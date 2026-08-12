import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSleeperPlayers, selectSleeperPlayers } from './api'
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
