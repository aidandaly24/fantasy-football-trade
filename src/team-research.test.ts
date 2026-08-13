import { describe, expect, it } from 'vitest'
import { parseTeamAddress, teamAddress, teamValueAllocation } from './team-research'
import type { Asset, Team } from './types'

function asset(id: string, position: Asset['position'], value: number, kind: Asset['kind'] = 'player'): Asset {
  return { id, name: id, kind, position, team: null, value, confidence: 1, age: null, rank: null }
}

function team(): Team {
  return {
    rosterId: 2, ownerId: 'owner', ownerName: 'owner', teamName: 'Team', avatar: null,
    players: [asset('qb', 'QB', 300), asset('wr', 'WR', 500), asset('def', 'DEF', 50)],
    picks: [asset('pick', 'PICK', 400, 'pick')], optimizedStarters: [],
    metrics: { lineupRaw: 0, coreRaw: 0, depthRaw: 0, picksRaw: 0, liquidityRaw: 0, marketRaw: 0, lineup: 0, core: 0, depth: 0, picks: 0, liquidity: 0, market: 0, overall: 0, contender: 0, future: 0 },
  }
}

describe('team research', () => {
  it('round-trips supported league and roster addresses without retaining player state', () => {
    const search = teamAddress('?player=7', '1336087922847289344', 12)
    expect(search).toBe('?league=1336087922847289344&team=12')
    expect(parseTeamAddress(search)).toEqual({ leagueId: '1336087922847289344', rosterId: 12 })
    expect(parseTeamAddress('?league=unsupported&team=12')).toBeNull()
    expect(parseTeamAddress('?league=1336087922847289344&team=0')).toBeNull()
  })

  it('builds an exact current-value allocation without blending positions', () => {
    expect(teamValueAllocation(team())).toEqual([
      { label: 'WR', value: 500, count: 1 },
      { label: 'Picks', value: 400, count: 1 },
      { label: 'QB', value: 300, count: 1 },
      { label: 'Other', value: 50, count: 1 },
    ])
  })
})
