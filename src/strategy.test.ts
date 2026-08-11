import { describe, expect, it } from 'vitest'
import { findComparablePackages, resolveTeamStrategy } from './strategy'
import type { Asset, Team } from './types'

function asset(id: string, position: Asset['position'], value: number, overrides: Partial<Asset> = {}): Asset {
  return { id, name: id, kind: position === 'PICK' ? 'pick' : 'player', position, team: null, value, confidence: 0.9, age: position === 'RB' ? 24 : 25, rank: null, depthChartOrder: position === 'PICK' ? undefined : 1, projectedPpg: position === 'PICK' ? undefined : value / 100, ...overrides }
}
function team(id: number, players: Asset[], picks: Asset[] = [], contender = 50, future = 50): Team {
  return { rosterId: id, ownerId: String(id), ownerName: String(id), teamName: `Team ${id}`, avatar: null, players, picks, optimizedStarters: players.filter((item) => item.isStarter || item.depthChartOrder === 1).slice(0, 4), metrics: { lineupRaw: 0, coreRaw: 0, depthRaw: 0, picksRaw: 0, liquidityRaw: 0, marketRaw: 0, lineup: contender, core: future, depth: 50, picks: 50, liquidity: 50, market: 50, overall: 50, contender, future } }
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
})
