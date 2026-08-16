import { describe, expect, it } from 'vitest'
import { FREAKBULL_KEEPER_RULE, keeperRetentionProbability, totalFreakbullKeepers } from './keeper-rules'

describe('Freakbull keeper rule', () => {
  it('keeps one protected player plus two of three equal-odds wheel candidates', () => {
    expect(FREAKBULL_KEEPER_RULE).toEqual({ protectedKeepers: 1, wheelCandidates: 3, wheelCuts: 1 })
    expect(keeperRetentionProbability('protected')).toBe(1)
    expect(keeperRetentionProbability('wheel')).toBeCloseTo(2 / 3)
    expect(totalFreakbullKeepers()).toBe(3)
  })
})
