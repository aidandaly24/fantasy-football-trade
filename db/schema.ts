import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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

export const edgeOpportunitySnapshots = sqliteTable(
  'edge_opportunity_snapshots',
  {
    userId: text('user_id').notNull(),
    leagueId: text('league_id').notNull(),
    snapshotKey: text('snapshot_key').notNull(),
    assetId: text('asset_id').notNull(),
    assetName: text('asset_name').notNull(),
    ownerRosterId: integer('owner_roster_id').notNull(),
    capturedAt: text('captured_at').notNull(),
    currentValue: integer('current_value').notNull(),
    projection30: integer('projection_30').notNull(),
    projection90: integer('projection_90').notNull(),
    projection180: integer('projection_180').notNull(),
    edgeScore: integer('edge_score').notNull(),
    lineupDelta: real('lineup_delta').notNull(),
    confidence: integer('confidence').notNull(),
    categoriesJson: text('categories_json').notNull(),
    catalyst: text('catalyst').notNull(),
    status: text('status').notNull().default('tracking'),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.leagueId, table.snapshotKey] }),
    index('idx_edge_opportunities_user_league').on(table.userId, table.leagueId, table.capturedAt),
  ],
)

// Legacy storage retained so removing the application feature does not imply a
// destructive migration. No Worker route reads from or writes to this table.
export const userTradeOffers = sqliteTable(
  'user_trade_offers',
  {
    userId: text('user_id').notNull(),
    leagueId: text('league_id').notNull(),
    offerId: text('offer_id').notNull(),
    counterpartRosterId: integer('counterpart_roster_id').notNull(),
    targetAssetId: text('target_asset_id').notNull(),
    targetAssetName: text('target_asset_name').notNull(),
    stage: text('stage').notNull(),
    status: text('status').notNull(),
    sentAssetsJson: text('sent_assets_json').notNull(),
    receiveAssetsJson: text('receive_assets_json').notNull(),
    marketDelta: integer('market_delta').notNull(),
    lineupDelta: real('lineup_delta').notNull(),
    thesis: text('thesis').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.leagueId, table.offerId] }),
    index('idx_trade_offers_user_league').on(table.userId, table.leagueId, table.updatedAt),
  ],
)

export const marketValueSnapshots = sqliteTable(
  'market_value_snapshots',
  {
    userId: text('user_id').notNull(),
    leagueId: text('league_id').notNull(),
    snapshotDate: text('snapshot_date').notNull(),
    assetId: text('asset_id').notNull(),
    assetName: text('asset_name').notNull(),
    kind: text('kind').notNull(),
    position: text('position').notNull(),
    ownerRosterId: integer('owner_roster_id').notNull(),
    currentValue: integer('current_value').notNull(),
    projection30: integer('projection_30').notNull(),
    confidence: integer('confidence').notNull(),
    eventType: text('event_type').notNull(),
    newsDirection: text('news_direction').notNull(),
    featuresJson: text('features_json').notNull(),
    metadataJson: text('metadata_json').notNull(),
    source: text('source').notNull(),
    sourceVersion: text('source_version').notNull(),
    capturedAt: text('captured_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.leagueId, table.snapshotDate, table.assetId] }),
    index('idx_market_snapshots_asset_date').on(table.userId, table.leagueId, table.assetId, table.snapshotDate),
    index('idx_market_snapshots_league_date').on(table.userId, table.leagueId, table.snapshotDate),
  ],
)

export const marketTapeConfigs = sqliteTable(
  'market_tape_configs',
  {
    userId: text('user_id').notNull(),
    leagueId: text('league_id').notNull(),
    numQbs: integer('num_qbs').notNull(),
    tep: integer('tep', { mode: 'boolean' }).notNull(),
    numTeams: integer('num_teams').notNull(),
    sourceVersion: text('source_version').notNull(),
    seededAt: text('seeded_at').notNull(),
    lastClientRefreshAt: text('last_client_refresh_at').notNull(),
    lastAutoRefreshAt: text('last_auto_refresh_at'),
    lastAutoRefreshError: text('last_auto_refresh_error'),
  },
  (table) => [primaryKey({ columns: [table.userId, table.leagueId] })],
)

export const edgeModelRuns = sqliteTable(
  'edge_model_runs',
  {
    userId: text('user_id').notNull(),
    leagueId: text('league_id').notNull(),
    runDate: text('run_date').notNull(),
    modelVersion: text('model_version').notNull(),
    trainedAt: text('trained_at').notNull(),
    status: text('status').notNull(),
    reportJson: text('report_json').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.leagueId, table.runDate, table.modelVersion] }),
    index('idx_edge_model_runs_latest').on(table.userId, table.leagueId, table.trainedAt),
  ],
)

export const historicalTapeConfigs = sqliteTable(
  'historical_tape_configs',
  {
    userId: text('user_id').notNull(),
    leagueId: text('league_id').notNull(),
    provider: text('provider').notNull(),
    status: text('status').notNull(),
    formatKey: text('format_key').notNull(),
    numQbs: integer('num_qbs').notNull(),
    tep: integer('tep', { mode: 'boolean' }).notNull(),
    numTeams: integer('num_teams').notNull(),
    queuedAt: text('queued_at').notNull(),
    startedAt: text('started_at'),
    updatedAt: text('updated_at').notNull(),
    completedAt: text('completed_at'),
    reportJson: text('report_json').notNull().default('{}'),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.leagueId, table.provider] }),
    index('idx_historical_tape_configs_status').on(table.status, table.updatedAt),
  ],
)

export const historicalTapeAssets = sqliteTable(
  'historical_tape_assets',
  {
    userId: text('user_id').notNull(),
    leagueId: text('league_id').notNull(),
    provider: text('provider').notNull(),
    assetId: text('asset_id').notNull(),
    assetName: text('asset_name').notNull(),
    position: text('position').notNull(),
    currentComposite: integer('current_composite').notNull(),
    slug: text('slug'),
    status: text('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastAttemptAt: text('last_attempt_at'),
    errorMessage: text('error_message'),
    observationCount: integer('observation_count').notNull().default(0),
    labelCount: integer('label_count').notNull().default(0),
    firstObservedAt: text('first_observed_at'),
    lastObservedAt: text('last_observed_at'),
    spanDays: integer('span_days').notNull().default(0),
    medianGapDays: real('median_gap_days').notNull().default(0),
    scaleStatus: text('scale_status').notNull().default('unknown'),
    scaleGap: real('scale_gap'),
    sourceVersion: text('source_version'),
    metadataJson: text('metadata_json').notNull().default('{}'),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.leagueId, table.provider, table.assetId] }),
    index('idx_historical_tape_assets_pending').on(table.userId, table.leagueId, table.provider, table.status),
  ],
)

export const historicalMarketObservations = sqliteTable(
  'historical_market_observations',
  {
    provider: text('provider').notNull(),
    formatKey: text('format_key').notNull(),
    scaleKey: text('scale_key').notNull(),
    assetId: text('asset_id').notNull(),
    assetName: text('asset_name').notNull(),
    position: text('position').notNull(),
    observedAt: text('observed_at').notNull(),
    providerValue: real('provider_value').notNull(),
    rawValue: real('raw_value'),
    sourceVersion: text('source_version').notNull(),
    provenanceJson: text('provenance_json').notNull(),
    ingestedAt: text('ingested_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.formatKey, table.scaleKey, table.assetId, table.observedAt] }),
    index('idx_historical_market_asset_date').on(table.provider, table.formatKey, table.scaleKey, table.assetId, table.observedAt),
  ],
)

export const leagueWeekStates = sqliteTable(
  'league_week_states',
  {
    rootLeagueId: text('root_league_id').notNull(),
    leagueId: text('league_id').notNull(),
    season: text('season').notNull(),
    week: integer('week').notNull(),
    rosterId: integer('roster_id').notNull(),
    ownerUserId: text('owner_user_id'),
    playersJson: text('players_json').notNull(),
    startersJson: text('starters_json').notNull(),
    points: real('points').notNull(),
    pointsAgainst: real('points_against').notNull(),
    wins: integer('wins').notNull(),
    losses: integer('losses').notNull(),
    ties: integer('ties').notNull(),
    sourceVersion: text('source_version').notNull(),
    capturedAt: text('captured_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.leagueId, table.week, table.rosterId] }),
    index('idx_league_week_states_root').on(table.rootLeagueId, table.season, table.week, table.rosterId),
  ],
)

export const objectivePlayerObservations = sqliteTable(
  'objective_player_observations',
  {
    assetId: text('asset_id').notNull(),
    observedDate: text('observed_date').notNull(),
    observedAt: text('observed_at').notNull(),
    name: text('name').notNull(),
    position: text('position'),
    team: text('team'),
    age: real('age'),
    active: integer('active', { mode: 'boolean' }),
    status: text('status'),
    injuryStatus: text('injury_status'),
    depthChartOrder: integer('depth_chart_order'),
    depthChartPosition: text('depth_chart_position'),
    source: text('source').notNull(),
    sourceVersion: text('source_version').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.assetId, table.observedDate] }),
    index('idx_objective_player_observations_date').on(table.assetId, table.observedAt),
  ],
)

export const managerBehaviorSnapshots = sqliteTable(
  'manager_behavior_snapshots',
  {
    rootLeagueId: text('root_league_id').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    asOfDate: text('as_of_date').notNull(),
    tradeCount: integer('trade_count').notNull(),
    initiatedCount: integer('initiated_count').notNull(),
    receivedPlayers: integer('received_players').notNull(),
    receivedPicks: integer('received_picks').notNull(),
    sentPlayers: integer('sent_players').notNull(),
    sentPicks: integer('sent_picks').notNull(),
    pickAffinity: real('pick_affinity').notNull(),
    consolidationIndex: real('consolidation_index').notNull(),
    sampleWeight: real('sample_weight').notNull(),
    evidenceJson: text('evidence_json').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.rootLeagueId, table.ownerUserId, table.asOfDate] }),
    index('idx_manager_behavior_root').on(table.rootLeagueId, table.asOfDate),
  ],
)

export const researchPipelineRuns = sqliteTable(
  'research_pipeline_runs',
  {
    id: text('id').primaryKey(),
    rootLeagueId: text('root_league_id').notNull(),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    status: text('status').notNull(),
    seasons: integer('seasons').notNull().default(0),
    expectedRosterWeeks: integer('expected_roster_weeks').notNull().default(0),
    rosterWeeks: integer('roster_weeks').notNull().default(0),
    identityParties: integer('identity_parties').notNull().default(0),
    mappedIdentityParties: integer('mapped_identity_parties').notNull().default(0),
    errorsJson: text('errors_json').notNull().default('[]'),
  },
  (table) => [index('idx_research_pipeline_runs_root').on(table.rootLeagueId, table.startedAt)],
)
