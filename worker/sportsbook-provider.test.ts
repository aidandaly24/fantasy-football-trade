import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSportsbookBundle, resetSportsbookProviderCacheForTest } from './sportsbook-provider'

const event = {
  id: 'event-1',
  commence_time: '2026-09-13T17:00:00Z',
  home_team: 'New York Giants',
  away_team: 'Dallas Cowboys',
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetSportsbookProviderCacheForTest()
})

describe('sportsbook provider adapter', () => {
  it('joins a Sleeper team to its event and returns aggregate prop and game context', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
      const headers = { 'Content-Type': 'application/json', 'x-requests-used': '30', 'x-requests-remaining': '470', 'x-requests-last': '10' }
      if (url.pathname.endsWith('/events')) return Response.json([event], { headers })
      if (url.pathname.endsWith('/americanfootball_nfl/odds')) return Response.json([{
        ...event,
        bookmakers: [{ key: 'book-a', markets: [
          { key: 'totals', outcomes: [{ name: 'Over', price: -110, point: 48 }, { name: 'Under', price: -110, point: 48 }] },
          { key: 'spreads', outcomes: [{ name: 'New York Giants', price: -110, point: 3 }, { name: 'Dallas Cowboys', price: -110, point: -3 }] },
        ] }],
      }], { headers })
      return Response.json({
        ...event,
        bookmakers: [{ key: 'book-a', last_update: '2026-09-12T12:00:00Z', markets: [{
          key: 'player_reception_yds',
          outcomes: [
            { name: 'Over', description: 'Malik Nabers', price: -110, point: 74.5 },
            { name: 'Under', description: 'Malik Nabers', price: -110, point: 74.5 },
          ],
        }] }],
      }, { headers })
    }))

    const bundle = await fetchSportsbookBundle([
      { id: '1', name: 'Malik Nabers', team: 'NYG', position: 'WR', kind: 'player' },
    ], 'private-key')

    expect(bundle.status).toBe('ready')
    expect(bundle.players[0].markets[0]).toMatchObject({ market: 'player_reception_yds', line: 74.5, overProbability: 0.5 })
    expect(bundle.players[0].game).toMatchObject({ total: 48, teamSpread: 3, impliedTeamTotal: 22.5 })
    expect(bundle.model.enabled).toBe(false)
  })
})
