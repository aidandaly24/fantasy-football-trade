import { describe, expect, it } from 'vitest'
import type { LeagueContext } from './league-context'
import { buildConsolidationStructure, modelSignalsForTrade, predictPortableModel, weightTradeEvidence } from './trade-models'
import type { Asset, Team } from './types'

const asset = (id: string, value: number, kind: Asset['kind'] = 'player'): Asset => ({
  id, name: id, kind, position: kind === 'pick' ? 'PICK' : 'WR', team: null, value, confidence: 1, age: kind === 'pick' ? null : 23, rank: null,
})
const team = (rosterId: number): Team => ({
  rosterId, ownerId: null, ownerName: String(rosterId), teamName: String(rosterId), avatar: null,
  players: Array.from({ length: 24 }, (_, index) => asset(`${rosterId}-${index}`, 10)), picks: [], optimizedStarters: [],
  metrics: {} as Team['metrics'],
})
const context = {
  marketFormat: { numTeams: 12, numQbs: 2, tep: true },
  scoring: { receptionPpr: 1, tePremiumPerReception: 0.75 },
  roster: { skillStartingSlots: 10 },
} as LeagueContext

describe('trade model evidence layers', () => {
  it('describes consolidation without changing either raw package value', () => {
    const structure = buildConsolidationStructure({
      sideA: [asset('elite', 100)], sideB: [asset('p1', 65), asset('pick', 50, 'pick')],
      teamA: team(1), teamB: team(2), marketPopulation: Array.from({ length: 120 }, (_, index) => index + 1), leagueContext: context,
    })
    expect(structure?.eliteAcquirer).toBe('B')
    expect(structure?.actualPremium).toBeCloseTo(0.15)
    expect(structure?.featureValues.package_size).toBe(2)
  })

  it('evaluates portable coefficients deterministically', () => {
    expect(predictPortableModel({
      kind: 'standardized-ridge-v1', features: ['x'], means: [2], scales: [2], coefficients: [4], intercept: 1,
    }, { x: 4 })).toBe(5)
  })

  it('does not use models that still need data as trade evidence', () => {
    const signals = modelSignalsForTrade({
      rawMarketPercent: 4, lineupPercent: 2, structure: null, health: null,
      weights: { market: 50, lineup: 20, exchange: 20, outcome: 10, outcomeHorizon: 180, outcomeVariant: 'premiumAware' },
    })
    expect(signals).toEqual({ market: 4, lineup: 2, exchange: null, outcome: null })
  })

  it('reports uncovered user weight rather than silently redistributing it', () => {
    const weighted = weightTradeEvidence(
      { market: 4, lineup: 2, exchange: null, outcome: null },
      { market: 50, lineup: 20, exchange: 20, outcome: 10, outcomeHorizon: 180, outcomeVariant: 'premiumAware' },
    )
    expect(weighted.weightCoverage).toBe(0.7)
    expect(weighted.complete).toBe(false)
    expect(weighted.coveredSignal).toBeCloseTo((4 * 50 + 2 * 20) / 70)
  })
})
