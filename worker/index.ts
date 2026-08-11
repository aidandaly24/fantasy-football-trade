import { refreshTrackedMarketTapes } from './edge-learning-store'
import { refreshHistoricalTapeAudits } from './historical-tape-store'
import { refreshDueResearch } from './research-store'
import type { Env } from './env'
import { alertsResponse, ensureAlertRefreshSchema, refreshAlertEvents } from './routes/alerts'
import { edgeResponse } from './routes/edge'
import { intelResponse } from './routes/intel'
import { journalResponse } from './routes/journal'
import { preferencesResponse } from './routes/preferences'
import { researchResponse } from './routes/research'
import { rookieResponse } from './routes/rookies'

const routes: Record<string, (request: Request, env: Env) => Promise<Response>> = {
  '/api/alerts': alertsResponse,
  '/api/edge': edgeResponse,
  '/api/intel': (request) => intelResponse(request),
  '/api/journal': journalResponse,
  '/api/preferences': preferencesResponse,
  '/api/research': researchResponse,
  '/api/rookies': rookieResponse,
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
  async scheduled(_controller: unknown, env: Env, context: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
    if (!env.DB) return
    context.waitUntil((async () => {
      await Promise.all([
        (async () => {
          await ensureAlertRefreshSchema(env.DB!)
          await refreshAlertEvents(env.DB!)
        })(),
        refreshTrackedMarketTapes(env.DB!),
        refreshHistoricalTapeAudits(env.DB!),
        refreshDueResearch(env.DB!),
      ])
    })())
  },
}

export default worker
