import { describe, expect, it } from 'vitest'
import { strategyProfileForLeague } from '..'
import { EMPEROR_PHIL_LEAGUE_ID, emperorPhilStrategy } from './strategy'

describe('Emperor Phil private strategy boundary', () => {
  it('applies only to Aidan roster 5 in the fixed league', () => {
    expect(strategyProfileForLeague(EMPEROR_PHIL_LEAGUE_ID, 5)).toBe(emperorPhilStrategy)
    expect(strategyProfileForLeague(EMPEROR_PHIL_LEAGUE_ID, 2)).toBeNull()
    expect(strategyProfileForLeague('1336087922847289344', 5)).toBeNull()
  })

  it('declares a top-six power goal and protects the 2027 first', () => {
    expect(emperorPhilStrategy.targetRank).toBe(6)
    expect(emperorPhilStrategy.minimumMeaningfulPowerGain).toBeLessThan(emperorPhilStrategy.idealPowerGain)
    expect(emperorPhilStrategy.protectedAssets).toContainEqual(expect.objectContaining({ year: 2027, round: 1 }))
  })
})
