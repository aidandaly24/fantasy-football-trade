import type { Env } from '../env'
import { methodNotAllowed, privateJson } from '../http'
import { authenticatedUser } from '../user-store'
import { fetchWeeklyProjectionBundle } from '../weekly-lineup-provider'

function input(request: Request): { season: number; week: number } | null {
  const search = new URL(request.url).searchParams
  const season = Number(search.get('season'))
  const week = Number(search.get('week'))
  if (!Number.isInteger(season) || season < 2026 || season > 2035) return null
  if (!Number.isInteger(week) || week < 1 || week > 18) return null
  return { season, week }
}

export async function weeklyLineupResponse(
  request: Request,
  _env: Env,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET')
  if (!authenticatedUser(request)) return privateJson({ message: 'Authenticated site access required' }, 401)
  const parsed = input(request)
  if (!parsed) return privateJson({ message: 'Invalid season or week' }, 400)
  try {
    return privateJson(
      await fetchWeeklyProjectionBundle(parsed.season, parsed.week, fetcher),
      200,
      'private, max-age=900',
    )
  } catch (error) {
    return privateJson({
      message: error instanceof Error ? error.message : 'Weekly lineup data is temporarily unavailable',
    }, 503)
  }
}
