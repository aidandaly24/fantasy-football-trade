export function privateJson(body: unknown, status = 200, cacheControl = 'private, no-store'): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export function privateJsonAttachment(body: unknown, filename: string): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, '-')}"`,
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export function validLeagueId(value: string | null): value is string {
  return Boolean(value && /^\d{8,24}$/.test(value))
}

export function sameOriginWrite(request: Request): boolean {
  const origin = request.headers.get('origin')
  return !origin || origin === new URL(request.url).origin
}

export function methodNotAllowed(allow: string): Response {
  return new Response('Method not allowed', { status: 405, headers: { Allow: allow } })
}
