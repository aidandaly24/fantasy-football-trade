import {
  collectLeagueJournal,
  type JournalCollection,
  type JournalLeague,
  type JournalTransaction,
  type SleeperJournalClient,
} from './journal-store'
import type { D1Database, D1PreparedStatement } from './user-store'

const SLEEPER_BASE = 'https://api.sleeper.app/v1'
const TRADYR_BASE = 'https://api.tradyr.app/v1'
const CHECKPOINTS = [7, 30, 90, 180] as const

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS league_roots (root_league_id TEXT PRIMARY KEY, name TEXT NOT NULL, sync_status TEXT NOT NULL DEFAULT 'pending', last_sync_at TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS league_seasons (league_id TEXT PRIMARY KEY, root_league_id TEXT NOT NULL, season TEXT NOT NULL, name TEXT NOT NULL, previous_league_id TEXT, total_rosters INTEGER NOT NULL, discovered_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_league_seasons_root ON league_seasons (root_league_id, season)`,
  `CREATE TABLE IF NOT EXISTS season_rosters (league_id TEXT NOT NULL, roster_id INTEGER NOT NULL, owner_user_id TEXT, team_name TEXT NOT NULL, avatar TEXT, roster_json TEXT NOT NULL, PRIMARY KEY (league_id, roster_id))`,
  `CREATE TABLE IF NOT EXISTS trades (league_id TEXT NOT NULL, transaction_id TEXT NOT NULL, root_league_id TEXT NOT NULL, season TEXT NOT NULL, week INTEGER NOT NULL, created_at_ms INTEGER NOT NULL, status_updated_at_ms INTEGER NOT NULL, creator_user_id TEXT, roster_ids_json TEXT NOT NULL, raw_json TEXT NOT NULL, ingested_at TEXT NOT NULL, PRIMARY KEY (league_id, transaction_id))`,
  `CREATE INDEX IF NOT EXISTS idx_trades_root_created ON trades (root_league_id, created_at_ms DESC)`,
  `CREATE TABLE IF NOT EXISTS sync_runs (id TEXT PRIMARY KEY, root_league_id TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, seasons_found INTEGER NOT NULL DEFAULT 0, targets_attempted INTEGER NOT NULL DEFAULT 0, targets_succeeded INTEGER NOT NULL DEFAULT 0, trade_count INTEGER NOT NULL DEFAULT 0, new_trade_count INTEGER NOT NULL DEFAULT 0, errors_json TEXT NOT NULL DEFAULT '[]')`,
  `CREATE INDEX IF NOT EXISTS idx_sync_runs_root_started ON sync_runs (root_league_id, started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS trade_snapshots (league_id TEXT NOT NULL, transaction_id TEXT NOT NULL, snapshot_kind TEXT NOT NULL, captured_at TEXT NOT NULL, source TEXT NOT NULL, source_version TEXT NOT NULL, values_json TEXT NOT NULL, is_retrospective INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (league_id, transaction_id, snapshot_kind))`,
  `CREATE TABLE IF NOT EXISTS trade_outcomes (league_id TEXT NOT NULL, transaction_id TEXT NOT NULL, checkpoint_days INTEGER NOT NULL, due_at TEXT NOT NULL, evaluated_at TEXT, status TEXT NOT NULL, grade TEXT, method_version TEXT NOT NULL, result_json TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (league_id, transaction_id, checkpoint_days))`,
  `CREATE INDEX IF NOT EXISTS idx_trade_outcomes_due ON trade_outcomes (status, due_at)`,
] as const

let schemaReady: Promise<void> | null = null

export async function ensureJournalSchema(db: D1Database): Promise<void> {
  if (!schemaReady) {
    schemaReady = db.batch(SCHEMA.map((sql) => db.prepare(sql))).then(() => undefined).catch((error) => {
      schemaReady = null
      throw error
    })
  }
  return schemaReady
}

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { 'User-Agent': 'RosterLab/4.2 private journal' } })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json<T>()
}

export function sleeperJournalClient(): SleeperJournalClient {
  return {
    getLeague: (leagueId) => requestJson(`${SLEEPER_BASE}/league/${leagueId}`),
    getUsers: (leagueId) => requestJson(`${SLEEPER_BASE}/league/${leagueId}/users`),
    getRosters: (leagueId) => requestJson(`${SLEEPER_BASE}/league/${leagueId}/rosters`),
    getTransactions: (leagueId, week) => requestJson(`${SLEEPER_BASE}/league/${leagueId}/transactions/${week}`),
  }
}

type TradyrPlayer = { sleeperId: string | null; name: string; composite: number }
type TradyrPick = { year: string; round: number; name: string; composite: number }
type TradyrResponse<T> = { data: T; meta?: { generatedAt?: string } }

export type SnapshotAsset = {
  key: string
  name: string
  kind: 'player' | 'pick'
  value: number | null
  fromRosterId: number | null
  toRosterId: number | null
}

export type SnapshotParty = {
  rosterId: number
  received: number
  sent: number
  net: number
}

export type TradeValueSnapshot = {
  assets: SnapshotAsset[]
  parties: SnapshotParty[]
  unresolved: string[]
}

export type ValueCatalog = {
  players: Map<string, TradyrPlayer>
  picks: TradyrPick[]
  sourceVersion: string
}

async function fetchValueCatalog(league: JournalLeague): Promise<ValueCatalog> {
  const positions = (league as JournalLeague & { roster_positions?: string[] }).roster_positions ?? []
  const scoring = (league as JournalLeague & { scoring_settings?: Record<string, number> }).scoring_settings ?? {}
  const totalRosters = (league as JournalLeague & { total_rosters?: number }).total_rosters ?? 12
  const numQbs = positions.includes('SUPER_FLEX') || positions.filter((slot) => slot === 'QB').length > 1 ? 2 : 1
  const tep = Number(scoring.bonus_rec_te ?? 0) > 0
  const playerParams = new URLSearchParams({ format: 'dynasty', numQbs: String(numQbs), tep: String(tep), limit: '1000' })
  const pickParams = new URLSearchParams({ numQbs: String(numQbs), numTeams: String(totalRosters) })
  const [playerResponse, pickResponse] = await Promise.all([
    requestJson<TradyrResponse<TradyrPlayer[]>>(`${TRADYR_BASE}/players?${playerParams}`),
    requestJson<TradyrResponse<TradyrPick[]>>(`${TRADYR_BASE}/picks?${pickParams}`),
  ])
  return {
    players: new Map(playerResponse.data.filter((player) => player.sleeperId).map((player) => [String(player.sleeperId), player])),
    picks: pickResponse.data,
    sourceVersion: playerResponse.meta?.generatedAt ?? new Date().toISOString(),
  }
}

function pickValue(catalog: ValueCatalog, season: string, round: number): { value: number | null; name: string } {
  const exact = catalog.picks.filter((pick) => pick.year === season && pick.round === round)
  const comparable = exact.length ? exact : catalog.picks.filter((pick) => pick.round === round)
  if (!comparable.length) return { value: null, name: `${season} round ${round}` }
  return {
    value: Math.round(comparable.reduce((sum, pick) => sum + pick.composite, 0) / comparable.length),
    name: `${season} round ${round} pick`,
  }
}

export function valueTrade(transaction: JournalTransaction, catalog: ValueCatalog): TradeValueSnapshot {
  const playerIds = [...new Set([...Object.keys(transaction.adds ?? {}), ...Object.keys(transaction.drops ?? {})])]
  const assets: SnapshotAsset[] = playerIds.map((playerId) => {
    const player = catalog.players.get(playerId)
    return {
      key: `player:${playerId}`,
      name: player?.name ?? `Player ${playerId}`,
      kind: 'player',
      value: player ? Math.round(player.composite) : null,
      fromRosterId: transaction.drops?.[playerId] ?? null,
      toRosterId: transaction.adds?.[playerId] ?? null,
    }
  })
  transaction.draft_picks.forEach((pick) => {
    const resolved = pickValue(catalog, pick.season, pick.round)
    assets.push({
      key: `pick:${pick.season}:${pick.round}:${pick.roster_id}`,
      name: resolved.name,
      kind: 'pick',
      value: resolved.value,
      fromRosterId: pick.previous_owner_id,
      toRosterId: pick.owner_id,
    })
  })
  assets.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }))
  const rosterIds = [...new Set(transaction.roster_ids)].sort((a, b) => a - b)
  const parties = rosterIds.map((rosterId) => {
    const received = assets.filter((asset) => asset.toRosterId === rosterId).reduce((sum, asset) => sum + (asset.value ?? 0), 0)
    const sent = assets.filter((asset) => asset.fromRosterId === rosterId).reduce((sum, asset) => sum + (asset.value ?? 0), 0)
    return { rosterId, received, sent, net: received - sent }
  })
  return { assets, parties, unresolved: assets.filter((asset) => asset.value === null).map((asset) => asset.key) }
}

async function batchInChunks(db: D1Database, statements: D1PreparedStatement[], size = 75): Promise<void> {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size))
  }
}

type CountRow = { count: number }

async function persistCollection(db: D1Database, collection: JournalCollection, startedAt: string, runId: string): Promise<number> {
  const before = await db.prepare('SELECT COUNT(*) AS count FROM trades WHERE root_league_id = ?').bind(collection.rootLeagueId).first<CountRow>()
  const now = new Date().toISOString()
  const current = collection.seasons[0]
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO league_roots (root_league_id, name, sync_status, last_sync_at, created_at) VALUES (?, ?, ?, ?, ?)
ON CONFLICT(root_league_id) DO UPDATE SET name=excluded.name, sync_status=excluded.sync_status, last_sync_at=excluded.last_sync_at`).bind(
      collection.rootLeagueId, current?.name ?? collection.rootLeagueId, collection.complete ? 'complete' : 'partial', now, startedAt,
    ),
  ]
  collection.seasons.forEach((season) => statements.push(db.prepare(`INSERT INTO league_seasons (league_id, root_league_id, season, name, previous_league_id, total_rosters, discovered_at)
VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(league_id) DO UPDATE SET root_league_id=excluded.root_league_id, season=excluded.season, name=excluded.name, previous_league_id=excluded.previous_league_id, total_rosters=excluded.total_rosters`).bind(
    season.league_id, collection.rootLeagueId, season.season, season.name ?? season.league_id, season.previous_league_id ?? null,
    (season as JournalLeague & { total_rosters?: number }).total_rosters ?? 0, now,
  )))
  collection.identities.forEach((identity) => statements.push(db.prepare(`INSERT INTO season_rosters (league_id, roster_id, owner_user_id, team_name, avatar, roster_json)
VALUES (?, ?, ?, ?, NULL, '{}') ON CONFLICT(league_id, roster_id) DO UPDATE SET owner_user_id=excluded.owner_user_id, team_name=excluded.team_name`).bind(
    identity.leagueId, identity.rosterId, identity.ownerUserId, identity.teamName ?? identity.ownerDisplayName ?? `Roster ${identity.rosterId}`,
  )))
  collection.trades.forEach((trade) => statements.push(db.prepare(`INSERT INTO trades (league_id, transaction_id, root_league_id, season, week, created_at_ms, status_updated_at_ms, creator_user_id, roster_ids_json, raw_json, ingested_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(league_id, transaction_id) DO UPDATE SET status_updated_at_ms=excluded.status_updated_at_ms, roster_ids_json=excluded.roster_ids_json, raw_json=excluded.raw_json`).bind(
    trade.leagueId, trade.transactionId, collection.rootLeagueId, trade.season, trade.week, trade.createdAtMs, trade.statusUpdatedAtMs,
    (trade.raw as JournalTransaction & { creator?: string | null }).creator ?? null, JSON.stringify(trade.rosterIds), JSON.stringify(trade.raw), now,
  )))
  await batchInChunks(db, statements)
  const after = await db.prepare('SELECT COUNT(*) AS count FROM trades WHERE root_league_id = ?').bind(collection.rootLeagueId).first<CountRow>()
  const newCount = Math.max(0, Number(after?.count ?? 0) - Number(before?.count ?? 0))
  const errors = collection.coverage.filter((target) => target.status === 'failed')
  await db.prepare(`UPDATE sync_runs SET finished_at=?, status=?, seasons_found=?, targets_attempted=?, targets_succeeded=?, trade_count=?, new_trade_count=?, errors_json=? WHERE id=?`).bind(
    now, collection.complete ? 'complete' : 'partial', collection.seasons.length, collection.coverage.length,
    collection.coverage.length - errors.length, collection.trades.length, newCount, JSON.stringify(errors), runId,
  ).run()
  return newCount
}

async function snapshotAndGrade(db: D1Database, collection: JournalCollection): Promise<void> {
  const current = collection.seasons[0]
  if (!current) return
  let catalog: ValueCatalog
  try {
    catalog = await fetchValueCatalog(current)
  } catch {
    return
  }
  const now = new Date()
  const existing = await db.prepare(`SELECT ts.league_id, ts.transaction_id, ts.snapshot_kind
FROM trade_snapshots ts JOIN trades t ON t.league_id=ts.league_id AND t.transaction_id=ts.transaction_id
WHERE t.root_league_id=? AND ts.snapshot_kind IN ('ingestion', 'backfill-current')`).bind(collection.rootLeagueId).all<{ league_id: string; transaction_id: string; snapshot_kind: string }>()
  const initialKinds = new Map(existing.results.map((row) => [`${row.league_id}:${row.transaction_id}`, row.snapshot_kind]))
  const initialStatements: D1PreparedStatement[] = []
  const due: Array<{ trade: JournalCollection['trades'][number]; days: number; dueAt: Date; values: TradeValueSnapshot }> = []
  for (const trade of collection.trades) {
    const values = valueTrade(trade.raw, catalog)
    const ageDays = (now.getTime() - trade.createdAtMs) / 86_400_000
    const initialKind = initialKinds.get(`${trade.leagueId}:${trade.transactionId}`) ?? (ageDays <= 7 ? 'ingestion' : 'backfill-current')
    initialStatements.push(db.prepare(`INSERT INTO trade_snapshots (league_id, transaction_id, snapshot_kind, captured_at, source, source_version, values_json, is_retrospective)
VALUES (?, ?, ?, ?, 'Tradyr composite', ?, ?, ?) ON CONFLICT(league_id, transaction_id, snapshot_kind) DO NOTHING`).bind(
      trade.leagueId, trade.transactionId, initialKind, now.toISOString(), catalog.sourceVersion, JSON.stringify(values), initialKind === 'backfill-current' ? 1 : 0,
    ))
    for (const days of CHECKPOINTS) {
      const dueAt = new Date(trade.createdAtMs + days * 86_400_000)
      const status = initialKind === 'backfill-current' ? 'insufficient_data' : dueAt <= now ? 'due' : 'pending'
      initialStatements.push(db.prepare(`INSERT INTO trade_outcomes (league_id, transaction_id, checkpoint_days, due_at, status, method_version, result_json)
VALUES (?, ?, ?, ?, ?, 'market-net-change-v2', '{}') ON CONFLICT(league_id, transaction_id, checkpoint_days) DO NOTHING`).bind(
        trade.leagueId, trade.transactionId, days, dueAt.toISOString(), status,
      ))
      if (status === 'due') due.push({ trade, days, dueAt, values })
    }
  }
  await batchInChunks(db, initialStatements)
  for (const checkpoint of due) {
      const { trade, days, dueAt, values } = checkpoint
      const initial = await db.prepare(`SELECT values_json FROM trade_snapshots WHERE league_id=? AND transaction_id=? AND snapshot_kind='ingestion'`).bind(trade.leagueId, trade.transactionId).first<{ values_json: string }>()
      if (!initial || values.unresolved.length) {
        await db.prepare(`UPDATE trade_outcomes SET evaluated_at=?, status='insufficient_data', result_json=? WHERE league_id=? AND transaction_id=? AND checkpoint_days=? AND status!='complete'`).bind(
          now.toISOString(), JSON.stringify({ unresolved: values.unresolved, missingBaseline: !initial }), trade.leagueId, trade.transactionId, days,
        ).run()
        continue
      }
      const baseline = JSON.parse(initial.values_json) as TradeValueSnapshot
      const changes = values.parties.map((party) => ({
        rosterId: party.rosterId,
        initialNet: baseline.parties.find((item) => item.rosterId === party.rosterId)?.net ?? 0,
        currentNet: party.net,
        change: party.net - (baseline.parties.find((item) => item.rosterId === party.rosterId)?.net ?? 0),
      }))
      const winner = [...changes].sort((a, b) => b.change - a.change || b.currentNet - a.currentNet || a.rosterId - b.rosterId)[0]
      const grade = winner ? `Roster ${winner.rosterId} ${winner.change >= 0 ? '+' : ''}${winner.change} since trade` : null
      await db.prepare(`INSERT INTO trade_snapshots (league_id, transaction_id, snapshot_kind, captured_at, source, source_version, values_json, is_retrospective)
VALUES (?, ?, ?, ?, 'Tradyr composite', ?, ?, 0) ON CONFLICT(league_id, transaction_id, snapshot_kind) DO NOTHING`).bind(
        trade.leagueId, trade.transactionId, `${days}d`, now.toISOString(), catalog.sourceVersion, JSON.stringify(values),
      ).run()
      await db.prepare(`UPDATE trade_outcomes SET evaluated_at=?, status='complete', grade=?, result_json=? WHERE league_id=? AND transaction_id=? AND checkpoint_days=? AND status!='complete'`).bind(
        now.toISOString(), grade, JSON.stringify({ changes, capturedLateByDays: Math.max(0, Math.floor((now.getTime() - dueAt.getTime()) / 86_400_000)) }), trade.leagueId, trade.transactionId, days,
      ).run()
  }
}

export async function syncLeagueJournal(db: D1Database, rootLeagueId: string): Promise<JournalCollection & { newTradeCount: number }> {
  await ensureJournalSchema(db)
  const startedAt = new Date().toISOString()
  const runId = `${rootLeagueId}:${startedAt}`
  await db.prepare(`INSERT INTO sync_runs (id, root_league_id, started_at, status) VALUES (?, ?, ?, 'running')`).bind(runId, rootLeagueId, startedAt).run()
  try {
    const collection = await collectLeagueJournal(rootLeagueId, sleeperJournalClient())
    const newTradeCount = await persistCollection(db, collection, startedAt, runId)
    await snapshotAndGrade(db, collection)
    return { ...collection, newTradeCount }
  } catch (error) {
    await db.prepare(`UPDATE sync_runs SET finished_at=?, status='failed', errors_json=? WHERE id=?`).bind(
      new Date().toISOString(), JSON.stringify([{ error: error instanceof Error ? error.message : String(error) }]), runId,
    ).run()
    throw error
  }
}

type TradeRow = {
  league_id: string
  transaction_id: string
  season: string
  week: number
  created_at_ms: number
  raw_json: string
  ingested_at: string
}
type IdentityRow = { league_id: string; roster_id: number; owner_user_id: string | null; team_name: string }
type SnapshotRow = { league_id: string; transaction_id: string; snapshot_kind: string; captured_at: string; values_json: string; is_retrospective: number }
type OutcomeRow = { league_id: string; transaction_id: string; checkpoint_days: number; due_at: string; evaluated_at: string | null; status: string; grade: string | null; result_json: string }
type SyncRow = { started_at: string; finished_at: string | null; status: string; seasons_found: number; targets_attempted: number; targets_succeeded: number; trade_count: number; new_trade_count: number; errors_json: string }

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T } catch { return fallback }
}

export async function readLeagueJournal(db: D1Database, rootLeagueId: string) {
  await ensureJournalSchema(db)
  const [tradeRows, identities, snapshots, outcomes, sync] = await Promise.all([
    db.prepare(`SELECT league_id, transaction_id, season, week, created_at_ms, raw_json, ingested_at FROM trades WHERE root_league_id=? ORDER BY created_at_ms DESC`).bind(rootLeagueId).all<TradeRow>(),
    db.prepare(`SELECT sr.league_id, sr.roster_id, sr.owner_user_id, sr.team_name FROM season_rosters sr JOIN league_seasons ls ON ls.league_id=sr.league_id WHERE ls.root_league_id=?`).bind(rootLeagueId).all<IdentityRow>(),
    db.prepare(`SELECT ts.league_id, ts.transaction_id, ts.snapshot_kind, ts.captured_at, ts.values_json, ts.is_retrospective FROM trade_snapshots ts JOIN trades t ON t.league_id=ts.league_id AND t.transaction_id=ts.transaction_id WHERE t.root_league_id=?`).bind(rootLeagueId).all<SnapshotRow>(),
    db.prepare(`SELECT o.league_id, o.transaction_id, o.checkpoint_days, o.due_at, o.evaluated_at, o.status, o.grade, o.result_json FROM trade_outcomes o JOIN trades t ON t.league_id=o.league_id AND t.transaction_id=o.transaction_id WHERE t.root_league_id=?`).bind(rootLeagueId).all<OutcomeRow>(),
    db.prepare(`SELECT started_at, finished_at, status, seasons_found, targets_attempted, targets_succeeded, trade_count, new_trade_count, errors_json FROM sync_runs WHERE root_league_id=? ORDER BY started_at DESC LIMIT 1`).bind(rootLeagueId).first<SyncRow>(),
  ])
  return {
    trades: tradeRows.results.map((row) => ({ leagueId: row.league_id, transactionId: row.transaction_id, season: row.season, week: row.week, createdAtMs: row.created_at_ms, raw: parseJson<JournalTransaction>(row.raw_json, {} as JournalTransaction), ingestedAt: row.ingested_at })),
    identities: identities.results.map((row) => ({ leagueId: row.league_id, rosterId: row.roster_id, ownerUserId: row.owner_user_id, teamName: row.team_name })),
    snapshots: snapshots.results.map((row) => ({ leagueId: row.league_id, transactionId: row.transaction_id, kind: row.snapshot_kind, capturedAt: row.captured_at, values: parseJson<TradeValueSnapshot>(row.values_json, { assets: [], parties: [], unresolved: [] }), retrospective: Boolean(row.is_retrospective) })),
    outcomes: outcomes.results.map((row) => ({ leagueId: row.league_id, transactionId: row.transaction_id, checkpointDays: row.checkpoint_days, dueAt: row.due_at, evaluatedAt: row.evaluated_at, status: row.status, grade: row.grade, result: parseJson(row.result_json, {}) })),
    sync: sync ? { startedAt: sync.started_at, finishedAt: sync.finished_at, status: sync.status, seasonsFound: sync.seasons_found, targetsAttempted: sync.targets_attempted, targetsSucceeded: sync.targets_succeeded, tradeCount: sync.trade_count, newTradeCount: sync.new_trade_count, errors: parseJson(sync.errors_json, []) } : null,
  }
}
