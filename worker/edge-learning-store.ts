import {
  buildEdgeLearningReport,
  emptyShadowHealth,
  shadowPredictions,
  type EdgeLearningReport,
  type MarketSnapshotRecord,
} from '../src/edge-learning'
import { isSupportedLeagueId } from '../src/league-context'
import type {
  EdgeCalibrationGroup,
  EdgeShadowModelHealth,
  EdgeShadowPrediction,
  EdgeStateBundle,
  MarketTapeAssetInput,
  MarketTapeRequest,
  MarketTapeSummary,
  TeamMarketHistoryPoint,
} from '../src/types'
import type { D1Database, D1PreparedStatement } from './user-store'
import { fetchMarketBundle } from './tradyr-market'

const AUTO_REFRESH_MS = 12 * 3_600_000
const MAX_TAPE_ROWS = 75_000

const CREATE_MARKET_SNAPSHOTS = `CREATE TABLE IF NOT EXISTS market_value_snapshots (
  user_id TEXT NOT NULL, league_id TEXT NOT NULL, snapshot_date TEXT NOT NULL,
  asset_id TEXT NOT NULL, asset_name TEXT NOT NULL, kind TEXT NOT NULL, position TEXT NOT NULL,
  owner_roster_id INTEGER NOT NULL, current_value INTEGER NOT NULL, projection_30 INTEGER NOT NULL,
  confidence INTEGER NOT NULL, event_type TEXT NOT NULL, news_direction TEXT NOT NULL,
  features_json TEXT NOT NULL, metadata_json TEXT NOT NULL, source TEXT NOT NULL,
  source_version TEXT NOT NULL, captured_at TEXT NOT NULL,
  PRIMARY KEY (user_id, league_id, snapshot_date, asset_id)
)`
const CREATE_MARKET_ASSET_INDEX = `CREATE INDEX IF NOT EXISTS idx_market_snapshots_asset_date
ON market_value_snapshots (user_id, league_id, asset_id, snapshot_date)`
const CREATE_MARKET_DATE_INDEX = `CREATE INDEX IF NOT EXISTS idx_market_snapshots_league_date
ON market_value_snapshots (user_id, league_id, snapshot_date)`
const CREATE_MARKET_CONFIGS = `CREATE TABLE IF NOT EXISTS market_tape_configs (
  user_id TEXT NOT NULL, league_id TEXT NOT NULL, num_qbs INTEGER NOT NULL,
  tep INTEGER NOT NULL, num_teams INTEGER NOT NULL, source_version TEXT NOT NULL,
  seeded_at TEXT NOT NULL, last_client_refresh_at TEXT NOT NULL,
  last_auto_refresh_at TEXT, last_auto_refresh_error TEXT,
  PRIMARY KEY (user_id, league_id)
)`
const CREATE_MODEL_RUNS = `CREATE TABLE IF NOT EXISTS edge_model_runs (
  user_id TEXT NOT NULL, league_id TEXT NOT NULL, run_date TEXT NOT NULL,
  model_version TEXT NOT NULL, trained_at TEXT NOT NULL, status TEXT NOT NULL,
  report_json TEXT NOT NULL,
  PRIMARY KEY (user_id, league_id, run_date, model_version)
)`
const CREATE_MODEL_INDEX = `CREATE INDEX IF NOT EXISTS idx_edge_model_runs_latest
ON edge_model_runs (user_id, league_id, trained_at)`

let schemaReady: Promise<void> | null = null

export async function ensureEdgeLearningSchema(db: D1Database): Promise<void> {
  if (!schemaReady) {
    schemaReady = db.batch([
      db.prepare(CREATE_MARKET_SNAPSHOTS),
      db.prepare(CREATE_MARKET_ASSET_INDEX),
      db.prepare(CREATE_MARKET_DATE_INDEX),
      db.prepare(CREATE_MARKET_CONFIGS),
      db.prepare(CREATE_MODEL_RUNS),
      db.prepare(CREATE_MODEL_INDEX),
      db.prepare('PRAGMA optimize'),
    ]).then(() => undefined).catch((error) => {
      schemaReady = null
      throw error
    })
  }
  return schemaReady
}

function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid record')
  return input as Record<string, unknown>
}

function boundedText(value: unknown, label: string, max: number, allowEmpty = false): string {
  const parsed = typeof value === 'string' ? value.trim() : ''
  if ((!allowEmpty && !parsed) || parsed.length > max) throw new Error(`Invalid ${label}`)
  return parsed
}

function boundedNumber(value: unknown, label: string, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`Invalid ${label}`)
  return parsed
}

function featureNumber(features: Record<string, unknown>, key: string, min: number, max: number): number {
  return boundedNumber(features[key], `feature ${key}`, min, max)
}

function normalizeTapeAsset(input: unknown): MarketTapeAssetInput {
  const value = object(input)
  const assetId = boundedText(value.assetId, 'asset ID', 80)
  if (!/^[\w:.\-]+$/.test(assetId)) throw new Error('Invalid asset ID')
  const kind = String(value.kind)
  if (kind !== 'player' && kind !== 'pick') throw new Error('Invalid asset kind')
  const position = String(value.position)
  if (!['QB', 'RB', 'WR', 'TE', 'PICK', 'K', 'DEF', 'NA'].includes(position)) throw new Error('Invalid asset position')
  const newsDirection = String(value.newsDirection)
  if (!['up', 'down', 'watch', 'none'].includes(newsDirection)) throw new Error('Invalid news direction')
  const eventType = boundedText(value.eventType, 'event type', 50)
  if (!/^[\w-]+$/.test(eventType)) throw new Error('Invalid event type')
  const features = object(value.features)
  const metadata = value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata)
    ? value.metadata as Record<string, unknown>
    : {}
  const projectedTier = ['early', 'mid', 'late', 'known'].includes(String(metadata.projectedTier))
    ? metadata.projectedTier as MarketTapeAssetInput['metadata']['projectedTier']
    : undefined
  return {
    assetId,
    assetName: boundedText(value.assetName, 'asset name', 120),
    kind,
    position: position as MarketTapeAssetInput['position'],
    ownerRosterId: Math.round(boundedNumber(value.ownerRosterId, 'owner roster', 1, 100)),
    currentValue: Math.round(boundedNumber(value.currentValue, 'current value', 0, 100_000)),
    confidence: Math.round(boundedNumber(value.confidence, 'confidence', 0, 100)),
    eventType,
    newsDirection: newsDirection as MarketTapeAssetInput['newsDirection'],
    features: {
      lineupDelta: features.lineupDelta == null ? null : featureNumber(features, 'lineupDelta', -50, 50),
      age: features.age == null ? null : featureNumber(features, 'age', 0, 60),
      horizonYears: featureNumber(features, 'horizonYears', 1, 4) as 1 | 2 | 3 | 4,
    },
    metadata: {
      year: typeof metadata.year === 'string' && /^20\d{2}$/.test(metadata.year) ? metadata.year : undefined,
      round: Number.isInteger(Number(metadata.round)) && Number(metadata.round) >= 1 && Number(metadata.round) <= 12 ? Number(metadata.round) : undefined,
      slot: Number.isInteger(Number(metadata.slot)) && Number(metadata.slot) >= 1 && Number(metadata.slot) <= 100 ? Number(metadata.slot) : undefined,
      projectedTier,
    },
  }
}

export function normalizeMarketTapeInput(input: unknown): MarketTapeRequest {
  const value = object(input)
  if (!Array.isArray(value.assets) || !value.assets.length || value.assets.length > 700) throw new Error('Invalid market tape assets')
  const format = object(value.format)
  const numQbs = boundedNumber(format.numQbs, 'quarterback format', 1, 2)
  if (numQbs !== 1 && numQbs !== 2) throw new Error('Invalid quarterback format')
  if (typeof format.tep !== 'boolean') throw new Error('Invalid tight end premium format')
  const context = object(value.leagueContext)
  const leagueId = boundedText(context.leagueId, 'league context ID', 24)
  if (!isSupportedLeagueId(leagueId)) throw new Error('Unsupported league context')
  const contextKey = boundedText(context.contextKey, 'league context key', 300)
  const tePremiumPerReception = boundedNumber(context.tePremiumPerReception, 'TE premium', 0, 5)
  const startingSlots = Math.round(boundedNumber(context.startingSlots, 'starting slots', 1, 30))
  const skillStartingSlots = Math.round(boundedNumber(context.skillStartingSlots, 'skill starting slots', 1, 30))
  if (!contextKey.startsWith(`${leagueId}:`)) throw new Error('League context fingerprint does not match its league')
  if ((tePremiumPerReception > 0) !== format.tep) throw new Error('League context does not match the provider TEP bucket')
  if (skillStartingSlots > startingSlots) throw new Error('Skill starting slots exceed total starting slots')
  return {
    assets: value.assets.map(normalizeTapeAsset),
    format: {
      numQbs,
      tep: format.tep,
      numTeams: Math.round(boundedNumber(format.numTeams, 'team count', 4, 32)),
    },
    leagueContext: {
      leagueId,
      contextKey,
      receptionPpr: boundedNumber(context.receptionPpr, 'reception PPR', 0, 5),
      tePremiumPerReception,
      startingSlots,
      skillStartingSlots,
      benchSlots: Math.round(boundedNumber(context.benchSlots, 'bench slots', 0, 40)),
      taxiSlots: Math.round(boundedNumber(context.taxiSlots, 'taxi slots', 0, 20)),
      reserveSlots: Math.round(boundedNumber(context.reserveSlots, 'reserve slots', 0, 20)),
      rookieDraftRounds: Math.round(boundedNumber(context.rookieDraftRounds, 'rookie draft rounds', 1, 12)),
    },
    sourceVersion: boundedText(value.sourceVersion, 'source version', 120),
  }
}

async function batchInChunks(db: D1Database, statements: D1PreparedStatement[], size = 60): Promise<void> {
  for (let index = 0; index < statements.length; index += size) await db.batch(statements.slice(index, index + size))
}

async function saveNormalizedTape(
  db: D1Database,
  userId: string,
  leagueId: string,
  assets: MarketTapeAssetInput[],
  sourceVersion: string,
  source: string,
  now: Date,
  leagueContext?: MarketTapeRequest['leagueContext'],
): Promise<void> {
  const capturedAt = now.toISOString()
  const snapshotDate = capturedAt.slice(0, 10)
  await batchInChunks(db, assets.map((asset) => db.prepare(`INSERT INTO market_value_snapshots (
  user_id, league_id, snapshot_date, asset_id, asset_name, kind, position, owner_roster_id,
  current_value, projection_30, confidence, event_type, news_direction, features_json,
  metadata_json, source, source_version, captured_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(user_id, league_id, snapshot_date, asset_id) DO UPDATE SET
  asset_name=excluded.asset_name, kind=excluded.kind, position=excluded.position,
  owner_roster_id=excluded.owner_roster_id, current_value=excluded.current_value,
  projection_30=CASE WHEN excluded.source='client' THEN excluded.projection_30 ELSE market_value_snapshots.projection_30 END,
  confidence=excluded.confidence, event_type=CASE WHEN excluded.source='client' THEN excluded.event_type ELSE market_value_snapshots.event_type END,
  news_direction=CASE WHEN excluded.source='client' THEN excluded.news_direction ELSE market_value_snapshots.news_direction END,
  features_json=CASE WHEN excluded.source='client' THEN excluded.features_json ELSE market_value_snapshots.features_json END,
  metadata_json=excluded.metadata_json, source=excluded.source, source_version=excluded.source_version,
  captured_at=excluded.captured_at`).bind(
    userId, leagueId, snapshotDate, asset.assetId, asset.assetName, asset.kind, asset.position,
    asset.ownerRosterId, asset.currentValue, asset.currentValue, asset.confidence, asset.eventType,
    asset.newsDirection, JSON.stringify(asset.features), JSON.stringify({
      ...asset.metadata,
      ...(leagueContext ? {
        leagueContextKey: leagueContext.contextKey,
        receptionPpr: leagueContext.receptionPpr,
        tePremiumPerReception: leagueContext.tePremiumPerReception,
        startingSlots: leagueContext.startingSlots,
        skillStartingSlots: leagueContext.skillStartingSlots,
        benchSlots: leagueContext.benchSlots,
        taxiSlots: leagueContext.taxiSlots,
        reserveSlots: leagueContext.reserveSlots,
        rookieDraftRounds: leagueContext.rookieDraftRounds,
      } : {}),
    }), source,
    sourceVersion, capturedAt,
  )))
}

export async function saveMarketTape(
  db: D1Database,
  userId: string,
  leagueId: string,
  request: MarketTapeRequest,
  now = new Date(),
): Promise<void> {
  if (request.leagueContext.leagueId !== leagueId) throw new Error('League context does not match the requested league')
  await saveNormalizedTape(db, userId, leagueId, request.assets, request.sourceVersion, 'client', now, request.leagueContext)
  const capturedAt = now.toISOString()
  await db.prepare(`INSERT INTO market_tape_configs (
  user_id, league_id, num_qbs, tep, num_teams, source_version, seeded_at, last_client_refresh_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(user_id, league_id) DO UPDATE SET
  num_qbs=excluded.num_qbs, tep=excluded.tep, num_teams=excluded.num_teams,
  source_version=excluded.source_version, last_client_refresh_at=excluded.last_client_refresh_at`).bind(
    userId, leagueId, request.format.numQbs, request.format.tep ? 1 : 0,
    request.format.numTeams, request.sourceVersion, capturedAt, capturedAt,
  ).run()
}

type SnapshotRow = {
  snapshot_date: string; asset_id: string; asset_name: string; kind: MarketTapeAssetInput['kind']
  position: MarketTapeAssetInput['position']; owner_roster_id: number; current_value: number
  projection_30: number; confidence: number; event_type: string
  news_direction: MarketTapeAssetInput['newsDirection']; features_json: string
  metadata_json: string; source_version: string; captured_at: string
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T } catch { return fallback }
}

function snapshotFromRow(row: SnapshotRow): MarketSnapshotRecord {
  return {
    snapshotDate: row.snapshot_date,
    capturedAt: row.captured_at,
    sourceVersion: row.source_version,
    assetId: row.asset_id,
    assetName: row.asset_name,
    kind: row.kind,
    position: row.position,
    ownerRosterId: row.owner_roster_id,
    currentValue: row.current_value,
    projection30: row.projection_30,
    confidence: row.confidence,
    eventType: row.event_type,
    newsDirection: row.news_direction,
    features: parseJson(row.features_json, {
      lineupDelta: null, age: null, horizonYears: 2,
    }),
    metadata: parseJson(row.metadata_json, {}),
  }
}

async function readSnapshots(db: D1Database, userId: string, leagueId: string): Promise<MarketSnapshotRecord[]> {
  const rows = await db.prepare(`SELECT snapshot_date, asset_id, asset_name, kind, position,
owner_roster_id, current_value, projection_30, confidence, event_type, news_direction,
features_json, metadata_json, source_version, captured_at
FROM market_value_snapshots WHERE user_id=? AND league_id=?
ORDER BY snapshot_date DESC, asset_id ASC LIMIT ?`).bind(userId, leagueId, MAX_TAPE_ROWS).all<SnapshotRow>()
  return rows.results.map(snapshotFromRow)
}

async function readLatestSnapshots(db: D1Database, userId: string, leagueId: string): Promise<MarketSnapshotRecord[]> {
  const rows = await db.prepare(`SELECT snapshot_date, asset_id, asset_name, kind, position,
owner_roster_id, current_value, projection_30, confidence, event_type, news_direction,
features_json, metadata_json, source_version, captured_at FROM market_value_snapshots
WHERE user_id=? AND league_id=? AND snapshot_date=(SELECT MAX(snapshot_date) FROM market_value_snapshots WHERE user_id=? AND league_id=?)
ORDER BY asset_id LIMIT 700`).bind(userId, leagueId, userId, leagueId).all<SnapshotRow>()
  return rows.results.map(snapshotFromRow)
}

type StoredReport = Pick<EdgeLearningReport, 'health' | 'calibration' | 'artifact'>

export async function rebuildEdgeLearningState(
  db: D1Database,
  userId: string,
  leagueId: string,
  now = new Date(),
): Promise<StoredReport> {
  const existing = await db.prepare(`SELECT report_json FROM edge_model_runs
WHERE user_id=? AND league_id=? AND run_date=? ORDER BY trained_at DESC LIMIT 1`).bind(
    userId, leagueId, now.toISOString().slice(0, 10),
  ).first<ReportRow>()
  if (existing) return parseJson<StoredReport>(existing.report_json, { health: emptyShadowHealth(), calibration: [], artifact: null })
  const snapshots = await readSnapshots(db, userId, leagueId)
  const report = buildEdgeLearningReport(snapshots, now)
  const stored: StoredReport = { health: report.health, calibration: report.calibration, artifact: report.artifact }
  await db.prepare(`INSERT INTO edge_model_runs (
  user_id, league_id, run_date, model_version, trained_at, status, report_json
) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(user_id, league_id, run_date, model_version) DO UPDATE SET
  trained_at=excluded.trained_at, status=excluded.status, report_json=excluded.report_json`).bind(
    userId, leagueId, now.toISOString().slice(0, 10), report.health.version,
    now.toISOString(), report.health.status, JSON.stringify(stored),
  ).run()
  return stored
}

type SummaryRow = {
  snapshot_count: number; asset_count: number; first_at: string | null; last_at: string | null
}
type ConfigRow = {
  last_auto_refresh_at: string | null; last_auto_refresh_error: string | null
}
type ReportRow = { report_json: string }
type TeamMarketHistoryRow = {
  snapshot_date: string
  owner_roster_id: number
  total_value: number
  player_value: number
  pick_value: number
  asset_count: number
}

export async function readTeamMarketHistory(
  db: D1Database,
  userId: string,
  leagueId: string,
): Promise<TeamMarketHistoryPoint[]> {
  const rows = await db.prepare(`SELECT snapshot_date, owner_roster_id,
SUM(current_value) AS total_value,
SUM(CASE WHEN kind='player' THEN current_value ELSE 0 END) AS player_value,
SUM(CASE WHEN kind='pick' THEN current_value ELSE 0 END) AS pick_value,
COUNT(*) AS asset_count
FROM market_value_snapshots
WHERE user_id=? AND league_id=?
GROUP BY snapshot_date, owner_roster_id
ORDER BY snapshot_date ASC, owner_roster_id ASC
LIMIT 10000`).bind(userId, leagueId).all<TeamMarketHistoryRow>()
  return rows.results.map((row) => ({
    snapshotDate: row.snapshot_date,
    rosterId: Number(row.owner_roster_id),
    totalValue: Number(row.total_value),
    playerValue: Number(row.player_value),
    pickValue: Number(row.pick_value),
    assetCount: Number(row.asset_count),
  }))
}

export async function readEdgeLearningState(
  db: D1Database,
  userId: string,
  leagueId: string,
): Promise<Pick<EdgeStateBundle, 'marketTape' | 'teamMarketHistory' | 'calibration' | 'shadowModel' | 'shadowPredictions'>> {
  const [summary, config, reportRow, snapshots, teamMarketHistory] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS snapshot_count, COUNT(DISTINCT asset_id) AS asset_count,
MIN(captured_at) AS first_at, MAX(captured_at) AS last_at
FROM market_value_snapshots WHERE user_id=? AND league_id=?`).bind(userId, leagueId).first<SummaryRow>(),
    db.prepare(`SELECT last_auto_refresh_at, last_auto_refresh_error FROM market_tape_configs
WHERE user_id=? AND league_id=?`).bind(userId, leagueId).first<ConfigRow>(),
    db.prepare(`SELECT report_json FROM edge_model_runs WHERE user_id=? AND league_id=?
ORDER BY trained_at DESC LIMIT 1`).bind(userId, leagueId).first<ReportRow>(),
    readLatestSnapshots(db, userId, leagueId),
    readTeamMarketHistory(db, userId, leagueId),
  ])
  const stored = reportRow
    ? parseJson<StoredReport>(reportRow.report_json, { health: emptyShadowHealth(), calibration: [], artifact: null })
    : { health: emptyShadowHealth(), calibration: [], artifact: null }
  const firstAt = summary?.first_at ?? null
  const lastAt = summary?.last_at ?? null
  const marketTape: MarketTapeSummary = {
    snapshotCount: Number(summary?.snapshot_count ?? 0),
    assetsTracked: Number(summary?.asset_count ?? 0),
    firstSnapshotAt: firstAt,
    lastSnapshotAt: lastAt,
    spanDays: firstAt && lastAt ? Math.max(0, Math.round((Date.parse(lastAt) - Date.parse(firstAt)) / 86_400_000)) : 0,
    labeledExamples: stored.health.trainingRows + stored.health.validationRows,
    lastAutomaticRefreshAt: config?.last_auto_refresh_at ?? null,
    automaticRefreshError: config?.last_auto_refresh_error ?? null,
  }
  return {
    marketTape,
    teamMarketHistory,
    calibration: stored.calibration,
    shadowModel: stored.health,
    shadowPredictions: shadowPredictions(stored.artifact, stored.health, snapshots),
  }
}

type TapeConfig = {
  user_id: string; league_id: string; num_qbs: 1 | 2; tep: number; num_teams: number
  last_auto_refresh_at: string | null
}
export type TradyrPlayer = {
  sleeperId: string | null
  slug?: string
  name?: string
  position?: string
  composite: number
  sources?: { ktc?: number | null; fantasycalc?: number | null }
}
type TradyrPick = { year: string; round: number; slot?: number; tier?: string; composite: number }
export type TradyrResponse<T> = {
  data: T
  meta?: { generatedAt?: string; version?: string; sources?: string[]; attribution?: string }
}
export type MarketCatalog = {
  players: Map<string, number>
  playerDetails: Map<string, TradyrPlayer>
  picks: TradyrPick[]
  sourceVersion: string
  provenance: { version?: string; sources: string[]; attribution?: string }
}

export async function fetchCatalog(
  config: { num_qbs: 1 | 2; tep: number; num_teams: number },
  apiKey?: string,
  fetcher: typeof fetch = fetch,
): Promise<MarketCatalog> {
  const key = apiKey?.trim()
  if (!key) throw new Error('Tradyr authentication is not configured')
  const bundle = await fetchMarketBundle({
    format: 'dynasty',
    numQbs: config.num_qbs,
    tep: Boolean(config.tep),
    numTeams: config.num_teams,
  }, key, fetcher)
  return {
    players: new Map(bundle.players.filter((player) => player.sleeperId).map((player) => [String(player.sleeperId), player.composite])),
    playerDetails: new Map(bundle.players.filter((player) => player.sleeperId).map((player) => [String(player.sleeperId), player])),
    picks: bundle.picks,
    sourceVersion: bundle.meta.generatedAt,
    provenance: {
      sources: bundle.meta.sources,
      attribution: bundle.meta.attribution,
    },
  }
}

export function resolveCatalogValue(snapshot: MarketSnapshotRecord, catalog: MarketCatalog): number | null {
  if (snapshot.kind === 'player') return catalog.players.get(snapshot.assetId) ?? null
  const year = snapshot.metadata.year
  const round = snapshot.metadata.round
  if (!round) return null
  const exact = catalog.picks.filter((pick) => (!year || pick.year === year) && pick.round === round)
  const candidates = exact.length ? exact : catalog.picks.filter((pick) => pick.round === round)
  if (!candidates.length) return null
  const slot = snapshot.metadata.slot
  if (slot) {
    const match = candidates.find((pick) => Number(pick.slot) === slot)
    if (match) return match.composite
  }
  const tier = snapshot.metadata.projectedTier
  if (tier && tier !== 'known') {
    const tierRows = candidates.filter((pick) => pick.tier === tier)
    if (tierRows.length) return Math.round(tierRows.reduce((sum, pick) => sum + pick.composite, 0) / tierRows.length)
  }
  return Math.round(candidates.reduce((sum, pick) => sum + pick.composite, 0) / candidates.length)
}

export async function refreshTrackedMarketTapes(
  db: D1Database,
  now = new Date(),
  apiKey?: string,
): Promise<void> {
  await ensureEdgeLearningSchema(db)
  const configs = await db.prepare(`SELECT user_id, league_id, num_qbs, tep, num_teams, last_auto_refresh_at
FROM market_tape_configs ORDER BY COALESCE(last_auto_refresh_at, seeded_at) ASC LIMIT 100`).all<TapeConfig>()
  const due = configs.results.filter((config) => !config.last_auto_refresh_at || now.getTime() - Date.parse(config.last_auto_refresh_at) >= AUTO_REFRESH_MS)
  const catalogs = new Map<string, Promise<MarketCatalog>>()
  for (const config of due) {
    try {
      const key = `${config.num_qbs}:${config.tep}:${config.num_teams}`
      if (!catalogs.has(key)) catalogs.set(key, fetchCatalog(config, apiKey))
      const catalog = await catalogs.get(key)!
      const latestRows = await db.prepare(`SELECT snapshot_date, asset_id, asset_name, kind, position,
owner_roster_id, current_value, projection_30, confidence, event_type, news_direction,
features_json, metadata_json, source_version, captured_at FROM market_value_snapshots
WHERE user_id=? AND league_id=? AND snapshot_date=(SELECT MAX(snapshot_date) FROM market_value_snapshots WHERE user_id=? AND league_id=?)
ORDER BY asset_id`).bind(config.user_id, config.league_id, config.user_id, config.league_id).all<SnapshotRow>()
      const refreshed = latestRows.results.map(snapshotFromRow).flatMap((snapshot) => {
        const value = resolveCatalogValue(snapshot, catalog)
        return value === null ? [] : [{ ...snapshot, currentValue: Math.round(value) }]
      })
      if (refreshed.length) {
        await saveNormalizedTape(db, config.user_id, config.league_id, refreshed, catalog.sourceVersion, 'automatic', now)
        await rebuildEdgeLearningState(db, config.user_id, config.league_id, now)
      }
      await db.prepare(`UPDATE market_tape_configs SET last_auto_refresh_at=?, last_auto_refresh_error=NULL
WHERE user_id=? AND league_id=?`).bind(now.toISOString(), config.user_id, config.league_id).run()
    } catch (error) {
      await db.prepare(`UPDATE market_tape_configs SET last_auto_refresh_at=?, last_auto_refresh_error=?
WHERE user_id=? AND league_id=?`).bind(
        now.toISOString(), error instanceof Error ? error.message.slice(0, 300) : 'Unknown refresh failure',
        config.user_id, config.league_id,
      ).run()
    }
  }
}

export function emptyLearningState(): Pick<EdgeStateBundle, 'marketTape' | 'teamMarketHistory' | 'calibration' | 'shadowModel' | 'shadowPredictions'> {
  return {
    marketTape: {
      snapshotCount: 0, assetsTracked: 0, firstSnapshotAt: null, lastSnapshotAt: null,
      spanDays: 0, labeledExamples: 0, lastAutomaticRefreshAt: null,
      automaticRefreshError: null,
    },
    teamMarketHistory: [],
    calibration: [] as EdgeCalibrationGroup[],
    shadowModel: emptyShadowHealth(),
    shadowPredictions: [] as EdgeShadowPrediction[],
  }
}
