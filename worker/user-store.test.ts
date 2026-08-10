import { describe, expect, it } from 'vitest'
import {
  authenticatedUser,
  ensureUserSchema,
  listLeaguePreferences,
  normalizePreferenceInput,
  saveLeaguePreference,
  type D1Database,
  type D1PreparedStatement,
} from './user-store'

type Row = {
  user_id: string
  league_id: string
  league_name: string
  my_roster_id: number | null
  watchlist_json: string
  settings_json: string
  updated_at: string
}

class FakeStatement implements D1PreparedStatement {
  private values: unknown[] = []

  constructor(private readonly db: FakeDatabase, private readonly sql: string) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values
    return this
  }

  async first<T>(): Promise<T | null> {
    const [userId, leagueId] = this.values
    return (this.db.rows.find((row) => row.user_id === userId && row.league_id === leagueId) as T | undefined) ?? null
  }

  async all<T>(): Promise<{ results: T[] }> {
    const [userId] = this.values
    return { results: this.db.rows.filter((row) => row.user_id === userId) as T[] }
  }

  async run(): Promise<unknown> {
    if (!this.sql.startsWith('INSERT INTO user_league_preferences')) return {}
    const [userId, leagueId, leagueName, myRosterId, watchlistJson, settingsJson, updatedAt] = this.values
    const row: Row = {
      user_id: String(userId),
      league_id: String(leagueId),
      league_name: String(leagueName),
      my_roster_id: myRosterId == null ? null : Number(myRosterId),
      watchlist_json: String(watchlistJson),
      settings_json: String(settingsJson),
      updated_at: String(updatedAt),
    }
    const index = this.db.rows.findIndex((item) => item.user_id === row.user_id && item.league_id === row.league_id)
    if (index >= 0) this.db.rows[index] = row
    else this.db.rows.push(row)
    return {}
  }
}

class FakeDatabase implements D1Database {
  rows: Row[] = []

  prepare(sql: string): D1PreparedStatement {
    return new FakeStatement(this, sql)
  }

  async batch(statements: D1PreparedStatement[]): Promise<unknown[]> {
    return Promise.all(statements.map((statement) => statement.run()))
  }
}

describe('private user state', () => {
  it('requires platform identity away from localhost', () => {
    expect(authenticatedUser(new Request('https://example.com/api/preferences'))).toBeNull()
    const request = new Request('https://example.com/api/preferences', {
      headers: {
        'oai-authenticated-user-id': 'user-a',
        'oai-authenticated-user-email': 'a@example.com',
      },
    })
    expect(authenticatedUser(request)?.id).toBe('user-a')
  })

  it('isolates the same league preference by authenticated user ID', async () => {
    const db = new FakeDatabase()
    await ensureUserSchema(db)
    const input = normalizePreferenceInput({
      leagueId: '1336087922847289344',
      leagueName: 'BC League',
      watchlist: ['11625'],
      settings: { rankingMode: 'future' },
    })
    await saveLeaguePreference(db, 'user-a', input)
    await saveLeaguePreference(db, 'user-b', { ...input, watchlist: ['9226'] })

    const userA = await listLeaguePreferences(db, 'user-a')
    const userB = await listLeaguePreferences(db, 'user-b')

    expect(userA[0].watchlist).toEqual(['11625'])
    expect(userB[0].watchlist).toEqual(['9226'])
  })

  it('sanitizes bounded watchlists and known settings', () => {
    const input = normalizePreferenceInput({
      leagueId: '1336087922847289344',
      leagueName: 'BC League',
      watchlist: ['11625', '11625', '<script>'],
      settings: { rankingMode: 'overall', edgeFilter: 'intel', teamDirectionOverrides: { '3': 'rebuilding', nope: 'contender', '4': 'invalid' }, unknown: true },
    })
    expect(input.watchlist).toEqual(['11625'])
    expect(input.settings).toEqual({ rankingMode: 'overall', edgeFilter: 'intel', teamDirectionOverrides: { '3': 'rebuilding' } })
  })
})
