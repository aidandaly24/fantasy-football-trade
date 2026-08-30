import { describe, expect, it, vi } from 'vitest'
import type { Env } from '../env'
import { rookieResponse } from './rookies'

const env = {
  ASSETS: { fetch: async () => new Response('unused') },
  TRADYR_API_KEY: 'test-secret',
} satisfies Env

function authenticatedRequest(method = 'GET'): Request {
  return new Request('https://rosterlab.example/api/rookies', {
    method,
    headers: {
      'oai-authenticated-user-id': 'user-a',
      'oai-authenticated-user-email': 'user@example.com',
    },
  })
}

describe('private rookie board route', () => {
  it('returns the generated board privately to an authenticated reader', async () => {
    const response = await rookieResponse(authenticatedRequest())
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(body.tradeReturnForecastEnabled).toBe(false)
    expect(Array.isArray(body.board)).toBe(true)
    expect((body.pickOpportunity as Record<string, unknown>).exactSlotPromotion).toBe(false)
    expect((body.futureClassOpportunity as Record<string, unknown>).downstreamEnabled).toBe(false)
    expect(JSON.stringify(body)).not.toContain('currentShadowBoard')
  })

  it('overlays a complete current rookie market without changing the model anchor rank', async () => {
    const baseResponse = await rookieResponse(authenticatedRequest())
    const base = await baseResponse.json() as { board: Array<Record<string, unknown>> }
    const first = base.board.find((player) => typeof player.sleeperId === 'string')!
    const nameLinked = base.board.find((player) => player.sleeperId === null)!
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      data: [
        {
          slug: 'current-rookie-wr', name: first.name, position: first.position, team: 'NEW', composite: 777,
          rank: 1, sleeperId: first.sleeperId,
        },
        {
          slug: 'name-linked-rookie', name: nameLinked.name, position: nameLinked.position, team: 'LINK', composite: 222,
          rank: 2, sleeperId: '99901',
        },
        {
          slug: 'market-only-rookie', name: 'Market Only', position: 'WR', team: 'NEW', composite: 111,
          rank: 3, sleeperId: '99902',
        },
      ],
      meta: { generatedAt: '2026-08-30T12:00:00Z', total: 3, sources: ['keeptradecut', 'fantasycalc'], attribution: 'Powered by Tradyr' },
    }))

    const response = await rookieResponse(
      authenticatedRequest(),
      env,
      undefined,
      undefined,
      fetcher as typeof fetch,
    )
    const body = await response.json() as { board: Array<Record<string, unknown>>; currentMarket: Record<string, unknown> }
    const current = body.board.find((player) => player.sleeperId === first.sleeperId)!
    const linked = body.board.find((player) => player.name === nameLinked.name)!
    const marketOnly = body.board.find((player) => player.name === 'Market Only')!

    expect(response.status).toBe(200)
    expect(body.currentMarket).toMatchObject({ status: 'live', generatedAt: '2026-08-30T12:00:00Z' })
    expect(current.rookieMarketRank).toBe(first.rookieMarketRank)
    expect(current.currentMarket).toEqual({ rank: 1, value: 777, overallRank: null, team: 'NEW' })
    expect(linked.sleeperId).toBe('99901')
    expect(marketOnly).toMatchObject({ sleeperId: '99902', draftBoardRank: null, expectedRookieProductionPercentile: null })
    expect(body.board).toHaveLength(base.board.length + 1)
    expect(String(fetcher.mock.calls[0][0])).toContain('format=rookie')
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer test-secret')
  })

  it('rejects hosted requests without identity headers', async () => {
    const response = await rookieResponse(new Request('https://rosterlab.example/api/rookies'))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ message: 'Authenticated site access required' })
  })

  it('allows GET only', async () => {
    const response = await rookieResponse(authenticatedRequest('POST'))
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
  })

  it('reports malformed or disabled artifacts as unavailable', async () => {
    const malformed = await rookieResponse(authenticatedRequest(), undefined, { version: 'broken' })
    expect(malformed.status).toBe(503)

    const validResponse = await rookieResponse(authenticatedRequest())
    const validArtifact = await validResponse.json() as Record<string, unknown>
    const malformedNestedField = await rookieResponse(authenticatedRequest(), undefined, {
      ...validArtifact,
      validation: {
        ...(validArtifact.validation as Record<string, unknown>),
        fullModelMae: 'not-a-number',
      },
    })
    expect(malformedNestedField.status).toBe(503)

    const disabled = await rookieResponse(authenticatedRequest(), undefined, {
      ...validArtifact,
      draftEvidenceEnabled: false,
    })
    expect(disabled.status).toBe(503)
    await expect(disabled.json()).resolves.toEqual({ message: 'Validated rookie evidence is currently disabled' })
  })
})
