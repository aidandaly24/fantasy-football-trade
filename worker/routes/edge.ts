import {
  ensureEdgeLearningSchema,
  normalizeMarketTapeInput,
  readEdgeLearningState,
  rebuildEdgeLearningState,
  saveMarketTape,
} from '../edge-learning-store'
import { ensureHistoricalTapeSchema, queueHistoricalTapeAudit, readHistoricalTapeAudit, refreshHistoricalTapeAudits } from '../historical-tape-store'
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

export async function edgeResponse(request: Request, env: Env): Promise<Response> {
  const user = authenticatedUser(request)
  if (!user) return privateJson({ message: 'Authenticated site access required' }, 401)
  if (!env.DB) return privateJson({ message: 'Private storage is not configured' }, 503)
  const url = new URL(request.url)
  const leagueId = url.searchParams.get('leagueId')
  if (!validLeagueId(leagueId)) return privateJson({ message: 'Invalid league ID' }, 400)
  try {
    await Promise.all([
      ensureEdgeLearningSchema(env.DB), ensureHistoricalTapeSchema(env.DB),
      ensureJournalSchema(env.DB), ensureResearchSchema(env.DB),
    ])
    const readState = async () => {
      const [learning, historicalTape, reconstructedTeamMarketHistory, teamHistoryBackfill] = await Promise.all([
        readEdgeLearningState(env.DB!, user.id, leagueId),
        readHistoricalTapeAudit(env.DB!, user.id, leagueId),
        readReconstructedTeamMarketHistory(env.DB!, user.id, leagueId),
        readTeamHistoryBackfill(env.DB!, user.id, leagueId),
      ])
      return { ...learning, historicalTape, reconstructedTeamMarketHistory, teamHistoryBackfill }
    }
    if (request.method === 'GET') return privateJson(await readState())
    if (request.method !== 'POST') {
      return methodNotAllowed('GET, POST')
    }
    if (!sameOriginWrite(request)) return privateJson({ message: 'Cross-origin writes are not allowed' }, 403)
    const input = await request.json().catch(() => null) as {
      action?: unknown; marketTape?: unknown
    } | null
    if (input?.action === 'market') {
      const tape = normalizeMarketTapeInput(input.marketTape)
      await saveMarketTape(env.DB, user.id, leagueId, tape)
      await queueHistoricalTapeAudit(env.DB, user.id, leagueId, tape)
      await refreshHistoricalTapeAudits(env.DB)
      await rebuildEdgeLearningState(env.DB, user.id, leagueId)
    } else if (input?.action === 'team-history') {
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
    } else {
      return privateJson({ message: 'Invalid edge action' }, 400)
    }
    return privateJson(await readState())
  } catch (error) {
    return privateJson({ message: error instanceof Error ? error.message : 'Edge research unavailable' }, 500)
  }
}
