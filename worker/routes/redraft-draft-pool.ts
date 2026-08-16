import type { RedraftDraftPool, RedraftDraftProjection, RedraftProjectionStats } from '../../src/types'
import { methodNotAllowed, privateJson } from '../http'
import { authenticatedUser } from '../user-store'

type UpstreamProjection = {
  player_id?: unknown
  week?: unknown
  game_id?: unknown
  company?: unknown
  player?: {
    first_name?: unknown
    last_name?: unknown
    position?: unknown
    team?: unknown
    injury_status?: unknown
  } | null
  stats?: Record<string, unknown> | null
}

const POSITIONS = new Set<RedraftDraftProjection['position']>(['QB', 'RB', 'WR', 'TE'])

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function nullableFinite(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function stats(row: UpstreamProjection): RedraftProjectionStats {
  const source = row.stats ?? {}
  return {
    adpPpr: finite(source.adp_ppr, 999),
    ptsPpr: nullableFinite(source.pts_ppr),
    passYd: finite(source.pass_yd),
    passTd: finite(source.pass_td),
    passInt: finite(source.pass_int),
    pass2pt: finite(source.pass_2pt),
    rushYd: finite(source.rush_yd),
    rushTd: finite(source.rush_td),
    rush2pt: finite(source.rush_2pt),
    rec: finite(source.rec),
    recYd: finite(source.rec_yd),
    recTd: finite(source.rec_td),
    rec2pt: finite(source.rec_2pt),
    fumLost: finite(source.fum_lost),
  }
}

export function normalizeRedraftDraftPool(rows: unknown, season: string, generatedAt: string): RedraftDraftPool | null {
  if (!Array.isArray(rows)) return null
  const players = rows.flatMap((candidate): RedraftDraftProjection[] => {
    const row = candidate as UpstreamProjection
    const position = row.player?.position
    const firstName = typeof row.player?.first_name === 'string' ? row.player.first_name.trim() : ''
    const lastName = typeof row.player?.last_name === 'string' ? row.player.last_name.trim() : ''
    const playerId = typeof row.player_id === 'string' ? row.player_id : ''
    const projectionStats = stats(row)
    if (!playerId || row.week !== null || row.game_id !== 'season' || !POSITIONS.has(position as RedraftDraftProjection['position'])) return []
    if (projectionStats.adpPpr <= 0 || projectionStats.adpPpr >= 350 || projectionStats.ptsPpr === null) return []
    return [{
      playerId,
      name: `${firstName} ${lastName}`.trim() || `Player ${playerId}`,
      position: position as RedraftDraftProjection['position'],
      team: typeof row.player?.team === 'string' ? row.player.team : null,
      injuryStatus: typeof row.player?.injury_status === 'string' ? row.player.injury_status : null,
      company: typeof row.company === 'string' ? row.company : null,
      stats: projectionStats,
    }]
  })
  const unique = [...new Map(players.map((player) => [player.playerId, player])).values()]
    .sort((left, right) => left.stats.adpPpr - right.stats.adpPpr || left.name.localeCompare(right.name))
  if (unique.length < 130) return null
  return {
    season,
    generatedAt,
    source: 'Sleeper-hosted season projections and PPR ADP',
    players: unique,
  }
}

export async function redraftDraftPoolResponse(
  request: Request,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET')
  if (!authenticatedUser(request)) return privateJson({ message: 'Authenticated site access required' }, 401)
  const season = new URL(request.url).searchParams.get('season') ?? ''
  if (!/^20\d{2}$/.test(season)) return privateJson({ message: 'Invalid season' }, 400)
  try {
    const response = await fetcher(`https://api.sleeper.com/projections/nfl/${season}?season_type=regular`)
    if (!response.ok) return privateJson({ message: 'Draft projection source is temporarily unavailable' }, 503)
    const generatedAt = response.headers.get('date')
      ? new Date(response.headers.get('date')!).toISOString()
      : new Date().toISOString()
    const bundle = normalizeRedraftDraftPool(await response.json(), season, generatedAt)
    if (!bundle) return privateJson({ message: 'Draft projection coverage is incomplete' }, 503)
    return privateJson(bundle, 200, 'private, max-age=300')
  } catch {
    return privateJson({ message: 'Draft projection source is temporarily unavailable' }, 503)
  }
}
