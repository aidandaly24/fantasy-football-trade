import { describe, expect, it } from 'vitest'
import { buildEdgeBoard, buildTeamDirections } from './edge'
import type { Asset, IntelSignal, PickValue, SleeperTransaction, Team } from './types'

function asset(id: string, position: Asset['position'], value: number, overrides: Partial<Asset> = {}): Asset {
  return { id, name: id, kind: position === 'PICK' ? 'pick' : 'player', position, team: null, value, confidence: 0.9, age: 25, rank: null, depthChartOrder: position === 'PICK' ? undefined : 1, projectedPpg: position === 'PICK' ? undefined : value / 100, ...overrides }
}

function team(id: number, players: Asset[], picks: Asset[] = [], contender = 50, future = 50): Team {
  return { rosterId: id, ownerId: String(id), ownerName: `Owner ${id}`, teamName: `Team ${id}`, avatar: null, players, picks, optimizedStarters: players.slice(0, 4), metrics: { lineupRaw: 0, coreRaw: 0, depthRaw: 0, picksRaw: 0, liquidityRaw: 0, marketRaw: 0, lineup: contender, core: future, depth: 50, picks: 50, liquidity: 50, market: 50, overall: 50, contender, future } }
}

const picks: PickValue[] = [
  { id: 'e', name: 'early', round: 1, slot: 2, year: '2027', tier: 'early', composite: 600, position: 'PICK' },
  { id: 'm', name: 'mid', round: 1, slot: 6, year: '2027', tier: 'mid', composite: 450, position: 'PICK' },
  { id: 'l', name: 'late', round: 1, slot: 11, year: '2027', tier: 'late', composite: 330, position: 'PICK' },
]

function trade(created: number): SleeperTransaction {
  return {
    transaction_id: 'trade-1', type: 'trade', status: 'complete', created, status_updated: created,
    roster_ids: [2, 3], consenter_ids: [2, 3], adds: { veteran: 2 }, drops: { veteran: 3 },
    draft_picks: [{ season: '2027', round: 1, roster_id: 2, previous_owner_id: 2, owner_id: 3 }],
  }
}

describe('league-wide edge engine', () => {
  it('uses recent trade flow and an explicit override for team direction', () => {
    const teams = [team(2, [asset('veteran', 'RB', 600)], [], 55, 55), team(3, [], [], 55, 55)]
    const automatic = buildTeamDirections({ teams, transactions: [trade(Date.UTC(2026, 7, 1))], picks, now: new Date('2026-08-10T00:00:00Z') })
    expect(automatic.find((item) => item.rosterId === 2)?.label).toBe('neutral')
    expect(automatic.find((item) => item.rosterId === 2)?.recentTrades).toBe(1)
    const overridden = buildTeamDirections({ teams, transactions: [], picks, overrides: { '2': 'rebuilding' } })
    expect(overridden.find((item) => item.rosterId === 2)).toMatchObject({ label: 'rebuilding', manual: true })
  })

  it('scans every opponent but never lets unvalidated news move market ordering', () => {
    const mine = team(1, [asset('qb', 'QB', 500), asset('wr', 'WR', 450), asset('te', 'TE', 350)], [], 65, 50)
    const ownerA = team(2, [asset('rb-news', 'RB', 420, { age: 22 }), asset('rb-depth', 'RB', 300)])
    const ownerB = team(3, [asset('rb-quiet', 'RB', 430), asset('rb-depth-2', 'RB', 300)])
    const directions = buildTeamDirections({ teams: [mine, ownerA, ownerB], transactions: [], picks, overrides: { '2': 'rebuilding', '3': 'rebuilding' } })
    const signal = {
      player: { slug: 'rb-news', name: 'rb-news', position: 'RB', team: 'NFL', age: 22, composite: 420, confidence: 0.9, rank: 10, posRank: 5, sources: { ktc: 420, fantasycalc: 420 }, sleeperId: 'rb-news' },
      articles: [{ id: 'a', title: 'rb-news named starter', url: 'https://example.com', source: 'Source', publishedAt: '2026-08-10T00:00:00Z', reliability: 0.9, expiresAt: '2026-08-12T00:00:00Z' }],
      direction: 'up', impactScore: 80, edgeScore: 82, confidence: 84, marketReactionScore: 10, freshnessScore: 95,
      action: 'Quietly inquire', rationale: 'Role expanded before the market moved.', add24: 2, drop24: 0, acceleration: 2, ownerTeam: ownerA, isMine: false,
    } satisfies IntelSignal
    const board = buildEdgeBoard([mine, ownerA, ownerB], { myRosterId: 1, rosterPositions: ['QB', 'RB', 'WR', 'TE'], directions, intelSignals: [signal] })
    expect(board[0].asset.id).toBe('rb-quiet')
    expect(board.find((item) => item.asset.id === 'rb-news')?.categories).toContain('intel')
    expect(board.some((item) => item.owner.rosterId === 3)).toBe(true)
  })

})
