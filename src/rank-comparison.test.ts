import { describe, expect, it } from 'vitest'
import { buildTeamRankComparisons } from './rank-comparison'

function team(rosterId: number, overall: number, contender: number) {
  return {
    rosterId,
    metrics: { overall, contender },
  } as Parameters<typeof buildTeamRankComparisons>[0][number]
}

describe('team rank comparison', () => {
  it('keeps dynasty-market and current-season power ranks separate', () => {
    const comparisons = buildTeamRankComparisons([
      team(1, 100, 40),
      team(2, 90, 80),
      team(3, 80, 70),
    ])

    expect(comparisons.get(1)).toEqual({ marketRank: 1, powerRank: 3, powerGap: 2 })
    expect(comparisons.get(2)).toEqual({ marketRank: 2, powerRank: 1, powerGap: -1 })
  })

  it('uses competition ranking for tied scores', () => {
    const comparisons = buildTeamRankComparisons([
      team(1, 100, 80),
      team(2, 100, 70),
      team(3, 80, 70),
    ])

    expect(comparisons.get(1)?.marketRank).toBe(1)
    expect(comparisons.get(2)?.marketRank).toBe(1)
    expect(comparisons.get(2)?.powerRank).toBe(2)
    expect(comparisons.get(3)?.powerRank).toBe(2)
  })
})
