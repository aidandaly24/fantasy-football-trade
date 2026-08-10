import { describe, expect, it } from 'vitest'
import { buildTradePlan, findTargets } from './strategy'
import type { Asset, Team } from './types'

function asset(id: string, position: Asset['position'], value: number, overrides: Partial<Asset> = {}): Asset {
  return { id, name: id, kind: position === 'PICK' ? 'pick' : 'player', position, team: null, value, confidence: 0.9, age: position === 'RB' ? 24 : 25, rank: null, depthChartOrder: position === 'PICK' ? undefined : 1, projectedPpg: position === 'PICK' ? undefined : value / 100, ...overrides }
}
function team(id: number, players: Asset[], picks: Asset[] = [], contender = 50, future = 50): Team {
  return { rosterId: id, ownerId: String(id), ownerName: String(id), teamName: `Team ${id}`, avatar: null, players, picks, optimizedStarters: players.filter((item) => item.isStarter || item.depthChartOrder === 1).slice(0, 4), metrics: { lineupRaw: 0, coreRaw: 0, depthRaw: 0, picksRaw: 0, liquidityRaw: 0, marketRaw: 0, lineup: contender, core: future, depth: 50, picks: 50, liquidity: 50, market: 50, overall: 50, contender, future } }
}

describe('evidence-only strategy inventory', () => {
  const rosterPositions = ['QB', 'RB', 'WR', 'TE', 'FLEX']
  it('orders targets by observed current market value only', () => {
    const mine = team(1, [asset('qb', 'QB', 500), asset('wr', 'WR', 500), asset('te', 'TE', 500)])
    const theirs = team(2, [asset('rb-target', 'RB', 600), asset('wr-luxury', 'WR', 650), asset('rb-depth', 'RB', 520)])
    expect(findTargets([mine, theirs], {
      myRosterId: 1,
      counterpartRosterId: 2,
      rosterPositions,
      teamStrategy: { mode: 'contender', horizonYears: 1, flipPriority: 0.25 },
    })[0].asset.id).toBe('wr-luxury')
  })

  it('does not let an unvalidated age curve change target ordering', () => {
    const theirs = team(2, [asset('old', 'WR', 600, { age: 31 }), asset('young', 'WR', 600, { age: 22 })])
    const contender = team(1, [asset('qb', 'QB', 700), asset('rb', 'RB', 650), asset('te', 'TE', 500)], [], 80, 45)
    const rebuild = team(1, contender.players, [], 35, 85)
    expect(findTargets([contender, theirs], { myRosterId: 1, counterpartRosterId: 2, rosterPositions })[0].asset.id).toBe('old')
    expect(findTargets([rebuild, theirs], { myRosterId: 1, counterpartRosterId: 2, rosterPositions })[0].asset.id).toBe('old')
  })

  it('shows factual age at the declared horizon without creating a decay score', () => {
    const mine = team(1, [asset('young-qb', 'QB', 500)], [asset('future-first', 'PICK', 450)], 20, 90)
    const theirs = team(2, [
      asset('dak-profile', 'QB', 620, { age: 33 }),
      asset('young-market-qb', 'QB', 620, { age: 24 }),
    ])
    const targets = findTargets([mine, theirs], {
      myRosterId: 1,
      counterpartRosterId: 2,
      rosterPositions,
      teamStrategy: { mode: 'rebuilding', horizonYears: 3, flipPriority: 0.9 },
    })
    expect(targets.map((target) => target.asset.id)).toContain('young-market-qb')
    expect(targets.map((target) => target.asset.id)).toContain('dak-profile')
    expect(targets.find((target) => target.asset.id === 'dak-profile')?.ageAtHorizon).toBe(36)
  })

  it('does not generate packages without real response labels', () => {
    const mine = team(1, [asset('bench', 'WR', 300, { depthChartOrder: 3 }), asset('pick', 'PICK', 300), asset('starter', 'QB', 700)])
    const theirs = team(2, [asset('target', 'RB', 300), asset('rb2', 'RB', 260)])
    const options = { myRosterId: 1, counterpartRosterId: 2, rosterPositions, manager: { pickAffinity: 1, sampleWeight: 1 } }
    const first = buildTradePlan([mine, theirs], options)
    const second = buildTradePlan([mine, theirs], options)
    expect(first.packages).toEqual(second.packages)
    expect(first.packages).toEqual([])
    expect(first.evidenceNote).toContain('Automated offers are off')
  })

  it('does not turn manager affinity into a fake acceptance prediction', () => {
    const mine = team(1, [asset('player', 'WR', 300, { depthChartOrder: 3 }), asset('pick', 'PICK', 300)])
    const theirs = team(2, [asset('target', 'RB', 300), asset('depth', 'RB', 260)])
    const plan = buildTradePlan([mine, theirs], { myRosterId: 1, counterpartRosterId: 2, rosterPositions, manager: { pickAffinity: 1, playerAffinity: 0, sampleWeight: 1 } })
    expect(plan.packages).toEqual([])
  })

  it('returns no staged package when every option misses the partner-fit floor', () => {
    const mine = team(1, [asset('small-pick', 'PICK', 100), asset('bench', 'WR', 90, { depthChartOrder: 4 })])
    const theirs = team(2, [asset('cornerstone', 'QB', 1000), asset('backup', 'QB', 120)])
    const plan = buildTradePlan([mine, theirs], { myRosterId: 1, counterpartRosterId: 2, rosterPositions })
    expect(plan.packages).toEqual([])
  })

  it('never substitutes a different player when a selected target has no safe package', () => {
    const mine = team(1, [asset('small-pick', 'PICK', 100), asset('bench', 'WR', 90, { depthChartOrder: 4 })])
    const theirs = team(2, [asset('cornerstone', 'QB', 1000), asset('attainable', 'RB', 100)])
    const plan = buildTradePlan([mine, theirs], { myRosterId: 1, counterpartRosterId: 2, rosterPositions, targetAssetId: 'cornerstone', maxTargets: 20 })
    expect(plan.targets).toHaveLength(1)
    expect(plan.targets[0].asset.id).toBe('cornerstone')
    expect(plan.packages).toEqual([])
  })
})
