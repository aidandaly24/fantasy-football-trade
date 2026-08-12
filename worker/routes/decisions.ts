import type { TradeDecisionStatus } from '../../src/decision-journal'
import { createTradeDecision, ensureDecisionSchema, listTradeDecisions, normalizeDecisionDraft, updateTradeDecisionStatus } from '../decision-store'
import type { Env } from '../env'
import { methodNotAllowed, privateJson, sameOriginWrite, validLeagueId } from '../http'
import { authenticatedUser } from '../user-store'

export async function decisionsResponse(request: Request, env: Env): Promise<Response> {
  const user = authenticatedUser(request)
  if (!user) return privateJson({ message: 'Authenticated site access required' }, 401)
  if (!env.DB) return privateJson({ message: 'Private storage is not configured' }, 503)
  const leagueId = new URL(request.url).searchParams.get('leagueId')
  if (!validLeagueId(leagueId)) return privateJson({ message: 'Invalid league ID' }, 400)
  try {
    await ensureDecisionSchema(env.DB)
    if (request.method === 'GET') return privateJson({ decisions: await listTradeDecisions(env.DB, user.id, leagueId) })
    if (!['POST', 'PATCH'].includes(request.method)) return methodNotAllowed('GET, POST, PATCH')
    if (!sameOriginWrite(request)) return privateJson({ message: 'Cross-origin writes are not allowed' }, 403)
    const input = await request.json().catch(() => null)
    if (request.method === 'POST') {
      const decision = await createTradeDecision(env.DB, user.id, normalizeDecisionDraft(input, leagueId))
      return privateJson({ decision }, 201)
    }
    const value = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
    await updateTradeDecisionStatus(env.DB, user.id, leagueId, String(value.id), String(value.status) as TradeDecisionStatus)
    return privateJson({ decisions: await listTradeDecisions(env.DB, user.id, leagueId) })
  } catch (error) {
    return privateJson({ message: error instanceof Error ? error.message : 'Decision journal unavailable' }, 400)
  }
}
