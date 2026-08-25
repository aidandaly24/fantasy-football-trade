import { describe, expect, it, vi } from 'vitest'
import type { Env } from '../env'
import { fetchMarketBundle } from '../tradyr-market'
import { marketResponse } from './market'

const env = {
  ASSETS: { fetch: async () => new Response('unused') },
  TRADYR_API_KEY: 'test-secret',
} satisfies Env

function request(path = '/api/market?format=dynasty&numQbs=2&tep=true&numTeams=12', authenticated = true): Request {
  return new Request(`https://rosterlab.example${path}`, {
    headers: authenticated
      ? { 'oai-authenticated-user-id': 'user-a', 'oai-authenticated-user-email': 'a@example.com' }
      : {},
  })
}

function player(index: number) {
  return {
    slug: `player-${index}-wr`,
    name: `Player ${index}`,
    position: 'WR',
    team: 'NFL',
    age: 24,
    composite: 500 - index,
    confidence: 0.9,
    rank: index + 1,
    posRank: index + 1,
    sources: { ktc: 1_000 - index, fantasycalc: 900 - index },
    sleeperId: String(10_000 + index),
  }
}

function pick(index: number) {
  return {
    id: `pick_2027_1_${String(index + 1).padStart(2, '0')}`,
    name: `2027 Pick 1.${String(index + 1).padStart(2, '0')}`,
    round: 1,
    slot: index + 1,
    year: '2027',
    tier: index < 4 ? 'early' : index < 8 ? 'mid' : 'late',
    composite: 500 - index,
    position: 'PICK',
  }
}

describe('authenticated market catalog boundary', () => {
  it('requires private site access and a configured provider key', async () => {
    expect((await marketResponse(request(undefined, false), env)).status).toBe(401)
    const response = await marketResponse(request(), { ...env, TRADYR_API_KEY: undefined })
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ message: 'Market data authentication is not configured' })
  })

  it('keeps the provider key server-side and returns one complete catalog', async () => {
    const players = Array.from({ length: 120 }, (_, index) => player(index))
    const picks = Array.from({ length: 12 }, (_, index) => pick(index))
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({
        data: players,
        meta: {
          generatedAt: '2026-08-25T00:00:00.000Z', sources: ['keeptradecut', 'fantasycalc'],
          attribution: 'Powered by Tradyr', total: players.length, limit: 1000, offset: 0,
        },
      }))
      .mockResolvedValueOnce(Response.json({ data: picks, meta: { total: picks.length, limit: 1000, offset: 0 } }))

    const response = await marketResponse(request(), env, fetcher as typeof fetch)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, max-age=300')
    const bundle = await response.json() as { players: unknown[]; picks: unknown[]; meta: { coverage: unknown } }
    expect(bundle.players).toHaveLength(120)
    expect(bundle.picks).toHaveLength(12)
    expect(bundle.meta.coverage).toEqual({ expected: 120, returned: 120, complete: true, pages: 1 })
    expect(fetcher).toHaveBeenCalledTimes(2)
    for (const [, init] of fetcher.mock.calls) {
      expect(init.headers.Authorization).toBe('Bearer test-secret')
    }
    expect(String(fetcher.mock.calls[0][0])).toContain('limit=1000')
    expect(new URL(request().url).searchParams.has('key')).toBe(false)
  })

  it('rejects a capped response instead of publishing partial rankings', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({
        data: Array.from({ length: 50 }, (_, index) => player(index)),
        meta: { total: 485, limit: 50, offset: 0, access: { limited: true, total: 485, returned: 50 } },
      }))
      .mockResolvedValueOnce(Response.json({ data: [], meta: { total: 0 } }))

    await expect(fetchMarketBundle(
      { format: 'dynasty', numQbs: 2, tep: true, numTeams: 12 },
      'test-secret',
      fetcher as typeof fetch,
    )).rejects.toThrow('Tradyr player coverage incomplete (50/485)')
  })

  it('does not request dynasty picks for a redraft market', async () => {
    const players = Array.from({ length: 140 }, (_, index) => player(index))
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: players, meta: { total: players.length } }))

    const bundle = await fetchMarketBundle(
      { format: 'redraft', numQbs: 1, tep: false, numTeams: 12 },
      'test-secret',
      fetcher as typeof fetch,
    )

    expect(bundle.players).toHaveLength(140)
    expect(bundle.picks).toEqual([])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
