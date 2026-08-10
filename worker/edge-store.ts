import type { EdgeOpportunitySnapshot, EdgeStateBundle, TradeOfferRecord, TradeOfferStatus } from '../src/types'
import type { D1Database, D1PreparedStatement } from './user-store'

const CREATE_OPPORTUNITIES = `CREATE TABLE IF NOT EXISTS edge_opportunity_snapshots (
  user_id TEXT NOT NULL, league_id TEXT NOT NULL, snapshot_key TEXT NOT NULL,
  asset_id TEXT NOT NULL, asset_name TEXT NOT NULL, owner_roster_id INTEGER NOT NULL,
  captured_at TEXT NOT NULL, current_value INTEGER NOT NULL, projection_30 INTEGER NOT NULL,
  projection_90 INTEGER NOT NULL, projection_180 INTEGER NOT NULL, edge_score INTEGER NOT NULL,
  lineup_delta REAL NOT NULL, confidence INTEGER NOT NULL, categories_json TEXT NOT NULL,
  catalyst TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'tracking',
  PRIMARY KEY (user_id, league_id, snapshot_key)
)`
const CREATE_OPPORTUNITY_INDEX = `CREATE INDEX IF NOT EXISTS idx_edge_opportunities_user_league
ON edge_opportunity_snapshots (user_id, league_id, captured_at DESC)`
const CREATE_OFFERS = `CREATE TABLE IF NOT EXISTS user_trade_offers (
  user_id TEXT NOT NULL, league_id TEXT NOT NULL, offer_id TEXT NOT NULL,
  counterpart_roster_id INTEGER NOT NULL, target_asset_id TEXT NOT NULL, target_asset_name TEXT NOT NULL,
  stage TEXT NOT NULL, status TEXT NOT NULL, sent_assets_json TEXT NOT NULL,
  receive_assets_json TEXT NOT NULL, market_delta INTEGER NOT NULL, lineup_delta REAL NOT NULL,
  thesis TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, league_id, offer_id)
)`
const CREATE_OFFER_INDEX = `CREATE INDEX IF NOT EXISTS idx_trade_offers_user_league
ON user_trade_offers (user_id, league_id, updated_at DESC)`

let schemaReady: Promise<void> | null = null

export async function ensureEdgeSchema(db: D1Database): Promise<void> {
  if (!schemaReady) {
    schemaReady = db.batch([
      db.prepare(CREATE_OPPORTUNITIES),
      db.prepare(CREATE_OPPORTUNITY_INDEX),
      db.prepare(CREATE_OFFERS),
      db.prepare(CREATE_OFFER_INDEX),
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

function boundedText(value: unknown, label: string, max: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || text.length > max) throw new Error(`Invalid ${label}`)
  return text
}

function boundedNumber(value: unknown, label: string, min: number, max: number): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`Invalid ${label}`)
  return number
}

export function normalizeOpportunityInput(input: unknown, now = new Date()): EdgeOpportunitySnapshot {
  const value = object(input)
  const assetId = boundedText(value.assetId, 'asset ID', 80)
  if (!/^[\w:.\-]+$/.test(assetId)) throw new Error('Invalid asset ID')
  const ownerRosterId = Math.round(boundedNumber(value.ownerRosterId, 'owner roster', 1, 100))
  const categories = Array.isArray(value.categories)
    ? [...new Set(value.categories.filter((category): category is 'value' | 'points' | 'intel' => ['value', 'points', 'intel'].includes(String(category))))].slice(0, 3)
    : []
  if (!categories.length) throw new Error('Invalid categories')
  const capturedAt = now.toISOString()
  return {
    snapshotKey: `${ownerRosterId}:${assetId}:${capturedAt.slice(0, 10)}`,
    assetId,
    assetName: boundedText(value.assetName, 'asset name', 120),
    ownerRosterId,
    capturedAt,
    currentValue: Math.round(boundedNumber(value.currentValue, 'current value', 0, 100_000)),
    projection30: Math.round(boundedNumber(value.projection30, '30-day projection', 0, 100_000)),
    projection90: Math.round(boundedNumber(value.projection90, '90-day projection', 0, 100_000)),
    projection180: Math.round(boundedNumber(value.projection180, '180-day projection', 0, 100_000)),
    edgeScore: Math.round(boundedNumber(value.edgeScore, 'edge score', 0, 100)),
    lineupDelta: Number(boundedNumber(value.lineupDelta, 'lineup delta', -50, 50).toFixed(2)),
    confidence: Math.round(boundedNumber(value.confidence, 'confidence', 0, 100)),
    categories,
    catalyst: boundedText(value.catalyst, 'catalyst', 500),
    status: 'tracking',
  }
}

const OFFER_STATUSES = new Set<TradeOfferStatus>(['draft', 'sent', 'countered', 'rejected', 'accepted', 'withdrawn'])
const OFFER_STAGES = new Set<TradeOfferRecord['stage']>(['opening', 'target', 'counter', 'walk-away'])

function normalizeAssets(input: unknown): TradeOfferRecord['sentAssets'] {
  if (!Array.isArray(input) || !input.length || input.length > 10) throw new Error('Invalid offer assets')
  return input.map((item) => {
    const value = object(item)
    const id = boundedText(value.id, 'offer asset ID', 80)
    if (!/^[\w:.\-]+$/.test(id)) throw new Error('Invalid offer asset ID')
    return {
      id,
      name: boundedText(value.name, 'offer asset name', 120),
      value: Math.round(boundedNumber(value.value, 'offer asset value', 0, 100_000)),
    }
  })
}

export function normalizeOfferInput(input: unknown, now = new Date()): TradeOfferRecord {
  const value = object(input)
  const offerId = boundedText(value.offerId, 'offer ID', 80)
  if (!/^[\w-]+$/.test(offerId)) throw new Error('Invalid offer ID')
  const stage = String(value.stage) as TradeOfferRecord['stage']
  const status = String(value.status) as TradeOfferStatus
  if (!OFFER_STAGES.has(stage)) throw new Error('Invalid offer stage')
  if (!OFFER_STATUSES.has(status)) throw new Error('Invalid offer status')
  const timestamp = now.toISOString()
  return {
    offerId,
    counterpartRosterId: Math.round(boundedNumber(value.counterpartRosterId, 'counterpart roster', 1, 100)),
    targetAssetId: boundedText(value.targetAssetId, 'target asset ID', 80),
    targetAssetName: boundedText(value.targetAssetName, 'target asset name', 120),
    stage,
    status,
    sentAssets: normalizeAssets(value.sentAssets),
    receiveAssets: normalizeAssets(value.receiveAssets),
    marketDelta: Math.round(boundedNumber(value.marketDelta, 'market delta', -100_000, 100_000)),
    lineupDelta: Number(boundedNumber(value.lineupDelta, 'lineup delta', -50, 50).toFixed(2)),
    thesis: boundedText(value.thesis, 'thesis', 1_000),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

async function batchInChunks(db: D1Database, statements: D1PreparedStatement[], size = 75): Promise<void> {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size))
  }
}

export async function saveOpportunitySnapshots(
  db: D1Database,
  userId: string,
  leagueId: string,
  snapshots: EdgeOpportunitySnapshot[],
): Promise<void> {
  if (!snapshots.length) return
  await batchInChunks(db, snapshots.map((snapshot) => db.prepare(`INSERT INTO edge_opportunity_snapshots (
  user_id, league_id, snapshot_key, asset_id, asset_name, owner_roster_id, captured_at,
  current_value, projection_30, projection_90, projection_180, edge_score, lineup_delta,
  confidence, categories_json, catalyst, status
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(user_id, league_id, snapshot_key) DO NOTHING`).bind(
    userId, leagueId, snapshot.snapshotKey, snapshot.assetId, snapshot.assetName, snapshot.ownerRosterId,
    snapshot.capturedAt, snapshot.currentValue, snapshot.projection30, snapshot.projection90,
    snapshot.projection180, snapshot.edgeScore, snapshot.lineupDelta, snapshot.confidence,
    JSON.stringify(snapshot.categories), snapshot.catalyst, snapshot.status,
  )))
}

export async function saveTradeOffer(
  db: D1Database,
  userId: string,
  leagueId: string,
  offer: TradeOfferRecord,
): Promise<void> {
  await db.prepare(`INSERT INTO user_trade_offers (
  user_id, league_id, offer_id, counterpart_roster_id, target_asset_id, target_asset_name,
  stage, status, sent_assets_json, receive_assets_json, market_delta, lineup_delta,
  thesis, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(user_id, league_id, offer_id) DO UPDATE SET
  status=excluded.status, stage=excluded.stage, sent_assets_json=excluded.sent_assets_json,
  receive_assets_json=excluded.receive_assets_json, market_delta=excluded.market_delta,
  lineup_delta=excluded.lineup_delta, thesis=excluded.thesis, updated_at=excluded.updated_at`).bind(
    userId, leagueId, offer.offerId, offer.counterpartRosterId, offer.targetAssetId, offer.targetAssetName,
    offer.stage, offer.status, JSON.stringify(offer.sentAssets), JSON.stringify(offer.receiveAssets),
    offer.marketDelta, offer.lineupDelta, offer.thesis, offer.createdAt, offer.updatedAt,
  ).run()
}

type OpportunityRow = {
  snapshot_key: string; asset_id: string; asset_name: string; owner_roster_id: number; captured_at: string
  current_value: number; projection_30: number; projection_90: number; projection_180: number
  edge_score: number; lineup_delta: number; confidence: number; categories_json: string; catalyst: string; status: string
}
type OfferRow = {
  offer_id: string; counterpart_roster_id: number; target_asset_id: string; target_asset_name: string
  stage: TradeOfferRecord['stage']; status: TradeOfferStatus; sent_assets_json: string; receive_assets_json: string
  market_delta: number; lineup_delta: number; thesis: string; created_at: string; updated_at: string
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T } catch { return fallback }
}

export async function readEdgeState(db: D1Database, userId: string, leagueId: string): Promise<EdgeStateBundle> {
  const [opportunities, offers] = await Promise.all([
    db.prepare(`SELECT snapshot_key, asset_id, asset_name, owner_roster_id, captured_at, current_value,
projection_30, projection_90, projection_180, edge_score, lineup_delta, confidence,
categories_json, catalyst, status FROM edge_opportunity_snapshots
WHERE user_id=? AND league_id=? ORDER BY captured_at DESC LIMIT 500`).bind(userId, leagueId).all<OpportunityRow>(),
    db.prepare(`SELECT offer_id, counterpart_roster_id, target_asset_id, target_asset_name, stage, status,
sent_assets_json, receive_assets_json, market_delta, lineup_delta, thesis, created_at, updated_at
FROM user_trade_offers WHERE user_id=? AND league_id=? ORDER BY updated_at DESC LIMIT 200`).bind(userId, leagueId).all<OfferRow>(),
  ])
  return {
    opportunities: opportunities.results.map((row) => ({
      snapshotKey: row.snapshot_key, assetId: row.asset_id, assetName: row.asset_name,
      ownerRosterId: row.owner_roster_id, capturedAt: row.captured_at, currentValue: row.current_value,
      projection30: row.projection_30, projection90: row.projection_90, projection180: row.projection_180,
      edgeScore: row.edge_score, lineupDelta: row.lineup_delta, confidence: row.confidence,
      categories: parseJson<EdgeOpportunitySnapshot['categories']>(row.categories_json, []),
      catalyst: row.catalyst, status: row.status,
    })),
    offers: offers.results.map((row) => ({
      offerId: row.offer_id, counterpartRosterId: row.counterpart_roster_id,
      targetAssetId: row.target_asset_id, targetAssetName: row.target_asset_name,
      stage: row.stage, status: row.status,
      sentAssets: parseJson<TradeOfferRecord['sentAssets']>(row.sent_assets_json, []),
      receiveAssets: parseJson<TradeOfferRecord['receiveAssets']>(row.receive_assets_json, []),
      marketDelta: row.market_delta, lineupDelta: row.lineup_delta, thesis: row.thesis,
      createdAt: row.created_at, updatedAt: row.updated_at,
    })),
  }
}
