import { readLeagueJournal, syncLeagueJournal } from '../journal-db'
import { authenticatedUser } from '../user-store'
import type { Env } from '../env'
import { methodNotAllowed, privateJson, sameOriginWrite, validLeagueId } from '../http'

export async function journalResponse(request: Request, env: Env): Promise<Response> {
  const user = authenticatedUser(request)
  if (!user) return privateJson({ message: 'Authenticated site access required' }, 401)
  if (!env.DB) return privateJson({ message: 'Private storage is not configured' }, 503)
  const leagueId = new URL(request.url).searchParams.get('leagueId')
  if (!validLeagueId(leagueId)) return privateJson({ message: 'Invalid league ID' }, 400)
  try {
    if (request.method === 'GET') return privateJson(await readLeagueJournal(env.DB, leagueId))
    if (request.method === 'POST') {
      if (!sameOriginWrite(request)) return privateJson({ message: 'Cross-origin writes are not allowed' }, 403)
      const sync = await syncLeagueJournal(env.DB, leagueId)
      const journal = await readLeagueJournal(env.DB, leagueId)
      return privateJson({ ...journal, collectionComplete: sync.complete, newTradeCount: sync.newTradeCount })
    }
    return methodNotAllowed('GET, POST')
  } catch (error) {
    return privateJson({ message: error instanceof Error ? error.message : 'Journal sync failed' }, 500)
  }
}
