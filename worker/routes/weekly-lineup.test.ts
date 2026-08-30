import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../env'
import { resetWeeklyLineupProviderCacheForTest } from '../weekly-lineup-provider'
import { weeklyLineupResponse } from './weekly-lineup'

const env = { ASSETS: { fetch: async () => new Response('unused') } } satisfies Env
const authenticated = { 'oai-authenticated-user-email': 'aidan@example.com' }

function request(query = '?season=2026&week=1', auth = true): Request {
  return new Request(`https://rosterlab.example/api/weekly-lineup${query}`, { headers: auth ? authenticated : {} })
}

describe('weekly lineup route', () => {
  beforeEach(() => resetWeeklyLineupProviderCacheForTest())

  it('requires private access and valid season/week inputs', async () => {
    expect((await weeklyLineupResponse(request(undefined, false), env)).status).toBe(401)
    expect((await weeklyLineupResponse(request('?season=2025&week=0'), env)).status).toBe(400)
    expect((await weeklyLineupResponse(new Request('https://rosterlab.example/api/weekly-lineup', { method: 'POST', headers: authenticated }), env)).status).toBe(405)
  })

  it('returns private cached data without exposing an upstream credential', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('page,scrape_date,fantasypros_id,player_name,team,r2p_pts\nqb,2025-12-30,1,Old QB,BUF,20\n'))
      .mockResolvedValueOnce(new Response('fantasypros_id,sleeper_id\n1,123\n'))
      .mockResolvedValueOnce(new Response('season,game_type,week,gameday,gametime,away_team,home_team\n2026,REG,1,2026-09-13,13:00,BUF,NYJ\n'))

    const response = await weeklyLineupResponse(request(), env, fetcher as typeof fetch)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, max-age=900')
    await expect(response.json()).resolves.toMatchObject({ season: 2026, week: 1, status: 'not-published' })
  })
})
