import type { TradeTapeRefreshState } from '../src/trade-models'
import type { D1Database, D1PreparedStatement } from './user-store'

const FANTASYCALC_BASE = 'https://api.fantasycalc.com'
const ANCHOR_COUNT = 40
const ANCHOR_BATCH_SIZE = 4

const CREATE_TAPE = `CREATE TABLE IF NOT EXISTS fantasycalc_trade_tape (
  trade_id TEXT PRIMARY KEY, trade_at TEXT NOT NULL, source_league_id TEXT NOT NULL,
  num_qbs INTEGER NOT NULL, num_teams INTEGER NOT NULL, ppr REAL NOT NULL,
  te_premium REAL NOT NULL, side1_count INTEGER NOT NULL, side2_count INTEGER NOT NULL,
  raw_json TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
)`
const CREATE_TAPE_DATE_INDEX = `CREATE INDEX IF NOT EXISTS idx_fantasycalc_trade_tape_date
ON fantasycalc_trade_tape (trade_at)`
const CREATE_TAPE_LEAGUE_INDEX = `CREATE INDEX IF NOT EXISTS idx_fantasycalc_trade_tape_league
ON fantasycalc_trade_tape (source_league_id)`
const CREATE_RUNS = `CREATE TABLE IF NOT EXISTS fantasycalc_trade_tape_runs (
  id TEXT PRIMARY KEY, initiated_by_user_id TEXT NOT NULL, started_at TEXT NOT NULL,
  finished_at TEXT, status TEXT NOT NULL, anchors_attempted INTEGER NOT NULL DEFAULT 0,
  anchors_succeeded INTEGER NOT NULL DEFAULT 0, trades_discovered INTEGER NOT NULL DEFAULT 0,
  new_trade_count INTEGER NOT NULL DEFAULT 0, errors_json TEXT NOT NULL DEFAULT '[]'
)`
const CREATE_RUNS_INDEX = `CREATE INDEX IF NOT EXISTS idx_fantasycalc_trade_tape_runs_started
ON fantasycalc_trade_tape_runs (started_at)`

type FantasyCalcAsset = {
  id: number
  name: string
  position: string
  maybeAge: number | null
  maybeBirthday: string | null
}

type FantasyCalcCatalogRow = {
  value?: unknown
  player?: Partial<FantasyCalcAsset>
}

export type StoredFantasyCalcTrade = {
  id: string
  date: string
  leagueId: string
  numQbs: number
  numTeams: number
  ppr: number
  tePremium: number
  numStarters: number
  rosterSize: number
  side1: FantasyCalcAsset[]
  side2: FantasyCalcAsset[]
}

type RunRow = {
  started_at: string
  finished_at: string | null
  status: TradeTapeRefreshState['status']
  anchors_attempted: number
  anchors_succeeded: number
  trades_discovered: number
  new_trade_count: number
  errors_json: string
}

type AggregateRow = {
  total_trades: number
  unique_leagues: number
  first_trade_at: string | null
  latest_trade_at: string | null
}

let schemaDatabase: D1Database | null = null
let schemaReady: Promise<void> | null = null

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function cleanAsset(value: unknown): FantasyCalcAsset | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const id = Math.round(finiteNumber(source.id, -1))
  const name = typeof source.name === 'string' ? source.name.trim() : ''
  const position = typeof source.position === 'string' ? source.position.trim().toUpperCase() : ''
  if (id < 0 || !name || !position) return null
  const age = source.maybeAge == null || source.maybeAge === '' ? Number.NaN : Number(source.maybeAge)
  return {
    id,
    name: name.slice(0, 120),
    position: position.slice(0, 12),
    maybeAge: Number.isFinite(age) && age >= 0 && age <= 100 ? age : null,
    maybeBirthday: typeof source.maybeBirthday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.maybeBirthday)
      ? source.maybeBirthday
      : null,
  }
}

function cleanSide(value: unknown): FantasyCalcAsset[] {
  return Array.isArray(value) ? value.flatMap((asset) => {
    const cleaned = cleanAsset(asset)
    return cleaned ? [cleaned] : []
  }).slice(0, 12) : []
}

export function normalizeFantasyCalcTrades(value: unknown): StoredFantasyCalcTrade[] {
  if (!Array.isArray(value)) return []
  const deduped = new Map<string, StoredFantasyCalcTrade>()
  value.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return
    const source = entry as Record<string, unknown>
    const id = typeof source.id === 'string' ? source.id.trim() : ''
    const parsedDate = typeof source.date === 'string' ? Date.parse(source.date) : Number.NaN
    const side1 = cleanSide(source.side1)
    const side2 = cleanSide(source.side2)
    if (!id || id.length > 100 || !Number.isFinite(parsedDate) || !side1.length || !side2.length) return
    deduped.set(id, {
      id,
      date: new Date(parsedDate).toISOString(),
      leagueId: typeof source.leagueId === 'string' ? source.leagueId.slice(0, 100) : '',
      numQbs: Math.round(finiteNumber(source.numQbs)),
      numTeams: Math.round(finiteNumber(source.numTeams)),
      ppr: finiteNumber(source.ppr),
      tePremium: finiteNumber(source.tePremium),
      numStarters: Math.round(finiteNumber(source.numStarters)),
      rosterSize: Math.round(finiteNumber(source.rosterSize)),
      side1,
      side2,
    })
  })
  return [...deduped.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

export function selectFantasyCalcAnchors(value: unknown, count = ANCHOR_COUNT): number[] {
  if (!Array.isArray(value) || count <= 0) return []
  const positions = ['QB', 'RB', 'WR', 'TE']
  const rows = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const source = entry as FantasyCalcCatalogRow
    const id = Math.round(finiteNumber(source.player?.id, -1))
    const position = String(source.player?.position ?? '').toUpperCase()
    const marketValue = finiteNumber(source.value)
    return id >= 0 && positions.includes(position) && marketValue > 0 ? [{ id, position, marketValue }] : []
  })
  const result: number[] = []
  const base = Math.floor(Math.min(count, rows.length) / positions.length)
  const remainder = Math.min(count, rows.length) % positions.length
  positions.forEach((position, positionIndex) => {
    const candidates = rows.filter((row) => row.position === position)
      .sort((a, b) => b.marketValue - a.marketValue || a.id - b.id)
    const quota = Math.min(candidates.length, base + (positionIndex < remainder ? 1 : 0))
    for (let index = 0; index < quota; index += 1) {
      const candidateIndex = Math.min(candidates.length - 1, Math.floor((index + 0.5) * candidates.length / quota))
      result.push(candidates[candidateIndex].id)
    }
  })
  return [...new Set(result)].sort((a, b) => a - b)
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T } catch { return fallback }
}

async function batchInChunks(db: D1Database, statements: D1PreparedStatement[], size = 50): Promise<void> {
  for (let index = 0; index < statements.length; index += size) await db.batch(statements.slice(index, index + size))
}

export async function ensureTradeTapeSchema(db: D1Database): Promise<void> {
  if (!schemaReady || schemaDatabase !== db) {
    schemaDatabase = db
    schemaReady = db.batch([
      db.prepare(CREATE_TAPE),
      db.prepare(CREATE_TAPE_DATE_INDEX),
      db.prepare(CREATE_TAPE_LEAGUE_INDEX),
      db.prepare(CREATE_RUNS),
      db.prepare(CREATE_RUNS_INDEX),
      db.prepare('PRAGMA optimize'),
    ]).then(() => undefined).catch((error) => {
      schemaDatabase = null
      schemaReady = null
      throw error
    })
  }
  return schemaReady
}

async function fetchFantasyCalcJson(fetcher: typeof fetch, path: string, params: Record<string, string>, attempt = 0): Promise<unknown> {
  const query = new URLSearchParams(params)
  const response = await fetcher(`${FANTASYCALC_BASE}${path}?${query}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'RosterLab/1.0 private model research' },
  })
  if (response.ok) return response.json()
  if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
    const retryAfter = Math.min(2_000, Math.max(250, Number(response.headers.get('Retry-After') ?? 0) * 1_000))
    await new Promise((resolve) => setTimeout(resolve, retryAfter))
    return fetchFantasyCalcJson(fetcher, path, params, 1)
  }
  throw new Error(`FantasyCalc ${path} failed (${response.status})`)
}

async function existingTradeIds(db: D1Database, ids: string[]): Promise<Set<string>> {
  const result = new Set<string>()
  for (let index = 0; index < ids.length; index += 75) {
    const chunk = ids.slice(index, index + 75)
    const placeholders = chunk.map(() => '?').join(',')
    const rows = await db.prepare(`SELECT trade_id FROM fantasycalc_trade_tape WHERE trade_id IN (${placeholders})`)
      .bind(...chunk).all<{ trade_id: string }>()
    rows.results.forEach((row) => result.add(row.trade_id))
  }
  return result
}

export async function readTradeTapeState(db: D1Database): Promise<TradeTapeRefreshState> {
  await ensureTradeTapeSchema(db)
  const [aggregate, latestRun, latestSuccess] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total_trades, COUNT(DISTINCT source_league_id) AS unique_leagues,
MIN(trade_at) AS first_trade_at, MAX(trade_at) AS latest_trade_at FROM fantasycalc_trade_tape`).first<AggregateRow>(),
    db.prepare(`SELECT started_at, finished_at, status, anchors_attempted, anchors_succeeded,
trades_discovered, new_trade_count, errors_json FROM fantasycalc_trade_tape_runs
ORDER BY started_at DESC LIMIT 1`).first<RunRow>(),
    db.prepare(`SELECT finished_at FROM fantasycalc_trade_tape_runs
WHERE status IN ('ready', 'partial') ORDER BY finished_at DESC LIMIT 1`).first<{ finished_at: string | null }>(),
  ])
  return {
    source: 'FantasyCalc completed trades',
    status: latestRun?.status ?? 'never-refreshed',
    lastAttemptAt: latestRun?.started_at ?? null,
    lastSuccessAt: latestSuccess?.finished_at ?? null,
    totalTrades: Number(aggregate?.total_trades ?? 0),
    uniqueLeagues: Number(aggregate?.unique_leagues ?? 0),
    firstTradeAt: aggregate?.first_trade_at ?? null,
    latestTradeAt: aggregate?.latest_trade_at ?? null,
    latestRun: latestRun ? {
      anchorsAttempted: Number(latestRun.anchors_attempted),
      anchorsSucceeded: Number(latestRun.anchors_succeeded),
      tradesDiscovered: Number(latestRun.trades_discovered),
      newTrades: Number(latestRun.new_trade_count),
      errors: parseJson<string[]>(latestRun.errors_json, []),
    } : null,
  }
}

export async function refreshTradeTape(
  db: D1Database,
  initiatedByUserId: string,
  options: { fetcher?: typeof fetch; now?: Date } = {},
): Promise<TradeTapeRefreshState> {
  await ensureTradeTapeSchema(db)
  const fetcher = options.fetcher ?? fetch
  const now = options.now ?? new Date()
  const startedAt = now.toISOString()
  const active = await db.prepare(`SELECT started_at FROM fantasycalc_trade_tape_runs
WHERE status='refreshing' ORDER BY started_at DESC LIMIT 1`).first<{ started_at: string }>()
  if (active && now.getTime() - Date.parse(active.started_at) < 2 * 60_000) {
    throw new Error('A tape refresh is already running')
  }
  const runId = crypto.randomUUID()
  await db.prepare(`INSERT INTO fantasycalc_trade_tape_runs (
id, initiated_by_user_id, started_at, status
) VALUES (?, ?, ?, 'refreshing')`).bind(runId, initiatedByUserId, startedAt).run()

  let attempted = 0
  let succeeded = 0
  const errors: string[] = []
  try {
    const catalog = await fetchFantasyCalcJson(fetcher, '/values/current', {
      isDynasty: 'true', numQbs: '2', numTeams: '12', ppr: '1', tep: 'te+',
      includeAdp: 'false', includeRosterPercent: 'false',
    })
    const anchors = selectFantasyCalcAnchors(catalog)
    if (!anchors.length) throw new Error('FantasyCalc returned no usable anchor players')
    attempted = anchors.length
    const discovered: StoredFantasyCalcTrade[] = []
    for (let index = 0; index < anchors.length; index += ANCHOR_BATCH_SIZE) {
      const batch = anchors.slice(index, index + ANCHOR_BATCH_SIZE)
      const results = await Promise.all(batch.map(async (anchorId) => {
        try {
          const response = await fetchFantasyCalcJson(fetcher, '/trades', {
            isDynasty: 'true', side1: String(anchorId), minPlayers: '2', maxPlayers: '4',
          })
          succeeded += 1
          return normalizeFantasyCalcTrades(response)
        } catch (error) {
          errors.push(`${anchorId}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300))
          return []
        }
      }))
      results.forEach((trades) => discovered.push(...trades))
    }
    if (!succeeded) throw new Error('Every FantasyCalc anchor request failed')
    const trades = normalizeFantasyCalcTrades(discovered)
    const existing = await existingTradeIds(db, trades.map((trade) => trade.id))
    const observedAt = new Date().toISOString()
    await batchInChunks(db, trades.map((trade) => db.prepare(`INSERT INTO fantasycalc_trade_tape (
trade_id, trade_at, source_league_id, num_qbs, num_teams, ppr, te_premium,
side1_count, side2_count, raw_json, first_seen_at, last_seen_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(trade_id) DO UPDATE SET
trade_at=excluded.trade_at, source_league_id=excluded.source_league_id,
num_qbs=excluded.num_qbs, num_teams=excluded.num_teams, ppr=excluded.ppr,
te_premium=excluded.te_premium, side1_count=excluded.side1_count,
side2_count=excluded.side2_count, raw_json=excluded.raw_json,
last_seen_at=excluded.last_seen_at`).bind(
      trade.id, trade.date, trade.leagueId, trade.numQbs, trade.numTeams, trade.ppr, trade.tePremium,
      trade.side1.length, trade.side2.length, JSON.stringify(trade), observedAt, observedAt,
    )))
    const finishedAt = new Date().toISOString()
    const status: TradeTapeRefreshState['status'] = errors.length ? 'partial' : 'ready'
    await db.prepare(`UPDATE fantasycalc_trade_tape_runs SET finished_at=?, status=?,
anchors_attempted=?, anchors_succeeded=?, trades_discovered=?, new_trade_count=?, errors_json=?
WHERE id=?`).bind(
      finishedAt, status, attempted, succeeded, trades.length, trades.length - existing.size,
      JSON.stringify(errors.slice(0, 50)), runId,
    ).run()
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
    await db.prepare(`UPDATE fantasycalc_trade_tape_runs SET finished_at=?, status='failed',
anchors_attempted=?, anchors_succeeded=?, errors_json=? WHERE id=?`).bind(
      new Date().toISOString(), attempted, succeeded, JSON.stringify(errors.slice(0, 50)), runId,
    ).run()
    throw error
  }
  return readTradeTapeState(db)
}
