import { describe, expect, it } from 'vitest'
import { buildActionableTradeBook } from './actionable-targets'
import { buildNegotiationLadder, buildTradeDiscovery, findComparablePackages, findTradeFrontier, resolveTeamStrategy } from './strategy'
import type { AssetReturnHealthBundle } from './asset-returns'
import type { Asset, Team } from './types'

function asset(id: string, position: Asset['position'], value: number, overrides: Partial<Asset> = {}): Asset {
  return { id, name: id, kind: position === 'PICK' ? 'pick' : 'player', position, team: null, value, confidence: 0.9, age: position === 'RB' ? 24 : 25, rank: null, depthChartOrder: position === 'PICK' ? undefined : 1, projectedPpg: position === 'PICK' ? undefined : value / 100, ...overrides }
}
function team(id: number, players: Asset[], picks: Asset[] = [], contender = 50, future = 50): Team {
  return { rosterId: id, ownerId: String(id), ownerName: String(id), teamName: `Team ${id}`, avatar: null, players, picks, optimizedStarters: players.filter((item) => item.isStarter || item.depthChartOrder === 1).slice(0, 4), metrics: { lineupRaw: 0, coreRaw: 0, depthRaw: 0, picksRaw: 0, liquidityRaw: 0, marketRaw: 0, lineup: contender, core: future, depth: 50, picks: 50, liquidity: 50, market: 50, overall: 50, contender, future } }
}

function returnHealth(rows: Array<{
  id: string
  name?: string
  value: number
  age?: number
  expected: number
  lower: number
  liquidity: number
  drawdown: number
}>): AssetReturnHealthBundle {
  return {
    sourceAudit: { survivorWarning: 'Tracked assets only.' },
    models: [],
    assets: Object.fromEntries(rows.map((row, index) => [row.id, {
      fantasyCalcId: index + 1,
      sleeperId: row.id,
      name: row.name ?? row.id,
      position: 'WR',
      format: '2qb',
      currentValue: row.value,
      overallRank: index + 1,
      age: row.age ?? 24,
      tradeFrequency: row.liquidity,
      consensusVariancePercent: 2,
      risk: { observed30dReturn: 0, observed90dReturn: 0, monthlyVolatility30d: 0.1, maxDrawdown90d: row.drawdown, maxDrawdown180d: row.drawdown, observations180d: 180 },
      horizons: { '30': { status: 'validated', enabled: true, expectedReturn: row.expected, trackedAssetLower: row.lower, trackedAssetUpper: row.expected + 0.1 }, '90': { status: 'shadow', enabled: false }, '180': { status: 'needs-data', enabled: false }, '365': { status: 'needs-data', enabled: false } },
    }])),
  } as unknown as AssetReturnHealthBundle
}

describe('evidence-only strategy inventory', () => {
  const rosterPositions = ['QB', 'RB', 'WR', 'TE', 'FLEX']
  it('keeps automatic strategy neutral', () => {
    const mine = team(1, [asset('young-qb', 'QB', 500)])
    expect(resolveTeamStrategy(mine)).toEqual({ mode: 'neutral', horizonYears: 2, flipPriority: 0 })
  })

  it('resolves a declared team strategy without inventing a score', () => {
    const mine = team(1, [asset('young-qb', 'QB', 500)], [asset('future-first', 'PICK', 450)], 20, 90)
    expect(resolveTeamStrategy(mine, { mode: 'rebuilding', horizonYears: 3, flipPriority: 0.9 })).toEqual({
      mode: 'rebuilding',
      horizonYears: 3,
      flipPriority: 0.9,
    })
  })

  it('builds deterministic current-value comparisons without an acceptance score', () => {
    const mine = team(1, [
      asset('starter', 'QB', 700, { isStarter: true }),
      asset('bench', 'WR', 310, { depthChartOrder: 3 }),
    ], [asset('second', 'PICK', 190)])
    const theirs = team(2, [asset('target', 'RB', 500), asset('other', 'WR', 450)])
    const options = { myRosterId: 1, counterpartRosterId: 2, rosterPositions, targetAssetId: 'target' }

    const first = findComparablePackages([mine, theirs], options)
    const second = findComparablePackages([mine, theirs], options)

    expect(first).toEqual(second)
    expect(first[0].send.map((item) => item.id)).toEqual(['bench', 'second'])
    expect(first[0].sendValue).toBe(500)
    expect(first[0].receiveValue).toBe(500)
    expect(first[0].marketNetToMe).toBe(0)
    expect(first[0].frontier).toBe(true)
    expect(first[0]).not.toHaveProperty('acceptanceScore')
    expect(first[0]).not.toHaveProperty('profitScore')
  })

  it('locks comparisons to the selected target and at most three outgoing assets', () => {
    const mine = team(1, [asset('a', 'WR', 100), asset('b', 'WR', 100), asset('c', 'WR', 100), asset('d', 'WR', 100)])
    const theirs = team(2, [asset('target', 'RB', 300), asset('other', 'RB', 300)])
    const packages = findComparablePackages([mine, theirs], {
      myRosterId: 1,
      counterpartRosterId: 2,
      rosterPositions,
      targetAssetId: 'target',
    })

    expect(packages[0].receive.map((item) => item.id)).toEqual(['target'])
    expect(packages.every((item) => item.send.length <= 3)).toBe(true)
  })

  it('compares an explicit multi-asset target basket without manufacturing a grade', () => {
    const mine = team(1, [asset('qb', 'QB', 500), asset('wr', 'WR', 300)], [asset('second', 'PICK', 200)])
    const theirs = team(2, [asset('target-a', 'RB', 320), asset('target-b', 'WR', 380)])
    const packages = findComparablePackages([mine, theirs], {
      myRosterId: 1,
      counterpartRosterId: 2,
      rosterPositions,
      targetAssetIds: ['target-a', 'target-b'],
      strategy: { mode: 'rebuilding', horizonYears: 3, flipPriority: 0 },
    })

    expect(packages[0].receive.map((item) => item.id).sort()).toEqual(['target-a', 'target-b'])
    expect(packages[0]).not.toHaveProperty('grade')
    expect(packages[0].tradeoffs.some((item) => item.includes('draft capital'))).toBe(true)
  })

  it('returns a deterministic league-wide Pareto frontier using only visible objectives', () => {
    const mine = team(1, [asset('veteran', 'QB', 500, { age: 31 }), asset('young-wr', 'WR', 300, { age: 23 })], [asset('first', 'PICK', 450)])
    const teams = [
      mine,
      team(2, [asset('young-target', 'RB', 500, { age: 22 })]),
      team(3, [asset('old-target', 'RB', 500, { age: 29 })], [asset('their-first', 'PICK', 450)]),
    ]
    const options = {
      myRosterId: 1,
      rosterPositions,
      strategy: { mode: 'rebuilding' as const, horizonYears: 3 as const, flipPriority: 0 },
    }

    const first = findTradeFrontier(teams, options)
    const second = findTradeFrontier(teams, options)
    const neutral = findTradeFrontier(teams, {
      ...options,
      strategy: { mode: 'neutral', horizonYears: 3, flipPriority: 0 },
    }, 16)

    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThan(0)
    expect(first.every((candidate) => candidate.frontier)).toBe(true)
    expect(first.every((candidate) => !('acceptanceScore' in candidate))).toBe(true)
    expect(first.some((candidate) => candidate.targetAsset.id === 'old-target')).toBe(false)
    expect(neutral.some((candidate) => candidate.targetAsset.id === 'old-target')).toBe(true)
  })

  it('keeps every priced target available to downstream thesis screens', () => {
    const mine = team(1, [asset('inventory', 'WR', 500)])
    const targets = Array.from({ length: 20 }, (_, index) => asset(`target-${index}`, 'WR', 100 + index * 20, { age: 22 + (index % 5) }))
    const discovery = buildTradeDiscovery([mine, team(2, targets)], {
      myRosterId: 1,
      rosterPositions,
      strategy: { mode: 'rebuilding', horizonYears: 3, flipPriority: 0 },
    }, 4)

    expect(discovery.candidates).toHaveLength(20)
    expect(discovery.frontier.length).toBeLessThanOrEqual(4)
    expect(new Set(discovery.candidates.map((candidate) => candidate.targetAsset.id)).size).toBe(20)
  })

  it('adds promoted return evidence to a declared rebuild without inventing a score', () => {
    const mine = team(1, [asset('out', 'WR', 500, { name: 'Out' })])
    const theirs = team(2, [asset('target', 'WR', 500, { name: 'Target' })])
    const makeReturnAsset = (sleeperId: string, expectedReturn: number) => ({
      fantasyCalcId: sleeperId === 'out' ? 1 : 2, sleeperId, name: sleeperId === 'out' ? 'Out' : 'Target', position: 'WR', format: '2qb', currentValue: 500,
      overallRank: 1, age: 24, tradeFrequency: 1, consensusVariancePercent: 2,
      risk: { observed30dReturn: 0, observed90dReturn: 0, monthlyVolatility30d: 0.1, maxDrawdown90d: -0.1, maxDrawdown180d: -0.2, observations180d: 180 },
      horizons: { '30': { status: 'validated', enabled: true, expectedReturn, trackedAssetLower: expectedReturn - 0.1, trackedAssetUpper: expectedReturn + 0.1 }, '90': { status: 'shadow', enabled: false }, '180': { status: 'needs-data', enabled: false }, '365': { status: 'needs-data', enabled: false } },
    })
    const health = {
      sourceAudit: { survivorWarning: 'Tracked assets only.' },
      models: [],
      assets: { out: makeReturnAsset('out', -0.1), target: makeReturnAsset('target', 0.1) },
    } as unknown as AssetReturnHealthBundle
    const packages = findComparablePackages([mine, theirs], {
      myRosterId: 1,
      counterpartRosterId: 2,
      rosterPositions,
      targetAssetId: 'target',
      strategy: { mode: 'rebuilding', horizonYears: 3, flipPriority: 0 },
      assetReturnHealth: health,
      numQbs: 2,
    })
    expect(packages[0].portfolio?.expectedPnl30).toBeCloseTo(100)
    expect(packages[0].tradeoffs.join(' ')).toContain('FantasyCalc-value')
    expect(packages[0]).not.toHaveProperty('score')
  })

  it('builds an actionable trade book from visible league-relative gates', () => {
    const mine = team(1, [asset('out', 'WR', 500, { name: 'Out', age: 25, isStarter: true })])
    const young = asset('young', 'WR', 500, { name: 'Young', age: 22, isStarter: true })
    const old = asset('old', 'WR', 500, { name: 'Old', age: 33, isStarter: true })
    const health = returnHealth([
      { id: 'out', name: 'Out', value: 500, age: 25, expected: -0.1, lower: -0.2, liquidity: 0.01, drawdown: -0.2 },
      { id: 'young', name: 'Young', value: 500, age: 22, expected: 0.15, lower: 0.02, liquidity: 0.02, drawdown: -0.1 },
      { id: 'old', name: 'Old', value: 500, age: 33, expected: 0.2, lower: -0.4, liquidity: 0.001, drawdown: -0.5 },
    ])
    const teams = [mine, team(2, [young]), team(3, [old])]
    const strategy = { mode: 'rebuilding' as const, horizonYears: 3 as const, flipPriority: 0 }
    const discovery = buildTradeDiscovery(teams, {
      myRosterId: 1,
      rosterPositions,
      strategy,
      assetReturnHealth: health,
      numQbs: 2,
    })
    const book = buildActionableTradeBook({ teams, myRosterId: 1, strategy, assetReturnHealth: health, numQbs: 2, candidates: discovery.candidates })

    expect(book.candidates.map((candidate) => candidate.targetAsset.id)).toContain('young')
    expect(book.candidates.map((candidate) => candidate.targetAsset.id)).not.toContain('old')
    expect(book.candidates[0].gates.every((gate) => gate.passed)).toBe(true)
    expect(book.candidates[0]).not.toHaveProperty('score')
    expect(book.method).toContain('no weighted target score')
  })

  it('allows a smaller catalyst only when promoted package P&L, downside, liquidity, age, and role all clear', () => {
    const mine = team(1, [asset('core', 'WR', 700, { name: 'Core', age: 23, isStarter: true }), asset('out-small', 'WR', 300, { name: 'Out Small', age: 25, depthChartOrder: 3 })], [asset('out-pick', 'PICK', 200)])
    const flip = asset('flip', 'WR', 300, { name: 'Flip', age: 22, depthChartOrder: 2 })
    const anchor = asset('anchor', 'WR', 600, { name: 'Anchor', age: 25, isStarter: true })
    const health = returnHealth([
      { id: 'out-small', name: 'Out Small', value: 300, expected: -0.1, lower: -0.2, liquidity: 0.01, drawdown: -0.2 },
      { id: 'flip', name: 'Flip', value: 300, age: 22, expected: 0.35, lower: 0.1, liquidity: 0.03, drawdown: -0.05 },
      { id: 'anchor', name: 'Anchor', value: 600, age: 25, expected: 0, lower: -0.2, liquidity: 0.01, drawdown: -0.2 },
    ])
    const teams = [mine, team(2, [flip]), team(3, [anchor])]
    const strategy = { mode: 'rebuilding' as const, horizonYears: 3 as const, flipPriority: 0 }
    const discovery = buildTradeDiscovery(teams, {
      myRosterId: 1,
      rosterPositions,
      strategy,
      assetReturnHealth: health,
      numQbs: 2,
    })
    const book = buildActionableTradeBook({ teams, myRosterId: 1, strategy, assetReturnHealth: health, numQbs: 2, candidates: discovery.candidates })
    const candidate = book.candidates.find((item) => item.targetAsset.id === 'flip')

    expect(candidate?.book).toBe('catalyst-flip')
    expect(candidate?.holdPeriod).toContain('30–90 days')
  })

  it('surfaces a discounted conversion into draft liquidity', () => {
    const mine = team(1, [asset('piece-a', 'WR', 250), asset('piece-b', 'WR', 250)])
    const futurePick = asset('future-first', 'PICK', 500, { year: '2027', round: 1, projectedTier: 'mid' })
    const health = returnHealth([
      { id: 'piece-a', value: 250, expected: 0, lower: -0.1, liquidity: 0.01, drawdown: -0.1 },
      { id: 'piece-b', value: 250, expected: 0, lower: -0.1, liquidity: 0.01, drawdown: -0.1 },
    ])
    const teams = [mine, team(2, [], [futurePick])]
    const strategy = { mode: 'rebuilding' as const, horizonYears: 3 as const, flipPriority: 0 }
    const discovery = buildTradeDiscovery(teams, {
      myRosterId: 1,
      rosterPositions,
      strategy,
      assetReturnHealth: health,
      numQbs: 2,
    })
    const book = buildActionableTradeBook({ teams, myRosterId: 1, strategy, assetReturnHealth: health, numQbs: 2, candidates: discovery.candidates })
    const candidate = book.candidates.find((item) => item.targetAsset.id === 'future-first')

    expect(candidate?.book).toBe('liquidity-conversion')
    expect(candidate?.marketNetToMe).toBeGreaterThanOrEqual(0)
    expect(candidate?.send.length).toBeLessThanOrEqual(2)
  })

  it('derives negotiation anchors from visible packages without acceptance odds', () => {
    const mine = team(1, [asset('fair', 'WR', 500), asset('cheap', 'WR', 450), asset('dear', 'WR', 550)])
    const theirs = team(2, [asset('target', 'RB', 500)])
    const candidates = findComparablePackages([mine, theirs], { myRosterId: 1, counterpartRosterId: 2, rosterPositions, targetAssetId: 'target' }, 12)
    const fair = candidates.find((candidate) => candidate.send.some((item) => item.id === 'fair'))!
    const ladder = buildNegotiationLadder([
      { ...fair, key: 'cheap', sendValue: 450, marketDistancePercent: 0.1 },
      fair,
      { ...fair, key: 'dear', sendValue: 550, marketDistancePercent: 0.1 },
    ])
    expect(ladder.map((step) => step.stage)).toEqual(['ambitious-opening', 'fair-target', 'walk-away'])
    expect(ladder.every((step) => !('acceptanceScore' in step))).toBe(true)
  })

})
