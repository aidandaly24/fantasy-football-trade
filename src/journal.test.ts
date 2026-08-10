import { describe, expect, it } from 'vitest'
import { journalTransactionsForCurrentManagers, tradePartyNames } from './journal'
import type { JournalBundle } from './types'

const trade = {
  leagueId: 'old', transactionId: 't1', season: '2025', week: 1, createdAtMs: 1, ingestedAt: '',
  raw: {
    transaction_id: 't1', type: 'trade', status: 'complete', created: 1, status_updated: 1,
    roster_ids: [1, 2], consenter_ids: [1, 2], adds: { p: 1 }, drops: { p: 2 },
    draft_picks: [{ season: '2027', round: 1, roster_id: 2, owner_id: 2, previous_owner_id: 1 }],
  },
}

const bundle: JournalBundle = {
  trades: [trade], snapshots: [], outcomes: [], sync: null,
  identities: [
    { leagueId: 'old', rosterId: 1, ownerUserId: 'alice', teamName: 'Old Alice' },
    { leagueId: 'old', rosterId: 2, ownerUserId: 'bob', teamName: 'Old Bob' },
    { leagueId: 'now', rosterId: 8, ownerUserId: 'alice', teamName: 'Alice Now' },
    { leagueId: 'now', rosterId: 3, ownerUserId: 'bob', teamName: 'Bob Now' },
  ],
}

describe('journal identity mapping', () => {
  it('maps season roster IDs through stable owner IDs', () => {
    const [mapped] = journalTransactionsForCurrentManagers(bundle, 'now')
    expect(mapped.roster_ids).toEqual([8, 3])
    expect(mapped.adds).toEqual({ p: 8 })
    expect(mapped.drops).toEqual({ p: 3 })
    expect(mapped.draft_picks[0]).toEqual(expect.objectContaining({ owner_id: 3, previous_owner_id: 8 }))
  })

  it('labels journal parties from the trade season', () => {
    expect(tradePartyNames(trade, bundle.identities).get(1)).toBe('Old Alice')
  })
})
