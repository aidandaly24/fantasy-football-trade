import { describe, expect, it } from 'vitest'
import type { Env } from '../env'
import type { D1Database } from '../user-store'
import { tradeTapeResponse } from './trade-tape'

const unusedDb = {
  prepare: () => { throw new Error('Database should not be reached') },
  batch: async () => [],
} as D1Database

const env = { DB: unusedDb } as Env

describe('trade tape route boundary', () => {
  it('requires hosted identity', async () => {
    const response = await tradeTapeResponse(new Request('https://rosterlab.test/api/trade-tape'), env)
    expect(response.status).toBe(401)
  })

  it('rejects cross-origin refresh writes before collection', async () => {
    const response = await tradeTapeResponse(new Request('https://rosterlab.test/api/trade-tape', {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example',
        'oai-authenticated-user-id': 'user-1',
        'oai-authenticated-user-email': 'user@example.com',
      },
    }), env)
    expect(response.status).toBe(403)
  })
})
