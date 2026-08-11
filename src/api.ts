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
const sleeperPlayerCache = new Map<string, SleeperPlayer>()

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

export async function fetchSleeperPlayers(ids: string[]): Promise<Map<string, SleeperPlayer>> {
  const playerMap = new Map<string, SleeperPlayer>()
  const filtered = [...new Set(ids.filter((id) => id !== '0' && /^\d+$/.test(id)))]
  const uncached = filtered.filter((id) => {
    const cached = sleeperPlayerCache.get(id)
    if (cached) playerMap.set(id, cached)
    return !cached
  })

  for (let offset = 0; offset < uncached.length; offset += 40) {
    const batch = uncached.slice(offset, offset + 40)
    const results = await Promise.all(
      batch.map(async (id) => {
        try {
          return await fetchJson<SleeperPlayer>(`${SLEEPER_BASE}/players/nfl/${id}`)
        } catch {
          return null
        }
      }),
    )
    results.forEach((player) => {
      if (player?.player_id) {
        sleeperPlayerCache.set(player.player_id, player)
        playerMap.set(player.player_id, player)
      }
    })
  }

  return playerMap
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
