export type League = {
  league_id: string
  name: string
  season: string
  status: string
  total_rosters: number
  draft_id: string | null
  previous_league_id?: string | null
  avatar: string | null
  roster_positions: string[]
  scoring_settings: Record<string, number>
  settings: {
    num_teams: number
    draft_rounds: number
    taxi_slots?: number
    reserve_slots?: number
    leg?: number
  }
}

export type SleeperRoster = {
  roster_id: number
  owner_id: string | null
  players: string[] | null
  starters: string[] | null
  reserve: string[] | null
  taxi: string[] | null
}

export type LeagueUser = {
  user_id: string
  display_name: string
  avatar: string | null
  metadata?: {
    team_name?: string
    avatar?: string
  } | null
}

export type TradedPick = {
  season: string
  round: number
  roster_id: number
  owner_id: number
  previous_owner_id: number
}

export type SleeperDraft = {
  draft_id: string
  season: string
  status: string
  draft_order: Record<string, number> | null
  slot_to_roster_id: Record<string, number> | null
}

export type SleeperTransactionPick = {
  season: string
  round: number
  roster_id: number
  owner_id: number
  previous_owner_id: number
}

export type SleeperTransaction = {
  transaction_id: string
  type: 'trade' | 'waiver' | 'free_agent' | string
  status: string
  created: number
  status_updated: number
  roster_ids: number[]
  consenter_ids: number[]
  adds: Record<string, number> | null
  drops: Record<string, number> | null
  draft_picks: SleeperTransactionPick[]
  creator?: string | null
  leg?: number
  metadata?: Record<string, unknown> | null
  settings?: Record<string, unknown> | null
  waiver_budget?: Array<Record<string, unknown>> | null
  season?: string
  leagueId?: string
  transactionWeek?: number
}

export type SleeperPlayer = {
  player_id: string
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
  position?: string | null
  fantasy_positions?: string[] | null
  team?: string | null
  age?: number | null
  active?: boolean
  status?: string | null
  injury_status?: string | null
  depth_chart_order?: number | null
  depth_chart_position?: string | null
}

export type TradyrPlayer = {
  slug: string
  name: string
  position: 'QB' | 'RB' | 'WR' | 'TE'
  team: string | null
  age: number | null
  composite: number
  confidence: number
  rank: number
  posRank: number
  sources: {
    ktc: number | null
    fantasycalc: number | null
  }
  sleeperId: string | null
}

export type PickValue = {
  id: string
  name: string
  round: number
  slot: number
  year: string
  tier: 'early' | 'mid' | 'late'
  composite: number
  position: 'PICK'
}

export type PickTier = 'early' | 'mid' | 'late'

export type PickProjection = {
  tier: PickTier
  probabilities: Record<PickTier, number>
  contenderRank: number
}

export type ApiMeta = {
  generatedAt: string
  sources: string[]
  attribution: string
}

export type Asset = {
  id: string
  name: string
  shortName?: string
  kind: 'player' | 'pick'
  position: 'QB' | 'RB' | 'WR' | 'TE' | 'PICK' | 'K' | 'DEF' | 'NA'
  team: string | null
  value: number
  confidence: number
  age: number | null
  rank: number | null
  sourceValue?: number | null
  marketSources?: {
    ktc: number | null
    fantasycalc: number | null
  }
  originalRosterId?: number
  ownerRosterId?: number
  year?: string
  round?: number
  slot?: number
  projectedTier?: PickTier | 'known'
  tierProbabilities?: Record<PickTier, number>
  valueLow?: number
  valueHigh?: number
  projectionConfidence?: number
  isStarter?: boolean
  isTaxi?: boolean
  isReserve?: boolean
  active?: boolean
  nflStatus?: string | null
  injuryStatus?: string | null
  depthChartOrder?: number | null
  depthChartPosition?: string | null
  projectedPpg?: number
  projectedPpgFloor?: number
  projectedPpgCeiling?: number
  productionModel?: string
  projectionDrivers?: string[]
}

export type TeamMetrics = {
  lineupRaw: number
  coreRaw: number
  depthRaw: number
  picksRaw: number
  liquidityRaw: number
  marketRaw: number
  lineup: number
  core: number
  depth: number
  picks: number
  liquidity: number
  market: number
  overall: number
  contender: number
  future: number
}

export type Team = {
  rosterId: number
  ownerId: string | null
  ownerName: string
  teamName: string
  avatar: string | null
  players: Asset[]
  picks: Asset[]
  optimizedStarters: Asset[]
  metrics: TeamMetrics
}

export type LeagueBundle = {
  league: League
  rosters: SleeperRoster[]
  users: LeagueUser[]
  tradedPicks: TradedPick[]
  draft: SleeperDraft | null
}

export type ValueBundle = {
  players: TradyrPlayer[]
  picks: PickValue[]
  meta: ApiMeta
}

export type PlayerProjection = {
  name: string
  position: 'QB' | 'RB' | 'WR' | 'TE'
  sourceSeason: number
  gamesObserved: number
  productionModel?: string
  expectedPpg: number
  floorPpg: number
  ceilingPpg: number
  confidence: number
  drivers?: string[]
  restOfSeasonPpg?: number
  restOfSeasonWeek?: number
}

export type ModelMetrics = {
  mae: number
  rmse: number
  rank_correlation: number
}

export type ModelGate = {
  id: string
  label: string
  passed: boolean
  actual: number
  requirement: string
}

export type ModelHealthBundle = {
  generatedAt: string
  model: string
  enabled: boolean
  testSeason: number
  target: string
  currentPlayers: number
  freshness?: {
    dataAsOf: string
    sourceSeason: number
    staleAfter: string
    stale: boolean
  }
  predictionDigest?: string
  metrics: {
    model: ModelMetrics
    baselineName: string
    baseline: ModelMetrics
    maeImprovement: number
    rankCorrelationDelta: number
  }
  gates: ModelGate[]
  phaseGates?: Record<string, { enabled: boolean; checks: ModelGate[] }>
  baselines: Array<{
    id: string
    selected: boolean
    validation: ModelMetrics
    test: ModelMetrics
  }>
  interval: {
    lowerQuantile: number
    upperQuantile: number
    targetCoverage: number
    test: { coverage: number; mean_width: number }
    byPosition: Record<string, { rows: number; coverage: number; mean_width: number }>
  }
  slices: Array<{
    id: string
    rows: number
    model: ModelMetrics
    baseline: ModelMetrics
    maeImprovement: number
  }>
  featureImportance: Array<{ feature: string; importance: number }>
}

export type ProjectionBundle = {
  generatedAt: string
  model: string
  enabled: boolean
  testMaeImprovement: number
  coverage: number
  dataAsOf?: string
  sourceSeason?: number
  staleAfter?: string
  stale?: boolean
  outlook?: 'next-season' | 'rest-of-season'
  restOfSeasonWeek?: number | null
  projections: Record<string, PlayerProjection>
}

export type EventModelSignal = {
  id: string
  label: string
  direction: 'up' | 'down' | 'watch'
  sampleSize: number
  modelPpgDelta: number
  actualResidualPpg: number
  observedPpgChange: number
  confidence: 'low' | 'medium' | 'high'
}

export type EventModelHealthBundle = {
  generatedAt: string
  enabled: boolean
  target: string
  trainingSeason: number
  validationSeason: number
  testSeason: number
  eventTestRows: number
  eventModel: ModelMetrics
  statusBlindModel: ModelMetrics
  maeImprovement: number
  maeImprovementInterval: { lower: number; median: number; upper: number }
  rankCorrelationDelta: number
  positionChanges: Record<string, number>
  checks: ModelGate[]
  signals: EventModelSignal[]
}

export type UserIdentity = {
  id: string
  email: string
  name: string
}

export type LeaguePreferences = {
  leagueId: string
  leagueName: string
  myRosterId: number | null
  watchlist: string[]
  settings: {
    rankingMode?: RankingMode
    strategyRosterId?: number
    edgeFilter?: 'all' | 'value' | 'flip' | 'points' | 'intel'
    teamDirectionOverrides?: Record<string, 'contender' | 'retooling' | 'rebuilding'>
    teamStrategy?: TeamStrategyProfile
  }
  updatedAt?: string
}

export type UserState = {
  user: UserIdentity
  preferences: LeaguePreferences[]
}

export type RankingMode = 'overall' | 'contender' | 'future'

export type NewsArticle = {
  id: string
  title: string
  url: string
  source: string
  publishedAt: string
  reliability: number
  normalizedTitle?: string
  eventType?: import('./intel-events').IntelEventType
  eventDirection?: import('./intel-events').EventDirection
  impactWeight?: number
  expiresAt?: string
  corroboratingSources?: string[]
  corroborationCount?: number
}

export type TrendItem = {
  playerId: string
  count: number
}

export type IntelFeed = {
  generatedAt: string
  articles: NewsArticle[]
  trends: {
    adds6: TrendItem[]
    adds24: TrendItem[]
    drops6: TrendItem[]
    drops24: TrendItem[]
  }
  sources: Array<{
    name: string
    ok: boolean
  }>
  qa?: {
    rawArticles: number
    publishedArticles: number
    duplicatesRemoved: number
    residualDuplicateRate: number
    classifierFixtureAccuracy: number
    classifierFixtureCount: number
  }
  phaseGates?: Record<string, {
    enabled: boolean
    advisoryOnly?: boolean
    checks: ModelGate[]
  }>
}

export type IntelSignal = {
  player: TradyrPlayer
  articles: NewsArticle[]
  direction: 'up' | 'down' | 'watch'
  impactScore: number
  edgeScore: number
  confidence: number
  marketReactionScore: number
  freshnessScore: number
  action: string
  rationale: string
  add24: number
  drop24: number
  acceleration: number
  ownerTeam: Team | null
  isMine: boolean
}

export type JournalIdentity = {
  leagueId: string
  rosterId: number
  ownerUserId: string | null
  teamName: string
}

export type JournalTrade = {
  leagueId: string
  transactionId: string
  season: string
  week: number
  createdAtMs: number
  raw: SleeperTransaction
  ingestedAt: string
}

export type TradeSnapshotAsset = {
  key: string
  name: string
  kind: 'player' | 'pick'
  value: number | null
  fromRosterId: number | null
  toRosterId: number | null
}

export type TradeSnapshot = {
  leagueId: string
  transactionId: string
  kind: 'ingestion' | 'backfill-current' | '30d' | '90d' | '180d' | string
  capturedAt: string
  retrospective: boolean
  values: {
    assets: TradeSnapshotAsset[]
    parties: Array<{ rosterId: number; received: number; sent: number; net: number }>
    unresolved: string[]
  }
}

export type TradeOutcome = {
  leagueId: string
  transactionId: string
  checkpointDays: 30 | 90 | 180 | number
  dueAt: string
  evaluatedAt: string | null
  status: 'pending' | 'due' | 'complete' | 'insufficient_data' | string
  grade: string | null
  result: Record<string, unknown>
}

export type JournalSync = {
  startedAt: string
  finishedAt: string | null
  status: 'complete' | 'partial' | 'failed' | 'running' | string
  seasonsFound: number
  targetsAttempted: number
  targetsSucceeded: number
  tradeCount: number
  newTradeCount: number
  errors: Array<{ leagueId?: string; type?: string; key?: string; error?: string }>
}

export type JournalBundle = {
  trades: JournalTrade[]
  identities: JournalIdentity[]
  snapshots: TradeSnapshot[]
  outcomes: TradeOutcome[]
  sync: JournalSync | null
  collectionComplete?: boolean
  newTradeCount?: number
}

export type PrivateAlert = {
  eventKey: string
  playerId: string
  createdAt: string
  seenAt: string | null
  readAt: string | null
  title: string
  eventType: import('./intel-events').IntelEventType
  direction: import('./intel-events').EventDirection
  impactWeight: number
  publishedAt: string
  expiresAt: string
  sources: Array<{ name: string; url: string }>
  corroborationCount: number
}

export type AlertInbox = {
  alerts: PrivateAlert[]
  unreadCount: number
  status: {
    due: boolean
    stale: boolean
    lastSuccessAt: string | null
    nextEligibleAt: string | null
    errorMessage: string | null
  }
}

export type EdgeFeatureVector = {
  lineupDelta: number | null
  age: number | null
  horizonYears: 1 | 2 | 3 | 4
}

export type MarketTapeAssetInput = {
  assetId: string
  assetName: string
  kind: 'player' | 'pick'
  position: Asset['position']
  ownerRosterId: number
  currentValue: number
  confidence: number
  eventType: string
  newsDirection: 'up' | 'down' | 'watch' | 'none'
  features: EdgeFeatureVector
  metadata: {
    year?: string
    round?: number
    slot?: number
    projectedTier?: PickTier | 'known'
  }
}

export type MarketTapeRequest = {
  assets: MarketTapeAssetInput[]
  format: {
    numQbs: 1 | 2
    tep: boolean
    numTeams: number
  }
  sourceVersion: string
}

export type MarketTapeSummary = {
  snapshotCount: number
  assetsTracked: number
  firstSnapshotAt: string | null
  lastSnapshotAt: string | null
  spanDays: number
  labeledExamples: number
  lastAutomaticRefreshAt: string | null
  automaticRefreshError: string | null
}

export type EdgeCalibrationGroup = {
  key: string
  label: string
  sampleSize: number
  actualReturn: number
  ruleReturn: number
  residualReturn: number
  shrunkenReturn: number
  confidence: number
}

export type EdgeShadowGate = {
  id: string
  label: string
  passed: boolean
  actual: number
  requirement: string
}

export type EdgeShadowModelHealth = {
  version: string
  status: 'collecting' | 'shadow' | 'passed-shadow'
  productionEnabled: false
  trainedAt: string | null
  trainingRows: number
  validationRows: number
  uniqueAssets: number
  dateSpanDays: number
  metrics: {
    modelMae: number | null
    baselineMae: number | null
    maeImprovement: number | null
    rankCorrelation: number | null
    baselineRankCorrelation: number | null
  }
  gates: EdgeShadowGate[]
}

export type EdgeShadowPrediction = {
  assetId: string
  expectedReturn30: number
  expectedValue30: number
  confidence: number
  mode: 'shadow'
}

export type TeamStrategyProfile = {
  mode: 'auto' | 'contender' | 'retooling' | 'rebuilding'
  horizonYears: 1 | 2 | 3 | 4
  flipPriority: number
}

export type HistoricalTapeGate = {
  id: 'coverage' | 'observations' | 'span' | 'cadence' | 'format' | 'scale'
  label: string
  passed: boolean
  actual: number
  requirement: string
}

export type HistoricalTapeAudit = {
  provider: 'tradyr'
  status: 'not-started' | 'queued' | 'running' | 'passed' | 'blocked' | 'failed'
  formatKey: string
  queuedAt: string | null
  updatedAt: string | null
  completedAt: string | null
  targetAssets: number
  attemptedAssets: number
  coveredAssets: number
  missingAssets: number
  failedAssets: number
  observationCount: number
  labelCount: number
  coverageRate: number
  medianObservations: number
  medianSpanDays: number
  medianGapDays: number
  scaleCompatibleRate: number
  sourceRelativeReady: boolean
  liveScaleReady: boolean
  featureReady: false
  gates: HistoricalTapeGate[]
  notes: string[]
}

export type EdgeStateBundle = {
  marketTape: MarketTapeSummary
  calibration: EdgeCalibrationGroup[]
  shadowModel: EdgeShadowModelHealth
  shadowPredictions: EdgeShadowPrediction[]
  historicalTape: HistoricalTapeAudit
}
