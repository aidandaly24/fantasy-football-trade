import { ensureEdgeLearningSchema } from '../edge-learning-store'
import { ensureHistoricalTapeSchema } from '../historical-tape-store'
import { ensureJournalSchema, syncLeagueJournal } from '../journal-db'
import { ensureResearchSchema, syncLeagueResearch } from '../research-store'
import {
  queueTeamHistoryBackfill,
  readReconstructedTeamMarketHistory,
  readTeamHistoryBackfill,
  refreshTeamHistoryBackfill,
} from '../team-history-store'
import { authenticatedUser } from '../user-store'
import type { Env } from '../env'
import { methodNotAllowed, privateJson, sameOriginWrite, validLeagueId } from '../http'

export async function teamHistoryResponse(request: Request, env: Env): Promise<Response> {
  const user = authenticatedUser(request)
  if (!user) return privateJson({ message: 'Authenticated site access required' }, 401)
  if (!env.DB) return privateJson({ message: 'Private storage is not configured' }, 503)
  const leagueId = new URL(request.url).searchParams.get('leagueId')
  if (!validLeagueId(leagueId)) return privateJson({ message: 'Invalid league ID' }, 400)
  try {
    await Promise.all([
      ensureEdgeLearningSchema(env.DB), ensureHistoricalTapeSchema(env.DB),
      ensureJournalSchema(env.DB), ensureResearchSchema(env.DB),
    ])
    if (request.method === 'POST') {
      if (!sameOriginWrite(request)) return privateJson({ message: 'Cross-origin writes are not allowed' }, 403)
      const weekState = await env.DB.prepare(`SELECT COUNT(*) AS count FROM league_week_states
WHERE root_league_id=?`).bind(leagueId).first<{ count: number }>()
      if (!Number(weekState?.count ?? 0)) {
        const seasons = await env.DB.prepare(`SELECT COUNT(*) AS count FROM league_seasons
WHERE root_league_id=?`).bind(leagueId).first<{ count: number }>()
        if (!Number(seasons?.count ?? 0)) await syncLeagueJournal(env.DB, leagueId)
        await syncLeagueResearch(env.DB, leagueId)
      }
      await queueTeamHistoryBackfill(env.DB, user.id, leagueId)
      await refreshTeamHistoryBackfill(env.DB, user.id, leagueId)
    } else if (request.method !== 'GET') {
      return methodNotAllowed('GET, POST')
    }
    const [reconstructedTeamMarketHistory, backfill] = await Promise.all([
      readReconstructedTeamMarketHistory(env.DB, user.id, leagueId),
      readTeamHistoryBackfill(env.DB, user.id, leagueId),
    ])
    return privateJson({ reconstructedTeamMarketHistory, backfill })
  } catch (error) {
    return privateJson({ message: error instanceof Error ? error.message : 'Team history unavailable' }, 500)
  }
}
