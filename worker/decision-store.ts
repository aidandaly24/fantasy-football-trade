import type {
  TradeDecision,
  TradeDecisionAsset,
  TradeDecisionCatalyst,
  TradeDecisionDraft,
  TradeDecisionSnapshot,
  TradeDecisionStatus,
} from '../src/decision-journal'
import type { D1Database } from './user-store'

const CREATE_DECISIONS = `CREATE TABLE IF NOT EXISTS trade_decisions (
  user_id TEXT NOT NULL,
  league_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  status TEXT NOT NULL,
  my_roster_id INTEGER NOT NULL,
  counterpart_roster_id INTEGER NOT NULL,
  send_assets_json TEXT NOT NULL,
  receive_assets_json TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  thesis TEXT NOT NULL,
  hold_period TEXT NOT NULL,
  exit_condition TEXT NOT NULL,
  catalysts_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  offered_at TEXT,
  resolved_at TEXT,
  PRIMARY KEY (user_id, league_id, decision_id)
)`
const CREATE_RECENT_INDEX = `CREATE INDEX IF NOT EXISTS idx_trade_decisions_user_league
ON trade_decisions (user_id, league_id, updated_at)`

const readyByDb = new WeakMap<object, Promise<void>>()
const STATUSES = new Set<TradeDecisionStatus>(['researching', 'offered', 'countered', 'accepted', 'rejected', 'withdrawn'])
const TERMINAL = new Set<TradeDecisionStatus>(['accepted', 'rejected', 'withdrawn'])

type DecisionRow = {
  decision_id: string
  league_id: string
  status: TradeDecisionStatus
  my_roster_id: number
  counterpart_roster_id: number
  send_assets_json: string
  receive_assets_json: string
  snapshot_json: string
  thesis: string
  hold_period: string
  exit_condition: string
  catalysts_json: string
  created_at: string
  updated_at: string
  offered_at: string | null
  resolved_at: string | null
}

export async function ensureDecisionSchema(db: D1Database): Promise<void> {
  let ready = readyByDb.get(db as object)
  if (!ready) {
    ready = db.batch([db.prepare(CREATE_DECISIONS), db.prepare(CREATE_RECENT_INDEX)]).then(() => undefined)
      .catch((error) => { readyByDb.delete(db as object); throw error })
    readyByDb.set(db as object, ready)
  }
  return ready
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid decision payload')
  return value as Record<string, unknown>
}

function text(value: unknown, label: string, max: number, required = true): string {
  const result = typeof value === 'string' ? value.trim() : ''
  if ((required && !result) || result.length > max) throw new Error(`Invalid ${label}`)
  return result
}

function number(value: unknown, label: string, min: number, max: number): number {
  const result = Number(value)
  if (!Number.isFinite(result) || result < min || result > max) throw new Error(`Invalid ${label}`)
  return result
}

function nullableNumber(value: unknown, label: string, min: number, max: number): number | null {
  return value === null ? null : number(value, label, min, max)
}

function decisionAsset(value: unknown): TradeDecisionAsset {
  const input = object(value)
  const kind = String(input.kind)
  if (!['player', 'pick'].includes(kind)) throw new Error('Invalid decision asset kind')
  const position = text(input.position, 'asset position', 8) as TradeDecisionAsset['position']
  return {
    id: text(input.id, 'asset ID', 80),
    name: text(input.name, 'asset name', 120),
    kind: kind as TradeDecisionAsset['kind'],
    position,
    value: number(input.value, 'asset value', 0, 100_000),
  }
}

function decisionAssets(value: unknown, label: string): TradeDecisionAsset[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new Error(`Invalid ${label} assets`)
  const assets = value.map(decisionAsset)
  if (new Set(assets.map((asset) => asset.id)).size !== assets.length) throw new Error(`Duplicate ${label} asset`)
  return assets
}

function snapshot(value: unknown): TradeDecisionSnapshot {
  const input = object(value)
  const provider = object(input.providerNetToMe)
  const strategy = object(input.strategy)
  const versions = object(input.evidenceVersions)
  const capturedAt = text(input.capturedAt, 'snapshot time', 40)
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error('Invalid snapshot time')
  return {
    capturedAt,
    marketNetToMe: number(input.marketNetToMe, 'market net', -500_000, 500_000),
    currentSeasonPowerDelta: nullableNumber(input.currentSeasonPowerDelta, 'power delta', -500_000, 500_000),
    lineupPpgDelta: nullableNumber(input.lineupPpgDelta, 'lineup delta', -100, 100),
    providerNetToMe: {
      ktc: nullableNumber(provider.ktc, 'KTC net', -500_000, 500_000),
      fantasycalc: nullableNumber(provider.fantasycalc, 'FantasyCalc net', -500_000, 500_000),
    },
    pickValueNetToMe: number(input.pickValueNetToMe, 'pick value net', -500_000, 500_000),
    expectedPnl30: nullableNumber(input.expectedPnl30, 'expected return', -500_000, 500_000),
    trackedAssetLowerPnl30: nullableNumber(input.trackedAssetLowerPnl30, 'tracked downside', -500_000, 500_000),
    returnCoverage: nullableNumber(input.returnCoverage, 'return coverage', 0, 1),
    strategy: {
      mode: text(strategy.mode, 'strategy mode', 40),
      horizonYears: number(strategy.horizonYears, 'strategy horizon', 1, 4),
    },
    evidenceVersions: {
      market: text(versions.market, 'market version', 120),
      assetReturn: versions.assetReturn === null ? null : text(versions.assetReturn, 'asset return version', 120),
      eventModel: versions.eventModel === null ? null : text(versions.eventModel, 'event model version', 120),
    },
  }
}

function catalyst(value: unknown): TradeDecisionCatalyst {
  const input = object(value)
  const eventType = input.eventType == null ? undefined : text(input.eventType, 'event type', 40)
  const eventDirection = input.eventDirection == null ? undefined : text(input.eventDirection, 'event direction', 20)
  const publishedAt = text(input.publishedAt, 'catalyst time', 40)
  if (!Number.isFinite(Date.parse(publishedAt))) throw new Error('Invalid catalyst time')
  return {
    id: text(input.id, 'catalyst ID', 180),
    title: text(input.title, 'catalyst title', 300),
    url: text(input.url, 'catalyst URL', 500),
    source: text(input.source, 'catalyst source', 100),
    publishedAt,
    eventType: eventType as TradeDecisionCatalyst['eventType'],
    eventDirection: eventDirection as TradeDecisionCatalyst['eventDirection'],
    playerId: text(input.playerId, 'catalyst player ID', 80),
    playerName: text(input.playerName, 'catalyst player name', 120),
  }
}

export function normalizeDecisionDraft(value: unknown, leagueId: string): TradeDecisionDraft {
  const input = object(value)
  if (String(input.leagueId) !== leagueId) throw new Error('Decision league does not match request')
  const status = String(input.status) as TradeDecisionStatus
  if (!STATUSES.has(status)) throw new Error('Invalid decision status')
  const myRosterId = Math.round(number(input.myRosterId, 'my roster', 1, 100))
  const counterpartRosterId = Math.round(number(input.counterpartRosterId, 'counterpart roster', 1, 100))
  if (myRosterId === counterpartRosterId) throw new Error('Decision requires two rosters')
  const catalysts = Array.isArray(input.catalysts) ? input.catalysts.slice(0, 10).map(catalyst) : []
  return {
    leagueId,
    status,
    myRosterId,
    counterpartRosterId,
    send: decisionAssets(input.send, 'sent'),
    receive: decisionAssets(input.receive, 'received'),
    snapshot: snapshot(input.snapshot),
    thesis: text(input.thesis, 'thesis', 1000),
    holdPeriod: text(input.holdPeriod, 'hold period', 300),
    exitCondition: text(input.exitCondition, 'exit condition', 600),
    catalysts,
  }
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T } catch { return fallback }
}

function fromRow(row: DecisionRow): TradeDecision {
  return {
    id: row.decision_id,
    leagueId: row.league_id,
    status: row.status,
    myRosterId: row.my_roster_id,
    counterpartRosterId: row.counterpart_roster_id,
    send: parseJson(row.send_assets_json, []),
    receive: parseJson(row.receive_assets_json, []),
    snapshot: parseJson(row.snapshot_json, {} as TradeDecisionSnapshot),
    thesis: row.thesis,
    holdPeriod: row.hold_period,
    exitCondition: row.exit_condition,
    catalysts: parseJson(row.catalysts_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    offeredAt: row.offered_at,
    resolvedAt: row.resolved_at,
  }
}

export async function listTradeDecisions(db: D1Database, userId: string, leagueId: string): Promise<TradeDecision[]> {
  const rows = await db.prepare(`SELECT decision_id, league_id, status, my_roster_id, counterpart_roster_id,
send_assets_json, receive_assets_json, snapshot_json, thesis, hold_period, exit_condition,
catalysts_json, created_at, updated_at, offered_at, resolved_at
FROM trade_decisions WHERE user_id=? AND league_id=?
ORDER BY updated_at DESC LIMIT 200`).bind(userId, leagueId).all<DecisionRow>()
  return rows.results.map(fromRow)
}

export async function createTradeDecision(
  db: D1Database,
  userId: string,
  draft: TradeDecisionDraft,
  now = new Date(),
): Promise<TradeDecision> {
  const id = crypto.randomUUID()
  const createdAt = now.toISOString()
  const offeredAt = ['offered', 'countered', 'accepted', 'rejected'].includes(draft.status) ? createdAt : null
  const resolvedAt = TERMINAL.has(draft.status) ? createdAt : null
  await db.prepare(`INSERT INTO trade_decisions (
  user_id, league_id, decision_id, status, my_roster_id, counterpart_roster_id,
  send_assets_json, receive_assets_json, snapshot_json, thesis, hold_period,
  exit_condition, catalysts_json, created_at, updated_at, offered_at, resolved_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    userId, draft.leagueId, id, draft.status, draft.myRosterId, draft.counterpartRosterId,
    JSON.stringify(draft.send), JSON.stringify(draft.receive), JSON.stringify(draft.snapshot),
    draft.thesis, draft.holdPeriod, draft.exitCondition, JSON.stringify(draft.catalysts),
    createdAt, createdAt, offeredAt, resolvedAt,
  ).run()
  return { ...draft, id, createdAt, updatedAt: createdAt, offeredAt, resolvedAt }
}

export async function updateTradeDecisionStatus(
  db: D1Database,
  userId: string,
  leagueId: string,
  id: string,
  status: TradeDecisionStatus,
  now = new Date(),
): Promise<void> {
  if (!STATUSES.has(status) || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid decision update')
  const updatedAt = now.toISOString()
  const offered = ['offered', 'countered', 'accepted', 'rejected'].includes(status)
  const resolved = TERMINAL.has(status)
  await db.prepare(`UPDATE trade_decisions SET status=?, updated_at=?,
offered_at=CASE WHEN ?=1 THEN COALESCE(offered_at, ?) ELSE offered_at END,
resolved_at=CASE WHEN ?=1 THEN ? ELSE NULL END
WHERE user_id=? AND league_id=? AND decision_id=?`).bind(
    status, updatedAt, offered ? 1 : 0, updatedAt, resolved ? 1 : 0, updatedAt,
    userId, leagueId, id,
  ).run()
}
