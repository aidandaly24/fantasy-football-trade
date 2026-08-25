import type { Env } from '../env'
import { methodNotAllowed, privateJson } from '../http'
import { fetchMarketBundle, type MarketRequest } from '../tradyr-market'
import { authenticatedUser } from '../user-store'

function parseMarketRequest(request: Request): MarketRequest | null {
  const search = new URL(request.url).searchParams
  const format = search.get('format')
  const numQbs = Number(search.get('numQbs'))
  const tep = search.get('tep')
  const numTeams = Number(search.get('numTeams'))
  if (format !== 'dynasty' && format !== 'redraft') return null
  if (numQbs !== 1 && numQbs !== 2) return null
  if (tep !== 'true' && tep !== 'false') return null
  if (!Number.isInteger(numTeams) || numTeams < 6 || numTeams > 20) return null
  return { format, numQbs, tep: tep === 'true', numTeams }
}

export async function marketResponse(
  request: Request,
  env: Env,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET')
  if (!authenticatedUser(request)) return privateJson({ message: 'Authenticated site access required' }, 401)
  const input = parseMarketRequest(request)
  if (!input) return privateJson({ message: 'Invalid market format' }, 400)
  const apiKey = env.TRADYR_API_KEY?.trim()
  if (!apiKey) return privateJson({ message: 'Market data authentication is not configured' }, 503)
  try {
    return privateJson(await fetchMarketBundle(input, apiKey, fetcher), 200, 'private, max-age=300')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Market data is temporarily unavailable'
    return privateJson({ message }, 503)
  }
}
