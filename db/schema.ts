import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const userLeaguePreferences = sqliteTable(
  'user_league_preferences',
  {
    userId: text('user_id').notNull(),
    leagueId: text('league_id').notNull(),
    leagueName: text('league_name').notNull(),
    myRosterId: integer('my_roster_id'),
    watchlistJson: text('watchlist_json').notNull().default('[]'),
    settingsJson: text('settings_json').notNull().default('{}'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.leagueId] }),
    index('idx_user_league_preferences_recent').on(table.userId, table.updatedAt),
  ],
)
