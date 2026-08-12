import type {
  ApiMeta,
  EventModelHealthBundle,
  EdgeStateBundle,
  AlertInbox,
  IntelFeed,
  JournalBundle,
  League,
  LeagueBundle,
  LeaguePreferences,
  LeagueUser,
  ModelHealthBundle,
  MarketTapeRequest,
  PickValue,
  ProjectionBundle,
  SleeperDraft,
  SleeperPlayer,
  SleeperRoster,
  TradyrPlayer,
  TradedPick,
  UserState,
  ValueBundle,
} from './types'
import type { ResearchPipelineBundle } from './research'
import type { RookieBoardBundle } from './rookies'
import type { TradeModelHealthBundle } from './trade-models'

const SLEEPER_BASE = 'https://api.sleeper.app/v1'
const TRADYR_BASE = 'https://api.tradyr.app/v1'
let sleeperPlayerCatalog: Promise<Record<string, SleeperPlayer>> | null = null
let projectionRequest: Promise<ProjectionBundle | null> | null = null
const valueRequests = new Map<string, Promise<ValueBundle>>()
let modelHealthRequest: Promise<ModelHealthBundle | null> | null = null
let eventModelHealthRequest: Promise<EventModelHealthBundle | null> | null = null
let rookieBoardRequest: Promise<RookieBoardBundle> | null = null
let intelRequest: Promise<IntelFeed> | null = null
let intelCachedAt = 0
const journalRequests = new Map<string, Promise<JournalBundle>>()
const edgeStateRequests = new Map<string, Promise<EdgeStateBundle>>()
const researchStateRequests = new Map<string, Promise<ResearchPipelineBundle>>()

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const body = (await response.json()) as { message?: string }
      if (body.message) message = body.message
    } catch {
      // Keep the status-based message when the response is not JSON.
    }
    throw new Error(message)
  }
  return (await response.json()) as T
}

export async function fetchLeagueBundle(leagueId: string): Promise<LeagueBundle> {
  const league = await fetchJson<League>(`${SLEEPER_BASE}/league/${leagueId}`)

  const [rosters, users, tradedPicks, draft] = await Promise.all([
    fetchJson<SleeperRoster[]>(`${SLEEPER_BASE}/league/${leagueId}/rosters`),
    fetchJson<LeagueUser[]>(`${SLEEPER_BASE}/league/${leagueId}/users`),
    fetchJson<TradedPick[]>(`${SLEEPER_BASE}/league/${leagueId}/traded_picks`),
    league.draft_id
      ? fetchJson<SleeperDraft>(`${SLEEPER_BASE}/draft/${league.draft_id}`).catch(() => null)
      : Promise.resolve(null),
  ])

  return { league, rosters, users, tradedPicks, draft }
}

type TradyrResponse<T> = { data: T; meta: ApiMeta }

export async function fetchValues(options: {
  numQbs: 1 | 2
  tep: boolean
  numTeams: number
}): Promise<ValueBundle> {
  const cacheKey = `${options.numQbs}:${options.tep}:${options.numTeams}`
  const existing = valueRequests.get(cacheKey)
  if (existing) return existing
  const params = new URLSearchParams({
    format: 'dynasty',
    numQbs: String(options.numQbs),
    tep: String(options.tep),
    limit: '1000',
  })
  const pickParams = new URLSearchParams({
    numQbs: String(options.numQbs),
    numTeams: String(options.numTeams),
  })

  const request = Promise.all([
    fetchJson<TradyrResponse<TradyrPlayer[]>>(`${TRADYR_BASE}/players?${params}`),
    fetchJson<TradyrResponse<PickValue[]>>(`${TRADYR_BASE}/picks?${pickParams}`),
  ]).then(([players, picks]) => ({ players: players.data, picks: picks.data, meta: players.meta }))
    .catch((error) => {
      valueRequests.delete(cacheKey)
      throw error
    })
  valueRequests.set(cacheKey, request)
  return request
}

export async function fetchProjections(): Promise<ProjectionBundle | null> {
  projectionRequest ??= fetchJson<ProjectionBundle>('/data/player-projections.json')
    .then((bundle) => bundle.enabled ? bundle : null)
    .catch(() => null)
  return projectionRequest
}

export async function fetchModelHealth(): Promise<ModelHealthBundle | null> {
  modelHealthRequest ??= fetchJson<ModelHealthBundle>('/data/model-health.json').catch(() => null)
  return modelHealthRequest
}

export async function fetchEventModelHealth(): Promise<EventModelHealthBundle | null> {
  eventModelHealthRequest ??= fetchJson<EventModelHealthBundle>('/data/event-model-health.json').catch(() => null)
  return eventModelHealthRequest
}

export async function fetchTradeModelHealth(): Promise<TradeModelHealthBundle | null> {
  try {
    return await fetchJson<TradeModelHealthBundle>('/data/trade-model-health.json')
  } catch {
    return null
  }
}

export async function fetchRookieBoard(): Promise<RookieBoardBundle> {
  rookieBoardRequest ??= fetchJson<RookieBoardBundle>('/api/rookies').catch((error) => {
    rookieBoardRequest = null
    throw error
  })
  return rookieBoardRequest
}

export async function fetchUserState(): Promise<UserState | null> {
  try {
    return await fetchJson<UserState>('/api/preferences')
  } catch {
    return null
  }
}

export async function saveLeaguePreferences(
  preferences: LeaguePreferences,
): Promise<{ user: UserState['user']; preferences: LeaguePreferences }> {
  return fetchJson<{ user: UserState['user']; preferences: LeaguePreferences }>('/api/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preferences),
  })
}

export function selectSleeperPlayers(
  catalog: Record<string, SleeperPlayer>,
  ids: string[],
): Map<string, SleeperPlayer> {
  const selected = new Map<string, SleeperPlayer>()
  ;[...new Set(ids)].forEach((id) => {
    if (id === '0') return
    const player = catalog[id]
    if (player) selected.set(id, player)
  })
  return selected
}

/** Sleeper's catalog endpoint is intentionally fetched once and filtered in
 * memory. The caller runs this after the first useful render, so optional role
 * and injury metadata never blocks current league and market values. */
export async function fetchSleeperPlayers(ids: string[]): Promise<Map<string, SleeperPlayer>> {
  if (!sleeperPlayerCatalog) {
    sleeperPlayerCatalog = fetchJson<Record<string, SleeperPlayer>>(`${SLEEPER_BASE}/players/nfl`)
      .catch((error) => {
        sleeperPlayerCatalog = null
        throw error
      })
  }
  return selectSleeperPlayers(await sleeperPlayerCatalog, ids)
}

export async function fetchIntel(options: { fresh?: boolean } = {}): Promise<IntelFeed> {
  const freshEnough = Date.now() - intelCachedAt < 5 * 60 * 1000
  if (options.fresh || (intelCachedAt > 0 && !freshEnough)) intelRequest = null
  intelRequest ??= fetchJson<IntelFeed>('/api/intel').then((feed) => {
    intelCachedAt = Date.now()
    return feed
  }).catch((error) => {
    intelRequest = null
    throw error
  })
  return intelRequest
}

export async function fetchJournal(leagueId: string): Promise<JournalBundle> {
  const existing = journalRequests.get(leagueId)
  if (existing) return existing
  const request = fetchJson<JournalBundle>(`/api/journal?leagueId=${encodeURIComponent(leagueId)}`).catch((error) => {
    journalRequests.delete(leagueId)
    throw error
  })
  journalRequests.set(leagueId, request)
  return request
}

export async function syncJournal(leagueId: string): Promise<JournalBundle> {
  const request = fetchJson<JournalBundle>(`/api/journal?leagueId=${encodeURIComponent(leagueId)}`, { method: 'POST' })
  journalRequests.set(leagueId, request)
  return request.catch((error) => {
    journalRequests.delete(leagueId)
    throw error
  })
}

export async function fetchAlerts(leagueId: string, sync = true): Promise<AlertInbox> {
  const params = new URLSearchParams({ leagueId })
  if (sync) params.set('sync', '1')
  return fetchJson<AlertInbox>(`/api/alerts?${params}`)
}

export async function updateAlertReadState(
  leagueId: string,
  eventKeys: string[],
  read = true,
): Promise<AlertInbox> {
  return fetchJson<AlertInbox>(`/api/alerts?leagueId=${encodeURIComponent(leagueId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventKeys, read }),
  })
}

export async function fetchEdgeState(leagueId: string): Promise<EdgeStateBundle> {
  const existing = edgeStateRequests.get(leagueId)
  if (existing) return existing
  const request = fetchJson<EdgeStateBundle>(`/api/edge?leagueId=${encodeURIComponent(leagueId)}`).catch((error) => {
    edgeStateRequests.delete(leagueId)
    throw error
  })
  edgeStateRequests.set(leagueId, request)
  return request
}

export async function fetchResearchState(leagueId: string, syncIfStale = false): Promise<ResearchPipelineBundle> {
  const path = `/api/research?leagueId=${encodeURIComponent(leagueId)}`
  let request = researchStateRequests.get(leagueId)
  if (!request) {
    request = fetchJson<ResearchPipelineBundle>(path).catch((error) => {
      researchStateRequests.delete(leagueId)
      throw error
    })
    researchStateRequests.set(leagueId, request)
  }
  const current = await request
  const stale = !current.lastLeagueSyncAt
    || Date.now() - Date.parse(current.lastLeagueSyncAt) > 24 * 60 * 60 * 1000
  if (!syncIfStale || !stale) return current
  const refreshed = fetchJson<ResearchPipelineBundle>(path, { method: 'POST' })
    .catch((error) => {
      researchStateRequests.delete(leagueId)
      throw error
    })
  researchStateRequests.set(leagueId, refreshed)
  return refreshed
}

export async function saveMarketTape(
  leagueId: string,
  marketTape: MarketTapeRequest,
): Promise<EdgeStateBundle> {
  const request = fetchJson<EdgeStateBundle>(`/api/edge?leagueId=${encodeURIComponent(leagueId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'market', marketTape }),
  }).catch((error) => {
    edgeStateRequests.delete(leagueId)
    throw error
  })
  edgeStateRequests.set(leagueId, request)
  return request
}

export function sleeperAvatar(avatar: string | null | undefined): string | null {
  if (!avatar) return null
  if (avatar.startsWith('http')) return avatar
  return `https://sleepercdn.com/avatars/thumbs/${avatar}`
}
