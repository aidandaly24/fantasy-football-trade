import type {
  ApiMeta,
  IntelFeed,
  League,
  LeagueBundle,
  LeagueUser,
  PickValue,
  SleeperDraft,
  SleeperPlayer,
  SleeperRoster,
  TradyrPlayer,
  TradedPick,
  ValueBundle,
} from './types'

const SLEEPER_BASE = 'https://api.sleeper.app/v1'
const TRADYR_BASE = 'https://api.tradyr.app/v1'

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
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

export async function fetchMissingPlayers(ids: string[]): Promise<Map<string, SleeperPlayer>> {
  const playerMap = new Map<string, SleeperPlayer>()
  const filtered = ids.filter((id) => id !== '0' && /^\d+$/.test(id))

  for (let offset = 0; offset < filtered.length; offset += 40) {
    const batch = filtered.slice(offset, offset + 40)
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
      if (player?.player_id) playerMap.set(player.player_id, player)
    })
  }

  return playerMap
}

export async function fetchIntel(): Promise<IntelFeed> {
  return fetchJson<IntelFeed>('/api/intel')
}

export function sleeperAvatar(avatar: string | null | undefined): string | null {
  if (!avatar) return null
  if (avatar.startsWith('http')) return avatar
  return `https://sleepercdn.com/avatars/thumbs/${avatar}`
}
