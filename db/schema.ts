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

export const leagueRoots = sqliteTable('league_roots', {
  rootLeagueId: text('root_league_id').primaryKey(),
  name: text('name').notNull(),
  syncStatus: text('sync_status').notNull().default('pending'),
  lastSyncAt: text('last_sync_at'),
  createdAt: text('created_at').notNull(),
})

export const leagueSeasons = sqliteTable(
  'league_seasons',
  {
    leagueId: text('league_id').primaryKey(),
    rootLeagueId: text('root_league_id').notNull(),
    season: text('season').notNull(),
    name: text('name').notNull(),
    previousLeagueId: text('previous_league_id'),
    totalRosters: integer('total_rosters').notNull(),
    discoveredAt: text('discovered_at').notNull(),
  },
  (table) => [index('idx_league_seasons_root').on(table.rootLeagueId, table.season)],
)

export const seasonUsers = sqliteTable(
  'season_users',
  {
    leagueId: text('league_id').notNull(),
    userId: text('user_id').notNull(),
    displayName: text('display_name').notNull(),
    avatar: text('avatar'),
    metadataJson: text('metadata_json').notNull().default('{}'),
  },
  (table) => [primaryKey({ columns: [table.leagueId, table.userId] })],
)

export const seasonRosters = sqliteTable(
  'season_rosters',
  {
    leagueId: text('league_id').notNull(),
    rosterId: integer('roster_id').notNull(),
    ownerUserId: text('owner_user_id'),
    teamName: text('team_name').notNull(),
    avatar: text('avatar'),
    rosterJson: text('roster_json').notNull(),
  },
  (table) => [primaryKey({ columns: [table.leagueId, table.rosterId] })],
)

export const trades = sqliteTable(
  'trades',
  {
    leagueId: text('league_id').notNull(),
    transactionId: text('transaction_id').notNull(),
    rootLeagueId: text('root_league_id').notNull(),
    season: text('season').notNull(),
    week: integer('week').notNull(),
    createdAtMs: integer('created_at_ms').notNull(),
    statusUpdatedAtMs: integer('status_updated_at_ms').notNull(),
    creatorUserId: text('creator_user_id'),
    rosterIdsJson: text('roster_ids_json').notNull(),
    rawJson: text('raw_json').notNull(),
    ingestedAt: text('ingested_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.leagueId, table.transactionId] }),
    index('idx_trades_root_created').on(table.rootLeagueId, table.createdAtMs),
  ],
)

export const syncRuns = sqliteTable(
  'sync_runs',
  {
    id: text('id').primaryKey(),
    rootLeagueId: text('root_league_id').notNull(),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    status: text('status').notNull(),
    seasonsFound: integer('seasons_found').notNull().default(0),
    targetsAttempted: integer('targets_attempted').notNull().default(0),
    targetsSucceeded: integer('targets_succeeded').notNull().default(0),
    tradeCount: integer('trade_count').notNull().default(0),
    newTradeCount: integer('new_trade_count').notNull().default(0),
    errorsJson: text('errors_json').notNull().default('[]'),
  },
  (table) => [index('idx_sync_runs_root_started').on(table.rootLeagueId, table.startedAt)],
)

export const tradeSnapshots = sqliteTable(
  'trade_snapshots',
  {
    leagueId: text('league_id').notNull(),
    transactionId: text('transaction_id').notNull(),
    snapshotKind: text('snapshot_kind').notNull(),
    capturedAt: text('captured_at').notNull(),
    source: text('source').notNull(),
    sourceVersion: text('source_version').notNull(),
    valuesJson: text('values_json').notNull(),
    isRetrospective: integer('is_retrospective', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.leagueId, table.transactionId, table.snapshotKind] })],
)

export const tradeOutcomes = sqliteTable(
  'trade_outcomes',
  {
    leagueId: text('league_id').notNull(),
    transactionId: text('transaction_id').notNull(),
    checkpointDays: integer('checkpoint_days').notNull(),
    dueAt: text('due_at').notNull(),
    evaluatedAt: text('evaluated_at'),
    status: text('status').notNull(),
    grade: text('grade'),
    methodVersion: text('method_version').notNull(),
    resultJson: text('result_json').notNull().default('{}'),
  },
  (table) => [
    primaryKey({ columns: [table.leagueId, table.transactionId, table.checkpointDays] }),
    index('idx_trade_outcomes_due').on(table.status, table.dueAt),
  ],
)

export const intelEvents = sqliteTable(
  'intel_events',
  {
    eventKey: text('event_key').primaryKey(),
    playerId: text('player_id').notNull(),
    normalizedTitle: text('normalized_title').notNull(),
    displayTitle: text('display_title').notNull(),
    eventType: text('event_type').notNull(),
    direction: text('direction').notNull(),
    impactWeight: integer('impact_weight').notNull(),
    publishedAt: text('published_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    sourcesJson: text('sources_json').notNull(),
    corroborationCount: integer('corroboration_count').notNull().default(1),
  },
  (table) => [index('idx_intel_events_active').on(table.playerId, table.expiresAt)],
)

export const userIntelAlerts = sqliteTable(
  'user_intel_alerts',
  {
    userId: text('user_id').notNull(),
    leagueId: text('league_id').notNull(),
    eventKey: text('event_key').notNull(),
    playerId: text('player_id').notNull(),
    createdAt: text('created_at').notNull(),
    seenAt: text('seen_at'),
    readAt: text('read_at'),
    dismissedAt: text('dismissed_at'),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.leagueId, table.eventKey] }),
    index('idx_user_intel_alerts_inbox').on(
      table.userId,
      table.leagueId,
      table.dismissedAt,
      table.readAt,
      table.createdAt,
    ),
  ],
)

export const intelRefreshRuns = sqliteTable('intel_refresh_runs', {
  scope: text('scope').primaryKey(),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  lastSuccessAt: text('last_success_at'),
  sourceStatusJson: text('source_status_json').notNull().default('{}'),
  eventCount: integer('event_count').notNull().default(0),
  errorMessage: text('error_message'),
})
