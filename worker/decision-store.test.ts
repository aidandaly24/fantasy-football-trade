import { describe, expect, it } from 'vitest'
import { ensureDecisionSchema, normalizeDecisionDraft } from './decision-store'
import type { D1Database, D1PreparedStatement } from './user-store'

function draft() {
  return {
    leagueId: '1336087922847289344', status: 'researching', myRosterId: 1, counterpartRosterId: 2,
    send: [{ id: 'a', name: 'A', kind: 'player', position: 'WR', value: 500 }],
    receive: [{ id: 'b', name: 'B', kind: 'player', position: 'QB', value: 600 }],
    snapshot: {
      capturedAt: '2026-08-12T00:00:00Z', marketNetToMe: 100, currentSeasonPowerDelta: null,
      lineupPpgDelta: 1.5, providerNetToMe: { ktc: 80, fantasycalc: 120 }, pickValueNetToMe: 0,
      expectedPnl30: null, trackedAssetLowerPnl30: null, returnCoverage: null,
      strategy: { mode: 'rebuilding', horizonYears: 3 },
      evidenceVersions: { market: 'today', assetReturn: null, eventModel: null },
    },
    thesis: 'Acquire the more durable asset.', holdPeriod: '90 days', exitCondition: 'Role breaks.', catalysts: [],
  }
}

describe('decision store', () => {
  it('normalizes an exact private evaluation and rejects cross-league input', () => {
    const normalized = normalizeDecisionDraft(draft(), '1336087922847289344')
    expect(normalized.snapshot.marketNetToMe).toBe(100)
    expect(() => normalizeDecisionDraft(draft(), '1312112570039037952')).toThrow('Decision league does not match')
  })

  it('creates the table and actual query index together', async () => {
    const sql: string[] = []
    const db = {
      prepare(statement: string) {
        sql.push(statement)
        return { bind: () => this, first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) } as unknown as D1PreparedStatement
      },
      batch: async () => [],
    } as D1Database
    await ensureDecisionSchema(db)
    expect(sql.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS trade_decisions'))).toBe(true)
    expect(sql.some((statement) => statement.includes('idx_trade_decisions_user_league'))).toBe(true)
  })
})
