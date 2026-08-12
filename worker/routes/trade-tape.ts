import type { Env } from '../env'
import { methodNotAllowed, privateJson, privateJsonAttachment, sameOriginWrite } from '../http'
import { exportTradeTape, readTradeTapeState, refreshTradeTape } from '../trade-tape-store'
import { authenticatedUser } from '../user-store'

export async function tradeTapeResponse(request: Request, env: Env): Promise<Response> {
  const user = authenticatedUser(request)
  if (!user) return privateJson({ message: 'Authenticated site access required' }, 401)
  if (!env.DB) return privateJson({ message: 'Private storage is not configured' }, 503)
  try {
    if (request.method === 'GET') {
      if (new URL(request.url).searchParams.get('format') === 'training') {
        const tape = await exportTradeTape(env.DB)
        return privateJsonAttachment(tape, `rosterlab-trade-tape-${tape.exportedAt.slice(0, 10)}.json`)
      }
      return privateJson(await readTradeTapeState(env.DB))
    }
    if (request.method !== 'POST') return methodNotAllowed('GET, POST')
    if (!sameOriginWrite(request)) return privateJson({ message: 'Cross-origin writes are not allowed' }, 403)
    return privateJson(await refreshTradeTape(env.DB, user.id))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Trade tape refresh failed'
    return privateJson({ message }, message === 'A tape refresh is already running' ? 409 : 500)
  }
}
