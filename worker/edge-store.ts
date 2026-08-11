import type { EdgeStateBundle, TradeOfferRecord, TradeOfferStatus } from '../src/types'
import type { D1Database } from './user-store'

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

type OfferRow = {
  offer_id: string; counterpart_roster_id: number; target_asset_id: string; target_asset_name: string
  stage: TradeOfferRecord['stage']; status: TradeOfferStatus; sent_assets_json: string; receive_assets_json: string
  market_delta: number; lineup_delta: number; thesis: string; created_at: string; updated_at: string
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T } catch { return fallback }
}

export async function readEdgeState(
  db: D1Database,
  userId: string,
  leagueId: string,
): Promise<Pick<EdgeStateBundle, 'offers'>> {
  const offers = await db.prepare(`SELECT offer_id, counterpart_roster_id, target_asset_id, target_asset_name, stage, status,
sent_assets_json, receive_assets_json, market_delta, lineup_delta, thesis, created_at, updated_at
FROM user_trade_offers WHERE user_id=? AND league_id=? ORDER BY updated_at DESC LIMIT 200`).bind(userId, leagueId).all<OfferRow>()
  return {
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
