import { describe, expect, it } from 'vitest'
import type { MarketSnapshotRecord } from '../src/edge-learning'
import { normalizeMarketTapeInput, resolveCatalogValue } from './edge-learning-store'

const rawAsset = {
  assetId: '11625',
  assetName: 'Target WR',
  kind: 'player',
  position: 'WR',
  ownerRosterId: 3,
  currentValue: 500,
  confidence: 74,
  eventType: 'role_change',
  newsDirection: 'up',
  features: {
    lineupDelta: 2.1, age: 23, horizonYears: 3,
  },
  metadata: {},
}

describe('market tape storage boundary', () => {
  it('normalizes a bounded full-league tape payload', () => {
    const normalized = normalizeMarketTapeInput({
      assets: [rawAsset],
      format: { numQbs: 2, tep: true, numTeams: 12 },
      sourceVersion: 'tradyr-2026-08-10',
    })
    expect(normalized).toMatchObject({ format: { numQbs: 2, tep: true, numTeams: 12 } })
    expect(normalized.assets[0]).toMatchObject({ assetId: '11625', currentValue: 500 })
  })

  it('rejects client-supplied evidence outside the audited range', () => {
    expect(() => normalizeMarketTapeInput({
      assets: [{ ...rawAsset, features: { ...rawAsset.features, lineupDelta: 51 } }],
      format: { numQbs: 2, tep: false, numTeams: 12 },
      sourceVersion: 'test',
    })).toThrow('Invalid feature lineupDelta')
  })

  it('resolves automatic player and projected-pick updates without sending league identity upstream', () => {
    const player = {
      ...rawAsset,
      snapshotDate: '2026-08-10',
      capturedAt: '2026-08-10T00:00:00Z',
      sourceVersion: 'test',
    } as MarketSnapshotRecord
    const pick = {
      ...player,
      assetId: 'pick:2027:1:3',
      kind: 'pick' as const,
      position: 'PICK' as const,
      metadata: { year: '2027', round: 1, projectedTier: 'late' as const },
    }
    const catalog = {
      players: new Map([['11625', 540]]),
      picks: [
        { year: '2027', round: 1, tier: 'early', composite: 900 },
        { year: '2027', round: 1, tier: 'late', composite: 500 },
      ],
      sourceVersion: 'catalog',
    }
    expect(resolveCatalogValue(player, catalog)).toBe(540)
    expect(resolveCatalogValue(pick, catalog)).toBe(500)
  })
})
