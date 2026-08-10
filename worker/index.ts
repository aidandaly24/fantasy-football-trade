import {
  classifierFixtureAccuracy,
  CLASSIFIER_FIXTURES,
  classifyHeadline,
  headlineSimilarity,
  normalizeHeadline,
  type EventDirection,
  type IntelEventType,
} from '../src/intel-events'
import {
  authenticatedUser,
  ensureUserSchema,
  getLeaguePreference,
  listLeaguePreferences,
  normalizePreferenceInput,
  saveLeaguePreference,
  type D1Database,
} from './user-store'
import { readLeagueJournal, syncLeagueJournal } from './journal-db'
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
} from './alerts-store'

interface AssetsBinding {
  fetch(request: Request): Promise<Response>
}

interface Env {
  ASSETS: AssetsBinding
  DB?: D1Database
}

type NewsArticle = {
  id: string
  title: string
  url: string
  source: string
  publishedAt: string
  reliability: number
  normalizedTitle: string
  eventType: IntelEventType
  eventDirection: EventDirection
  impactWeight: number
  expiresAt: string
  corroboratingSources: string[]
  corroborationCount: number
}

type TrendItem = {
  playerId: string
  count: number
}

type SleeperTrend = {
  player_id: string
  count: number
}

const NEWS_SOURCES = [
  { name: 'ESPN', url: 'https://www.espn.com/espn/rss/nfl/news', reliability: 0.94 },
  { name: 'CBS Sports', url: 'https://www.cbssports.com/rss/headlines/nfl/', reliability: 0.91 },
  { name: 'Yahoo Sports', url: 'https://sports.yahoo.com/nfl/rss.xml', reliability: 0.85 },
] as const

function decodeXml(value: string): string {
  const entities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    quot: '"',
  }
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name: string) => entities[name.toLowerCase()] ?? entity)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function rssField(item: string, field: string): string {
  const match = item.match(new RegExp(`<${field}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${field}>`, 'i'))
  return match ? decodeXml(match[1]) : ''
}

function parseFeed(xml: string, source: typeof NEWS_SOURCES[number]): NewsArticle[] {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
    .map((match, index) => {
      const item = match[1]
      const title = rssField(item, 'title')
      const url = rssField(item, 'link') || rssField(item, 'guid')
      const publishedAt = rssField(item, 'pubDate') || rssField(item, 'dc:date')
      const published = Number.isNaN(Date.parse(publishedAt)) ? new Date() : new Date(publishedAt)
      const classification = classifyHeadline(title)
      return {
        id: `${source.name.toLowerCase().replace(/\s+/g, '-')}-${index}-${title.slice(0, 28)}`,
        title,
        url,
        source: source.name,
        publishedAt: published.toISOString(),
        reliability: source.reliability,
        normalizedTitle: normalizeHeadline(title),
        eventType: classification.eventType,
        eventDirection: classification.direction,
        impactWeight: classification.impactWeight,
        expiresAt: new Date(published.getTime() + classification.expiresInHours * 3_600_000).toISOString(),
        corroboratingSources: [source.name],
        corroborationCount: 1,
      }
    })
    .filter((article) => article.title && /^https?:\/\//.test(article.url))
}

async function fetchNewsSource(source: typeof NEWS_SOURCES[number]) {
  try {
    const response = await fetch(source.url, {
      headers: { 'User-Agent': 'RosterLab/1.0 (+private fantasy-football research)' },
    })
    if (!response.ok) throw new Error(`${response.status}`)
    return { name: source.name, ok: true, articles: parseFeed(await response.text(), source) }
  } catch {
    return { name: source.name, ok: false, articles: [] as NewsArticle[] }
  }
}

async function fetchTrend(type: 'add' | 'drop', hours: 6 | 24): Promise<TrendItem[]> {
  try {
    const response = await fetch(
      `https://api.sleeper.app/v1/players/nfl/trending/${type}?lookback_hours=${hours}&limit=100`,
    )
    if (!response.ok) return []
    const data = await response.json<SleeperTrend[]>()
    return data.map((item) => ({ playerId: item.player_id, count: item.count }))
  } catch {
    return []
  }
}

async function buildIntelFeed() {
  const [news, adds6, adds24, drops6, drops24] = await Promise.all([
    Promise.all(NEWS_SOURCES.map(fetchNewsSource)),
    fetchTrend('add', 6),
    fetchTrend('add', 24),
    fetchTrend('drop', 6),
    fetchTrend('drop', 24),
  ])

  const rawArticles = news
    .flatMap((result) => result.articles)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
  const deduplicated: NewsArticle[] = []
  rawArticles.forEach((article) => {
    const duplicate = deduplicated.find((candidate) => headlineSimilarity(candidate.title, article.title) >= 0.82)
    if (!duplicate) {
      deduplicated.push(article)
      return
    }
    duplicate.corroboratingSources = [...new Set([...duplicate.corroboratingSources, article.source])]
    duplicate.corroborationCount += 1
    duplicate.reliability = Math.max(duplicate.reliability, article.reliability)
  })
  const articles = deduplicated
    .slice(0, 60)
  const remainingDuplicatePairs = articles.flatMap((article, index) =>
    articles.slice(index + 1).map((candidate) => headlineSimilarity(article.title, candidate.title)),
  ).filter((similarity) => similarity >= 0.82).length
  const residualDuplicateRate = articles.length ? remainingDuplicatePairs / articles.length : 0
  const fixtureAccuracy = classifierFixtureAccuracy()
  const sourceSuccessRate = news.filter((source) => source.ok).length / NEWS_SOURCES.length
  const checks = [
    {
      id: 'eventSample',
      label: 'Labeled event sample',
      passed: CLASSIFIER_FIXTURES.length >= 20,
      actual: CLASSIFIER_FIXTURES.length,
      requirement: '>= 20 labeled event fixtures',
    },
    {
      id: 'eventAccuracy',
      label: 'Event classification accuracy',
      passed: fixtureAccuracy >= 0.85,
      actual: fixtureAccuracy,
      requirement: '>= 85% on the labeled fixture set',
    },
    {
      id: 'newsDuplicates',
      label: 'Residual duplicate rate',
      passed: residualDuplicateRate <= 0.05,
      actual: residualDuplicateRate,
      requirement: '<= 5% after normalization',
    },
    {
      id: 'newsSources',
      label: 'News sources online',
      passed: sourceSuccessRate >= 0.67,
      actual: sourceSuccessRate,
      requirement: '>= 67% of configured sources',
    },
  ]

  return {
      generatedAt: new Date().toISOString(),
      articles,
      trends: { adds6, adds24, drops6, drops24 },
      sources: news.map(({ name, ok }) => ({ name, ok })),
      qa: {
        rawArticles: rawArticles.length,
        publishedArticles: articles.length,
        duplicatesRemoved: rawArticles.length - deduplicated.length,
        residualDuplicateRate,
        classifierFixtureAccuracy: fixtureAccuracy,
        classifierFixtureCount: CLASSIFIER_FIXTURES.length,
      },
      phaseGates: {
        'v2.0': {
          enabled: checks.every((check) => check.passed),
          advisoryOnly: true,
          checks,
        },
      },
  }
}

async function intelResponse(): Promise<Response> {
  return Response.json(await buildIntelFeed(), {
    headers: {
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function privateJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

async function preferencesResponse(request: Request, env: Env): Promise<Response> {
  const user = authenticatedUser(request)
  if (!user) return privateJson({ message: 'Authenticated site access required' }, 401)
  if (!env.DB) return privateJson({ message: 'Private storage is not configured' }, 503)
  try {
    await ensureUserSchema(env.DB)
    if (request.method === 'GET') {
      const leagueId = new URL(request.url).searchParams.get('leagueId')
      if (leagueId && !/^\d{8,24}$/.test(leagueId)) {
        return privateJson({ message: 'Invalid league ID' }, 400)
      }
      const preferences = leagueId
        ? await getLeaguePreference(env.DB, user.id, leagueId)
        : await listLeaguePreferences(env.DB, user.id)
      return privateJson({ user, preferences })
    }
    if (request.method === 'PUT') {
      const origin = request.headers.get('origin')
      if (origin && origin !== new URL(request.url).origin) {
        return privateJson({ message: 'Cross-origin writes are not allowed' }, 403)
      }
      let input: unknown
      try {
        input = await request.json()
      } catch {
        return privateJson({ message: 'Invalid JSON body' }, 400)
      }
      let preference
      try {
        preference = normalizePreferenceInput(input)
      } catch (error) {
        return privateJson({ message: error instanceof Error ? error.message : 'Invalid preferences' }, 400)
      }
      return privateJson({
        user,
        preferences: await saveLeaguePreference(env.DB, user.id, preference),
      })
    }
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, PUT' } })
  } catch {
    return privateJson({ message: 'Private storage is temporarily unavailable' }, 500)
  }
}

function validLeagueId(value: string | null): value is string {
  return Boolean(value && /^\d{8,24}$/.test(value))
}

function sameOriginWrite(request: Request): boolean {
  const origin = request.headers.get('origin')
  return !origin || origin === new URL(request.url).origin
}

async function journalResponse(request: Request, env: Env): Promise<Response> {
  const user = authenticatedUser(request)
  if (!user) return privateJson({ message: 'Authenticated site access required' }, 401)
  if (!env.DB) return privateJson({ message: 'Private storage is not configured' }, 503)
  const leagueId = new URL(request.url).searchParams.get('leagueId')
  if (!validLeagueId(leagueId)) return privateJson({ message: 'Invalid league ID' }, 400)
  try {
    if (request.method === 'GET') return privateJson(await readLeagueJournal(env.DB, leagueId))
    if (request.method === 'POST') {
      if (!sameOriginWrite(request)) return privateJson({ message: 'Cross-origin writes are not allowed' }, 403)
      const sync = await syncLeagueJournal(env.DB, leagueId)
      const journal = await readLeagueJournal(env.DB, leagueId)
      return privateJson({ ...journal, collectionComplete: sync.complete, newTradeCount: sync.newTradeCount })
    }
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } })
  } catch (error) {
    return privateJson({ message: error instanceof Error ? error.message : 'Journal sync failed' }, 500)
  }
}

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

async function refreshAlertEvents(db: D1Database): Promise<void> {
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

async function alertsResponse(request: Request, env: Env): Promise<Response> {
  const user = authenticatedUser(request)
  if (!user) return privateJson({ message: 'Authenticated site access required' }, 401)
  if (!env.DB) return privateJson({ message: 'Private storage is not configured' }, 503)
  const url = new URL(request.url)
  const leagueId = url.searchParams.get('leagueId')
  if (!validLeagueId(leagueId)) return privateJson({ message: 'Invalid league ID' }, 400)
  try {
    await ensureUserSchema(env.DB)
    await ensureAlertSchema(env.DB)
    await env.DB.prepare(CREATE_REFRESH_RUNS).run()
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
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } })
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

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/intel') {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
      return intelResponse()
    }
    if (url.pathname === '/api/preferences') {
      return preferencesResponse(request, env)
    }
    if (url.pathname === '/api/journal') {
      return journalResponse(request, env)
    }
    if (url.pathname === '/api/alerts') {
      return alertsResponse(request, env)
    }

    const response = await env.ASSETS.fetch(request)
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) return response

    const origin = new URL(request.url).origin
    const html = (await response.text()).replaceAll('__SITE_ORIGIN__', origin)
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  },
}

export default worker
