import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchIntel, fetchJournal, fetchSleeperPlayers, fetchTradyrPlayers, fetchValues, selectSleeperPlayers } from './api'
import type { SleeperPlayer, TradyrPlayer } from './types'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Sleeper player catalog selection', () => {
  it('selects rostered players from one bulk catalog without duplicating IDs', () => {
    const catalog: Record<string, SleeperPlayer> = {
      '101': { player_id: '101', full_name: 'First Player', position: 'WR' },
      '202': { player_id: '202', full_name: 'Second Player', position: 'RB' },
      '303': { player_id: '303', full_name: 'Unrostered Player', position: 'QB' },
    }

    const selected = selectSleeperPlayers(catalog, ['202', '101', '202', '0', 'missing'])

    expect([...selected.keys()]).toEqual(['202', '101'])
    expect(selected.get('101')?.full_name).toBe('First Player')
  })

  it('uses one bulk request for repeated roster selections', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      '101': { player_id: '101', full_name: 'First Player', position: 'WR' },
      '202': { player_id: '202', full_name: 'Second Player', position: 'RB' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const first = await fetchSleeperPlayers(['101'])
    const second = await fetchSleeperPlayers(['202'])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://api.sleeper.app/v1/players/nfl', undefined)
    expect(first.get('101')?.full_name).toBe('First Player')
    expect(second.get('202')?.full_name).toBe('Second Player')
  })
})

function tradyrPlayer(index: number): TradyrPlayer {
  return {
    slug: `player-${index}`,
    name: `Player ${index}`,
    position: 'WR',
    team: 'NFL',
    age: 24,
    composite: 500 - index,
    confidence: 1,
    rank: index + 1,
    posRank: index + 1,
    sources: { ktc: 1_000 - index, fantasycalc: 900 - index },
    sleeperId: String(10_000 + index),
  }
}

describe('Tradyr player coverage', () => {
  it('retrieves every provider page with overlap and deduplicates boundary rows', async () => {
    const total = 110
    const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = new URL(String(input))
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const data = Array.from(
        { length: Math.max(0, Math.min(50, total - offset)) },
        (_, index) => tradyrPlayer(offset + index),
      )
      return Promise.resolve(Response.json({
        data,
        meta: {
          generatedAt: `2026-08-16T00:00:${String(offset).padStart(2, '0')}.000Z`,
          sources: ['keeptradecut', 'fantasycalc'],
          attribution: 'Powered by Tradyr',
          total,
          limit: 50,
          offset,
        },
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchTradyrPlayers(new URLSearchParams({
      format: 'dynasty', numQbs: '2', tep: 'true', limit: '1000',
    }))

    expect(result.data).toHaveLength(total)
    expect(new Set(result.data.map((player) => player.sleeperId)).size).toBe(total)
    expect(result.meta.coverage).toEqual({ expected: total, returned: total, complete: true, pages: 3 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).searchParams.get('offset'))).toEqual([null, '45', '90'])
  })

  it('rebuilds global ranks when every provider page restarts rank at one', async () => {
    const total = 80
    const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = new URL(String(input))
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const data = Array.from(
        { length: Math.max(0, Math.min(50, total - offset)) },
        (_, index) => ({ ...tradyrPlayer(offset + index), rank: index + 1 }),
      )
      return Promise.resolve(Response.json({
        data,
        meta: {
          generatedAt: '2026-08-16T00:00:00.000Z',
          sources: ['fantasycalc'],
          attribution: 'Powered by Tradyr',
          total,
          limit: 50,
          offset,
        },
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchTradyrPlayers(new URLSearchParams({ format: 'redraft', limit: '1000' }))

    expect(result.data).toHaveLength(total)
    expect(result.data[49]).toMatchObject({ name: 'Player 49', rank: 50 })
    expect(result.data[50]).toMatchObject({ name: 'Player 50', rank: 51 })
    expect(result.data[79]).toMatchObject({ name: 'Player 79', rank: 80 })
  })

  it('rejects an incomplete market response instead of returning partial prices', async () => {
    const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = new URL(String(input))
      const offset = Number(url.searchParams.get('offset') ?? 0)
      return Promise.resolve(Response.json({
        data: offset === 0 ? Array.from({ length: 50 }, (_, index) => tradyrPlayer(index)) : [],
        meta: {
          generatedAt: '2026-08-16T00:00:00.000Z',
          sources: ['keeptradecut', 'fantasycalc'],
          attribution: 'Powered by Tradyr',
          total: 120,
          limit: 50,
          offset,
        },
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchTradyrPlayers(new URLSearchParams({ format: 'dynasty', limit: '1000' })))
      .rejects.toThrow('Tradyr player coverage incomplete')
  })
})

describe('secondary workspace request reuse', () => {
  it('shares an in-flight intel request across workspaces', async () => {
    let finishRequest: ((response: Response) => void) | undefined
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => {
      finishRequest = resolve
    }))
    vi.stubGlobal('fetch', fetchMock)

    const first = fetchIntel()
    const second = fetchIntel()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    finishRequest?.(Response.json({ articles: [], trends: [], sources: [], phaseGates: {} }))
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
  })

  it('reuses the prefetched journal when its screen opens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      trades: [], identities: [], snapshots: [], outcomes: [], sync: null,
    }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchJournal('999999999999999999')
    await fetchJournal('999999999999999999')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shares market requests for leagues using the same provider format', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: [], meta: { generatedAt: '2026-08-11T00:00:00.000Z' } }))
      .mockResolvedValueOnce(Response.json({ data: [], meta: { generatedAt: '2026-08-11T00:00:00.000Z' } }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchValues({ numQbs: 2, tep: true, numTeams: 10 })
    await fetchValues({ numQbs: 2, tep: true, numTeams: 10 })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
