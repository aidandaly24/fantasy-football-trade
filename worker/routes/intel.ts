import { buildIntelFeed } from '../intel-feed'
import { authenticatedUser } from '../user-store'
import { methodNotAllowed, privateJson } from '../http'

export async function intelResponse(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET')
  if (!authenticatedUser(request)) return privateJson({ message: 'Authenticated site access required' }, 401)
  return privateJson(await buildIntelFeed(), 200, 'private, max-age=300')
}
