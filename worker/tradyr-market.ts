import type { ApiMeta, PickValue, TradyrPlayer, ValueBundle } from '../src/types'

const TRADYR_BASE = 'https://api.tradyr.app/v1'

export type MarketRequest = {
  format: 'dynasty' | 'redraft'
  numQbs: 1 | 2
  tep: boolean
  numTeams: number
}

type UpstreamMeta = Partial<ApiMeta> & {
  access?: { limited?: boolean; returned?: number; total?: number; reason?: string }
}

type UpstreamResponse<T> = { data?: T; meta?: UpstreamMeta }

async function requestTradyr<T>(url: string, apiKey: string, fetcher: typeof fetch): Promise<UpstreamResponse<T>> {
  const response = await fetcher(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': 'RosterLab private market catalog',
    },
  })
  if (!response.ok) throw new Error(`Tradyr request failed (${response.status})`)
  return response.json<UpstreamResponse<T>>()
}

function completeRows<T>(response: UpstreamResponse<T[]>, label: string): { rows: T[]; expected: number } {
  if (!Array.isArray(response.data)) throw new Error(`${label} response is invalid`)
  const reportedTotal = Number(response.meta?.total ?? response.meta?.access?.total)
  const expected = Number.isFinite(reportedTotal) && reportedTotal >= 0 ? reportedTotal : response.data.length
  if (response.meta?.access?.limited || response.data.length < expected) {
    throw new Error(`${label} coverage incomplete (${response.data.length}/${expected})`)
  }
  return { rows: response.data, expected }
}

function playerKey(player: TradyrPlayer): string {
  const sleeperId = String(player.sleeperId ?? '')
  return /^\d+$/.test(sleeperId) ? `sleeper:${sleeperId}` : `slug:${player.slug}`
}

function uniquePlayers(players: TradyrPlayer[]): TradyrPlayer[] {
  return [...new Map(players.map((player) => [playerKey(player), player])).values()]
}

function uniquePicks(picks: PickValue[]): PickValue[] {
  return [...new Map(picks.map((pick) => [pick.id, pick])).values()]
}

export async function fetchMarketBundle(
  input: MarketRequest,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ValueBundle> {
  const playerParams = new URLSearchParams({
    format: input.format,
    numQbs: String(input.numQbs),
    tep: String(input.tep),
    limit: '1000',
  })
  const pickParams = new URLSearchParams({
    numQbs: String(input.numQbs),
    numTeams: String(input.numTeams),
    limit: '1000',
  })
  const [playerResponse, pickResponse] = await Promise.all([
    requestTradyr<TradyrPlayer[]>(`${TRADYR_BASE}/players?${playerParams}`, apiKey, fetcher),
    input.format === 'dynasty'
      ? requestTradyr<PickValue[]>(`${TRADYR_BASE}/picks?${pickParams}`, apiKey, fetcher)
      : Promise.resolve({ data: [], meta: { total: 0 } } satisfies UpstreamResponse<PickValue[]>),
  ])
  const playerCoverage = completeRows(playerResponse, 'Tradyr player')
  const pickCoverage = completeRows(pickResponse, 'Tradyr pick')
  const players = uniquePlayers(playerCoverage.rows)
  const picks = uniquePicks(pickCoverage.rows)
  if (players.length < playerCoverage.expected) {
    throw new Error(`Tradyr player coverage incomplete after deduplication (${players.length}/${playerCoverage.expected})`)
  }
  if (picks.length < pickCoverage.expected) {
    throw new Error(`Tradyr pick coverage incomplete after deduplication (${picks.length}/${pickCoverage.expected})`)
  }
  return {
    players,
    picks,
    meta: {
      generatedAt: playerResponse.meta?.generatedAt ?? new Date().toISOString(),
      sources: playerResponse.meta?.sources ?? [],
      attribution: playerResponse.meta?.attribution ?? 'Powered by Tradyr, https://tradyr.app',
      total: playerCoverage.expected,
      limit: playerResponse.meta?.limit ?? 1000,
      offset: 0,
      coverage: { expected: playerCoverage.expected, returned: players.length, complete: true, pages: 1 },
    },
  }
}
