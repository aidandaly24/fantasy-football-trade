import type { EventModelHealthBundle } from '../../src/types'
import {
  captureDueObjectivePlayers,
  ensureResearchSchema,
  readResearchPipeline,
  syncLeagueResearch,
} from '../research-store'
import { authenticatedUser } from '../user-store'
import type { Env } from '../env'
import { methodNotAllowed, privateJson, sameOriginWrite, validLeagueId } from '../http'

async function eventModelHealth(request: Request, env: Env): Promise<(EventModelHealthBundle & {
  trainingRows?: number; validationRows?: number; testRows?: number
}) | null> {
  try {
    const response = await env.ASSETS.fetch(new Request(new URL('/data/event-model-health.json', request.url)))
    if (!response.ok) return null
    return response.json<EventModelHealthBundle & { trainingRows?: number; validationRows?: number; testRows?: number }>()
  } catch {
    return null
  }
}
export async function researchResponse(request: Request, env: Env): Promise<Response> {
  const user = authenticatedUser(request)
  if (!user) return privateJson({ message: 'Authenticated site access required' }, 401)
  if (!env.DB) return privateJson({ message: 'Private storage is not configured' }, 503)
  const leagueId = new URL(request.url).searchParams.get('leagueId')
  if (!validLeagueId(leagueId)) return privateJson({ message: 'Invalid league ID' }, 400)
  try {
    await ensureResearchSchema(env.DB)
    if (request.method === 'POST') {
      if (!sameOriginWrite(request)) return privateJson({ message: 'Cross-origin writes are not allowed' }, 403)
      await syncLeagueResearch(env.DB, leagueId)
      await captureDueObjectivePlayers(env.DB)
    } else if (request.method !== 'GET') {
      return methodNotAllowed('GET, POST')
    }
    return privateJson(await readResearchPipeline(env.DB, user.id, leagueId, await eventModelHealth(request, env)))
  } catch (error) {
    return privateJson({ message: error instanceof Error ? error.message : 'Research pipeline unavailable' }, 500)
  }
}
