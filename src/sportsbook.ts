import type { Asset } from './types'

export const SPORTSBOOK_SOURCE_URL = 'https://the-odds-api.com/'

export const SPORTSBOOK_MARKETS = {
  player_pass_yds: { label: 'Pass yards', unit: 'yards' },
  player_pass_tds: { label: 'Pass TDs', unit: 'touchdowns' },
  player_pass_interceptions: { label: 'Interceptions', unit: 'interceptions' },
  player_rush_yds: { label: 'Rush yards', unit: 'yards' },
  player_rush_attempts: { label: 'Rush attempts', unit: 'attempts' },
  player_receptions: { label: 'Receptions', unit: 'receptions' },
  player_reception_yds: { label: 'Receiving yards', unit: 'yards' },
  player_anytime_td: { label: 'Anytime TD', unit: 'probability' },
} as const

export type SportsbookMarketKey = keyof typeof SPORTSBOOK_MARKETS

export type SportsbookPlayerRequest = Pick<Asset, 'id' | 'name' | 'team' | 'position' | 'kind'>

export type SportsbookLineObservation = {
  bookmaker: string
  market: SportsbookMarketKey
  participant: string
  outcome: string
  price: number
  point: number | null
  updatedAt: string | null
}

export type SportsbookMarketConsensus = {
  market: SportsbookMarketKey
  label: string
  unit: string
  line: number | null
  lineLow: number | null
  lineHigh: number | null
  overProbability: number | null
  yesProbability: number | null
  probabilityIncludesVig: boolean
  bookmakerCount: number
  observedAt: string | null
}

export type SportsbookGameContext = {
  eventId: string
  awayTeam: string
  homeTeam: string
  commenceTime: string
  total: number | null
  teamSpread: number | null
  impliedTeamTotal: number | null
  bookmakerCount: number
}

export type SportsbookPlayerSnapshot = {
  playerId: string
  playerName: string
  team: string | null
  position: SportsbookPlayerRequest['position']
  status: 'covered' | 'no-event' | 'no-props' | 'ambiguous-name'
  game: SportsbookGameContext | null
  markets: SportsbookMarketConsensus[]
  note: string
}

export type SportsbookUsage = {
  requestsUsed: number | null
  requestsRemaining: number | null
  lastRequestCost: number | null
  eventRequests: number
}

export type SportsbookBundle = {
  status: 'ready' | 'partial' | 'needs-key' | 'offseason' | 'unavailable'
  provider: 'The Odds API'
  sourceUrl: string
  generatedAt: string
  cacheSeconds: number
  model: {
    stage: 'shadow'
    enabled: false
    target: string
    reason: string
  }
  players: SportsbookPlayerSnapshot[]
  usage: SportsbookUsage
  warnings: string[]
}

export type SportsbookModelGate = {
  id: string
  label: string
  requirement: string
  passed: boolean
  actual: number | string | null
}

export type SportsbookModelHealth = {
  version: string
  generatedAt: string
  status: 'needs-data' | 'shadow' | 'validated'
  enabled: boolean
  target: string
  rows: number
  trainRows: number
  testRows: number
  seasons: number[]
  anchors: string[]
  metrics: {
    baselineMae: number | null
    sportsbookOnlyMae: number | null
    combinedMae: number | null
    combinedLift: number | null
  }
  gates: SportsbookModelGate[]
  notes: string[]
}

export function normalizeSportsbookPlayerName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
}

export function americanOddsToProbability(price: number): number | null {
  if (!Number.isFinite(price) || price === 0) return null
  return price < 0 ? Math.abs(price) / (Math.abs(price) + 100) : 100 / (price + 100)
}

export function removeTwoWayVig(first: number, second: number): [number, number] | null {
  const firstProbability = americanOddsToProbability(first)
  const secondProbability = americanOddsToProbability(second)
  if (firstProbability === null || secondProbability === null) return null
  const total = firstProbability + secondProbability
  if (total <= 0) return null
  return [firstProbability / total, secondProbability / total]
}

function median(values: number[]): number | null {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!finite.length) return null
  const middle = Math.floor(finite.length / 2)
  return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2
}

function latestTimestamp(values: Array<string | null>): string | null {
  return values
    .filter((value): value is string => Boolean(value && Number.isFinite(Date.parse(value))))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null
}

export function buildSportsbookConsensus(
  market: SportsbookMarketKey,
  observations: SportsbookLineObservation[],
): SportsbookMarketConsensus | null {
  const relevant = observations.filter((observation) => observation.market === market)
  if (!relevant.length) return null

  const bookmakerCount = new Set(relevant.map((observation) => observation.bookmaker)).size
  const points = relevant.flatMap((observation) => observation.point === null ? [] : [observation.point])
  const grouped = new Map<string, SportsbookLineObservation[]>()
  relevant.forEach((observation) => {
    const key = `${observation.bookmaker}:${observation.point ?? 'none'}`
    grouped.set(key, [...(grouped.get(key) ?? []), observation])
  })

  const overProbabilities: number[] = []
  const yesProbabilities: number[] = []
  let probabilityIncludesVig = false
  grouped.forEach((rows) => {
    const over = rows.find((row) => row.outcome.toLowerCase() === 'over')
    const under = rows.find((row) => row.outcome.toLowerCase() === 'under')
    if (over && under) {
      const noVig = removeTwoWayVig(over.price, under.price)
      if (noVig) overProbabilities.push(noVig[0])
    }
    const yes = rows.find((row) => ['yes', 'over'].includes(row.outcome.toLowerCase()))
    const no = rows.find((row) => ['no', 'under'].includes(row.outcome.toLowerCase()))
    if (yes && no) {
      const noVig = removeTwoWayVig(yes.price, no.price)
      if (noVig) yesProbabilities.push(noVig[0])
    } else if (yes && market === 'player_anytime_td') {
      const raw = americanOddsToProbability(yes.price)
      if (raw !== null) {
        yesProbabilities.push(raw)
        probabilityIncludesVig = true
      }
    }
  })

  const meta = SPORTSBOOK_MARKETS[market]
  return {
    market,
    label: meta.label,
    unit: meta.unit,
    line: median(points),
    lineLow: points.length ? Math.min(...points) : null,
    lineHigh: points.length ? Math.max(...points) : null,
    overProbability: median(overProbabilities),
    yesProbability: median(yesProbabilities),
    probabilityIncludesVig,
    bookmakerCount,
    observedAt: latestTimestamp(relevant.map((observation) => observation.updatedAt)),
  }
}

export function consensusForPlayer(
  playerName: string,
  observations: SportsbookLineObservation[],
): SportsbookMarketConsensus[] {
  const normalized = normalizeSportsbookPlayerName(playerName)
  const matching = observations.filter(
    (observation) => normalizeSportsbookPlayerName(observation.participant) === normalized,
  )
  return (Object.keys(SPORTSBOOK_MARKETS) as SportsbookMarketKey[])
    .flatMap((market) => {
      const consensus = buildSportsbookConsensus(market, matching)
      return consensus ? [consensus] : []
    })
}

export function sportsbookMarketsForPosition(position: SportsbookPlayerRequest['position']): SportsbookMarketKey[] {
  if (position === 'QB') return ['player_pass_yds', 'player_pass_tds', 'player_pass_interceptions', 'player_rush_yds']
  if (position === 'RB') return ['player_rush_yds', 'player_rush_attempts', 'player_receptions', 'player_reception_yds', 'player_anytime_td']
  if (position === 'WR' || position === 'TE') return ['player_receptions', 'player_reception_yds', 'player_anytime_td']
  return []
}

export function eligibleSportsbookPlayers(players: SportsbookPlayerRequest[]): SportsbookPlayerRequest[] {
  const seen = new Set<string>()
  return players.filter((player) => {
    if (player.kind === 'pick' || !player.team || !sportsbookMarketsForPosition(player.position).length || seen.has(player.id)) return false
    seen.add(player.id)
    return true
  })
}
