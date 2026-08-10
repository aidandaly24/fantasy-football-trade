interface AssetsBinding {
  fetch(request: Request): Promise<Response>
}

interface Env {
  ASSETS: AssetsBinding
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
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
