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

async function intelResponse(): Promise<Response> {
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

  return Response.json(
    {
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
    },
    {
      headers: {
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  )
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
