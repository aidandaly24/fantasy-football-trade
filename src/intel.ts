import type { IntelFeed, IntelSignal, NewsArticle, Team, TradyrPlayer } from './types'

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Conservative name matching: exact full names, or a unique last name when the
 * headline does not name a different person with that surname. */
export function matchArticlePlayers(article: NewsArticle, players: TradyrPlayer[]): TradyrPlayer[] {
  const title = ` ${normalize(article.title)} `
  const lastNameCounts = new Map<string, number>()
  players.forEach((player) => {
    const last = normalize(player.name).split(' ').at(-1) ?? ''
    if (last.length >= 5) lastNameCounts.set(last, (lastNameCounts.get(last) ?? 0) + 1)
  })

  return players.filter((player) => {
    const fullName = normalize(player.name)
    if (fullName && title.includes(` ${fullName} `)) return true
    const lastName = fullName.split(' ').at(-1) ?? ''
    if (lastName.length < 5 || lastNameCounts.get(lastName) !== 1 || !title.includes(` ${lastName} `)) return false
    const displayLastName = player.name.split(/\s+/).at(-1) ?? ''
    return !new RegExp(`\\b[A-Z][A-Za-z'’-]+\\s+${escapeRegex(displayLastName)}\\b`).test(article.title)
  })
}

function trendMap(items: IntelFeed['trends']['adds24']): Map<string, number> {
  return new Map(items.map((item) => [item.playerId, item.count]))
}

function ownerMap(teams: Team[]): Map<string, Team> {
  const owners = new Map<string, Team>()
  teams.forEach((team) => team.players.forEach((asset) => owners.set(asset.id.replace(/^player-/, ''), team)))
  return owners
}

/** Joins factual articles and Sleeper trend counts to players. Legacy score fields
 * are zeroed because the news-to-value and news-to-action models have not passed
 * historical validation. */
export function buildIntelSignals(
  feed: IntelFeed,
  players: TradyrPlayer[],
  teams: Team[],
  myRosterId: number,
): IntelSignal[] {
  const articlesByPlayer = new Map<string, NewsArticle[]>()
  feed.articles.forEach((article) => {
    if (article.expiresAt && Date.parse(article.expiresAt) < Date.parse(feed.generatedAt)) return
    matchArticlePlayers(article, players).forEach((player) => {
      if (!player.sleeperId) return
      articlesByPlayer.set(player.sleeperId, [...(articlesByPlayer.get(player.sleeperId) ?? []), article])
    })
  })
  const adds24 = trendMap(feed.trends.adds24)
  const drops24 = trendMap(feed.trends.drops24)
  const owners = ownerMap(teams)

  return players
    .filter((player) => player.sleeperId)
    .flatMap((player): IntelSignal[] => {
      const id = player.sleeperId!
      const articles = (articlesByPlayer.get(id) ?? [])
        .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
      const add24 = adds24.get(id) ?? 0
      const drop24 = drops24.get(id) ?? 0
      if (!articles.length && add24 === 0 && drop24 === 0) return []
      const ownerTeam = owners.get(id) ?? null
      return [{
        player,
        articles,
        direction: 'watch',
        impactScore: 0,
        edgeScore: 0,
        confidence: 0,
        marketReactionScore: 0,
        freshnessScore: 0,
        action: 'Watch only',
        rationale: `${articles.length} linked current report${articles.length === 1 ? '' : 's'}; ${add24} adds and ${drop24} drops in Sleeper's 24-hour trend feed.`,
        add24,
        drop24,
        acceleration: 0,
        ownerTeam,
        isMine: ownerTeam?.rosterId === myRosterId,
      }]
    })
    .sort((a, b) => {
      const newest = (signal: IntelSignal) => Math.max(0, ...signal.articles.map((article) => Date.parse(article.publishedAt)))
      return newest(b) - newest(a) || a.player.name.localeCompare(b.player.name)
    })
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
