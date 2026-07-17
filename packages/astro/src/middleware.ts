import type { MiddlewareHandler } from 'astro'
import {
  canonicalFromHtml,
  htmlPathForMarkdownPath,
  markdownRouteForPath,
  renderAgentMarkdown,
} from '@iannuttall/seo-graph-core'

export interface AgentMarkdownMiddlewareOptions {
  /** Deployment base path, matching the Astro `base` option. */
  base?: string
  /** Extra selectors to strip, on top of the default exclusion contract. */
  excludeSelectors?: readonly string[]
  /**
   * `Cache-Control` for dynamically rendered Markdown when the HTML
   * response carries none. Defaults to `max-age=300`. Pass `null` to omit.
   */
  cacheControl?: string | null
  /** Optional `Content-Signal` header for both representations. */
  contentSignal?: string
  /**
   * Append `Link: <...>; rel="alternate"; type="text/markdown"` and
   * `Vary: Accept` to server-rendered HTML responses (build-time injection
   * cannot reach them). Defaults to `true`.
   */
  linkAlternate?: boolean
}

function isHtmlResponse(response: Response): boolean {
  return (response.headers.get('Content-Type') ?? '').includes('text/html')
}

function withAppendedHeaders(
  response: Response,
  apply: (headers: Headers) => void,
): Response {
  const headers = new Headers(response.headers)
  apply(headers)
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}

/**
 * Serve a live Markdown twin for server-rendered pages.
 *
 * Prerendered pages get static `.md` twins from the `agentMarkdown()` build
 * integration and are served from static assets, so this middleware never
 * sees them in production. A request for `<page>.md` that no app route
 * answers (404) is mapped back to its HTML route, rendered through the app,
 * and converted with the same contract as the build pipeline — so flipping
 * a page to `prerender = false` automatically makes its Markdown twin live
 * with no further configuration.
 *
 * ```ts
 * // src/middleware.ts
 * import { agentMarkdownMiddleware } from '@iannuttall/seo-graph-astro'
 *
 * export const onRequest = agentMarkdownMiddleware()
 * ```
 */
export function agentMarkdownMiddleware(
  options: AgentMarkdownMiddlewareOptions = {},
): MiddlewareHandler {
  const linkAlternate = options.linkAlternate !== false

  return async (context, next) => {
    const pathname = context.url.pathname
    const response = await next()

    if (!pathname.endsWith('.md')) {
      if (
        linkAlternate &&
        response.status === 200 &&
        isHtmlResponse(response)
      ) {
        const markdownPath = markdownRouteForPath(
          pathname,
          options.base,
        ).markdownPath
        const alternate = new URL(
          markdownPath,
          context.site ?? context.url,
        ).toString()
        return withAppendedHeaders(response, (headers) => {
          headers.append(
            'Link',
            `<${alternate}>; rel="alternate"; type="text/markdown"`,
          )
          if (!(headers.get('Vary') ?? '').includes('Accept')) {
            headers.append('Vary', 'Accept')
          }
          if (options.contentSignal) {
            headers.set('Content-Signal', options.contentSignal)
          }
        })
      }
      return response
    }

    // An app route (static file, collection endpoint, ...) answered the
    // `.md` request itself; never shadow it.
    if (response.status !== 404) return response

    let htmlPath: string
    try {
      htmlPath = htmlPathForMarkdownPath(pathname, options.base)
    } catch {
      return response
    }

    let htmlResponse: Response
    try {
      htmlResponse = await context.rewrite(htmlPath)
    } catch {
      return response
    }
    if (htmlResponse.status !== 200 || !isHtmlResponse(htmlResponse)) {
      return response
    }

    const html = await htmlResponse.text()
    const canonical =
      canonicalFromHtml(html) ??
      new URL(htmlPath, context.site ?? context.url).toString()

    let markdown: string
    let tokenEstimate: number
    try {
      const rendered = renderAgentMarkdown(html, canonical, {
        excludeSelectors: options.excludeSelectors,
      })
      markdown = rendered.markdown
      tokenEstimate = rendered.tokenEstimate
    } catch {
      // The page violates the content contract (no content root, no H1);
      // degrade to the original 404 rather than a server error.
      return response
    }

    const headers = new Headers({
      'Content-Type': 'text/markdown; charset=utf-8',
      'X-Markdown-Tokens': String(tokenEstimate),
    })
    headers.append('Link', `<${canonical}>; rel="canonical"`)
    headers.append('Vary', 'Accept')
    const cacheControl =
      htmlResponse.headers.get('Cache-Control') ??
      (options.cacheControl === null ? null : (options.cacheControl ?? 'max-age=300'))
    if (cacheControl) headers.set('Cache-Control', cacheControl)
    if (options.contentSignal) {
      headers.set('Content-Signal', options.contentSignal)
    }

    return new Response(markdown, { headers, status: 200 })
  }
}
