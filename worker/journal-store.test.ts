import { describe, expect, it } from 'vitest'
import { collectLeagueJournal, normalizeTrade, type JournalLeague, type SleeperJournalClient } from './journal-store'

const current: JournalLeague = { league_id: 'current', season: '2026', previous_league_id: 'old' }
const old: JournalLeague = { league_id: 'old', season: '2025', previous_league_id: null }

function client(overrides: Partial<SleeperJournalClient> = {}): SleeperJournalClient {
  return {
    getLeague: async (id) => id === 'current' ? current : old,
    getUsers: async (id) => [{ user_id: id === 'current' ? 'user-now' : 'user-then', display_name: id }],
    getRosters: async () => [{ roster_id: 1, owner_id: null }],
    getTransactions: async () => [],
    ...overrides,
  }
}

describe('journal collection', () => {
  it('traverses every predecessor and uses season-specific identities', async () => {
    const result = await collectLeagueJournal('current', client({
      getRosters: async (id) => [{ roster_id: 1, owner_id: id === 'current' ? 'user-now' : 'user-then', players: ['20', '3'], starters: ['20'], reserve: ['3'], taxi: [] }],
    }))
    expect(result.seasons.map((season) => season.league_id)).toEqual(['current', 'old'])
    expect(result.identities).toContainEqual(expect.objectContaining({ leagueId: 'current', ownerUserId: 'user-now' }))
    expect(result.identities).toContainEqual(expect.objectContaining({ leagueId: 'old', ownerUserId: 'user-then' }))
    expect(result.seasonRosters).toContainEqual(expect.objectContaining({ leagueId: 'current', players: ['3', '20'], starters: ['20'] }))
    expect(result.coverage.filter((target) => target.type === 'transactions')).toHaveLength(38)
    expect(result.complete).toBe(true)
  })

  it('records failed weeks instead of treating them as empty and detects loops', async () => {
    const loop: JournalLeague = { league_id: 'loop', season: '2026', previous_league_id: 'loop' }
    const result = await collectLeagueJournal('loop', client({
      getLeague: async () => loop,
      getTransactions: async (_id, week) => {
        if (week === 0) throw new Error('temporary 503')
        return []
      },
    }))
    expect(result.complete).toBe(false)
    expect(result.coverage).toContainEqual(expect.objectContaining({ type: 'transactions', key: '0', status: 'failed' }))
    expect(result.coverage).toContainEqual(expect.objectContaining({ error: 'Linked-season loop detected' }))
  })

  it('normalizes completed trades into deterministic player and pick legs', async () => {
    const result = await collectLeagueJournal('current', client({
      getTransactions: async (id, week) => id === 'current' && week === 0 ? [{
        transaction_id: 't1', type: 'trade', status: 'complete', created: 20, status_updated: 21,
        roster_ids: [2, 1], consenter_ids: [2, 1], adds: { '20': 2, '3': 1 }, drops: { '20': 1, '3': 2 },
        draft_picks: [{ season: '2027', round: 1, roster_id: 4, previous_owner_id: 2, owner_id: 1 }],
      }] : [],
    }))
    expect(result.trades).toHaveLength(1)
    expect(result.trades[0].assets.map((asset) => [asset.kind, asset.assetKey, asset.fromRosterId, asset.toRosterId]))
      .toEqual([['player', '3', 2, 1], ['player', '20', 1, 2], ['pick', '2027:1:4', 2, 1]])
    expect(result.trades[0].rosterIds).toEqual([1, 2])
  })

  it('keeps identical transaction IDs from different seasons distinct', () => {
    const transaction = { transaction_id: 'same', type: 'trade', status: 'complete', created: 1, status_updated: 1, roster_ids: [], consenter_ids: [], adds: null, drops: null, draft_picks: [] }
    expect(normalizeTrade(current, 1, transaction).leagueId).not.toBe(normalizeTrade(old, 1, transaction).leagueId)
  })
})
