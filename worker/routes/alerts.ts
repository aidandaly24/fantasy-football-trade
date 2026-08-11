import type { EventDirection, IntelEventType } from '../../src/intel-events'
import {
  canonicalizeIntelEvents,
  ensureAlertSchema,
  getRefreshStatus,
  matchConfidentPlayer,
  materializeWatchlistAlerts,
  saveCanonicalEvents,
  saveMaterializedAlerts,
  type CanonicalIntelEvent,
  type PlayerCandidate,
} from '../alerts-store'
import { buildIntelFeed } from '../intel-feed'
import { authenticatedUser, ensureUserSchema, getLeaguePreference, type D1Database } from '../user-store'
import type { Env } from '../env'
import { methodNotAllowed, privateJson, sameOriginWrite, validLeagueId } from '../http'

type TradyrDirectoryResponse = {
  data: Array<{ sleeperId: string | null; name: string }>
}
type RefreshRow = { last_success_at: string | null; started_at: string | null; error_message: string | null }
type EventRow = {
  event_key: string
  player_id: string
  normalized_title: string
  display_title: string
  event_type: IntelEventType
  direction: EventDirection
  impact_weight: number
  published_at: string
  expires_at: string
  first_seen_at: string
  last_seen_at: string
  sources_json: string
  corroboration_count: number
}
type AlertRow = {
  event_key: string
  player_id: string
  created_at: string
  seen_at: string | null
  read_at: string | null
  display_title: string
  event_type: IntelEventType
  direction: EventDirection
  impact_weight: number
  published_at: string
  expires_at: string
  sources_json: string
  corroboration_count: number
}
const CREATE_REFRESH_RUNS = `CREATE TABLE IF NOT EXISTS intel_refresh_runs (
  scope TEXT PRIMARY KEY, started_at TEXT, completed_at TEXT, last_success_at TEXT,
  source_status_json TEXT NOT NULL DEFAULT '{}', event_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
)`

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T } catch { return fallback }
}

async function playerDirectory(): Promise<PlayerCandidate[]> {
  const params = new URLSearchParams({ format: 'dynasty', numQbs: '2', tep: 'false', limit: '1000' })
  const response = await fetch(`https://api.tradyr.app/v1/players?${params}`)
  if (!response.ok) throw new Error(`Player directory failed (${response.status})`)
  const body = await response.json<TradyrDirectoryResponse>()
  return body.data.filter((player): player is { sleeperId: string; name: string } => Boolean(player.sleeperId && player.name))
    .map((player) => ({ playerId: String(player.sleeperId), name: player.name }))
}

function canonicalFromRow(row: EventRow): CanonicalIntelEvent {
  const sources = parseJson<Array<{ name: string; url: string }>>(row.sources_json, [])
  return {
    eventKey: row.event_key,
    playerId: row.player_id,
    title: row.display_title,
    normalizedTitle: row.normalized_title,
    source: sources[0] ?? { name: 'NFL reporting', url: '' },
    corroboratingSources: sources,
    corroborationCount: row.corroboration_count,
    eventType: row.event_type,
    direction: row.direction,
    impactWeight: row.impact_weight,
    publishedAt: row.published_at,
    expiresAt: row.expires_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  }
}

export async function ensureAlertRefreshSchema(db: D1Database): Promise<void> {
  await ensureAlertSchema(db)
  await db.prepare(CREATE_REFRESH_RUNS).run()
}

export async function refreshAlertEvents(db: D1Database): Promise<void> {
  const startedAt = new Date().toISOString()
  await db.prepare(`INSERT INTO intel_refresh_runs (scope, started_at, source_status_json)
VALUES ('global', ?, '{}') ON CONFLICT(scope) DO UPDATE SET started_at=excluded.started_at, error_message=NULL`).bind(startedAt).run()
  try {
    const [feed, candidates] = await Promise.all([buildIntelFeed(), playerDirectory()])
    const inputs = feed.articles.flatMap((article) => {
      const player = matchConfidentPlayer(article.title, candidates)
      return player ? [{
        playerId: player.playerId,
        title: article.title,
        source: { name: article.source, url: article.url },
        publishedAt: article.publishedAt,
        expiresAt: article.expiresAt,
        eventType: article.eventType,
        direction: article.eventDirection,
        impactWeight: article.impactWeight,
      }] : []
    })
    const events = await canonicalizeIntelEvents(inputs)
    await saveCanonicalEvents(db, events)
    const completedAt = new Date().toISOString()
    await db.prepare(`UPDATE intel_refresh_runs SET completed_at=?, last_success_at=?, source_status_json=?, event_count=?, error_message=NULL WHERE scope='global'`).bind(
      completedAt, completedAt, JSON.stringify(feed.sources), events.length,
    ).run()
  } catch (error) {
    await db.prepare(`UPDATE intel_refresh_runs SET completed_at=?, error_message=? WHERE scope='global'`).bind(
      new Date().toISOString(), error instanceof Error ? error.message : String(error),
    ).run()
    throw error
  }
}

export async function alertsResponse(request: Request, env: Env): Promise<Response> {
  const user = authenticatedUser(request)
  if (!user) return privateJson({ message: 'Authenticated site access required' }, 401)
  if (!env.DB) return privateJson({ message: 'Private storage is not configured' }, 503)
  const url = new URL(request.url)
  const leagueId = url.searchParams.get('leagueId')
  if (!validLeagueId(leagueId)) return privateJson({ message: 'Invalid league ID' }, 400)
  try {
    await ensureUserSchema(env.DB)
    await ensureAlertRefreshSchema(env.DB)
    if (request.method === 'POST') {
      if (!sameOriginWrite(request)) return privateJson({ message: 'Cross-origin writes are not allowed' }, 403)
      const input = await request.json().catch(() => null) as { eventKeys?: unknown; read?: unknown } | null
      const eventKeys = Array.isArray(input?.eventKeys)
        ? [...new Set(input.eventKeys.filter((key): key is string => typeof key === 'string' && /^[a-f\d]{64}$/.test(key)))].slice(0, 100)
        : []
      if (!eventKeys.length) return privateJson({ message: 'No valid alert IDs' }, 400)
      const timestamp = input?.read === false ? null : new Date().toISOString()
      await env.DB.batch(eventKeys.map((eventKey) => env.DB!.prepare(`UPDATE user_intel_alerts SET read_at=?, seen_at=COALESCE(seen_at, ?) WHERE user_id=? AND league_id=? AND event_key=?`).bind(
        timestamp, new Date().toISOString(), user.id, leagueId, eventKey,
      )))
    } else if (request.method !== 'GET') {
      return methodNotAllowed('GET, POST')
    }

    let refresh = await env.DB.prepare(`SELECT last_success_at, started_at, error_message FROM intel_refresh_runs WHERE scope='global'`).first<RefreshRow>()
    let status = getRefreshStatus(refresh ? { lastSuccessAt: refresh.last_success_at, lastAttemptAt: refresh.started_at, errorMessage: refresh.error_message } : null)
    if (request.method === 'GET' && url.searchParams.get('sync') === '1' && status.due) {
      try { await refreshAlertEvents(env.DB) } catch { /* The prior inbox remains available with stale health. */ }
      refresh = await env.DB.prepare(`SELECT last_success_at, started_at, error_message FROM intel_refresh_runs WHERE scope='global'`).first<RefreshRow>()
      status = getRefreshStatus(refresh ? { lastSuccessAt: refresh.last_success_at, lastAttemptAt: refresh.started_at, errorMessage: refresh.error_message } : null)
    }
    const preference = await getLeaguePreference(env.DB, user.id, leagueId)
    const activeRows = await env.DB.prepare(`SELECT event_key, player_id, normalized_title, display_title, event_type, direction, impact_weight, published_at, expires_at, first_seen_at, last_seen_at, sources_json, corroboration_count FROM intel_events WHERE expires_at > ?`).bind(new Date().toISOString()).all<EventRow>()
    const materialized = materializeWatchlistAlerts(activeRows.results.map(canonicalFromRow), {
      userId: user.id,
      leagueId,
      watchlist: preference?.watchlist ?? [],
    })
    await saveMaterializedAlerts(env.DB, materialized)
    const inbox = await env.DB.prepare(`SELECT a.event_key, a.player_id, a.created_at, a.seen_at, a.read_at,
e.display_title, e.event_type, e.direction, e.impact_weight, e.published_at, e.expires_at, e.sources_json, e.corroboration_count
FROM user_intel_alerts a JOIN intel_events e ON e.event_key=a.event_key
WHERE a.user_id=? AND a.league_id=? AND a.dismissed_at IS NULL
ORDER BY a.created_at DESC LIMIT 100`).bind(user.id, leagueId).all<AlertRow>()
    const alerts = inbox.results.map((row) => ({
      eventKey: row.event_key,
      playerId: row.player_id,
      createdAt: row.created_at,
      seenAt: row.seen_at,
      readAt: row.read_at,
      title: row.display_title,
      eventType: row.event_type,
      direction: row.direction,
      impactWeight: row.impact_weight,
      publishedAt: row.published_at,
      expiresAt: row.expires_at,
      sources: parseJson<Array<{ name: string; url: string }>>(row.sources_json, []),
      corroborationCount: row.corroboration_count,
    }))
    return privateJson({ alerts, unreadCount: alerts.filter((alert) => !alert.readAt).length, status })
  } catch (error) {
    return privateJson({ message: error instanceof Error ? error.message : 'Alert inbox unavailable' }, 500)
  }
}
