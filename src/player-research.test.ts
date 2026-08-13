import { describe, expect, it } from 'vitest'
import { buildPlayerResearchProfile, parsePlayerAddress, playerAddress } from './player-research'
import type { Asset, Team } from './types'

function player(id: string, value: number, flags: Partial<Asset> = {}): Asset {
  return {
    id, name: `Player ${id}`, kind: 'player', position: 'WR', team: 'NE', value,
    confidence: 1, age: 23, rank: 20, ...flags,
  }
}

function team(rosterId: number, players: Asset[]): Team {
  return {
    rosterId, ownerId: String(rosterId), ownerName: `owner${rosterId}`, teamName: `Team ${rosterId}`,
    avatar: null, players, picks: [], optimizedStarters: players.slice(0, 1),
    metrics: { lineupRaw: 0, coreRaw: 0, depthRaw: 0, picksRaw: 0, liquidityRaw: 0, marketRaw: 0, lineup: 0, core: 0, depth: 0, picks: 0, liquidity: 0, market: 0, overall: 0, contender: 0, future: 0 },
  }
}

describe('player research profile', () => {
  it('resolves current league ownership and factual roster context', () => {
    const target = player('7', 900, { isTaxi: true })
    const profile = buildPlayerResearchProfile({
      playerId: '7', teams: [team(1, [player('1', 500)]), team(2, [target, player('8', 400)])],
      myRosterId: 1, marketAsOf: '2026-08-13T00:00:00Z',
    })
    expect(profile?.owner.rosterId).toBe(2)
    expect(profile?.rosterStatus).toBe('Taxi')
    expect(profile?.positionDepth.map((asset) => asset.id)).toEqual(['7', '8'])
    expect(profile?.isMyRoster).toBe(false)
  })

  it('returns null when the player is not rostered in the selected league', () => {
    expect(buildPlayerResearchProfile({ playerId: '404', teams: [team(1, [])], myRosterId: 1, marketAsOf: 'now' })).toBeNull()
  })

  it('round-trips only supported league and player addresses', () => {
    const search = playerAddress('', '1336087922847289344', '7')
    expect(parsePlayerAddress(search)).toEqual({ leagueId: '1336087922847289344', playerId: '7' })
    expect(parsePlayerAddress('?league=unsupported&player=7')).toBeNull()
    expect(parsePlayerAddress('?league=1336087922847289344')).toBeNull()
  })
})
