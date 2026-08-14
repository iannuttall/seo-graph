import { estimateMarkdownTokens } from '@iannuttall/seo-graph-core'

type MarkdownInterpolation =
  | boolean
  | number
  | readonly (boolean | number | string)[]
  | null
  | string
  | undefined

export interface MarkdownResponseOptions {
  cacheControl?: string | null
  canonical?: string | URL
  contentSignal?: string
  describedBy?: string | URL
  emitTokenHeader?: boolean
  extraHeaders?: Readonly<Record<string, string>>
  noindex?: boolean
  status?: number
}

function appendLink(headers: Headers, value: string): void {
  const existing = headers.get('Link')
  headers.set('Link', existing ? `${existing}, ${value}` : value)
}

function normalizedMarkdown(value: string): string {
  return `${value.replaceAll('\r\n', '\n').trimEnd()}\n`
}

export function markdownResponse(
  markdown: string,
  options: MarkdownResponseOptions = {},
): Response {
  const body = normalizedMarkdown(markdown)
  const headers = new Headers({
    'Content-Type': 'text/markdown; charset=utf-8',
  })
  if (options.emitTokenHeader !== false) {
    headers.set('X-Markdown-Tokens', String(estimateMarkdownTokens(body)))
  }
  if (options.cacheControl !== null && options.cacheControl !== undefined) {
    headers.set('Cache-Control', options.cacheControl)
  }
  if (options.canonical) {
    appendLink(headers, `<${options.canonical}>; rel="canonical"`)
  }
  if (options.describedBy) {
    appendLink(headers, `<${options.describedBy}>; rel="describedby"`)
  }
  if (options.noindex) headers.set('X-Robots-Tag', 'noindex, follow')
  if (options.contentSignal) {
    headers.set('Content-Signal', options.contentSignal)
  }
  for (const [name, value] of Object.entries(options.extraHeaders ?? {})) {
    headers.set(name, value)
  }
  return new Response(body, { headers, status: options.status ?? 200 })
}

function assembleMarkdown(
  strings: TemplateStringsArray,
  values: readonly MarkdownInterpolation[],
): string {
  const indents = strings
    .flatMap((part) => part.split('\n'))
    .filter((line) => line.trim())
    .map((line) => line.match(/^[ \t]*/u)?.[0].length ?? 0)
  const indent = indents.length > 0 ? Math.min(...indents) : 0
  const parts: string[] = []
  strings.forEach((part, index) => {
    parts.push(
      part
        .split('\n')
        .map((line) => line.slice(Math.min(indent, line.match(/^[ \t]*/u)?.[0].length ?? 0)))
        .join('\n'),
    )
    const value = values[index]
    if (value === null || value === undefined) return
    parts.push(Array.isArray(value) ? value.join('\n') : String(value))
  })
  return normalizedMarkdown(parts.join('').trim())
}

interface MarkdownTag {
  (strings: TemplateStringsArray, ...values: MarkdownInterpolation[]): Response
  heading(depth: number, text: string): string
  link(text: string, url: string): string
  section(heading: string, body: string): string
  string(
    strings: TemplateStringsArray,
    ...values: MarkdownInterpolation[]
  ): string
}

const markdownTag = (function markdownTag(
  strings: TemplateStringsArray,
  ...values: MarkdownInterpolation[]
): Response {
  return markdownResponse(assembleMarkdown(strings, values))
}) as MarkdownTag

markdownTag.string = (strings, ...values) => assembleMarkdown(strings, values)
markdownTag.link = (text, url) => `[${text.replace(/[[\]]/gu, '\\$&')}](${url})`
markdownTag.heading = (depth, text) => {
  if (!Number.isInteger(depth) || depth < 1 || depth > 6) {
    throw new Error('Markdown heading depth must be from 1 to 6')
  }
  return `${'#'.repeat(depth)} ${text}`
}
markdownTag.section = (heading, body) => `${heading}\n\n${body}`

/** Tagged template that returns a `text/markdown` response. */
export const md = markdownTag
