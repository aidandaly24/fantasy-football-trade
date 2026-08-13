import {
  normalizeFantasyCalcHistory,
  reconstructTeamPlayerHistory,
  type HistoricalPlayerValueInput,
  type TeamRosterStateInput,
} from '../src/team-history'
import type {
  ReconstructedTeamMarketHistoryPoint,
  TeamHistoryBackfill,
} from '../src/types'
import { ensureEdgeLearningSchema } from './edge-learning-store'
import { ensureHistoricalTapeSchema } from './historical-tape-store'
import { ensureJournalSchema } from './journal-db'
import { ensureResearchSchema } from './research-store'
import type { D1Database, D1PreparedStatement } from './user-store'

const FANTASYCALC_BASE = 'https://api.fantasycalc.com'
const PROVIDER = 'fantasycalc'
const FORMAT_KEY = 'fantasycalc-dynasty-superflex-history-v1'
const SCALE_KEY = 'fantasycalc-public-history-weekly-v1'
const ASSETS_PER_RUN = 12

type ConfigRow = {
  status: string
  updated_at: string
  report_json: string
}

type AssetProgressRow = {
  requested_assets: number
  completed_assets: number
  missing_assets: number
  failed_assets: number
  observation_count: number
  first_observed_at: string | null
  last_observed_at: string | null
}

type FantasyCalcCurrentRow = {
  player?: {
    id?: string | number
    sleeperId?: string | null
    name?: string | null
    position?: string | null
  }
  value?: number | null
}

type FantasyCalcHistoryRow = { date?: unknown; value?: unknown; raw?: unknown }

type TapeAssetRow = {
  asset_id: string
  asset_name: string
  position: string
  slug: string | null
  attempt_count: number
  metadata_json: string
}

type WeekStateRow = {
  season: string
  week: number
  roster_id: number
  owner_user_id: string | null
  players_json: string
}

type CurrentRosterAssetRow = {
  snapshot_date: string
  owner_roster_id: number
  owner_user_id: string | null
  asset_id: string
  asset_name: string
  position: string
  current_value: number
}

type HistoricalObservationRow = {
  asset_id: string
  observed_at: string
  provider_value: number
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T } catch { return fallback }
}

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'RosterLab private team-history research' },
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json<T>()
}

async function batchInChunks(db: D1Database, statements: D1PreparedStatement[], size = 60): Promise<void> {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size))
  }
}

function emptyBackfill(): TeamHistoryBackfill {
  return {
    provider: PROVIDER,
    status: 'not-started',
    formatKey: FORMAT_KEY,
    requestedAssets: 0,
    completedAssets: 0,
    missingAssets: 0,
    failedAssets: 0,
    observationCount: 0,
    firstObservedAt: null,
    lastObservedAt: null,
    updatedAt: null,
    notes: [
      'Run the backfill from a team page to combine exact Sleeper weekly rosters with FantasyCalc player history.',
      'Reconstructed values exclude picks and use FantasyCalc generic superflex history, not this league exact TEP settings.',
    ],
  }
}

export async function readTeamHistoryBackfill(
  db: D1Database,
  userId: string,
  leagueId: string,
): Promise<TeamHistoryBackfill> {
  await ensureHistoricalTapeSchema(db)
  const config = await db.prepare(`SELECT status, updated_at, report_json
FROM historical_tape_configs WHERE user_id=? AND league_id=? AND provider=?`).bind(
    userId, leagueId, PROVIDER,
  ).first<ConfigRow>()
  if (!config) return emptyBackfill()
  const progress = await db.prepare(`SELECT
COUNT(*) AS requested_assets,
SUM(CASE WHEN status='complete' THEN 1 ELSE 0 END) AS completed_assets,
SUM(CASE WHEN status='missing' THEN 1 ELSE 0 END) AS missing_assets,
SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed_assets,
SUM(observation_count) AS observation_count,
MIN(first_observed_at) AS first_observed_at,
MAX(last_observed_at) AS last_observed_at
FROM historical_tape_assets WHERE user_id=? AND league_id=? AND provider=?`).bind(
    userId, leagueId, PROVIDER,
  ).first<AssetProgressRow>()
  const report = parseJson<{ notes?: string[] }>(config.report_json, {})
  const requestedAssets = Number(progress?.requested_assets ?? 0)
  const completedAssets = Number(progress?.completed_assets ?? 0)
  const missingAssets = Number(progress?.missing_assets ?? 0)
  const failedAssets = Number(progress?.failed_assets ?? 0)
  const terminal = completedAssets + missingAssets + failedAssets >= requestedAssets && requestedAssets > 0
  const status: TeamHistoryBackfill['status'] = config.status === 'failed'
    ? 'failed'
    : terminal
      ? missingAssets || failedAssets ? 'partial' : 'complete'
      : config.status === 'queued' ? 'queued' : 'running'
  return {
    provider: PROVIDER,
    status,
    formatKey: FORMAT_KEY,
    requestedAssets,
    completedAssets,
    missingAssets,
    failedAssets,
    observationCount: Number(progress?.observation_count ?? 0),
    firstObservedAt: progress?.first_observed_at ?? null,
    lastObservedAt: progress?.last_observed_at ?? null,
    updatedAt: config.updated_at,
    notes: report.notes ?? [
      'Player values are reconstructed from exact Sleeper weekly roster membership.',
      'Missing or delisted players reduce coverage; RosterLab never fills them with made-up values.',
      'Draft-pick value remains exclusive to exact observed portfolio snapshots.',
    ],
  }
}

async function currentCatalog(): Promise<Map<string, {
  fantasyCalcId: string
  name: string
  position: string
  value: number
}>> {
  const params = new URLSearchParams({
    isDynasty: 'true', numQbs: '2', numTeams: '12', ppr: '1', tep: 'te+',
    includeAdp: 'false', includeRosterPercent: 'false',
  })
  const rows = await requestJson<FantasyCalcCurrentRow[]>(`${FANTASYCALC_BASE}/values/current?${params}`)
  const catalog = new Map<string, { fantasyCalcId: string; name: string; position: string; value: number }>()
  rows.forEach((row) => {
    const sleeperId = String(row.player?.sleeperId ?? '')
    const fantasyCalcId = String(row.player?.id ?? '')
    const value = Number(row.value ?? 0)
    if (!sleeperId || !fantasyCalcId || !Number.isFinite(value) || value <= 0) return
    catalog.set(sleeperId, {
      fantasyCalcId,
      name: row.player?.name?.trim() || sleeperId,
      position: row.player?.position?.trim() || 'UNK',
      value,
    })
  })
  return catalog
}

export async function queueTeamHistoryBackfill(
  db: D1Database,
  userId: string,
  leagueId: string,
  now = new Date(),
): Promise<void> {
  await Promise.all([
    ensureHistoricalTapeSchema(db), ensureResearchSchema(db), ensureEdgeLearningSchema(db), ensureJournalSchema(db),
  ])
  const existing = await db.prepare(`SELECT status FROM historical_tape_configs
WHERE user_id=? AND league_id=? AND provider=?`).bind(userId, leagueId, PROVIDER).first<{ status: string }>()
  if (existing && !['complete', 'partial', 'failed'].includes(existing.status)) return
  const [weekRows, currentRows, catalog] = await Promise.all([
    db.prepare(`SELECT season, week, roster_id, owner_user_id, players_json
FROM league_week_states WHERE root_league_id=? ORDER BY season, week, roster_id`).bind(leagueId).all<WeekStateRow>(),
    db.prepare(`SELECT snapshot_date, owner_roster_id, NULL AS owner_user_id,
asset_id, asset_name, position, current_value FROM market_value_snapshots
WHERE user_id=? AND league_id=? AND kind='player' AND snapshot_date=(
  SELECT MAX(snapshot_date) FROM market_value_snapshots WHERE user_id=? AND league_id=?
) ORDER BY asset_id`).bind(userId, leagueId, userId, leagueId).all<CurrentRosterAssetRow>(),
    currentCatalog(),
  ])
  const playerIds = new Set<string>()
  weekRows.results.forEach((row) => parseJson<string[]>(row.players_json, []).forEach((id) => playerIds.add(id)))
  currentRows.results.forEach((row) => playerIds.add(row.asset_id))
  if (!weekRows.results.length) throw new Error('Sleeper weekly roster history is not ready yet')
  if (!playerIds.size) throw new Error('No historical roster players were found')

  const currentById = new Map(currentRows.results.map((row) => [row.asset_id, row]))
  const timestamp = now.toISOString()
  const report = JSON.stringify({
    notes: [
      'Player values are reconstructed from exact Sleeper weekly roster membership.',
      'FantasyCalc history is generic dynasty superflex and does not expose historical PPR, TEP, or team-count parameters.',
      'The stored provider tape is sampled weekly to bound private D1 writes; missing players remain explicit.',
      'Draft picks are excluded because a trustworthy point-in-time pick series is not available.',
    ],
  })
  const assets = [...playerIds].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const configStatement = existing
    ? db.prepare(`UPDATE historical_tape_configs SET status='queued', format_key=?,
queued_at=?, started_at=NULL, updated_at=?, completed_at=NULL, report_json=?
WHERE user_id=? AND league_id=? AND provider=?`).bind(
        FORMAT_KEY, timestamp, timestamp, report, userId, leagueId, PROVIDER,
      )
    : db.prepare(`INSERT INTO historical_tape_configs (
user_id, league_id, provider, status, format_key, num_qbs, tep, num_teams,
queued_at, updated_at, report_json
) VALUES (?, ?, ?, 'queued', ?, 2, 1, 12, ?, ?, ?)`).bind(
        userId, leagueId, PROVIDER, FORMAT_KEY, timestamp, timestamp, report,
      )
  await configStatement.run()
  await batchInChunks(db, assets.map((assetId) => {
    const item = catalog.get(assetId)
    const current = currentById.get(assetId)
    return db.prepare(`INSERT INTO historical_tape_assets (
user_id, league_id, provider, asset_id, asset_name, position, current_composite,
slug, status, error_message, metadata_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(user_id, league_id, provider, asset_id) DO UPDATE SET
asset_name=excluded.asset_name, position=excluded.position,
current_composite=excluded.current_composite,
slug=COALESCE(excluded.slug, historical_tape_assets.slug),
status=CASE WHEN excluded.slug IS NULL AND historical_tape_assets.status='complete'
  THEN 'complete' ELSE excluded.status END,
attempt_count=CASE WHEN excluded.slug IS NULL AND historical_tape_assets.status='complete'
  THEN historical_tape_assets.attempt_count ELSE 0 END,
last_attempt_at=CASE WHEN excluded.slug IS NULL AND historical_tape_assets.status='complete'
  THEN historical_tape_assets.last_attempt_at ELSE NULL END,
error_message=CASE WHEN excluded.slug IS NULL AND historical_tape_assets.status='complete'
  THEN NULL ELSE excluded.error_message END,
observation_count=CASE WHEN excluded.slug IS NULL AND historical_tape_assets.status='complete'
  THEN historical_tape_assets.observation_count ELSE 0 END,
label_count=CASE WHEN excluded.slug IS NULL AND historical_tape_assets.status='complete'
  THEN historical_tape_assets.label_count ELSE 0 END,
first_observed_at=CASE WHEN excluded.slug IS NULL AND historical_tape_assets.status='complete'
  THEN historical_tape_assets.first_observed_at ELSE NULL END,
last_observed_at=CASE WHEN excluded.slug IS NULL AND historical_tape_assets.status='complete'
  THEN historical_tape_assets.last_observed_at ELSE NULL END,
span_days=CASE WHEN excluded.slug IS NULL AND historical_tape_assets.status='complete'
  THEN historical_tape_assets.span_days ELSE 0 END,
median_gap_days=CASE WHEN excluded.slug IS NULL AND historical_tape_assets.status='complete'
  THEN historical_tape_assets.median_gap_days ELSE 0 END,
scale_status=CASE WHEN excluded.slug IS NULL AND historical_tape_assets.status='complete'
  THEN historical_tape_assets.scale_status ELSE 'unknown' END,
scale_gap=CASE WHEN excluded.slug IS NULL AND historical_tape_assets.status='complete'
  THEN historical_tape_assets.scale_gap ELSE NULL END,
source_version=CASE WHEN excluded.slug IS NULL AND historical_tape_assets.status='complete'
  THEN historical_tape_assets.source_version ELSE NULL END,
metadata_json=excluded.metadata_json`).bind(
      userId, leagueId, PROVIDER, assetId,
      item?.name ?? current?.asset_name ?? assetId,
      item?.position ?? current?.position ?? 'UNK',
      Math.round(item?.value ?? current?.current_value ?? 0),
      item?.fantasyCalcId ?? null,
      item ? 'pending' : 'missing',
      item ? null : 'Player is not present in the current FantasyCalc catalog',
      JSON.stringify({ fantasyCalcId: item?.fantasyCalcId ?? null, forceRefresh: Boolean(existing) }),
    )
  }))
}

function spanDays(first: string, last: string): number {
  return Math.max(0, Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000))
}

async function markFromCachedObservations(
  db: D1Database,
  userId: string,
  leagueId: string,
  asset: TapeAssetRow,
  now: string,
): Promise<boolean> {
  const cached = await db.prepare(`SELECT COUNT(*) AS count, MIN(observed_at) AS first_at,
MAX(observed_at) AS last_at FROM historical_market_observations
WHERE provider=? AND format_key=? AND scale_key=? AND asset_id=?`).bind(
    PROVIDER, FORMAT_KEY, SCALE_KEY, asset.asset_id,
  ).first<{ count: number; first_at: string | null; last_at: string | null }>()
  if (!cached?.count || !cached.first_at || !cached.last_at) return false
  await db.prepare(`UPDATE historical_tape_assets SET status='complete', last_attempt_at=?,
observation_count=?, first_observed_at=?, last_observed_at=?, span_days=?, median_gap_days=7,
scale_status='source-relative', error_message=NULL
WHERE user_id=? AND league_id=? AND provider=? AND asset_id=?`).bind(
    now, Number(cached.count), cached.first_at, cached.last_at, spanDays(cached.first_at, cached.last_at),
    userId, leagueId, PROVIDER, asset.asset_id,
  ).run()
  return true
}

export async function refreshTeamHistoryBackfill(
  db: D1Database,
  userId: string,
  leagueId: string,
  now = new Date(),
): Promise<TeamHistoryBackfill> {
  await ensureHistoricalTapeSchema(db)
  const timestamp = now.toISOString()
  const pending = await db.prepare(`SELECT asset_id, asset_name, position, slug, attempt_count, metadata_json
FROM historical_tape_assets WHERE user_id=? AND league_id=? AND provider=? AND status='pending'
ORDER BY attempt_count, asset_id LIMIT ?`).bind(userId, leagueId, PROVIDER, ASSETS_PER_RUN).all<TapeAssetRow>()
  await db.prepare(`UPDATE historical_tape_configs SET status='running',
started_at=COALESCE(started_at, ?), updated_at=? WHERE user_id=? AND league_id=? AND provider=?`).bind(
    timestamp, timestamp, userId, leagueId, PROVIDER,
  ).run()

  const uncached: TapeAssetRow[] = []
  for (const asset of pending.results) {
    const metadata = parseJson<{ forceRefresh?: boolean }>(asset.metadata_json, {})
    if (metadata.forceRefresh || !await markFromCachedObservations(db, userId, leagueId, asset, timestamp)) {
      uncached.push(asset)
    }
  }
  const fetched = await Promise.all(uncached.map(async (asset) => {
    if (!asset.slug) return { asset, history: null, error: new Error('Missing FantasyCalc player ID') }
    try {
      const params = new URLSearchParams({ isDynasty: 'true', numQbs: '2' })
      const history = await requestJson<FantasyCalcHistoryRow[]>(
        `${FANTASYCALC_BASE}/trades/historical/${encodeURIComponent(asset.slug)}?${params}`,
      )
      return { asset, history, error: null }
    } catch (error) {
      return { asset, history: null, error }
    }
  }))

  for (const result of fetched) {
    const attemptCount = result.asset.attempt_count + 1
    if (result.error || !result.history) {
      const terminal = attemptCount >= 3
      await db.prepare(`UPDATE historical_tape_assets SET status=?, attempt_count=?,
last_attempt_at=?, error_message=? WHERE user_id=? AND league_id=? AND provider=? AND asset_id=?`).bind(
        terminal ? 'failed' : 'pending', attemptCount, timestamp,
        result.error instanceof Error ? result.error.message.slice(0, 300) : 'FantasyCalc history unavailable',
        userId, leagueId, PROVIDER, result.asset.asset_id,
      ).run()
      continue
    }
    const observations = normalizeFantasyCalcHistory(result.history)
    if (!observations.length) {
      await db.prepare(`UPDATE historical_tape_assets SET status='missing', attempt_count=?,
last_attempt_at=?, error_message='History contained no valid positive values'
WHERE user_id=? AND league_id=? AND provider=? AND asset_id=?`).bind(
        attemptCount, timestamp, userId, leagueId, PROVIDER, result.asset.asset_id,
      ).run()
      continue
    }
    const provenance = JSON.stringify({
      provider: PROVIDER,
      endpoint: '/trades/historical/:playerId',
      params: { isDynasty: true, numQbs: 2 },
      sourceFormat: 'dynasty-superflex; historical endpoint omits PPR, TEP, and team count',
      sampling: 'first, weekly, latest',
      retrievedAt: timestamp,
    })
    await batchInChunks(db, observations.map((observation) => db.prepare(`INSERT INTO historical_market_observations (
provider, format_key, scale_key, asset_id, asset_name, position, observed_at,
provider_value, raw_value, source_version, provenance_json, ingested_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(provider, format_key, scale_key, asset_id, observed_at) DO UPDATE SET
asset_name=excluded.asset_name, position=excluded.position, provider_value=excluded.provider_value,
raw_value=excluded.raw_value, source_version=excluded.source_version,
provenance_json=excluded.provenance_json, ingested_at=excluded.ingested_at`).bind(
      PROVIDER, FORMAT_KEY, SCALE_KEY, result.asset.asset_id, result.asset.asset_name,
      result.asset.position, observation.observedAt, observation.providerValue, observation.rawValue,
      timestamp, provenance, timestamp,
    )))
    const first = observations[0].observedAt
    const last = observations[observations.length - 1].observedAt
    await db.prepare(`UPDATE historical_tape_assets SET status='complete', attempt_count=?,
last_attempt_at=?, error_message=NULL, observation_count=?, first_observed_at=?, last_observed_at=?,
span_days=?, median_gap_days=7, scale_status='source-relative', source_version=?, metadata_json=?
WHERE user_id=? AND league_id=? AND provider=? AND asset_id=?`).bind(
      attemptCount, timestamp, observations.length, first, last, spanDays(first, last), timestamp,
      JSON.stringify({ fantasyCalcId: result.asset.slug, sampling: 'weekly', forceRefresh: false }),
      userId, leagueId, PROVIDER, result.asset.asset_id,
    ).run()
  }

  const remaining = await db.prepare(`SELECT
SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
SUM(CASE WHEN status='missing' THEN 1 ELSE 0 END) AS missing
FROM historical_tape_assets WHERE user_id=? AND league_id=? AND provider=?`).bind(
    userId, leagueId, PROVIDER,
  ).first<{ pending: number; failed: number; missing: number }>()
  if (!Number(remaining?.pending ?? 0)) {
    const status = Number(remaining?.failed ?? 0) || Number(remaining?.missing ?? 0) ? 'partial' : 'complete'
    await db.prepare(`UPDATE historical_tape_configs SET status=?, updated_at=?, completed_at=?
WHERE user_id=? AND league_id=? AND provider=?`).bind(status, timestamp, timestamp, userId, leagueId, PROVIDER).run()
  }
  return readTeamHistoryBackfill(db, userId, leagueId)
}

export async function readReconstructedTeamMarketHistory(
  db: D1Database,
  userId: string,
  leagueId: string,
): Promise<ReconstructedTeamMarketHistoryPoint[]> {
  await Promise.all([
    ensureHistoricalTapeSchema(db), ensureResearchSchema(db), ensureEdgeLearningSchema(db), ensureJournalSchema(db),
  ])
  const [weeks, current, observations] = await Promise.all([
    db.prepare(`SELECT season, week, roster_id, owner_user_id, players_json
FROM league_week_states WHERE root_league_id=? ORDER BY season, week, roster_id`).bind(leagueId).all<WeekStateRow>(),
    db.prepare(`SELECT m.snapshot_date, m.owner_roster_id, sr.owner_user_id,
m.asset_id, m.asset_name, m.position, m.current_value
FROM market_value_snapshots m
LEFT JOIN season_rosters sr ON sr.league_id=? AND sr.roster_id=m.owner_roster_id
WHERE m.user_id=? AND m.league_id=? AND m.kind='player' AND m.snapshot_date=(
  SELECT MAX(snapshot_date) FROM market_value_snapshots WHERE user_id=? AND league_id=?
) ORDER BY m.owner_roster_id, m.asset_id`).bind(
      leagueId, userId, leagueId, userId, leagueId,
    ).all<CurrentRosterAssetRow>(),
    db.prepare(`SELECT h.asset_id, h.observed_at, h.provider_value
FROM historical_market_observations h JOIN historical_tape_assets a
  ON a.provider=h.provider AND a.asset_id=h.asset_id
WHERE a.user_id=? AND a.league_id=? AND a.provider=? AND a.status='complete'
  AND h.format_key=? AND h.scale_key=?
ORDER BY h.asset_id, h.observed_at LIMIT 100000`).bind(
      userId, leagueId, PROVIDER, FORMAT_KEY, SCALE_KEY,
    ).all<HistoricalObservationRow>(),
  ])
  const states: TeamRosterStateInput[] = weeks.results.map((row) => ({
    season: row.season,
    week: row.week,
    rosterId: row.roster_id,
    ownerUserId: row.owner_user_id,
    players: parseJson<string[]>(row.players_json, []),
  }))
  const currentByRoster = new Map<number, CurrentRosterAssetRow[]>()
  current.results.forEach((row) => {
    const rows = currentByRoster.get(row.owner_roster_id) ?? []
    rows.push(row)
    currentByRoster.set(row.owner_roster_id, rows)
  })
  currentByRoster.forEach((rows, rosterId) => {
    const first = rows[0]
    states.push({
      season: first.snapshot_date.slice(0, 4),
      week: null,
      rosterId,
      ownerUserId: first.owner_user_id,
      players: rows.map((row) => row.asset_id),
      observedAt: first.snapshot_date,
      label: `${first.snapshot_date.slice(0, 4)} current`,
    })
  })
  const values: HistoricalPlayerValueInput[] = observations.results.map((row) => ({
    assetId: row.asset_id,
    observedAt: row.observed_at,
    value: Number(row.provider_value),
  }))
  return reconstructTeamPlayerHistory(states, values)
}
