import { describe, expect, it } from 'vitest'
import { buildMarketDislocations, selectMarketDislocations } from './dislocations'
import type { TeamDirection } from './edge'
import type { Asset, Team } from './types'

function asset(id: string, position: Asset['position'], value: number, overrides: Partial<Asset> = {}): Asset {
  return {
    id,
    name: id,
    kind: 'player',
    position,
    team: null,
    value,
    confidence: 0.9,
    age: 24,
    rank: null,
    projectedPpg: value / 100,
    marketSources: { ktc: value, fantasycalc: value },
    ...overrides,
  }
}

function team(id: number, players: Asset[]): Team {
  return {
    rosterId: id,
    ownerId: String(id),
    ownerName: `Owner ${id}`,
    teamName: `Team ${id}`,
    avatar: null,
    players,
    picks: [],
    optimizedStarters: [],
    metrics: {
      lineupRaw: 0, coreRaw: 0, depthRaw: 0, picksRaw: 0, liquidityRaw: 0, marketRaw: 0,
      lineup: 0, core: 0, depth: 0, picks: 0, liquidity: 0, market: 0, overall: 0, contender: 0, future: 0,
    },
  }
}

function direction(rosterId: number, overrides: Partial<TeamDirection> = {}): TeamDirection {
  return {
    rosterId,
    label: 'neutral',
    manual: false,
    recentTrades: 0,
    playerValueFlow: 0,
    pickValueFlow: 0,
    reasons: [],
    ...overrides,
  }
}

const rosterPositions = ['QB', 'RB', 'WR', 'TE']
const strategy = { mode: 'rebuilding' as const, horizonYears: 3 as const, flipPriority: 0 }

function completeTeam(id: number, prefix: string, extra: Asset[] = []): Team {
  return team(id, [
    asset(`${prefix}-qb`, 'QB', 700, { projectedPpg: 18 }),
    asset(`${prefix}-rb`, 'RB', 600, { projectedPpg: 14 }),
    asset(`${prefix}-wr`, 'WR', 650, { projectedPpg: 15 }),
    asset(`${prefix}-te`, 'TE', 400, { projectedPpg: 10 }),
    ...extra,
  ])
}

describe('market dislocation evidence', () => {
  it('compares KTC and FantasyCalc as ranks inside one dual-source population', () => {
    const mine = team(1, [
      asset('top', 'WR', 900, { marketSources: { ktc: 1000, fantasycalc: 1000 } }),
      asset('middle', 'WR', 600, { marketSources: { ktc: 800, fantasycalc: 500 } }),
    ])
    const target = asset('target', 'WR', 500, { marketSources: { ktc: 900, fantasycalc: 400 }, projectedPpg: 13 })
    const bottom = asset('bottom', 'WR', 200, { marketSources: { ktc: 100, fantasycalc: 300 } })
    const result = buildMarketDislocations([mine, team(2, [target, bottom])], {
      myRosterId: 1,
      rosterPositions,
      directions: [direction(2)],
      strategy,
    }).find((candidate) => candidate.asset.id === 'target')

    expect(result?.market).toMatchObject({
      ktc: 900,
      fantasycalc: 400,
      ktcRank: 2,
      fantasycalcRank: 3,
      population: 4,
      percentileGap: 33.3,
      higherRankSource: 'KTC',
    })
    expect(result?.categories).toContain('market-gap')
  })

  it('does not treat provider scale shape as player disagreement', () => {
    const mine = team(1, [
      asset('top', 'WR', 900, { marketSources: { ktc: 5000, fantasycalc: 500 } }),
      asset('second', 'WR', 800, { marketSources: { ktc: 4000, fantasycalc: 400 } }),
      asset('third', 'WR', 700, { marketSources: { ktc: 3000, fantasycalc: 300 } }),
    ])
    const alignedLow = asset('aligned-low', 'WR', 100, { marketSources: { ktc: 1000, fantasycalc: 100 } })
    const reordered = asset('reordered', 'WR', 400, { marketSources: { ktc: 2000, fantasycalc: 450 } })
    const candidates = buildMarketDislocations([mine, team(2, [alignedLow, reordered])], {
      myRosterId: 1,
      rosterPositions,
      directions: [direction(2)],
      strategy,
    })

    expect(candidates.find((candidate) => candidate.asset.id === 'aligned-low')?.market.percentileGap).toBe(0)
    expect(candidates.find((candidate) => candidate.asset.id === 'aligned-low')?.categories).not.toContain('market-gap')
    expect(selectMarketDislocations(candidates, 'market')[0].asset.id).toBe('reordered')
  })

  it('compares production and market percentiles within the same position', () => {
    const mine = completeTeam(1, 'mine')
    const expensive = asset('expensive', 'RB', 900, { projectedPpg: 8 })
    const cheapProducer = asset('cheap-producer', 'RB', 300, { projectedPpg: 20 })
    const candidates = buildMarketDislocations([mine, team(2, [expensive, cheapProducer])], {
      myRosterId: 1,
      rosterPositions,
      directions: [direction(2)],
      strategy,
    })
    const result = candidates.find((candidate) => candidate.asset.id === 'cheap-producer')

    expect(result?.production.productionRank).toBe(1)
    expect(result?.production.marketPopulation).toBe(result?.production.productionPopulation)
    expect(result?.production.percentileGap).toBeGreaterThan(0)
    expect(result?.categories).toContain('production-ahead')
    expect(selectMarketDislocations(candidates, 'production')[0].asset.id).toBe('cheap-producer')
  })

  it('keeps owner pressure factual and retains strict lineup coverage', () => {
    const mine = completeTeam(1, 'mine')
    const target = asset('bench-rb', 'RB', 250, { projectedPpg: 9 })
    const owner = completeTeam(2, 'them', [
      asset('backup-rb', 'RB', 450, { projectedPpg: 11 }),
      target,
    ])
    const result = buildMarketDislocations([mine, owner], {
      myRosterId: 1,
      rosterPositions,
      directions: [direction(2, { recentTrades: 3, playerValueFlow: -200, pickValueFlow: 200 })],
      strategy,
    }).find((candidate) => candidate.asset.id === 'bench-rb')

    expect(result?.pressure).toMatchObject({
      ownerLikelyStarter: false,
      ownerPositionCount: 3,
      dedicatedSlots: 1,
      countAboveDedicatedSlots: 2,
      recentTrades: 3,
      playerValueFlow: -200,
      pickValueFlow: 200,
    })
    expect(result?.pressure.myLineupDelta).not.toBeNull()
    expect(result?.pressure.ownerLineupLoss).not.toBeNull()
    expect(result?.categories).toEqual(expect.arrayContaining(['owner-depth', 'active-trader']))
  })

  it('uses the declared rebuild horizon only as a visible Pareto objective', () => {
    const mine = completeTeam(1, 'mine')
    const young = asset('young', 'RB', 500, { age: 21, projectedPpg: 12 })
    const old = asset('old', 'RB', 500, { age: 29, projectedPpg: 12 })
    const teams = [mine, completeTeam(2, 'young-owner', [young]), completeTeam(3, 'old-owner', [old])]
    const directions = [direction(2, { recentTrades: 1 }), direction(3, { recentTrades: 1 })]
    const rebuild = buildMarketDislocations(teams, { myRosterId: 1, rosterPositions, directions, strategy })
    const neutral = buildMarketDislocations(teams, {
      myRosterId: 1,
      rosterPositions,
      directions,
      strategy: { mode: 'neutral', horizonYears: 3, flipPriority: 0 },
    })

    expect(rebuild.find((candidate) => candidate.asset.id === 'young')?.frontier).toBe(true)
    expect(rebuild.find((candidate) => candidate.asset.id === 'old')?.frontier).toBe(false)
    expect(neutral.find((candidate) => candidate.asset.id === 'old')?.frontier).toBe(true)
  })

  it('is deterministic and never manufactures profit, acceptance, or an edge score', () => {
    const teams = [completeTeam(1, 'mine'), completeTeam(2, 'them', [asset('target', 'WR', 300, { projectedPpg: undefined })])]
    const options = { myRosterId: 1, rosterPositions, directions: [direction(2, { recentTrades: 1 })], strategy }
    const first = buildMarketDislocations(teams, options)
    const second = buildMarketDislocations(teams, options)
    const target = first.find((candidate) => candidate.asset.id === 'target')

    expect(first).toEqual(second)
    expect(target?.production.percentileGap).toBeNull()
    expect(target).not.toHaveProperty('edgeScore')
    expect(target).not.toHaveProperty('profit')
    expect(target).not.toHaveProperty('acceptance')
  })
})
