import { describe, expect, it } from 'vitest'
import { methodNotAllowed, privateJson, sameOriginWrite, validLeagueId } from './http'
import { intelResponse } from './routes/intel'

describe('Worker HTTP boundaries', () => {
  it('uses private, non-cacheable JSON by default', async () => {
    const response = privateJson({ ok: true })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('returns an explicit Allow header for unsupported methods', () => {
    const response = methodNotAllowed('GET, POST')
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, POST')
  })

  it('validates league IDs and same-origin writes at the boundary', () => {
    expect(validLeagueId('1336087922847289344')).toBe(true)
    expect(validLeagueId('not-a-league')).toBe(false)
    expect(sameOriginWrite(new Request('https://rosterlab.example/api/edge', {
      method: 'POST',
      headers: { origin: 'https://rosterlab.example' },
    }))).toBe(true)
    expect(sameOriginWrite(new Request('https://rosterlab.example/api/edge', {
      method: 'POST',
      headers: { origin: 'https://attacker.example' },
    }))).toBe(false)
  })

  it('keeps the generic intel feed behind site authentication', async () => {
    const response = await intelResponse(new Request('https://rosterlab.example/api/intel'))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ message: 'Authenticated site access required' })
  })
})
