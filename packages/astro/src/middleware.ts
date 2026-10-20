import type { MiddlewareHandler } from 'astro'
import {
  acceptsMarkdown,
  canonicalFromHtml,
  htmlPathForMarkdownPath,
  isNoindexHtml,
  llmsTxtPathForPage,
  markdownRouteForPath,
  renderAgentMarkdown,
} from '@iannuttall/seo-graph-core'

export interface AgentMarkdownMiddlewareOptions {
  /** Deployment base path, matching the Astro `base` option. */
  base?: string
  /** Extra selectors to strip, on top of the default exclusion contract. */
  excludeSelectors?: readonly string[]
  /**
   * Serve Markdown at the canonical HTML URL when `Accept` prefers
   * `text/markdown`. Defaults to `false` for backward compatibility.
   */
  contentNegotiation?: boolean
  /**
   * `Cache-Control` for dynamically rendered Markdown when the HTML
   * response carries none. Defaults to `max-age=300`. Pass `null` to omit.
   */
  cacheControl?: string | null
  /** Optional `Content-Signal` header for both representations. */
  contentSignal?: string
  /**
   * Public path of the llms.txt file that describes these pages. When set,
   * covered HTML and Markdown responses get `rel="describedby"`.
   */
  llmsTxtPath?: string | readonly string[]
  /**
   * Append Markdown discovery links and `Vary: Accept` to server-rendered
   * HTML responses. Defaults to `true`.
   */
  linkAlternate?: boolean
}

function isHtmlResponse(response: Response): boolean {
  return (response.headers.get('Content-Type') ?? '').includes('text/html')
}

function isMarkdownResponse(response: Response): boolean {
  return (response.headers.get('Content-Type') ?? '').includes('text/markdown')
}

function mergeVary(headers: Headers, value: string): void {
  const values = (headers.get('Vary') ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (!values.some((item) => item.toLowerCase() === value.toLowerCase())) {
    values.push(value)
  }
  headers.set('Vary', values.join(', '))
}

function appendLink(headers: Headers, value: string): void {
  const values = (headers.get('Link') ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (!values.includes(value)) values.push(value)
  headers.set('Link', values.join(', '))
}

function withHeaders(
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

function describedByForPath(
  pathname: string,
  llmsTxtPath: string | readonly string[] | undefined,
  baseUrl: URL,
): string | undefined {
  if (!llmsTxtPath) return undefined
  const selected = llmsTxtPathForPage(llmsTxtPath, pathname)
  return selected ? new URL(selected, baseUrl).toString() : undefined
}

function appendDiscoveryLinks(
  headers: Headers,
  input: {
    alternate?: string
    canonical?: string
    describedBy?: string
  },
): void {
  if (input.alternate) {
    appendLink(
      headers,
      `<${input.alternate}>; rel="alternate"; type="text/markdown"`,
    )
  }
  if (input.canonical) {
    appendLink(headers, `<${input.canonical}>; rel="canonical"`)
  }
  if (input.describedBy) {
    appendLink(headers, `<${input.describedBy}>; rel="describedby"`)
  }
}

/**
 * Serve live Markdown twins for server-rendered pages. Content negotiation
 * is opt-in so existing sites keep their current request behavior.
 */
export function agentMarkdownMiddleware(
  options: AgentMarkdownMiddlewareOptions = {},
): MiddlewareHandler {
  const linkAlternate = options.linkAlternate !== false

  return async (context, next) => {
    const pathname = context.url.pathname
    const response = await next()
    const baseUrl = context.site ?? context.url

    if (!pathname.endsWith('.md')) {
      if (
        response.status !== 200 ||
        !isHtmlResponse(response)
      ) {
        return response
      }

      const markdownPath = markdownRouteForPath(
        pathname,
        options.base,
      ).markdownPath
      const alternate = new URL(markdownPath, baseUrl).toString()
      const describedBy = describedByForPath(
        pathname,
        options.llmsTxtPath,
        baseUrl,
      )
      const isPrerendered =
        'isPrerendered' in context && context.isPrerendered === true

      if (
        options.contentNegotiation &&
        !isPrerendered &&
        acceptsMarkdown(context.request.headers.get('Accept'))
      ) {
        let html: string
        try {
          html = await response.clone().text()
        } catch {
          return response
        }
        const canonical =
          canonicalFromHtml(html) ?? new URL(pathname, baseUrl).toString()
        try {
          const ownMarkdown = await context.rewrite(markdownPath)
          if (ownMarkdown.status === 200 && isMarkdownResponse(ownMarkdown)) {
            const headers = new Headers(ownMarkdown.headers)
            mergeVary(headers, 'Accept')
            appendDiscoveryLinks(headers, { canonical, describedBy })
            if (isNoindexHtml(html)) {
              headers.set('X-Robots-Tag', 'noindex, follow')
            }
            if (options.contentSignal) {
              headers.set('Content-Signal', options.contentSignal)
            }
            return new Response(
              context.request.method === 'HEAD' ? null : ownMarkdown.body,
              { headers, status: ownMarkdown.status },
            )
          }
        } catch {
          // Fall back to deterministic HTML conversion below.
        }
        try {
          const rendered = renderAgentMarkdown(html, canonical, {
            excludeSelectors: options.excludeSelectors,
          })
          const headers = new Headers(response.headers)
          headers.delete('Content-Encoding')
          headers.delete('Content-Length')
          headers.delete('ETag')
          headers.set('Content-Type', 'text/markdown; charset=utf-8')
          headers.set('X-Markdown-Tokens', String(rendered.tokenEstimate))
          mergeVary(headers, 'Accept')
          appendDiscoveryLinks(headers, { canonical, describedBy })
          if (isNoindexHtml(html)) {
            headers.set('X-Robots-Tag', 'noindex, follow')
          }
          if (options.contentSignal) {
            headers.set('Content-Signal', options.contentSignal)
          }
          const cacheControl =
            response.headers.get('Cache-Control') ??
            (options.cacheControl === null
              ? null
              : (options.cacheControl ?? 'max-age=300'))
          if (cacheControl) headers.set('Cache-Control', cacheControl)
          return new Response(
            context.request.method === 'HEAD' ? null : rendered.markdown,
            { headers, status: 200 },
          )
        } catch {
          return response
        }
      }

      if (!linkAlternate) {
        if (!options.contentNegotiation && !options.contentSignal) return response
        return withHeaders(response, (headers) => {
          if (options.contentNegotiation) mergeVary(headers, 'Accept')
          if (options.contentSignal) {
            headers.set('Content-Signal', options.contentSignal)
          }
        })
      }
      return withHeaders(response, (headers) => {
        appendDiscoveryLinks(headers, { alternate, describedBy })
        mergeVary(headers, 'Accept')
        if (options.contentSignal) {
          headers.set('Content-Signal', options.contentSignal)
        }
      })
    }

    // An app route or static asset answered the `.md` request itself.
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
      canonicalFromHtml(html) ?? new URL(htmlPath, baseUrl).toString()

    let markdown: string
    let tokenEstimate: number
    try {
      const rendered = renderAgentMarkdown(html, canonical, {
        excludeSelectors: options.excludeSelectors,
      })
      markdown = rendered.markdown
      tokenEstimate = rendered.tokenEstimate
    } catch {
      return response
    }

    const headers = new Headers({
      'Content-Type': 'text/markdown; charset=utf-8',
      'X-Markdown-Tokens': String(tokenEstimate),
    })
    appendDiscoveryLinks(headers, {
      canonical,
      describedBy: describedByForPath(
        htmlPath,
        options.llmsTxtPath,
        baseUrl,
      ),
    })
    mergeVary(headers, 'Accept')
    const cacheControl =
      htmlResponse.headers.get('Cache-Control') ??
      (options.cacheControl === null
        ? null
        : (options.cacheControl ?? 'max-age=300'))
    if (cacheControl) headers.set('Cache-Control', cacheControl)
    if (options.contentSignal) {
      headers.set('Content-Signal', options.contentSignal)
    }
    if (isNoindexHtml(html)) {
      headers.set('X-Robots-Tag', 'noindex, follow')
    }

    return new Response(markdown, { headers, status: 200 })
  }
}
