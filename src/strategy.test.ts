import { describe, expect, it } from 'vitest'
import { buildTradePlan, findTargets } from './strategy'
import type { Asset, Team } from './types'

function asset(id: string, position: Asset['position'], value: number, overrides: Partial<Asset> = {}): Asset {
  return { id, name: id, kind: position === 'PICK' ? 'pick' : 'player', position, team: null, value, confidence: 0.9, age: position === 'RB' ? 24 : 25, rank: null, depthChartOrder: position === 'PICK' ? undefined : 1, projectedPpg: position === 'PICK' ? undefined : value / 100, ...overrides }
}
function team(id: number, players: Asset[], picks: Asset[] = [], contender = 50, future = 50): Team {
  return { rosterId: id, ownerId: String(id), ownerName: String(id), teamName: `Team ${id}`, avatar: null, players, picks, optimizedStarters: players.filter((item) => item.isStarter || item.depthChartOrder === 1).slice(0, 4), metrics: { lineupRaw: 0, coreRaw: 0, depthRaw: 0, picksRaw: 0, liquidityRaw: 0, marketRaw: 0, lineup: contender, core: future, depth: 50, picks: 50, liquidity: 50, market: 50, overall: 50, contender, future } }
}

describe('deterministic strategy engine', () => {
  const rosterPositions = ['QB', 'RB', 'WR', 'TE', 'FLEX']
  it('ranks a lineup need above an equally valued luxury target', () => {
    const mine = team(1, [asset('qb', 'QB', 500), asset('wr', 'WR', 500), asset('te', 'TE', 500)])
    const theirs = team(2, [asset('rb-target', 'RB', 600), asset('wr-luxury', 'WR', 600), asset('rb-depth', 'RB', 520)])
    expect(findTargets([mine, theirs], { myRosterId: 1, counterpartRosterId: 2, rosterPositions })[0].asset.id).toBe('rb-target')
  })

  it('changes timeline preference between contender and future build', () => {
    const theirs = team(2, [asset('old', 'WR', 600, { age: 31 }), asset('young', 'WR', 600, { age: 22 })])
    const contender = team(1, [asset('qb', 'QB', 700), asset('rb', 'RB', 650), asset('te', 'TE', 500)], [], 80, 45)
    const rebuild = team(1, contender.players, [], 35, 85)
    expect(findTargets([contender, theirs], { myRosterId: 1, counterpartRosterId: 2, rosterPositions })[0].asset.id).toBe('old')
    expect(findTargets([rebuild, theirs], { myRosterId: 1, counterpartRosterId: 2, rosterPositions })[0].asset.id).toBe('young')
  })

  it('returns stable, capped packages and honors the walk-away price cap', () => {
    const mine = team(1, [asset('bench', 'WR', 300, { depthChartOrder: 3 }), asset('pick', 'PICK', 300), asset('starter', 'QB', 700)])
    const theirs = team(2, [asset('target', 'RB', 300), asset('rb2', 'RB', 260)])
    const options = { myRosterId: 1, counterpartRosterId: 2, rosterPositions, manager: { pickAffinity: 1, sampleWeight: 1 } }
    const first = buildTradePlan([mine, theirs], options)
    const second = buildTradePlan([mine, theirs], options)
    expect(first.packages).toEqual(second.packages)
    expect(first.packages.length).toBeGreaterThan(0)
    expect(first.packages.every((item) => item.send.reduce((sum, asset) => sum + asset.value, 0) <= item.receive.reduce((sum, asset) => sum + asset.value, 0) * 1.08)).toBe(true)
    expect(first.packages.every((item) => item.send.length <= 3)).toBe(true)
    expect(first.packages.every((item) => item.acceptanceScore >= ({ opening: 42, target: 48, counter: 54, 'walk-away': 60 }[item.stage]))).toBe(true)
  })

  it('makes pick affinity observable in the opening offer when values are interchangeable', () => {
    const mine = team(1, [asset('player', 'WR', 300, { depthChartOrder: 3 }), asset('pick', 'PICK', 300)])
    const theirs = team(2, [asset('target', 'RB', 300), asset('depth', 'RB', 260)])
    const plan = buildTradePlan([mine, theirs], { myRosterId: 1, counterpartRosterId: 2, rosterPositions, manager: { pickAffinity: 1, playerAffinity: 0, sampleWeight: 1 } })
    expect(plan.packages[0].send[0].id).toBe('pick')
  })

  it('returns no staged package when every option misses the partner-fit floor', () => {
    const mine = team(1, [asset('small-pick', 'PICK', 100), asset('bench', 'WR', 90, { depthChartOrder: 4 })])
    const theirs = team(2, [asset('cornerstone', 'QB', 1000), asset('backup', 'QB', 120)])
    const plan = buildTradePlan([mine, theirs], { myRosterId: 1, counterpartRosterId: 2, rosterPositions })
    expect(plan.packages).toEqual([])
  })
})
