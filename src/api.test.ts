import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchIntel, fetchJournal, fetchSleeperPlayers, fetchValues, selectSleeperPlayers } from './api'
import type { SleeperPlayer } from './types'

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
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      players: [], picks: [], meta: { generatedAt: '2026-08-11T00:00:00.000Z' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchValues({ numQbs: 2, tep: true, numTeams: 10 })
    await fetchValues({ numQbs: 2, tep: true, numTeams: 10 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/market?format=dynasty&numQbs=2&tep=true&numTeams=10', undefined)
  })
})
