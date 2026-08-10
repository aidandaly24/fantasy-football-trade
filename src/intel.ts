import type { IntelFeed, IntelSignal, NewsArticle, Team, TradyrPlayer } from './types'

const POSITIVE_WORDS = [
  'activated',
  'cleared',
  'extension',
  'first team',
  'full participant',
  'healthy',
  'impresses',
  'named starter',
  'promoted',
  'returns',
  'returns to practice',
  'sharp',
  'starter',
  'starting',
]

const NEGATIVE_WORDS = [
  'arrested',
  'demoted',
  'expected to miss',
  'injured',
  'injury',
  'limited',
  'placed on ir',
  'questionable',
  'released',
  'ruled out',
  'setback',
  'surgery',
  'suspended',
  'torn',
]

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function headlineScore(title: string): number {
  const normalized = ` ${normalize(title)} `
  const positive = POSITIVE_WORDS.filter((word) => normalized.includes(` ${word} `)).length
  const negative = NEGATIVE_WORDS.filter((word) => normalized.includes(` ${word} `)).length
  return positive - negative
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function matchArticlePlayers(
  article: NewsArticle,
  players: TradyrPlayer[],
): TradyrPlayer[] {
  const title = ` ${normalize(article.title)} `
  const lastNameCounts = new Map<string, number>()

  players.forEach((player) => {
    const parts = normalize(player.name).split(' ')
    const last = parts.at(-1) ?? ''
    if (last.length >= 5) lastNameCounts.set(last, (lastNameCounts.get(last) ?? 0) + 1)
  })

  return players.filter((player) => {
    const fullName = normalize(player.name)
    if (fullName && title.includes(` ${fullName} `)) return true
    const lastName = fullName.split(' ').at(-1) ?? ''
    if (lastName.length < 5 || lastNameCounts.get(lastName) !== 1 || !title.includes(` ${lastName} `)) {
      return false
    }
    const displayLastName = player.name.split(/\s+/).at(-1) ?? ''
    const differentFullName = new RegExp(`\\b[A-Z][A-Za-z'’-]+\\s+${escapeRegex(displayLastName)}\\b`).test(article.title)
    return !differentFullName
  })
}

function trendMap(items: IntelFeed['trends']['adds24']): Map<string, number> {
  return new Map(items.map((item) => [item.playerId, item.count]))
}

function ownerMap(teams: Team[]): Map<string, Team> {
  const owners = new Map<string, Team>()
  teams.forEach((team) => {
    team.players.forEach((asset) => owners.set(asset.id.replace(/^player-/, ''), team))
  })
  return owners
}

function actionFor(
  direction: IntelSignal['direction'],
  ownerTeam: Team | null,
  isMine: boolean,
  edgeScore: number,
  marketReactionScore: number,
) {
  if (edgeScore < 35) {
    return ownerTeam ? 'Monitor; no urgent edge' : 'No rush—verify first'
  }
  if (direction === 'up') {
    if (!ownerTeam) return 'Add before waivers move'
    if (isMine) return 'Hold the information edge'
    if (marketReactionScore >= 65 && edgeScore < 50) return 'Verify the price before chasing'
    return 'Quietly inquire'
  }
  if (direction === 'down') {
    if (!ownerTeam) return 'Leave on the wire'
    if (isMine) return 'Protect the downside'
    return 'Buy only at a discount'
  }
  return ownerTeam ? 'Put on the watchlist' : 'Investigate before adding'
}

function rationaleFor(options: {
  direction: IntelSignal['direction']
  articles: NewsArticle[]
  add24: number
  drop24: number
  acceleration: number
  impactScore: number
  marketReactionScore: number
}) {
  const { direction, articles, add24, drop24, acceleration, impactScore, marketReactionScore } = options
  if (articles.length && direction === 'up') {
    return `${articles.length} linked report${articles.length === 1 ? '' : 's'} point up. Impact is ${impactScore}/100; Sleeper reaction is ${marketReactionScore}/100.`
  }
  if (articles.length && direction === 'down') {
    return `${articles.length} linked report${articles.length === 1 ? '' : 's'} flag downside. Impact is ${impactScore}/100; Sleeper reaction is ${marketReactionScore}/100.`
  }
  if (acceleration >= 1.5 && add24 > drop24) {
    return `Add pace is ${acceleration.toFixed(1)}× its 24-hour baseline, a useful early-interest flag.`
  }
  if (drop24 > add24) return `Sleeper managers logged ${drop24} drops versus ${add24} adds in the last 24 hours.`
  return `Market activity is moving, but the available evidence is not yet directional.`
}

export function buildIntelSignals(
  feed: IntelFeed,
  players: TradyrPlayer[],
  teams: Team[],
  myRosterId: number,
): IntelSignal[] {
  const articlesByPlayer = new Map<string, NewsArticle[]>()
  feed.articles.forEach((article) => {
    matchArticlePlayers(article, players).forEach((player) => {
      const id = player.sleeperId
      if (!id) return
      articlesByPlayer.set(id, [...(articlesByPlayer.get(id) ?? []), article])
    })
  })

  const adds6 = trendMap(feed.trends.adds6)
  const adds24 = trendMap(feed.trends.adds24)
  const drops6 = trendMap(feed.trends.drops6)
  const drops24 = trendMap(feed.trends.drops24)
  const owners = ownerMap(teams)
  const generatedAt = Number.isNaN(Date.parse(feed.generatedAt)) ? Date.now() : Date.parse(feed.generatedAt)

  return players
    .filter((player) => player.sleeperId)
    .map((player): IntelSignal | null => {
      const id = player.sleeperId!
      const articles = articlesByPlayer.get(id) ?? []
      const add6 = adds6.get(id) ?? 0
      const add24 = adds24.get(id) ?? 0
      const drop6 = drops6.get(id) ?? 0
      const drop24 = drops24.get(id) ?? 0
      if (!articles.length && add24 === 0 && drop24 === 0) return null

      const newsScore = articles.reduce(
        (sum, article) => sum + headlineScore(article.title) * article.reliability,
        0,
      )
      const trendDelta = add24 - drop24
      const acceleration = add6 / Math.max(add24 / 4, 1)
      const dropAcceleration = drop6 / Math.max(drop24 / 4, 1)
      const directionScore = newsScore * 3 + Math.sign(trendDelta) + Math.sign(acceleration - dropAcceleration)
      const direction: IntelSignal['direction'] =
        directionScore >= 2 ? 'up' : directionScore <= -2 ? 'down' : 'watch'
      const activity = Math.log10(add24 + drop24 + 1) * 24
      const velocity = Math.max(0, Math.max(acceleration, dropAcceleration) - 1) * 12
      const marketReactionScore = Math.round(Math.min(99, activity + Math.min(32, velocity)))
      const impactScore = Math.round(Math.min(
        99,
        articles.length
          ? 28 + Math.abs(newsScore) * 20 + articles.length * 7
          : 15 + activity * 0.75,
      ))
      const newestArticle = articles.reduce(
        (newest, article) => Math.max(newest, Date.parse(article.publishedAt) || 0),
        0,
      )
      const articleAgeHours = newestArticle ? Math.max(0, generatedAt - newestArticle) / 3_600_000 : 168
      const freshnessScore = Math.round(articles.length ? Math.max(8, 100 * (0.5 ** (articleAgeHours / 48))) : 12)
      const averageReliability = articles.length
        ? articles.reduce((sum, article) => sum + article.reliability, 0) / articles.length
        : 0.4
      const agreement = articles.length > 1 && Math.abs(newsScore) >= articles.length * 0.7 ? 8 : 0
      const confidence = Math.round(Math.min(
        95,
        averageReliability * 70 + Math.min(18, articles.length * 7) + agreement + Math.min(8, activity * 0.15),
      ))
      const edgeScore = Math.round(Math.max(
        0,
        Math.min(99, impactScore * 0.42 + confidence * 0.32 + freshnessScore * 0.26 - marketReactionScore * 0.45),
      ))
      const ownerTeam = owners.get(id) ?? null
      const isMine = ownerTeam?.rosterId === myRosterId

      return {
        player,
        articles,
        direction,
        impactScore,
        edgeScore,
        confidence,
        marketReactionScore,
        freshnessScore,
        action: actionFor(direction, ownerTeam, isMine, edgeScore, marketReactionScore),
        rationale: rationaleFor({ direction, articles, add24, drop24, acceleration, impactScore, marketReactionScore }),
        add24,
        drop24,
        acceleration,
        ownerTeam,
        isMine,
      }
    })
    .filter((signal): signal is IntelSignal => signal !== null)
    .sort((a, b) => b.edgeScore - a.edgeScore || b.confidence - a.confidence)
}

export function timeAgo(value: string, now = Date.now()): string {
  const elapsed = Math.max(0, now - Date.parse(value))
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
