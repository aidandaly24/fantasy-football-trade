import { describe, expect, it } from 'vitest'
import type { Env } from '../env'
import { sportsbookResponse } from './sportsbook'

const env: Env = {
  ASSETS: { fetch: async () => new Response('not used') },
}

describe('sportsbook route', () => {
  it('keeps the endpoint private outside local development', async () => {
    const response = await sportsbookResponse(new Request('https://example.com/api/sportsbook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
      body: JSON.stringify({ players: [{ id: '1', name: 'Malik Nabers', team: 'NYG', position: 'WR' }] }),
    }), env)
    expect(response.status).toBe(401)
  })

  it('reports missing secret without pretending sportsbook evidence exists', async () => {
    const response = await sportsbookResponse(new Request('http://localhost/api/sportsbook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
      body: JSON.stringify({ players: [{ id: '1', name: 'Malik Nabers', team: 'NYG', position: 'WR' }] }),
    }), env)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'needs-key', players: [] })
  })

  it('rejects unsupported or malformed assets before calling the provider', async () => {
    const response = await sportsbookResponse(new Request('http://localhost/api/sportsbook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
      body: JSON.stringify({ players: [{ id: 'pick', name: '2027 1st', team: null, position: 'PICK' }] }),
    }), env)
    expect(response.status).toBe(400)
  })
})
