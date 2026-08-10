import { headlineSimilarity, normalizeHeadline, type EventDirection, type IntelEventType } from '../src/intel-events'

/** Minimal D1 surface used by the alert store. */
export interface AlertStatement {
  bind(...values: unknown[]): AlertStatement
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  run(): Promise<unknown>
}

export interface AlertDatabase {
  prepare(sql: string): AlertStatement
  batch(statements: AlertStatement[]): Promise<unknown[]>
}

export type AlertSource = { name: string; url: string }

export type IntelEventInput = {
  playerId: string
  title: string
  source: AlertSource
  publishedAt: string
  expiresAt: string
  eventType: IntelEventType
  direction: EventDirection
  impactWeight: number
}

export type CanonicalIntelEvent = IntelEventInput & {
  eventKey: string
  normalizedTitle: string
  corroboratingSources: AlertSource[]
  corroborationCount: number
  firstSeenAt: string
  lastSeenAt: string
}

export type PlayerCandidate = {
  playerId: string
  name: string
  aliases?: string[]
}

export type WatchlistPreference = {
  userId: string
  leagueId: string
  watchlist: string[]
}

export type AlertMaterialization = {
  userId: string
  leagueId: string
  eventKey: string
  playerId: string
  createdAt: string
}

export type RefreshRecord = {
  lastSuccessAt: string | null
  lastAttemptAt?: string | null
  errorMessage?: string | null
}

export type RefreshStatus = {
  due: boolean
  stale: boolean
  lastSuccessAt: string | null
  nextEligibleAt: string | null
  errorMessage: string | null
}

const CREATE_EVENTS = `CREATE TABLE IF NOT EXISTS intel_events (
  event_key TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  display_title TEXT NOT NULL,
  event_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  impact_weight REAL NOT NULL,
  published_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  corroboration_count INTEGER NOT NULL DEFAULT 1
)`
const CREATE_EVENT_LOOKUP = `CREATE INDEX IF NOT EXISTS idx_intel_events_lookup
ON intel_events (player_id, event_type, direction, published_at DESC)`
const CREATE_ALERTS = `CREATE TABLE IF NOT EXISTS user_intel_alerts (
  user_id TEXT NOT NULL,
  league_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  player_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  seen_at TEXT,
  read_at TEXT,
  dismissed_at TEXT,
  PRIMARY KEY (user_id, league_id, event_key)
)`
const CREATE_INBOX = `CREATE INDEX IF NOT EXISTS idx_user_intel_alerts_inbox
ON user_intel_alerts (user_id, league_id, dismissed_at, read_at, created_at DESC)`

let schemaReady: Promise<void> | null = null

export async function ensureAlertSchema(db: AlertDatabase): Promise<void> {
  if (!schemaReady) {
    schemaReady = db.batch([
      db.prepare(CREATE_EVENTS), db.prepare(CREATE_EVENT_LOOKUP),
      db.prepare(CREATE_ALERTS), db.prepare(CREATE_INBOX),
    ]).then(() => undefined).catch((error) => {
      schemaReady = null
      throw error
    })
  }
  return schemaReady
}

function validDate(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function sourceKey(source: AlertSource): string {
  return `${source.name.trim().toLowerCase()}\u0000${source.url.trim()}`
}

function uniqueSources(sources: AlertSource[]): AlertSource[] {
  return [...new Map(sources.map((source) => [sourceKey(source), source])).values()]
}

/**
 * A conservative exact-name matcher. An alert is returned only when one player
 * ID (possibly through multiple aliases) matches the normalized headline.
 */
export function matchConfidentPlayer(title: string, candidates: PlayerCandidate[]): PlayerCandidate | null {
  const normalizedTitle = ` ${normalizeHeadline(title)} `
  const matching = new Map<string, PlayerCandidate>()
  for (const candidate of candidates) {
    const names = [candidate.name, ...(candidate.aliases ?? [])]
    if (names.some((name) => {
      const normalizedName = normalizeHeadline(name)
      const tokens = normalizedName.split(' ').filter(Boolean)
      return tokens.length >= 2 && normalizedName.length >= 5 && normalizedTitle.includes(` ${normalizedName} `)
    })) matching.set(candidate.playerId, candidate)
  }
  return matching.size === 1 ? [...matching.values()][0] : null
}

export function canonicalEventIdentity(event: Pick<IntelEventInput, 'playerId' | 'title' | 'eventType' | 'direction' | 'publishedAt'>): string {
  // Twelve-hour buckets prevent a repeated headline months later being treated as the same event.
  const bucket = Math.floor(validDate(event.publishedAt) / (12 * 60 * 60 * 1000))
  return [event.playerId, event.eventType, event.direction, normalizeHeadline(event.title), String(bucket)].join('|')
}

export async function stableEventFingerprint(event: Pick<IntelEventInput, 'playerId' | 'title' | 'eventType' | 'direction' | 'publishedAt'>): Promise<string> {
  const data = new TextEncoder().encode(canonicalEventIdentity(event))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function canCorroborate(left: IntelEventInput, right: IntelEventInput): boolean {
  return left.playerId === right.playerId
    && left.eventType === right.eventType
    && left.direction === right.direction
    && Math.abs(validDate(left.publishedAt) - validDate(right.publishedAt)) <= 24 * 60 * 60 * 1000
    && headlineSimilarity(left.title, right.title) >= 0.82
}

/** Collapse cross-source reports before persistence, keeping the oldest report as canonical. */
export async function canonicalizeIntelEvents(inputs: IntelEventInput[], now = new Date().toISOString()): Promise<CanonicalIntelEvent[]> {
  const ordered = [...inputs].sort((a, b) => validDate(a.publishedAt) - validDate(b.publishedAt) || a.title.localeCompare(b.title))
  const groups: IntelEventInput[][] = []
  for (const input of ordered) {
    const group = groups.find((candidate) => canCorroborate(candidate[0], input))
    if (group) group.push(input)
    else groups.push([input])
  }
  return Promise.all(groups.map(async (group) => {
    const base = group[0]
    return {
      ...base,
      eventKey: await stableEventFingerprint(base),
      normalizedTitle: normalizeHeadline(base.title),
      corroboratingSources: uniqueSources(group.map((item) => item.source)),
      corroborationCount: uniqueSources(group.map((item) => item.source)).length,
      firstSeenAt: now,
      lastSeenAt: now,
    }
  }))
}

export function materializeWatchlistAlerts(
  events: CanonicalIntelEvent[],
  preference: WatchlistPreference,
  now = new Date().toISOString(),
): AlertMaterialization[] {
  const watched = new Set(preference.watchlist)
  const nowMs = validDate(now)
  return events
    .filter((event) => watched.has(event.playerId) && validDate(event.expiresAt) > nowMs)
    .map((event) => ({ userId: preference.userId, leagueId: preference.leagueId, eventKey: event.eventKey, playerId: event.playerId, createdAt: now }))
}

export function getRefreshStatus(
  record: RefreshRecord | null,
  now = new Date(),
  refreshEveryMs = 5 * 60 * 1000,
  staleAfterMs = 15 * 60 * 1000,
): RefreshStatus {
  const lastSuccessMs = record?.lastSuccessAt ? validDate(record.lastSuccessAt) : 0
  const nextEligibleMs = lastSuccessMs ? lastSuccessMs + refreshEveryMs : null
  const nowMs = now.getTime()
  return {
    due: !nextEligibleMs || nowMs >= nextEligibleMs,
    stale: !lastSuccessMs || nowMs - lastSuccessMs > staleAfterMs,
    lastSuccessAt: record?.lastSuccessAt ?? null,
    nextEligibleAt: nextEligibleMs ? new Date(nextEligibleMs).toISOString() : null,
    errorMessage: record?.errorMessage ?? null,
  }
}

export async function saveCanonicalEvents(db: AlertDatabase, events: CanonicalIntelEvent[]): Promise<void> {
  if (!events.length) return
  await db.batch(events.map((event) => db.prepare(`INSERT INTO intel_events (
  event_key, player_id, normalized_title, display_title, event_type, direction, impact_weight,
  published_at, expires_at, first_seen_at, last_seen_at, sources_json, corroboration_count
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(event_key) DO UPDATE SET
  last_seen_at = excluded.last_seen_at,
  expires_at = excluded.expires_at,
  sources_json = excluded.sources_json,
  corroboration_count = excluded.corroboration_count`).bind(
    event.eventKey, event.playerId, event.normalizedTitle, event.title, event.eventType, event.direction,
    event.impactWeight, event.publishedAt, event.expiresAt, event.firstSeenAt, event.lastSeenAt,
    JSON.stringify(event.corroboratingSources), event.corroborationCount,
  )))
}

/** Insert-only materialization makes repeated syncs idempotent and preserves read state. */
export async function saveMaterializedAlerts(db: AlertDatabase, alerts: AlertMaterialization[]): Promise<void> {
  if (!alerts.length) return
  await db.batch(alerts.map((alert) => db.prepare(`INSERT INTO user_intel_alerts (
  user_id, league_id, event_key, player_id, created_at
) VALUES (?, ?, ?, ?, ?)
ON CONFLICT(user_id, league_id, event_key) DO NOTHING`).bind(
    alert.userId, alert.leagueId, alert.eventKey, alert.playerId, alert.createdAt,
  )))
}
