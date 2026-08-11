import { describe, expect, it } from 'vitest'
import {
  createManualPendingTrade,
  isAcceptedPendingTrade,
  manualTradeAlreadySettled,
  manualTradeRejectedBySleeper,
  mergePendingTrades,
  projectPendingTrades,
} from './pending-trades'
import type { Asset, LeagueBundle, SleeperTransaction, Team } from './types'

const rosterPositions = ['QB', 'RB', 'WR', 'TE']

function asset(id: string, value: number, overrides: Partial<Asset> = {}): Asset {
  return {
    id,
    name: id,
    kind: 'player',
    position: 'WR',
    team: 'NFL',
    value,
    confidence: 1,
    age: 23,
    rank: null,
    projectedPpg: value / 100,
    ...overrides,
  }
}

function pick(id: string, ownerRosterId: number, originalRosterId: number, value = 300): Asset {
  return asset(id, value, {
    kind: 'pick',
    position: 'PICK',
    team: null,
    age: null,
    year: '2027',
    round: 1,
    originalRosterId,
    ownerRosterId,
  })
}

function team(rosterId: number, players: Asset[], picks: Asset[] = []): Team {
  return {
    rosterId,
    ownerId: String(rosterId),
    ownerName: `Owner ${rosterId}`,
    teamName: `Team ${rosterId}`,
    avatar: null,
    players,
    picks,
    optimizedStarters: [],
    metrics: {
      lineupRaw: 0, coreRaw: 0, depthRaw: 0, picksRaw: 0, liquidityRaw: 0, marketRaw: 0,
      lineup: 0, core: 0, depth: 0, picks: 0, liquidity: 0, market: 0, overall: 0, contender: 0, future: 0,
    },
  }
}

function transaction(overrides: Partial<SleeperTransaction> = {}): SleeperTransaction {
  return {
    transaction_id: 'trade-1',
    type: 'trade',
    status: 'pending',
    created: 100,
    status_updated: 100,
    roster_ids: [1, 2],
    consenter_ids: [1, 2],
    adds: { p1: 2, p2: 1 },
    drops: { p1: 1, p2: 2 },
    draft_picks: [],
    ...overrides,
  }
}

describe('pending trade projection', () => {
  it('projects only accepted trades that remain pending', () => {
    expect(isAcceptedPendingTrade(transaction())).toBe(true)
    expect(isAcceptedPendingTrade(transaction({ status: 'complete' }))).toBe(false)
    expect(isAcceptedPendingTrade(transaction({ status: 'failed' }))).toBe(false)
    expect(isAcceptedPendingTrade(transaction({ consenter_ids: [1] }))).toBe(false)
  })

  it('maintains settled, committed, available, ranking, and pick ownership state', () => {
    const p1 = asset('p1', 500)
    const p2 = asset('p2', 200)
    const first = pick('pick:2027:1:1', 1, 1)
    const settled = [team(1, [p1], [first]), team(2, [p2])]
    const pending = transaction({
      draft_picks: [{ season: '2027', round: 1, roster_id: 1, previous_owner_id: 1, owner_id: 2 }],
    })
    const projection = projectPendingTrades(
      settled,
      mergePendingTrades([pending], []),
      rosterPositions,
    )

    expect(settled[0].players.map((item) => item.id)).toEqual(['p1'])
    expect(projection.committedTeams[0].players.map((item) => item.id)).toEqual(['p2'])
    expect(projection.committedTeams[1].players.map((item) => item.id)).toEqual(['p1'])
    expect(projection.committedTeams[1].picks[0]).toMatchObject({ id: 'pick:2027:1:1', ownerRosterId: 2 })
    expect(projection.committedTeams[1].metrics.market).toBe(800)
    expect(projection.availableTeams.flatMap((item) => [...item.players, ...item.picks])).toHaveLength(0)
    expect(projection.lockedAssetIds).toEqual(['p1', 'p2', 'pick:2027:1:1'])
    expect(projection.issues).toEqual([])
  })

  it('applies chained moves deterministically and deduplicates manual copies', () => {
    const settled = [team(1, [asset('p1', 500)]), team(2, []), team(3, [])]
    const first = transaction({ transaction_id: 'first', adds: { p1: 2 }, drops: { p1: 1 } })
    const second = transaction({ transaction_id: 'second', created: 200, roster_ids: [2, 3], consenter_ids: [2, 3], adds: { p1: 3 }, drops: { p1: 2 } })
    const manualCopy = createManualPendingTrade({ teamAId: 1, teamBId: 2, sideA: [settled[0].players[0]], sideB: [], now: 150 })
    const records = mergePendingTrades([second, first], [manualCopy])
    const projection = projectPendingTrades(settled, records, rosterPositions)

    expect(records).toHaveLength(2)
    expect(projection.committedTeams.find((item) => item.rosterId === 3)?.players.map((item) => item.id)).toEqual(['p1'])
    expect(projection.issues).toEqual([])
  })

  it('rolls back by recomputing without the cancelled transaction', () => {
    const settled = [team(1, [asset('p1', 500)]), team(2, [asset('p2', 200)])]
    const committed = projectPendingTrades(settled, mergePendingTrades([transaction()], []), rosterPositions)
    const rolledBack = projectPendingTrades(settled, [], rosterPositions)

    expect(committed.committedTeams[0].players.map((item) => item.id)).toEqual(['p2'])
    expect(rolledBack.committedTeams[0].players.map((item) => item.id)).toEqual(['p1'])
    expect(rolledBack.lockedAssetIds).toEqual([])
  })

  it('recognizes a private commitment after Sleeper settles every leg', () => {
    const pending = createManualPendingTrade({
      teamAId: 1,
      teamBId: 2,
      sideA: [asset('p1', 500), pick('pick:2027:1:1', 1, 1)],
      sideB: [asset('p2', 200)],
      now: 100,
    })
    const bundle = {
      rosters: [
        { roster_id: 1, owner_id: '1', players: ['p2'], starters: [], reserve: [], taxi: [] },
        { roster_id: 2, owner_id: '2', players: ['p1'], starters: [], reserve: [], taxi: [] },
      ],
      tradedPicks: [{ season: '2027', round: 1, roster_id: 1, previous_owner_id: 1, owner_id: 2 }],
    } as unknown as LeagueBundle

    expect(manualTradeAlreadySettled(pending, bundle)).toBe(true)
    expect(manualTradeAlreadySettled(pending, { ...bundle, tradedPicks: [] })).toBe(false)
    expect(manualTradeRejectedBySleeper(pending, [transaction({
      status: 'failed',
      adds: { p1: 2, p2: 1 },
      drops: { p1: 1, p2: 2 },
      draft_picks: [{ season: '2027', round: 1, roster_id: 1, previous_owner_id: 1, owner_id: 2 }],
    })])).toBe(true)
  })

  it('reports unresolved assets instead of inventing ownership', () => {
    const settled = [team(1, []), team(2, [])]
    const projection = projectPendingTrades(settled, mergePendingTrades([transaction({ adds: { missing: 2 }, drops: { missing: 1 } })], []), rosterPositions)

    expect(projection.issues).toHaveLength(1)
    expect(projection.committedTeams.flatMap((item) => item.players)).toHaveLength(0)
  })
})
