import {
  acceptsMarkdown,
  htmlPathForMarkdownPath,
  llmsTxtCoversPath,
  markdownRouteForPath,
  normalizeLlmsTxtPath,
  parseAccept,
} from '@iannuttall/seo-graph-core'

export { acceptsMarkdown, parseAccept }

export interface AssetFetcher {
  fetch(request: Request): Promise<Response>
}

export interface CloudflareMarkdownOptions {
  base?: string
  canonicalHosts?: readonly string[]
  contentSignal?: string
  ignoredMarkdownPrefixes?: readonly string[]
  /** Public llms.txt path used for `rel="describedby"` discovery. */
  llmsTxtPath?: string
  noindexPaths?: readonly string[]
  responseHeaders?: Readonly<Record<string, string>>
  site: string
}

const defaultIgnoredMarkdownPrefixes = ['/.well-known/'] as const

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
  const existing = headers.get('Link')
  if (!existing) {
    headers.set('Link', value)
    return
  }
  if (!existing.split(',').some((part) => part.trim() === value)) {
    headers.set('Link', `${existing}, ${value}`)
  }
}

function withPolicyHeaders(
  response: Response,
  options: Pick<CloudflareMarkdownOptions, 'contentSignal' | 'responseHeaders'>,
): Response {
  if (!options.contentSignal && !options.responseHeaders) return response
  const headers = new Headers(response.headers)
  if (options.contentSignal) {
    headers.set('Content-Signal', options.contentSignal)
  }
  for (const [name, value] of Object.entries(options.responseHeaders ?? {})) {
    headers.set(name, value)
  }
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}

function applyNoindex(headers: Headers, noindex: boolean): void {
  if (noindex) headers.set('X-Robots-Tag', 'noindex, follow')
}

function responseWithHeaders(
  response: Response,
  request: Request,
  update: (headers: Headers) => void,
): Response {
  const headers = new Headers(response.headers)
  update(headers)
  return new Response(request.method === 'HEAD' ? null : response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}

function isHtml(response: Response): boolean {
  return response.headers.get('Content-Type')?.includes('text/html') ?? false
}

function isRepresentationResponse(response: Response): boolean {
  return (
    (response.status >= 200 && response.status < 300) || response.status === 304
  )
}

function isManagedMarkdown(
  pathname: string,
  ignoredPrefixes: readonly string[],
): boolean {
  return (
    pathname.endsWith('.md') &&
    !ignoredPrefixes.some((prefix) => pathname.startsWith(prefix))
  )
}

function canonicalUrl(site: URL, path: string): string {
  return new URL(path, site).toString()
}

async function markdownResponse(input: {
  canonical: string
  contentSignal?: string
  describedBy?: string
  request: Request
  responseHeaders?: Readonly<Record<string, string>>
  response: Response
}): Promise<Response> {
  const headers = new Headers(input.response.headers)
  const body =
    input.response.status === 304 || input.request.method === 'HEAD'
      ? null
      : input.response.body

  headers.set('Content-Type', 'text/markdown; charset=utf-8')
  appendLink(headers, `<${input.canonical}>; rel="canonical"`)
  if (input.describedBy) {
    appendLink(headers, `<${input.describedBy}>; rel="describedby"`)
  }
  if (!headers.has('X-Markdown-Tokens')) {
    const contentRange = headers.get('Content-Range')
    const rangeTotal = contentRange?.match(/\/(\d+)$/u)?.[1]
    const byteLength = Number(
      rangeTotal ??
        (input.response.status === 304
          ? Number.NaN
          : headers.get('Content-Length')),
    )
    if (Number.isSafeInteger(byteLength) && byteLength >= 0) {
      headers.set('X-Markdown-Tokens', String(Math.ceil(byteLength / 4)))
    }
  }
  if (input.contentSignal) {
    headers.set('Content-Signal', input.contentSignal)
  }
  for (const [name, value] of Object.entries(input.responseHeaders ?? {})) {
    headers.set(name, value)
  }
  mergeVary(headers, 'Accept')

  return new Response(body, {
    headers,
    status: input.response.status,
    statusText: input.response.statusText,
  })
}

export function createCloudflareMarkdownHandler(
  options: CloudflareMarkdownOptions,
): (request: Request, assets: AssetFetcher) => Promise<Response> {
  const site = new URL(options.site)
  const canonicalHosts = new Set(options.canonicalHosts ?? [site.hostname])
  const ignoredPrefixes =
    options.ignoredMarkdownPrefixes ?? defaultIgnoredMarkdownPrefixes
  const noindexPaths = new Set(options.noindexPaths ?? [])
  const llmsTxtPath = options.llmsTxtPath
    ? normalizeLlmsTxtPath(options.llmsTxtPath)
    : undefined
  const describedBy = (pathname: string): string | undefined =>
    llmsTxtPath && llmsTxtCoversPath(llmsTxtPath, pathname)
      ? canonicalUrl(site, llmsTxtPath)
      : undefined

  return async (request, assets) => {
    const requestUrl = new URL(request.url)
    if (
      canonicalHosts.has(requestUrl.hostname) &&
      requestUrl.hostname !== site.hostname
    ) {
      const destination = new URL(
        `${requestUrl.pathname}${requestUrl.search}`,
        site,
      )
      return withPolicyHeaders(Response.redirect(destination, 308), options)
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        headers: {
          Allow: 'GET, HEAD',
          ...(options.contentSignal
            ? { 'Content-Signal': options.contentSignal }
            : {}),
          ...options.responseHeaders,
        },
        status: 405,
      })
    }

    if (isManagedMarkdown(requestUrl.pathname, ignoredPrefixes)) {
      const response = await assets.fetch(request)
      if (!isRepresentationResponse(response)) {
        return withPolicyHeaders(response, options)
      }
      const htmlPath = htmlPathForMarkdownPath(
        requestUrl.pathname,
        options.base,
      )
      const result = await markdownResponse({
        canonical: canonicalUrl(site, htmlPath),
        contentSignal: options.contentSignal,
        describedBy: describedBy(htmlPath),
        responseHeaders: options.responseHeaders,
        response,
        request,
      })
      return responseWithHeaders(result, request, (headers) => {
        applyNoindex(headers, noindexPaths.has(htmlPath))
      })
    }

    if (acceptsMarkdown(request.headers.get('Accept'))) {
      const markdownUrl = new URL(request.url)
      markdownUrl.pathname = markdownRouteForPath(
        markdownUrl.pathname,
        options.base,
      ).markdownPath
      const assetRequest = new Request(markdownUrl, request)
      const response = await assets.fetch(assetRequest)
      if (isRepresentationResponse(response)) {
        const result = await markdownResponse({
          canonical: canonicalUrl(site, requestUrl.pathname),
          contentSignal: options.contentSignal,
          describedBy: describedBy(requestUrl.pathname),
          responseHeaders: options.responseHeaders,
          response,
          request,
        })
        return responseWithHeaders(result, request, (headers) => {
          applyNoindex(headers, noindexPaths.has(requestUrl.pathname))
        })
      }
    }

    const response = await assets.fetch(request)
    if (
      !isRepresentationResponse(response) ||
      (response.status !== 304 && !isHtml(response))
    ) {
      return withPolicyHeaders(response, options)
    }

    return responseWithHeaders(response, request, (headers) => {
      appendLink(
        headers,
        `<${canonicalUrl(site, markdownRouteForPath(requestUrl.pathname, options.base).markdownPath)}>; rel="alternate"; type="text/markdown"`,
      )
      const llmsUrl = describedBy(requestUrl.pathname)
      if (llmsUrl) {
        appendLink(headers, `<${llmsUrl}>; rel="describedby"`)
      }
      if (options.contentSignal) {
        headers.set('Content-Signal', options.contentSignal)
      }
      for (const [name, value] of Object.entries(
        options.responseHeaders ?? {},
      )) {
        headers.set(name, value)
      }
      mergeVary(headers, 'Accept')
      applyNoindex(headers, noindexPaths.has(requestUrl.pathname))
    })
  }
}
