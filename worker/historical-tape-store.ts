import {
  buildHistoricalTapeAudit,
  emptyHistoricalTapeAudit,
  selectHistoricalAuditAssets,
  summarizeHistoricalSeries,
  type HistoricalAuditAssetResult,
  type HistoricalPointInput,
} from '../src/historical-tape'
import type { HistoricalTapeAudit, MarketTapeRequest } from '../src/types'
import { fetchCatalog, type TradyrResponse } from './edge-learning-store'
import type { D1Database, D1PreparedStatement } from './user-store'

const TRADYR_BASE = 'https://api.tradyr.app/v1'
const PROVIDER = 'tradyr'
const FORMAT_KEY = 'tradyr-default-history'
const SCALE_KEY = 'tradyr-history-normalized-v1'
const ASSETS_PER_RUN = 8

const CREATE_CONFIGS = `CREATE TABLE IF NOT EXISTS historical_tape_configs (
  user_id TEXT NOT NULL, league_id TEXT NOT NULL, provider TEXT NOT NULL,
  status TEXT NOT NULL, format_key TEXT NOT NULL, num_qbs INTEGER NOT NULL,
  tep INTEGER NOT NULL, num_teams INTEGER NOT NULL, queued_at TEXT NOT NULL,
  started_at TEXT, updated_at TEXT NOT NULL, completed_at TEXT, report_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, league_id, provider)
)`
const CREATE_CONFIG_INDEX = `CREATE INDEX IF NOT EXISTS idx_historical_tape_configs_status
ON historical_tape_configs (status, updated_at)`
const CREATE_ASSETS = `CREATE TABLE IF NOT EXISTS historical_tape_assets (
  user_id TEXT NOT NULL, league_id TEXT NOT NULL, provider TEXT NOT NULL,
  asset_id TEXT NOT NULL, asset_name TEXT NOT NULL, position TEXT NOT NULL,
  current_composite INTEGER NOT NULL, slug TEXT, status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0, last_attempt_at TEXT, error_message TEXT,
  observation_count INTEGER NOT NULL DEFAULT 0, label_count INTEGER NOT NULL DEFAULT 0,
  first_observed_at TEXT, last_observed_at TEXT, span_days INTEGER NOT NULL DEFAULT 0,
  median_gap_days REAL NOT NULL DEFAULT 0, scale_status TEXT NOT NULL DEFAULT 'unknown',
  scale_gap REAL, source_version TEXT, metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, league_id, provider, asset_id)
)`
const CREATE_ASSET_INDEX = `CREATE INDEX IF NOT EXISTS idx_historical_tape_assets_pending
ON historical_tape_assets (user_id, league_id, provider, status)`
const CREATE_OBSERVATIONS = `CREATE TABLE IF NOT EXISTS historical_market_observations (
  provider TEXT NOT NULL, format_key TEXT NOT NULL, scale_key TEXT NOT NULL,
  asset_id TEXT NOT NULL, asset_name TEXT NOT NULL, position TEXT NOT NULL,
  observed_at TEXT NOT NULL, provider_value REAL NOT NULL, raw_value REAL,
  source_version TEXT NOT NULL, provenance_json TEXT NOT NULL, ingested_at TEXT NOT NULL,
  PRIMARY KEY (provider, format_key, scale_key, asset_id, observed_at)
)`
const CREATE_OBSERVATION_INDEX = `CREATE INDEX IF NOT EXISTS idx_historical_market_asset_date
ON historical_market_observations (provider, format_key, scale_key, asset_id, observed_at)`

let schemaReady: Promise<void> | null = null

export async function ensureHistoricalTapeSchema(db: D1Database): Promise<void> {
  if (!schemaReady) {
    schemaReady = db.batch([
      db.prepare(CREATE_CONFIGS),
      db.prepare(CREATE_CONFIG_INDEX),
      db.prepare(CREATE_ASSETS),
      db.prepare(CREATE_ASSET_INDEX),
      db.prepare(CREATE_OBSERVATIONS),
      db.prepare(CREATE_OBSERVATION_INDEX),
      db.prepare('PRAGMA optimize'),
    ]).then(() => undefined).catch((error) => {
      schemaReady = null
      throw error
    })
  }
  return schemaReady
}

async function batchInChunks(db: D1Database, statements: D1PreparedStatement[], size = 60): Promise<void> {
  for (let index = 0; index < statements.length; index += size) await db.batch(statements.slice(index, index + size))
}

type LatestAssetRow = {
  asset_id: string
  asset_name: string
  kind: MarketTapeRequest['assets'][number]['kind']
  position: MarketTapeRequest['assets'][number]['position']
  current_value: number
}

export async function queueHistoricalTapeAudit(
  db: D1Database,
  userId: string,
  leagueId: string,
  request: MarketTapeRequest,
  now = new Date(),
): Promise<void> {
  await ensureHistoricalTapeSchema(db)
  const existing = await db.prepare(`SELECT status FROM historical_tape_configs
WHERE user_id=? AND league_id=? AND provider=?`).bind(userId, leagueId, PROVIDER).first<{ status: string }>()
  if (existing) return
  const latest = await db.prepare(`SELECT asset_id, asset_name, kind, position, current_value
FROM market_value_snapshots
WHERE user_id=? AND league_id=? AND snapshot_date=(
  SELECT MAX(snapshot_date) FROM market_value_snapshots WHERE user_id=? AND league_id=?
)
ORDER BY position, current_value DESC, asset_id`).bind(userId, leagueId, userId, leagueId).all<LatestAssetRow>()
  const selected = selectHistoricalAuditAssets(latest.results.map((row) => ({
    assetId: row.asset_id,
    assetName: row.asset_name,
    kind: row.kind,
    position: row.position,
    currentValue: row.current_value,
  })))
  if (!selected.length) return
  const timestamp = now.toISOString()
  await db.batch([
    db.prepare(`INSERT INTO historical_tape_configs (
  user_id, league_id, provider, status, format_key, num_qbs, tep, num_teams,
  queued_at, updated_at, report_json
) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, '{}')`).bind(
      userId, leagueId, PROVIDER, FORMAT_KEY, request.format.numQbs, request.format.tep ? 1 : 0,
      request.format.numTeams, timestamp, timestamp,
    ),
    ...selected.map((asset) => db.prepare(`INSERT INTO historical_tape_assets (
  user_id, league_id, provider, asset_id, asset_name, position, current_composite
) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
      userId, leagueId, PROVIDER, asset.assetId, asset.assetName, asset.position, Math.round(asset.currentValue),
    )),
  ])
}

type ConfigRow = {
  user_id: string
  league_id: string
  status: string
  num_qbs: 1 | 2
  tep: number
  num_teams: number
  queued_at: string
  updated_at: string
  completed_at: string | null
  report_json: string
}

type AssetRow = {
  asset_id: string
  asset_name: string
  position: 'QB' | 'RB' | 'WR' | 'TE'
  current_composite: number
  status: HistoricalAuditAssetResult['status']
  attempt_count: number
  observation_count: number
  label_count: number
  span_days: number
  median_gap_days: number
  scale_status: HistoricalAuditAssetResult['scaleStatus']
}

type HistoryData = {
  name?: string
  position?: string
  history?: HistoricalPointInput[]
}

function canonicalSlug(name: string, position: string): string {
  const normalized = name.toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${normalized}-${position.toLowerCase()}`
}

async function fetchHistory(slug: string): Promise<TradyrResponse<HistoryData> | null> {
  const response = await fetch(`${TRADYR_BASE}/players/${encodeURIComponent(slug)}/history`, {
    headers: { 'User-Agent': 'RosterLab/5.0 private historical tape audit' },
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json<TradyrResponse<HistoryData>>()
}

function auditAssetFromRow(row: AssetRow): HistoricalAuditAssetResult {
  return {
    status: row.status,
    observationCount: row.observation_count,
    labelCount: row.label_count,
    spanDays: row.span_days,
    medianGapDays: row.median_gap_days,
    scaleStatus: row.scale_status,
  }
}

async function currentAudit(db: D1Database, config: ConfigRow): Promise<HistoricalTapeAudit> {
  if (['passed', 'blocked', 'failed'].includes(config.status) && config.report_json !== '{}') {
    try { return JSON.parse(config.report_json) as HistoricalTapeAudit } catch { /* rebuild below */ }
  }
  const rows = await db.prepare(`SELECT asset_id, asset_name, position, current_composite, status,
attempt_count, observation_count, label_count, span_days, median_gap_days, scale_status
FROM historical_tape_assets WHERE user_id=? AND league_id=? AND provider=?
ORDER BY position, asset_id`).bind(config.user_id, config.league_id, PROVIDER).all<AssetRow>()
  const lifecycleStatus = config.status === 'failed'
    ? 'failed'
    : config.status === 'queued'
      ? 'queued'
      : config.status === 'running'
        ? 'running'
        : 'complete'
  return buildHistoricalTapeAudit({
    assets: rows.results.map(auditAssetFromRow),
    formatCompatible: config.num_qbs === 2 && !config.tep,
    lifecycleStatus,
    queuedAt: config.queued_at,
    updatedAt: config.updated_at,
    completedAt: config.completed_at,
  })
}

export async function readHistoricalTapeAudit(
  db: D1Database,
  userId: string,
  leagueId: string,
): Promise<HistoricalTapeAudit> {
  await ensureHistoricalTapeSchema(db)
  const config = await db.prepare(`SELECT user_id, league_id, status, num_qbs, tep, num_teams,
queued_at, updated_at, completed_at, report_json FROM historical_tape_configs
WHERE user_id=? AND league_id=? AND provider=?`).bind(userId, leagueId, PROVIDER).first<ConfigRow>()
  return config ? currentAudit(db, config) : emptyHistoricalTapeAudit()
}

async function finalizeIfComplete(db: D1Database, config: ConfigRow, now: Date): Promise<void> {
  const pending = await db.prepare(`SELECT COUNT(*) AS pending FROM historical_tape_assets
WHERE user_id=? AND league_id=? AND provider=? AND status='pending'`).bind(
    config.user_id, config.league_id, PROVIDER,
  ).first<{ pending: number }>()
  if (Number(pending?.pending ?? 0) > 0) {
    await db.prepare(`UPDATE historical_tape_configs SET status='running', updated_at=?
WHERE user_id=? AND league_id=? AND provider=?`).bind(
      now.toISOString(), config.user_id, config.league_id, PROVIDER,
    ).run()
    return
  }
  const completedAt = now.toISOString()
  const draftConfig = { ...config, status: 'complete', updated_at: completedAt, completed_at: completedAt }
  const report = await currentAudit(db, draftConfig)
  await db.prepare(`UPDATE historical_tape_configs
SET status=?, updated_at=?, completed_at=?, report_json=?
WHERE user_id=? AND league_id=? AND provider=?`).bind(
    report.status, completedAt, completedAt, JSON.stringify(report),
    config.user_id, config.league_id, PROVIDER,
  ).run()
}

export async function refreshHistoricalTapeAudits(db: D1Database, now = new Date()): Promise<void> {
  await ensureHistoricalTapeSchema(db)
  const config = await db.prepare(`SELECT user_id, league_id, status, num_qbs, tep, num_teams,
queued_at, updated_at, completed_at, report_json FROM historical_tape_configs
WHERE status IN ('queued', 'running') ORDER BY updated_at ASC LIMIT 1`).first<ConfigRow>()
  if (!config) return
  const startedAt = now.toISOString()
  await db.prepare(`UPDATE historical_tape_configs SET status='running',
started_at=COALESCE(started_at, ?), updated_at=? WHERE user_id=? AND league_id=? AND provider=?`).bind(
    startedAt, startedAt, config.user_id, config.league_id, PROVIDER,
  ).run()
  try {
    const catalog = await fetchCatalog({ num_qbs: config.num_qbs, tep: config.tep, num_teams: config.num_teams })
    const pending = await db.prepare(`SELECT asset_id, asset_name, position, current_composite, status,
attempt_count, observation_count, label_count, span_days, median_gap_days, scale_status
FROM historical_tape_assets
WHERE user_id=? AND league_id=? AND provider=? AND status='pending'
ORDER BY attempt_count, position, asset_id LIMIT ?`).bind(
      config.user_id, config.league_id, PROVIDER, ASSETS_PER_RUN,
    ).all<AssetRow>()
    const fetched = await Promise.all(pending.results.map(async (asset) => {
      const detail = catalog.playerDetails.get(asset.asset_id)
      if (!detail) return { asset, detail: null, slug: null, response: null, missing: true, error: null }
      const slug = detail.slug ?? canonicalSlug(detail.name ?? asset.asset_name, detail.position ?? asset.position)
      try {
        const response = await fetchHistory(slug)
        return { asset, detail, slug, response, missing: !response, error: null }
      } catch (error) {
        return { asset, detail, slug, response: null, missing: false, error }
      }
    }))

    for (const item of fetched) {
      const attemptCount = item.asset.attempt_count + 1
      if (item.missing) {
        await db.prepare(`UPDATE historical_tape_assets SET slug=?, status='missing',
attempt_count=?, last_attempt_at=?, error_message='No provider history was returned'
WHERE user_id=? AND league_id=? AND provider=? AND asset_id=?`).bind(
          item.slug, attemptCount, startedAt, config.user_id, config.league_id, PROVIDER, item.asset.asset_id,
        ).run()
        continue
      }
      if (item.error || !item.response || !item.detail) {
        const terminal = attemptCount >= 3
        const message = item.error instanceof Error ? item.error.message.slice(0, 300) : 'Provider history unavailable'
        await db.prepare(`UPDATE historical_tape_assets SET slug=?, status=?, attempt_count=?,
last_attempt_at=?, error_message=? WHERE user_id=? AND league_id=? AND provider=? AND asset_id=?`).bind(
          item.slug, terminal ? 'failed' : 'pending', attemptCount, startedAt, message,
          config.user_id, config.league_id, PROVIDER, item.asset.asset_id,
        ).run()
        continue
      }
      const summary = summarizeHistoricalSeries({
        history: item.response.data.history ?? [],
        currentComposite: item.detail.composite,
        currentKtc: item.detail.sources?.ktc,
        currentFantasyCalc: item.detail.sources?.fantasycalc,
      })
      if (!summary.observationCount) {
        await db.prepare(`UPDATE historical_tape_assets SET slug=?, status='missing', attempt_count=?,
last_attempt_at=?, error_message='History contained no valid observations', source_version=?
WHERE user_id=? AND league_id=? AND provider=? AND asset_id=?`).bind(
          item.slug, attemptCount, startedAt, item.response.meta?.generatedAt ?? catalog.sourceVersion,
          config.user_id, config.league_id, PROVIDER, item.asset.asset_id,
        ).run()
        continue
      }
      const sourceVersion = item.response.meta?.generatedAt ?? catalog.sourceVersion
      const provenance = JSON.stringify({
        provider: PROVIDER,
        endpoint: '/v1/players/:slug/history',
        version: item.response.meta?.version ?? catalog.provenance.version,
        sources: item.response.meta?.sources ?? catalog.provenance.sources,
        attribution: item.response.meta?.attribution ?? catalog.provenance.attribution,
        scaleStatus: summary.scaleStatus,
      })
      await batchInChunks(db, summary.observations.map((observation) => db.prepare(`INSERT INTO historical_market_observations (
  provider, format_key, scale_key, asset_id, asset_name, position, observed_at,
  provider_value, raw_value, source_version, provenance_json, ingested_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(provider, format_key, scale_key, asset_id, observed_at) DO UPDATE SET
  asset_name=excluded.asset_name, position=excluded.position, provider_value=excluded.provider_value,
  raw_value=excluded.raw_value, source_version=excluded.source_version,
  provenance_json=excluded.provenance_json, ingested_at=excluded.ingested_at`).bind(
        PROVIDER, FORMAT_KEY, SCALE_KEY, item.asset.asset_id, item.asset.asset_name, item.asset.position,
        observation.observedAt, observation.providerValue, observation.rawValue, sourceVersion, provenance, startedAt,
      )))
      await db.prepare(`UPDATE historical_tape_assets SET slug=?, status='complete', attempt_count=?,
last_attempt_at=?, error_message=NULL, observation_count=?, label_count=?, first_observed_at=?,
last_observed_at=?, span_days=?, median_gap_days=?, scale_status=?, scale_gap=?, source_version=?, metadata_json=?
WHERE user_id=? AND league_id=? AND provider=? AND asset_id=?`).bind(
        item.slug, attemptCount, startedAt, summary.observationCount, summary.labelCount,
        summary.firstObservedAt, summary.lastObservedAt, summary.spanDays, summary.medianGapDays,
        summary.scaleStatus, summary.scaleGap, sourceVersion,
        JSON.stringify({ currentComposite: item.detail.composite, sources: item.detail.sources ?? {} }),
        config.user_id, config.league_id, PROVIDER, item.asset.asset_id,
      ).run()
    }
    await finalizeIfComplete(db, { ...config, status: 'running', updated_at: startedAt }, now)
  } catch (error) {
    await db.prepare(`UPDATE historical_tape_configs SET status='running', updated_at=?, report_json=?
WHERE user_id=? AND league_id=? AND provider=?`).bind(
      startedAt,
      JSON.stringify({ transientError: error instanceof Error ? error.message.slice(0, 300) : 'Unknown audit failure' }),
      config.user_id, config.league_id, PROVIDER,
    ).run()
  }
}
