import { describe, expect, it } from 'vitest'
import { normalizeRedraftDraftPool, redraftDraftPoolResponse } from './redraft-draft-pool'

function row(index: number) {
  return {
    player_id: String(index), week: null, game_id: 'season', company: 'rotowire',
    player: { first_name: 'Player', last_name: String(index), position: index % 4 === 0 ? 'QB' : index % 4 === 1 ? 'RB' : index % 4 === 2 ? 'WR' : 'TE', team: 'NFL', injury_status: null },
    stats: { adp_ppr: index + 1, pts_ppr: 200 - index / 2, pass_yd: index % 4 === 0 ? 4000 : 0 },
  }
}

function request(authenticated = true): Request {
  return new Request('https://rosterlab.example/api/redraft-draft-pool?season=2026', {
    headers: authenticated ? { 'oai-authenticated-user-id': 'user-a', 'oai-authenticated-user-email': 'a@example.com' } : {},
  })
}

describe('redraft draft projection boundary', () => {
  it('filters the upstream feed to a complete season-long skill-player pool', () => {
    const bundle = normalizeRedraftDraftPool(Array.from({ length: 140 }, (_, index) => row(index)), '2026', '2026-08-16T12:00:00.000Z')
    expect(bundle?.players).toHaveLength(140)
    expect(bundle?.players[0]).toMatchObject({ playerId: '0', position: 'QB', stats: { adpPpr: 1, passYd: 4000 } })
  })

  it('requires private access and rejects incomplete upstream coverage', async () => {
    const fetcher = async () => Response.json(Array.from({ length: 20 }, (_, index) => row(index)))
    expect((await redraftDraftPoolResponse(request(false), fetcher as typeof fetch)).status).toBe(401)
    const response = await redraftDraftPoolResponse(request(), fetcher as typeof fetch)
    expect(response.status).toBe(503)
  })
})
