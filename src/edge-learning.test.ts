import { describe, expect, it } from 'vitest'
import {
  calibrateEdgeResponses,
  labelMarketSnapshots,
  shadowPredictions,
  trainShadowModel,
  type EdgeTrainingExample,
  type MarketSnapshotRecord,
} from './edge-learning'
import type { EdgeFeatureVector } from './types'

const features: EdgeFeatureVector = {
  ruleGain30: 0.1,
  ruleGain90: 0.15,
  edgeScore: 70,
  lineupDelta: 2,
  catalystScore: 60,
  sellerFit: 65,
  liquidityScore: 75,
  timingScore: 55,
  uncertaintyPenalty: 25,
  confidence: 70,
  age: 24,
  contenderProbability: 0.2,
  rebuildingProbability: 0.65,
}

function snapshot(assetId: string, capturedAt: string, currentValue: number, projection30 = 110): MarketSnapshotRecord {
  return {
    assetId,
    assetName: `Asset ${assetId}`,
    kind: 'player',
    position: 'WR',
    ownerRosterId: 2,
    currentValue,
    projection30,
    confidence: 70,
    eventType: 'role_change',
    newsDirection: 'up',
    features,
    metadata: {},
    snapshotDate: capturedAt.slice(0, 10),
    capturedAt,
    sourceVersion: 'test',
  }
}

describe('edge learning pipeline', () => {
  it('creates honest 30-day labels without treating adjacent days as independent', () => {
    const labels = labelMarketSnapshots([
      snapshot('x', '2026-01-01T00:00:00Z', 100),
      snapshot('x', '2026-01-02T00:00:00Z', 101),
      snapshot('x', '2026-01-31T00:00:00Z', 120),
      snapshot('x', '2026-02-01T00:00:00Z', 121),
    ])
    expect(labels).toHaveLength(1)
    expect(labels[0]).toMatchObject({ assetId: 'x', actualReturn: 0.2, ruleReturn: 0.1 })
  })

  it('shrinks small calibration cohorts toward the original rule', () => {
    const examples = Array.from({ length: 5 }, (_, index): EdgeTrainingExample => ({
      assetId: `x${index}`,
      assetName: `X ${index}`,
      position: 'WR',
      kind: 'player',
      eventType: 'role_change',
      newsDirection: 'up',
      capturedAt: `2026-01-0${index + 1}T00:00:00Z`,
      outcomeAt: `2026-02-0${index + 1}T00:00:00Z`,
      currentValue: 100,
      outcomeValue: 120,
      actualReturn: 0.2,
      ruleReturn: 0.1,
      features,
    }))
    const overall = calibrateEdgeResponses(examples).find((group) => group.key === 'all')!
    expect(overall.shrunkenReturn).toBeCloseTo(0.12, 6)
    expect(overall.confidence).toBeLessThan(50)
  })

  it('trains only in shadow and passes gates on a strong time-split synthetic signal', () => {
    const start = Date.parse('2025-01-01T00:00:00Z')
    const examples = Array.from({ length: 300 }, (_, index): EdgeTrainingExample => {
      const age = 20 + (index * 7) % 20
      const lineupDelta = -2 + ((index * 11) % 50) / 10
      const actualReturn = 0.18 - (age - 20) * 0.008 + lineupDelta * 0.025
      const capturedAt = new Date(start + index * 86_400_000).toISOString()
      return {
        assetId: `asset-${index}`,
        assetName: `Asset ${index}`,
        position: (['QB', 'RB', 'WR', 'TE'] as const)[index % 4],
        kind: 'player',
        eventType: 'none',
        newsDirection: 'none',
        capturedAt,
        outcomeAt: new Date(Date.parse(capturedAt) + 30 * 86_400_000).toISOString(),
        currentValue: 1000,
        outcomeValue: Math.round(1000 * (1 + actualReturn)),
        actualReturn,
        ruleReturn: 0,
        features: { ...features, age, lineupDelta, ruleGain30: 0 },
      }
    })
    const { health, artifact } = trainShadowModel(examples, new Date('2026-01-01T00:00:00Z'))
    expect(health.status).toBe('passed-shadow')
    expect(health.productionEnabled).toBe(false)
    expect(health.gates.every((gate) => gate.passed)).toBe(true)
    expect(health.metrics.maeImprovement).toBeGreaterThan(0.5)
    const current = snapshot('current', '2026-01-01T00:00:00Z', 100)
    expect(shadowPredictions(artifact, health, [current])[0]).toMatchObject({ assetId: 'current', mode: 'shadow' })
  })

  it('stays in collection mode before there is enough later evidence', () => {
    const { health, artifact } = trainShadowModel([])
    expect(health.status).toBe('collecting')
    expect(artifact).toBeNull()
    expect(health.productionEnabled).toBe(false)
  })
})
