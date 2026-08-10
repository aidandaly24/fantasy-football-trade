interface AssetsBinding {
  fetch(request: Request): Promise<Response>
}

interface Env {
  ASSETS: AssetsBinding
}

type NewsArticle = {
  id: string
  title: string
  url: string
  source: string
  publishedAt: string
  reliability: number
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
      return {
        id: `${source.name.toLowerCase().replace(/\s+/g, '-')}-${index}-${title.slice(0, 28)}`,
        title,
        url,
        source: source.name,
        publishedAt: Number.isNaN(Date.parse(publishedAt)) ? new Date().toISOString() : new Date(publishedAt).toISOString(),
        reliability: source.reliability,
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

  const seen = new Set<string>()
  const articles = news
    .flatMap((result) => result.articles)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .filter((article) => {
      const key = article.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 60)

  return Response.json(
    {
      generatedAt: new Date().toISOString(),
      articles,
      trends: { adds6, adds24, drops6, drops24 },
      sources: news.map(({ name, ok }) => ({ name, ok })),
    },
    {
      headers: {
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  )
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/intel') {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
      return intelResponse()
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
