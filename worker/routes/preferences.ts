import {
  authenticatedUser,
  ensureUserSchema,
  getLeaguePreference,
  listLeaguePreferences,
  normalizePreferenceInput,
  saveLeaguePreference,
} from '../user-store'
import type { Env } from '../env'
import { methodNotAllowed, privateJson } from '../http'

export async function preferencesResponse(request: Request, env: Env): Promise<Response> {
  const user = authenticatedUser(request)
  if (!user) return privateJson({ message: 'Authenticated site access required' }, 401)
  if (!env.DB) return privateJson({ message: 'Private storage is not configured' }, 503)
  try {
    await ensureUserSchema(env.DB)
    if (request.method === 'GET') {
      const leagueId = new URL(request.url).searchParams.get('leagueId')
      if (leagueId && !/^\d{8,24}$/.test(leagueId)) {
        return privateJson({ message: 'Invalid league ID' }, 400)
      }
      const preferences = leagueId
        ? await getLeaguePreference(env.DB, user.id, leagueId)
        : await listLeaguePreferences(env.DB, user.id)
      return privateJson({ user, preferences })
    }
    if (request.method === 'PUT') {
      const origin = request.headers.get('origin')
      if (origin && origin !== new URL(request.url).origin) {
        return privateJson({ message: 'Cross-origin writes are not allowed' }, 403)
      }
      let input: unknown
      try {
        input = await request.json()
      } catch {
        return privateJson({ message: 'Invalid JSON body' }, 400)
      }
      let preference
      try {
        preference = normalizePreferenceInput(input)
      } catch (error) {
        return privateJson({ message: error instanceof Error ? error.message : 'Invalid preferences' }, 400)
      }
      return privateJson({
        user,
        preferences: await saveLeaguePreference(env.DB, user.id, preference),
      })
    }
    return methodNotAllowed('GET, PUT')
  } catch {
    return privateJson({ message: 'Private storage is temporarily unavailable' }, 500)
  }
}
