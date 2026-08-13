import type { Env } from './env'
import { alertsResponse } from './routes/alerts'
import { edgeResponse } from './routes/edge'
import { intelResponse } from './routes/intel'
import { journalResponse } from './routes/journal'
import { preferencesResponse } from './routes/preferences'
import { researchResponse } from './routes/research'
import { rookieResponse } from './routes/rookies'
import { tradeTapeResponse } from './routes/trade-tape'
import { teamHistoryResponse } from './routes/team-history'
import { decisionsResponse } from './routes/decisions'

const routes: Record<string, (request: Request, env: Env) => Promise<Response>> = {
  '/api/alerts': alertsResponse,
  '/api/edge': edgeResponse,
  '/api/intel': (request) => intelResponse(request),
  '/api/journal': journalResponse,
  '/api/preferences': preferencesResponse,
  '/api/research': researchResponse,
  '/api/rookies': rookieResponse,
  '/api/trade-tape': tradeTapeResponse,
  '/api/team-history': teamHistoryResponse,
  '/api/decisions': decisionsResponse,
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const route = routes[url.pathname]
    if (route) return route(request, env)

    const response = await env.ASSETS.fetch(request)
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) return response

    const origin = new URL(request.url).origin
    const html = (await response.text()).replaceAll('__SITE_ORIGIN__', origin)
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  },
}

export default worker
