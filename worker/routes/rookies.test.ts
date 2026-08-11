import { describe, expect, it } from 'vitest'
import { rookieResponse } from './rookies'

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
    expect(JSON.stringify(body)).not.toContain('currentShadowBoard')
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
