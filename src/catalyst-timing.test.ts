import { describe, expect, it } from 'vitest'
import { buildCatalystTimingRead } from './catalyst-timing'
import type { Asset, EdgeShadowModelHealth, EventModelHealthBundle, IntelSignal } from './types'

const asset: Asset = { id: '1', name: 'Player One', kind: 'player', position: 'WR', team: 'TST', value: 500, confidence: 1, age: 23, rank: 1 }
const signal = {
  player: { slug: 'one', name: 'Player One', position: 'WR', team: 'TST', age: 23, composite: 500, confidence: 1, rank: 1, posRank: 1, sources: { ktc: 500, fantasycalc: 500 }, sleeperId: '1' },
  articles: [{ id: 'a', title: 'Player One named starter', url: 'https://example.test/a', source: 'Test', publishedAt: '2026-08-12T00:00:00Z', reliability: 1, eventType: 'role', eventDirection: 'up' }],
  direction: 'watch', impactScore: 0, edgeScore: 0, confidence: 0, marketReactionScore: 0, freshnessScore: 0,
  action: 'Watch', rationale: 'Fact', add24: 0, drop24: 0, acceleration: 0, ownerTeam: null, isMine: false,
} satisfies IntelSignal
const health = {
  enabled: true,
  checks: [{ id: 'a', label: 'a', passed: true, actual: 1, requirement: '1' }],
} as EventModelHealthBundle
const shadow = { status: 'passed-shadow' } as EdgeShadowModelHealth

describe('catalyst timing read', () => {
  it('shows current events and descriptive cohorts without promoting timing', () => {
    const read = buildCatalystTimingRead({
      incoming: [asset], signals: [signal], eventHealth: health, shadowModel: shadow,
      calibration: [{ key: 'event:role', label: 'role', sampleSize: 7, actualReturn: 0.12, ruleReturn: 0, residualReturn: 0.12, shrunkenReturn: 0.04, confidence: 20 }],
    })
    expect(read.events).toHaveLength(1)
    expect(read.events[0].marketCohort?.sampleSize).toBe(7)
    expect(read.productionEventModelEnabled).toBe(true)
    expect(read.marketEventModelEnabled).toBe(false)
    expect(read.timingInfluenceEnabled).toBe(false)
  })
})
