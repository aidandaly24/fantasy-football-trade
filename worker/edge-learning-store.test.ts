import { describe, expect, it } from 'vitest'
import type { MarketSnapshotRecord } from '../src/edge-learning'
import { normalizeMarketTapeInput, readTeamMarketHistory, resolveCatalogValue } from './edge-learning-store'
import type { D1Database, D1PreparedStatement } from './user-store'

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

const leagueContext = {
  leagueId: '1336087922847289344',
  contextKey: '1336087922847289344:12t:2qb:ppr1:tep0.75:start9:bench10:taxi2:ir0:draft3',
  receptionPpr: 1,
  tePremiumPerReception: 0.75,
  startingSlots: 9,
  skillStartingSlots: 9,
  benchSlots: 10,
  taxiSlots: 2,
  reserveSlots: 0,
  rookieDraftRounds: 3,
}

describe('market tape storage boundary', () => {
  it('normalizes a bounded full-league tape payload', () => {
    const normalized = normalizeMarketTapeInput({
      assets: [rawAsset],
      format: { numQbs: 2, tep: true, numTeams: 12 },
      leagueContext,
      sourceVersion: 'tradyr-2026-08-10',
    })
    expect(normalized).toMatchObject({ format: { numQbs: 2, tep: true, numTeams: 12 } })
    expect(normalized.assets[0]).toMatchObject({ assetId: '11625', currentValue: 500 })
  })

  it('rejects client-supplied evidence outside the audited range', () => {
    expect(() => normalizeMarketTapeInput({
      assets: [{ ...rawAsset, features: { ...rawAsset.features, lineupDelta: 51 } }],
      format: { numQbs: 2, tep: true, numTeams: 12 },
      leagueContext,
      sourceVersion: 'test',
    })).toThrow('Invalid feature lineupDelta')
  })

  it('rejects arbitrary league contexts outside the fixed switcher', () => {
    expect(() => normalizeMarketTapeInput({
      assets: [rawAsset],
      format: { numQbs: 2, tep: true, numTeams: 12 },
      leagueContext: { ...leagueContext, leagueId: '999999999999999999' },
      sourceVersion: 'test',
    })).toThrow('Unsupported league context')
  })

  it('rejects a context fingerprint or TEP bucket that contradicts the payload', () => {
    expect(() => normalizeMarketTapeInput({
      assets: [rawAsset],
      format: { numQbs: 2, tep: true, numTeams: 12 },
      leagueContext: { ...leagueContext, contextKey: 'different-league:tep0.75' },
      sourceVersion: 'test',
    })).toThrow('fingerprint')
    expect(() => normalizeMarketTapeInput({
      assets: [rawAsset],
      format: { numQbs: 2, tep: false, numTeams: 12 },
      leagueContext,
      sourceVersion: 'test',
    })).toThrow('provider TEP bucket')
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

  it('returns team market history as dated player and pick totals', async () => {
    let sql = ''
    const statement: D1PreparedStatement = {
      bind: () => statement,
      first: async () => null,
      all: async <T>() => ({ results: [{
        snapshot_date: '2026-08-13', owner_roster_id: 3, total_value: 1200,
        player_value: 800, pick_value: 400, asset_count: 9,
      }] as T[] }),
      run: async () => undefined,
    }
    const db: D1Database = {
      prepare: (query) => { sql = query; return statement },
      batch: async () => [],
    }
    await expect(readTeamMarketHistory(db, 'user', leagueContext.leagueId)).resolves.toEqual([{
      snapshotDate: '2026-08-13', rosterId: 3, totalValue: 1200,
      playerValue: 800, pickValue: 400, assetCount: 9,
    }])
    expect(sql).toContain('GROUP BY snapshot_date, owner_roster_id')
  })
})
