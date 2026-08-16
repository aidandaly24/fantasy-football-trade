import {
  SPORTSBOOK_SOURCE_URL,
  consensusForPlayer,
  eligibleSportsbookPlayers,
  normalizeSportsbookPlayerName,
  sportsbookMarketsForPosition,
  type SportsbookBundle,
  type SportsbookGameContext,
  type SportsbookLineObservation,
  type SportsbookMarketKey,
  type SportsbookPlayerRequest,
} from '../src/sportsbook'

const ODDS_BASE = 'https://api.the-odds-api.com/v4'
const CACHE_MS = 10 * 60 * 1000

const NFL_TEAM_NAMES: Record<string, string> = {
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills',
  CAR: 'Carolina Panthers', CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns',
  DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers',
  HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars', JAC: 'Jacksonville Jaguars',
  KC: 'Kansas City Chiefs', LV: 'Las Vegas Raiders', LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams',
  MIA: 'Miami Dolphins', MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints',
  NYG: 'New York Giants', NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers',
  SEA: 'Seattle Seahawks', SF: 'San Francisco 49ers', TB: 'Tampa Bay Buccaneers', TEN: 'Tennessee Titans',
  WAS: 'Washington Commanders',
}

type OddsOutcome = { name: string; description?: string; price: number; point?: number }
type OddsMarket = { key: string; last_update?: string; outcomes: OddsOutcome[] }
type OddsBookmaker = { key: string; last_update?: string; markets: OddsMarket[] }
type OddsEvent = { id: string; commence_time: string; home_team: string; away_team: string; bookmakers?: OddsBookmaker[] }
type UsageHeaders = { used: number | null; remaining: number | null; last: number | null }
type ProviderResult<T> = { data: T; usage: UsageHeaders }
type TimedPromise<T> = { expiresAt: number; value: Promise<T> }

let eventsCache: TimedPromise<ProviderResult<OddsEvent[]>> | null = null
let gameOddsCache: TimedPromise<ProviderResult<OddsEvent[]>> | null = null
const propCaches = new Map<string, TimedPromise<ProviderResult<OddsEvent>>>()

function numericHeader(headers: Headers, key: string): number | null {
  const raw = headers.get(key)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function resetSportsbookProviderCacheForTest(): void {
  eventsCache = null
  gameOddsCache = null
  propCaches.clear()
}

async function providerJson<T>(url: URL): Promise<ProviderResult<T>> {
  const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Odds provider request failed (${response.status})`)
  return {
    data: await response.json<T>(),
    usage: {
      used: numericHeader(response.headers, 'x-requests-used'),
      remaining: numericHeader(response.headers, 'x-requests-remaining'),
      last: numericHeader(response.headers, 'x-requests-last'),
    },
  }
}

function cached<T>(current: TimedPromise<T> | null, loader: () => Promise<T>): TimedPromise<T> {
  if (current && current.expiresAt > Date.now()) return current
  const entry: TimedPromise<T> = { expiresAt: Date.now() + CACHE_MS, value: loader() }
  void entry.value.catch(() => {
    entry.expiresAt = 0
  })
  return entry
}

function apiUrl(path: string, apiKey: string, params: Record<string, string> = {}): URL {
  const url = new URL(`${ODDS_BASE}${path}`)
  url.searchParams.set('apiKey', apiKey)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  return url
}

function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function teamName(abbreviation: string | null): string | null {
  return abbreviation ? NFL_TEAM_NAMES[abbreviation.toUpperCase()] ?? null : null
}

function eventForPlayer(events: OddsEvent[], player: SportsbookPlayerRequest): OddsEvent | null {
  const team = teamName(player.team)
  if (!team) return null
  const earliest = Date.now() - 6 * 60 * 60 * 1000
  return events
    .filter((event) => (event.home_team === team || event.away_team === team) && Date.parse(event.commence_time) >= earliest)
    .sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time))[0] ?? null
}

function gameContext(event: OddsEvent, gameOdds: OddsEvent | undefined, playerTeam: string | null): SportsbookGameContext {
  const fullTeamName = teamName(playerTeam)
  const totals: number[] = []
  const spreads: number[] = []
  const books = new Set<string>()
  gameOdds?.bookmakers?.forEach((bookmaker) => {
    bookmaker.markets.forEach((market) => {
      if (market.key === 'totals') {
        market.outcomes.forEach((outcome) => {
          if (Number.isFinite(outcome.point)) totals.push(Number(outcome.point))
        })
        books.add(bookmaker.key)
      }
      if (market.key === 'spreads') {
        market.outcomes.forEach((outcome) => {
          if (outcome.name === fullTeamName && Number.isFinite(outcome.point)) spreads.push(Number(outcome.point))
        })
        books.add(bookmaker.key)
      }
    })
  })
  const total = median(totals)
  const teamSpread = median(spreads)
  return {
    eventId: event.id,
    awayTeam: event.away_team,
    homeTeam: event.home_team,
    commenceTime: event.commence_time,
    total,
    teamSpread,
    impliedTeamTotal: total === null || teamSpread === null ? null : total / 2 - teamSpread / 2,
    bookmakerCount: books.size,
  }
}

function observationsFromEvent(event: OddsEvent): SportsbookLineObservation[] {
  return (event.bookmakers ?? []).flatMap((bookmaker) => bookmaker.markets.flatMap((market) => {
    if (!market.key.startsWith('player_')) return []
    return market.outcomes.flatMap((outcome) => {
      if (!outcome.description || !Number.isFinite(outcome.price)) return []
      return [{
        bookmaker: bookmaker.key,
        market: market.key as SportsbookMarketKey,
        participant: outcome.description,
        outcome: outcome.name,
        price: outcome.price,
        point: Number.isFinite(outcome.point) ? Number(outcome.point) : null,
        updatedAt: market.last_update ?? bookmaker.last_update ?? null,
      } satisfies SportsbookLineObservation]
    })
  }))
}

function combineUsage(results: UsageHeaders[], eventRequests: number): SportsbookBundle['usage'] {
  const latestWithUsed = [...results].reverse().find((usage) => usage.used !== null)
  const latestWithRemaining = [...results].reverse().find((usage) => usage.remaining !== null)
  return {
    requestsUsed: latestWithUsed?.used ?? null,
    requestsRemaining: latestWithRemaining?.remaining ?? null,
    lastRequestCost: results.reduce((sum, usage) => sum + (usage.last ?? 0), 0) || null,
    eventRequests,
  }
}

export async function fetchSportsbookBundle(
  rawPlayers: SportsbookPlayerRequest[],
  apiKey: string | undefined,
): Promise<SportsbookBundle> {
  const generatedAt = new Date().toISOString()
  const base = {
    provider: 'The Odds API' as const,
    sourceUrl: SPORTSBOOK_SOURCE_URL,
    generatedAt,
    cacheSeconds: CACHE_MS / 1000,
    model: {
      stage: 'shadow' as const,
      enabled: false as const,
      target: 'Incremental weekly PPR accuracy over the existing production model',
      reason: 'Sportsbook features have not passed a chronological held-out challenger.',
    },
  }
  if (!apiKey) {
    return {
      ...base,
      status: 'needs-key',
      players: [],
      usage: { requestsUsed: null, requestsRemaining: null, lastRequestCost: null, eventRequests: 0 },
      warnings: ['The private ODDS_API_KEY site secret is not configured.'],
    }
  }

  const players = eligibleSportsbookPlayers(rawPlayers).slice(0, 12)
  if (!players.length) {
    return {
      ...base,
      status: 'unavailable',
      players: [],
      usage: { requestsUsed: null, requestsRemaining: null, lastRequestCost: null, eventRequests: 0 },
      warnings: ['No supported rostered QB, RB, WR, or TE was requested.'],
    }
  }

  eventsCache = cached(eventsCache, () => providerJson<OddsEvent[]>(apiUrl('/sports/americanfootball_nfl/events', apiKey)))
  gameOddsCache = cached(gameOddsCache, () => providerJson<OddsEvent[]>(apiUrl('/sports/americanfootball_nfl/odds', apiKey, {
    regions: 'us', markets: 'spreads,totals', oddsFormat: 'american', dateFormat: 'iso',
  })))
  const [eventsResult, gameOddsResult] = await Promise.all([eventsCache.value, gameOddsCache.value])
  if (!eventsResult.data.length) {
    return {
      ...base,
      status: 'offseason',
      players: players.map((player) => ({
        playerId: player.id, playerName: player.name, team: player.team, position: player.position,
        status: 'no-event' as const, game: null, markets: [], note: 'No current NFL event is available.',
      })),
      usage: combineUsage([eventsResult.usage, gameOddsResult.usage], 0),
      warnings: ['No current NFL slate is available from the provider.'],
    }
  }

  const playerEvents = new Map(players.map((player) => [player.id, eventForPlayer(eventsResult.data, player)]))
  const eventPlayers = new Map<string, SportsbookPlayerRequest[]>()
  players.forEach((player) => {
    const event = playerEvents.get(player.id)
    if (event) eventPlayers.set(event.id, [...(eventPlayers.get(event.id) ?? []), player])
  })

  const propResults = new Map<string, ProviderResult<OddsEvent>>()
  await Promise.all([...eventPlayers.entries()].map(async ([eventId, requested]) => {
    const markets = [...new Set(requested.flatMap((player) => sportsbookMarketsForPosition(player.position)))].sort()
    const cacheKey = `${eventId}:${markets.join(',')}`
    const current = propCaches.get(cacheKey) ?? null
    const entry = cached(current, () => providerJson<OddsEvent>(apiUrl(`/sports/americanfootball_nfl/events/${eventId}/odds`, apiKey, {
      regions: 'us', markets: markets.join(','), oddsFormat: 'american', dateFormat: 'iso',
    })))
    propCaches.set(cacheKey, entry)
    propResults.set(eventId, await entry.value)
  }))

  const snapshots = players.map((player) => {
    const event = playerEvents.get(player.id)
    if (!event) return {
      playerId: player.id, playerName: player.name, team: player.team, position: player.position,
      status: 'no-event' as const, game: null, markets: [], note: 'No upcoming event matched the Sleeper team.',
    }
    const propEvent = propResults.get(event.id)?.data
    const observations = propEvent ? observationsFromEvent(propEvent) : []
    const normalized = normalizeSportsbookPlayerName(player.name)
    const providerNames = [...new Set(observations.map((observation) => observation.participant)
      .filter((name) => normalizeSportsbookPlayerName(name) === normalized))]
    const markets = consensusForPlayer(player.name, observations)
    const gameOdds = gameOddsResult.data.find((candidate) => candidate.id === event.id)
    if (providerNames.length > 1) return {
      playerId: player.id, playerName: player.name, team: player.team, position: player.position,
      status: 'ambiguous-name' as const, game: gameContext(event, gameOdds, player.team), markets: [],
      note: 'Multiple provider participants matched after suffix normalization; no props were assigned.',
    }
    return {
      playerId: player.id, playerName: player.name, team: player.team, position: player.position,
      status: markets.length ? 'covered' as const : 'no-props' as const,
      game: gameContext(event, gameOdds, player.team),
      markets,
      note: markets.length
        ? 'Consensus summarizes the current lines; it is not a validated fantasy projection.'
        : 'The event matched, but no exact-name props are currently posted.',
    }
  })
  const usage = combineUsage(
    [eventsResult.usage, gameOddsResult.usage, ...[...propResults.values()].map((result) => result.usage)],
    propResults.size,
  )
  const covered = snapshots.filter((snapshot) => snapshot.status === 'covered').length
  return {
    ...base,
    status: covered === snapshots.length ? 'ready' : covered > 0 ? 'partial' : 'unavailable',
    players: snapshots,
    usage,
    warnings: [
      'Lines are volatile and may be delayed or incorrect; verify before using them as factual market context.',
      ...(covered < snapshots.length ? [`${snapshots.length - covered} requested players do not have matched props.`] : []),
    ],
  }
}
