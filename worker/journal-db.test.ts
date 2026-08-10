import { describe, expect, it } from 'vitest'
import { valueTrade, type ValueCatalog } from './journal-db'

describe('journal valuation snapshots', () => {
  it('prices player and pick legs by destination without hiding unresolved assets', () => {
    const catalog: ValueCatalog = {
      players: new Map([['1', { sleeperId: '1', name: 'Alpha Back', composite: 5000 }]]),
      picks: [{ year: '2027', round: 1, name: '2027 1.06', composite: 3200 }],
      sourceVersion: 'fixture',
    }
    const snapshot = valueTrade({
      transaction_id: 't', type: 'trade', status: 'complete', created: 1, status_updated: 1,
      roster_ids: [1, 2], consenter_ids: [1, 2],
      adds: { '1': 2, '404': 1 }, drops: { '1': 1, '404': 2 },
      draft_picks: [{ season: '2027', round: 1, roster_id: 2, previous_owner_id: 2, owner_id: 1 }],
    }, catalog)
    expect(snapshot.unresolved).toEqual(['player:404'])
    expect(snapshot.parties).toContainEqual({ rosterId: 1, received: 3200, sent: 5000, net: -1800 })
    expect(snapshot.parties).toContainEqual({ rosterId: 2, received: 5000, sent: 3200, net: 1800 })
  })
})
