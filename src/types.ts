export type League = {
  league_id: string
  name: string
  season: string
  status: string
  total_rosters: number
  draft_id: string | null
  avatar: string | null
  roster_positions: string[]
  scoring_settings: Record<string, number>
  settings: {
    num_teams: number
    draft_rounds: number
    taxi_slots?: number
    reserve_slots?: number
  }
}

export type SleeperRoster = {
  roster_id: number
  owner_id: string | null
  players: string[] | null
  starters: string[] | null
  reserve: string[] | null
  taxi: string[] | null
}

export type LeagueUser = {
  user_id: string
  display_name: string
  avatar: string | null
  metadata?: {
    team_name?: string
    avatar?: string
  } | null
}

export type TradedPick = {
  season: string
  round: number
  roster_id: number
  owner_id: number
  previous_owner_id: number
}

export type SleeperDraft = {
  draft_id: string
  season: string
  status: string
  draft_order: Record<string, number> | null
  slot_to_roster_id: Record<string, number> | null
}

export type SleeperPlayer = {
  player_id: string
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
  position?: string | null
  fantasy_positions?: string[] | null
  team?: string | null
  age?: number | null
}

export type TradyrPlayer = {
  slug: string
  name: string
  position: 'QB' | 'RB' | 'WR' | 'TE'
  team: string | null
  age: number | null
  composite: number
  confidence: number
  rank: number
  posRank: number
  sources: {
    ktc: number | null
    fantasycalc: number | null
  }
  sleeperId: string | null
}

export type PickValue = {
  id: string
  name: string
  round: number
  slot: number
  year: string
  tier: 'early' | 'mid' | 'late'
  composite: number
  position: 'PICK'
}

export type PickTier = 'early' | 'mid' | 'late'

export type PickProjection = {
  tier: PickTier
  probabilities: Record<PickTier, number>
  contenderRank: number
}

export type ApiMeta = {
  generatedAt: string
  sources: string[]
  attribution: string
}

export type Asset = {
  id: string
  name: string
  shortName?: string
  kind: 'player' | 'pick'
  position: 'QB' | 'RB' | 'WR' | 'TE' | 'PICK' | 'K' | 'DEF' | 'NA'
  team: string | null
  value: number
  confidence: number
  age: number | null
  rank: number | null
  sourceValue?: number | null
  originalRosterId?: number
  ownerRosterId?: number
  year?: string
  round?: number
  slot?: number
  projectedTier?: PickTier | 'known'
  tierProbabilities?: Record<PickTier, number>
  valueLow?: number
  valueHigh?: number
  projectionConfidence?: number
  isStarter?: boolean
  isTaxi?: boolean
  isReserve?: boolean
}

export type TeamMetrics = {
  lineupRaw: number
  coreRaw: number
  depthRaw: number
  picksRaw: number
  liquidityRaw: number
  marketRaw: number
  lineup: number
  core: number
  depth: number
  picks: number
  liquidity: number
  market: number
  overall: number
  contender: number
  future: number
}

export type Team = {
  rosterId: number
  ownerId: string | null
  ownerName: string
  teamName: string
  avatar: string | null
  players: Asset[]
  picks: Asset[]
  optimizedStarters: Asset[]
  metrics: TeamMetrics
}

export type LeagueBundle = {
  league: League
  rosters: SleeperRoster[]
  users: LeagueUser[]
  tradedPicks: TradedPick[]
  draft: SleeperDraft | null
}

export type ValueBundle = {
  players: TradyrPlayer[]
  picks: PickValue[]
  meta: ApiMeta
}

export type RankingMode = 'overall' | 'contender' | 'future'

export type NewsArticle = {
  id: string
  title: string
  url: string
  source: string
  publishedAt: string
  reliability: number
}

export type TrendItem = {
  playerId: string
  count: number
}

export type IntelFeed = {
  generatedAt: string
  articles: NewsArticle[]
  trends: {
    adds6: TrendItem[]
    adds24: TrendItem[]
    drops6: TrendItem[]
    drops24: TrendItem[]
  }
  sources: Array<{
    name: string
    ok: boolean
  }>
}

export type IntelSignal = {
  player: TradyrPlayer
  articles: NewsArticle[]
  direction: 'up' | 'down' | 'watch'
  impactScore: number
  edgeScore: number
  confidence: number
  marketReactionScore: number
  freshnessScore: number
  action: string
  rationale: string
  add24: number
  drop24: number
  acceleration: number
  ownerTeam: Team | null
  isMine: boolean
}
