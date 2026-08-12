import { describe, expect, it } from 'vitest'
import { decisionsResponse } from './decisions'
import type { Env } from '../env'
import type { D1Database, D1PreparedStatement } from '../user-store'

const statement: D1PreparedStatement = {
  bind() { return this },
  first: async () => null,
  all: async () => ({ results: [] }),
  run: async () => ({}),
}
const env = {
  DB: { prepare: () => statement, batch: async () => [] } as D1Database,
  ASSETS: { fetch: async () => new Response('') },
} satisfies Env

function request(method = 'GET', body?: unknown, authenticated = true): Request {
  return new Request('https://rosterlab.example/api/decisions?leagueId=1336087922847289344', {
    method,
    headers: authenticated ? {
      'content-type': 'application/json',
      'oai-authenticated-user-id': 'user-a',
      'oai-authenticated-user-email': 'user@example.com',
    } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('decision route', () => {
  it('requires authenticated private access', async () => {
    expect((await decisionsResponse(request('GET', undefined, false), env)).status).toBe(401)
  })

  it('returns the saved decision list privately', async () => {
    const response = await decisionsResponse(request(), env)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({ decisions: [] })
  })

  it('rejects unsupported methods', async () => {
    const response = await decisionsResponse(request('DELETE'), env)
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, POST, PATCH')
  })
})
