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

const SLEEPER_BASE = 'https://api.sleeper.app/v1'
const TRADYR_BASE = 'https://api.tradyr.app/v1'
let sleeperPlayerCatalog: Promise<Record<string, SleeperPlayer>> | null = null

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

  const [players, picks] = await Promise.all([
    fetchJson<TradyrResponse<TradyrPlayer[]>>(`${TRADYR_BASE}/players?${params}`),
    fetchJson<TradyrResponse<PickValue[]>>(`${TRADYR_BASE}/picks?${pickParams}`),
  ])

  return { players: players.data, picks: picks.data, meta: players.meta }
}

export async function fetchProjections(): Promise<ProjectionBundle | null> {
  try {
    const bundle = await fetchJson<ProjectionBundle>('/data/player-projections.json')
    return bundle.enabled ? bundle : null
  } catch {
    return null
  }
}

export async function fetchModelHealth(): Promise<ModelHealthBundle | null> {
  try {
    return await fetchJson<ModelHealthBundle>('/data/model-health.json')
  } catch {
    return null
  }
}

export async function fetchEventModelHealth(): Promise<EventModelHealthBundle | null> {
  try {
    return await fetchJson<EventModelHealthBundle>('/data/event-model-health.json')
  } catch {
    return null
  }
}

export async function fetchRookieBoard(): Promise<RookieBoardBundle> {
  return fetchJson<RookieBoardBundle>('/api/rookies')
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

export async function fetchIntel(): Promise<IntelFeed> {
  return fetchJson<IntelFeed>('/api/intel')
}

export async function fetchJournal(leagueId: string): Promise<JournalBundle> {
  return fetchJson<JournalBundle>(`/api/journal?leagueId=${encodeURIComponent(leagueId)}`)
}

export async function syncJournal(leagueId: string): Promise<JournalBundle> {
  return fetchJson<JournalBundle>(`/api/journal?leagueId=${encodeURIComponent(leagueId)}`, { method: 'POST' })
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
  return fetchJson<EdgeStateBundle>(`/api/edge?leagueId=${encodeURIComponent(leagueId)}`)
}

export async function fetchResearchState(leagueId: string, syncIfStale = true): Promise<ResearchPipelineBundle> {
  const path = `/api/research?leagueId=${encodeURIComponent(leagueId)}`
  const current = await fetchJson<ResearchPipelineBundle>(path)
  const stale = !current.lastLeagueSyncAt
    || Date.now() - Date.parse(current.lastLeagueSyncAt) > 24 * 60 * 60 * 1000
  if (!syncIfStale || !stale) return current
  return fetchJson<ResearchPipelineBundle>(path, { method: 'POST' })
}

export async function saveMarketTape(
  leagueId: string,
  marketTape: MarketTapeRequest,
): Promise<EdgeStateBundle> {
  return fetchJson<EdgeStateBundle>(`/api/edge?leagueId=${encodeURIComponent(leagueId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'market', marketTape }),
  })
}

export function sleeperAvatar(avatar: string | null | undefined): string | null {
  if (!avatar) return null
  if (avatar.startsWith('http')) return avatar
  return `https://sleepercdn.com/avatars/thumbs/${avatar}`
}
