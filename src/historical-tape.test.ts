import { describe, expect, it } from 'vitest'
import {
  buildHistoricalTapeAudit,
  normalizeHistoricalDate,
  selectHistoricalAuditAssets,
  summarizeHistoricalSeries,
} from './historical-tape'

describe('historical tape audit', () => {
  it('normalizes compact provider dates and rejects impossible dates', () => {
    expect(normalizeHistoricalDate('230310')).toBe('2023-03-10')
    expect(normalizeHistoricalDate('260229')).toBeNull()
    expect(normalizeHistoricalDate('2026-03-10')).toBeNull()
  })

  it('selects a deterministic, position-stratified sample', () => {
    const candidates = ['QB', 'RB', 'WR', 'TE'].flatMap((position, positionIndex) =>
      Array.from({ length: 20 }, (_, index) => ({
        assetId: `${position}-${index}`,
        assetName: `${position} ${index}`,
        kind: 'player' as const,
        position: position as 'QB' | 'RB' | 'WR' | 'TE',
        currentValue: 1000 - positionIndex * 10 - index,
      })),
    )
    const first = selectHistoricalAuditAssets(candidates)
    const second = selectHistoricalAuditAssets([...candidates].reverse())
    expect(first).toHaveLength(50)
    expect(first.map((row) => row.assetId)).toEqual(second.map((row) => row.assetId))
    expect(first.filter((row) => row.position === 'QB')).toHaveLength(10)
    expect(first.filter((row) => row.position === 'RB')).toHaveLength(14)
    expect(first.filter((row) => row.position === 'WR')).toHaveLength(16)
    expect(first.filter((row) => row.position === 'TE')).toHaveLength(10)
  })

  it('keeps provider history on its own scale and detects component-like data', () => {
    const summary = summarizeHistoricalSeries({
      history: [
        { date: '260704', value: 560, raw: 5300 },
        { date: '260804', value: 572, raw: 5430 },
      ],
      currentComposite: 473,
      currentKtc: 5460,
      currentFantasyCalc: 4119,
    })
    expect(summary.observationCount).toBe(2)
    expect(summary.scaleStatus).toBe('component-like')
    expect(summary.observations[1]).toEqual({ observedAt: '2026-08-04', providerValue: 572, rawValue: 5430 })
  })

  it('blocks promotion when coverage is good but the scale is incompatible', () => {
    const assets = Array.from({ length: 50 }, (_, index) => ({
      status: 'complete' as const,
      observationCount: 40,
      labelCount: 20,
      spanDays: 700,
      medianGapDays: 20,
      scaleStatus: index < 10 ? 'compatible' as const : 'component-like' as const,
    }))
    const audit = buildHistoricalTapeAudit({
      assets,
      formatCompatible: true,
      lifecycleStatus: 'complete',
      queuedAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T01:00:00.000Z',
      completedAt: '2026-08-10T01:00:00.000Z',
    })
    expect(audit.status).toBe('blocked')
    expect(audit.sourceRelativeReady).toBe(true)
    expect(audit.liveScaleReady).toBe(false)
    expect(audit.gates.find((gate) => gate.id === 'scale')?.passed).toBe(false)
    expect(audit.featureReady).toBe(false)
  })
})
