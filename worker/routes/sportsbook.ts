import type { SportsbookPlayerRequest } from '../../src/sportsbook'
import type { Env } from '../env'
import { methodNotAllowed, privateJson, sameOriginWrite } from '../http'
import { fetchSportsbookBundle } from '../sportsbook-provider'
import { authenticatedUser } from '../user-store'

const POSITIONS = new Set(['QB', 'RB', 'WR', 'TE'])

function requestedPlayers(input: unknown): SportsbookPlayerRequest[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid sportsbook request')
  const raw = (input as { players?: unknown }).players
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 12) throw new Error('Select between 1 and 12 players')
  return raw.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid player')
    const player = item as Record<string, unknown>
    const id = typeof player.id === 'string' ? player.id.trim() : ''
    const name = typeof player.name === 'string' ? player.name.trim() : ''
    const team = typeof player.team === 'string' ? player.team.trim().toUpperCase() : null
    const position = typeof player.position === 'string' ? player.position.toUpperCase() : ''
    if (!/^[\w-]{1,64}$/.test(id) || !name || name.length > 100 || !team || !/^[A-Z]{2,3}$/.test(team) || !POSITIONS.has(position)) {
      throw new Error('Invalid player')
    }
    return { id, name, team, position: position as SportsbookPlayerRequest['position'], kind: 'player' as const }
  })
}

export async function sportsbookResponse(request: Request, env: Env): Promise<Response> {
  if (!authenticatedUser(request)) return privateJson({ message: 'Authenticated site access required' }, 401)
  if (request.method !== 'POST') return methodNotAllowed('POST')
  if (!sameOriginWrite(request)) return privateJson({ message: 'Cross-origin writes are not allowed' }, 403)
  try {
    const players = requestedPlayers(await request.json())
    return privateJson(await fetchSportsbookBundle(players, env.ODDS_API_KEY), 200, 'private, max-age=300')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sportsbook evidence unavailable'
    const status = message.startsWith('Invalid') || message.startsWith('Select') ? 400 : 502
    return privateJson({ message }, status)
  }
}
