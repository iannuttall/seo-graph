import type { AgentRouteManifest, AgentRouteManifestEntry } from './manifest.js'

export interface LlmsTxtRouteItem {
  label?: string
  path: string
}

export interface LlmsTxtExternalItem {
  description?: string
  label: string
  url: string
}

export interface LlmsTxtSection {
  heading: string
  items: readonly (LlmsTxtRouteItem | LlmsTxtExternalItem)[]
}

export interface LlmsTxtAutoSectionOptions {
  /** Heading for the generated list. Defaults to `Pages`. */
  heading?: string
  /** Place the generated section before or after manual sections. */
  position?: 'after' | 'before'
}

export interface LlmsTxtConfig {
  /**
   * Add every indexable manifest page that is not already in a manual
   * section. When `sections` is omitted, this defaults to `true` so the
   * documented title-and-summary setup creates a useful index.
   */
  autoSection?: boolean | LlmsTxtAutoSectionOptions
  /** Optional free-form Markdown between the summary and file sections. */
  details?: string
  /** Curated file sections. Existing explicit configurations are unchanged. */
  sections?: readonly LlmsTxtSection[]
  summary: string
  title: string
}

export function normalizeLlmsTxtPath(path = '/llms.txt'): string {
  if (!path.startsWith('/') || path.includes('?') || path.includes('#')) {
    throw new Error('llms.txt path must be an absolute URL path')
  }
  if (path.includes('\\') || /%(?:2f|5c)/iu.test(path)) {
    throw new Error('llms.txt path contains a separator')
  }
  const segments = path.split('/').filter(Boolean)
  for (const segment of segments) {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      throw new Error(`llms.txt path contains invalid encoding: ${segment}`)
    }
    if (decoded === '.' || decoded === '..') {
      throw new Error('llms.txt path contains traversal')
    }
  }
  if (segments.at(-1)?.toLowerCase() !== 'llms.txt') {
    throw new Error('llms.txt path must end with /llms.txt')
  }
  return `/${segments.join('/')}`
}

export function llmsTxtCoversPath(
  llmsTxtPath: string,
  pagePath: string,
): boolean {
  const normalized = normalizeLlmsTxtPath(llmsTxtPath)
  const scope = normalized.slice(0, -'/llms.txt'.length) || '/'
  if (scope === '/') return pagePath.startsWith('/')
  return pagePath === scope || pagePath.startsWith(`${scope}/`)
}

function isExternalItem(
  item: LlmsTxtRouteItem | LlmsTxtExternalItem,
): item is LlmsTxtExternalItem {
  return 'url' in item
}

function cleanTitle(value: string): string {
  return value.replace(/\s+\|\s+[^|]+$/u, '').trim()
}

function routeItem(
  item: LlmsTxtRouteItem,
  pages: ReadonlyMap<string, AgentRouteManifestEntry>,
  site: URL,
): { line: string; page: AgentRouteManifestEntry } {
  const page = pages.get(item.path)
  if (!page)
    throw new Error(`llms.txt route is not in the manifest: ${item.path}`)
  if (page.noindex) {
    throw new Error(`llms.txt route must be indexable: ${item.path}`)
  }
  const label = item.label?.trim() || cleanTitle(page.title)
  return {
    line: `- [${label}](${new URL(page.markdownPath, site)}): ${page.description}`,
    page,
  }
}

function externalItem(item: LlmsTxtExternalItem, site: URL): string {
  const url = new URL(item.url, site)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`llms.txt link must use HTTP or HTTPS: ${item.url}`)
  }
  const description = item.description ? `: ${item.description}` : ''
  return `- [${item.label}](${url})${description}`
}

interface ResolvedLlmsTxtSection {
  heading: string
  lines: string[]
}

interface ResolvedLlmsTxt {
  pages: AgentRouteManifestEntry[]
  sections: ResolvedLlmsTxtSection[]
}

function resolveLlmsTxt(
  manifest: AgentRouteManifest,
  config: LlmsTxtConfig,
): ResolvedLlmsTxt {
  const site = new URL(manifest.site)
  const pageMap = new Map(manifest.pages.map((page) => [page.htmlPath, page]))
  const seen = new Set<string>()
  const selectedPages: AgentRouteManifestEntry[] = []
  const manualSections = (config.sections ?? []).map((section) => {
    if (!section.heading.trim() || section.items.length === 0) {
      throw new Error(
        'llms.txt sections require a heading and at least one item',
      )
    }
    const lines = section.items.map((item) => {
      const key = isExternalItem(item)
        ? new URL(item.url, site).toString()
        : item.path
      if (seen.has(key)) throw new Error(`Duplicate llms.txt item: ${key}`)
      seen.add(key)
      if (isExternalItem(item)) return externalItem(item, site)
      const resolved = routeItem(item, pageMap, site)
      selectedPages.push(resolved.page)
      return resolved.line
    })
    return { heading: section.heading, lines }
  })

  const autoSection =
    config.autoSection ?? (config.sections === undefined ? true : false)
  if (autoSection === false) {
    return { pages: selectedPages, sections: manualSections }
  }

  const autoPages = manifest.pages
    .filter((page) => !page.noindex && !seen.has(page.htmlPath))
    .sort((left, right) =>
      left.htmlPath.localeCompare(right.htmlPath, 'en-US'),
    )
  if (autoPages.length === 0) {
    return { pages: selectedPages, sections: manualSections }
  }

  const autoOptions = typeof autoSection === 'object' ? autoSection : {}
  const generated: ResolvedLlmsTxtSection = {
    heading: autoOptions.heading?.trim() || 'Pages',
    lines: autoPages.map(
      (page) =>
        `- [${cleanTitle(page.title)}](${new URL(page.markdownPath, site)}): ${page.description}`,
    ),
  }
  const sections =
    autoOptions.position === 'before'
      ? [generated, ...manualSections]
      : [...manualSections, generated]
  const pages =
    autoOptions.position === 'before'
      ? [...autoPages, ...selectedPages]
      : [...selectedPages, ...autoPages]
  return { pages, sections }
}

function renderHeader(config: LlmsTxtConfig): string[] {
  if (!config.title.trim() || !config.summary.trim()) {
    throw new Error('llms.txt requires a title and summary')
  }
  const lines = [`# ${config.title.trim()}`, '', `> ${config.summary.trim()}`]
  const details = config.details?.trim()
  if (details) lines.push('', details)
  return lines
}

export function renderLlmsTxt(
  manifest: AgentRouteManifest,
  config: LlmsTxtConfig,
): string {
  const resolved = resolveLlmsTxt(manifest, config)
  const lines = renderHeader(config)
  for (const section of resolved.sections) {
    lines.push('', `## ${section.heading.trim()}`, '', ...section.lines)
  }
  return `${lines.join('\n')}\n`
}

function markdownBody(markdown: string): string {
  return markdown
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)*/u, '')
    .replace(/^#\s+[^\n]+(?:\n+)*/u, '')
    .trim()
}

/**
 * Create an optional one-file export from the same selected pages as
 * `renderLlmsTxt`. `llms-full.txt` is a convenience format, not part of the
 * llms.txt v2 proposal.
 */
export function renderLlmsFullTxt(
  manifest: AgentRouteManifest,
  config: LlmsTxtConfig,
  markdownByHtmlPath: ReadonlyMap<string, string>,
): string {
  const resolved = resolveLlmsTxt(manifest, config)
  const lines = renderHeader(config)
  for (const page of resolved.pages) {
    const markdown = markdownByHtmlPath.get(page.htmlPath)
    if (markdown === undefined) {
      throw new Error(`Missing Markdown for llms-full.txt route: ${page.htmlPath}`)
    }
    lines.push('', `## ${cleanTitle(page.title)}`, '', markdownBody(markdown))
  }
  return `${lines.join('\n')}\n`
}
