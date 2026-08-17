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
  /**
   * Optional short blockquote summary. The v2 specification requires only
   * the title.
   */
  summary?: string
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

/**
 * Return the most specific llms.txt file that covers a page. This implements
 * the v2 rule for sites that publish more than one scoped file.
 */
export function llmsTxtPathForPage(
  llmsTxtPaths: string | readonly string[],
  pagePath: string,
): string | undefined {
  const paths = typeof llmsTxtPaths === 'string' ? [llmsTxtPaths] : llmsTxtPaths
  return [...new Set(paths.map((path) => normalizeLlmsTxtPath(path)))]
    .filter((path) => llmsTxtCoversPath(path, pagePath))
    .sort(
      (left, right) =>
        right.length - left.length || left.localeCompare(right, 'en-US'),
    )[0]
}

function isExternalItem(
  item: LlmsTxtRouteItem | LlmsTxtExternalItem,
): item is LlmsTxtExternalItem {
  return 'url' in item
}

function cleanTitle(value: string): string {
  return inlineText(value).replace(/\s+\|\s+[^|]+$/u, '').trim()
}

function inlineText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function linkLabel(value: string): string {
  return inlineText(value).replace(/\\/gu, '\\\\').replace(/\]/gu, '\\]')
}

function descriptionSuffix(value: string | undefined): string {
  const description = value ? inlineText(value) : ''
  return description ? `: ${description}` : ''
}

function markdownUrl(value: URL): string {
  return value.toString().replace(/\(/gu, '%28').replace(/\)/gu, '%29')
}

interface MarkdownHeading {
  index: number
  level: number
  title: string
}

function markdownHeadings(value: string): MarkdownHeading[] {
  const lines = value.replace(/\r\n?/gu, '\n').split('\n')
  const headings: MarkdownHeading[] = []
  let fence: { character: string; length: number } | undefined
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1]
    if (fenceMatch) {
      const character = fenceMatch[0] ?? ''
      if (
        fence &&
        character === fence.character &&
        fenceMatch.length >= fence.length
      ) {
        fence = undefined
      } else if (!fence) {
        fence = { character, length: fenceMatch.length }
      }
      continue
    }
    if (fence) continue

    const atx = line.match(/^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/u)
    if (atx?.[1]) {
      headings.push({
        index,
        level: atx[1].length,
        title: (atx[2] ?? '').replace(/[ \t]+#+[ \t]*$/u, '').trim(),
      })
      continue
    }

    const setext = line.match(/^ {0,3}(=+|-+)[ \t]*$/u)?.[1]
    const previous = lines[index - 1]?.trim()
    if (setext && previous) {
      headings.push({
        index,
        level: setext[0] === '=' ? 1 : 2,
        title: previous,
      })
    }
  }
  return headings
}

function assertDetailsHaveNoHeadings(details: string): void {
  if (markdownHeadings(details).length > 0) {
    throw new Error('llms.txt details must not contain Markdown headings')
  }
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
  const label = linkLabel(item.label?.trim() || cleanTitle(page.title))
  return {
    line: `- [${label}](${markdownUrl(new URL(page.markdownPath, site))})${descriptionSuffix(page.description)}`,
    page,
  }
}

function externalItem(item: LlmsTxtExternalItem, site: URL): string {
  const url = new URL(item.url, site)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`llms.txt link must use HTTP or HTTPS: ${item.url}`)
  }
  return `- [${linkLabel(item.label)}](${markdownUrl(url)})${descriptionSuffix(item.description)}`
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
    const heading = inlineText(section.heading)
    if (!heading || section.items.length === 0) {
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
    return { heading, lines }
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
    heading: inlineText(autoOptions.heading ?? '') || 'Pages',
    lines: autoPages.map(
      (page) =>
        `- [${linkLabel(cleanTitle(page.title))}](${markdownUrl(new URL(page.markdownPath, site))})${descriptionSuffix(page.description)}`,
    ),
  }
  if (generated.lines.length === 0) {
    return { pages: selectedPages, sections: manualSections }
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
  const title = inlineText(config.title)
  if (!title) throw new Error('llms.txt requires a title')
  const lines = [`# ${title}`]
  const summary = inlineText(config.summary ?? '')
  if (summary) lines.push('', `> ${summary}`)
  const details = config.details?.trim()
  if (details) {
    assertDetailsHaveNoHeadings(details)
    lines.push('', details)
  }
  return lines
}

function parseLlmsLinkLine(line: string): boolean {
  const match = line.match(
    /^ {0,3}[-+*][\t ]+\[(?:\\.|[^\]])+\]\((https?:\/\/[^\s)]+)\)(?:[\t ]*:[\t ]*.*)?$/u,
  )
  if (!match?.[1]) return false
  try {
    const url = new URL(match[1])
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Validate the strict llms.txt v2 structure used by this package. */
export function validateLlmsTxtV2(value: string): string[] {
  const normalized = value.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n')
  const lines = normalized.split('\n')
  const headings = markdownHeadings(normalized)
  const errors: string[] = []
  if (!lines[0]?.match(/^ {0,3}#\s+\S/u)) {
    errors.push('The first line must be one level-one heading.')
  }
  if (headings.filter((heading) => heading.level === 1).length !== 1) {
    errors.push('The file must contain exactly one level-one heading.')
  }
  if (headings.some((heading) => heading.level >= 3)) {
    errors.push('The file can use only level-one and level-two headings.')
  }

  const sectionHeadings = new Map(
    headings
      .filter((heading) => heading.level === 2)
      .map((heading) => [heading.index, heading]),
  )

  let inFileList = false
  let sectionTitle = ''
  let sectionLinks = 0
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim()
    const heading = sectionHeadings.get(index)
    if (heading) {
      if (inFileList && sectionLinks === 0) {
        errors.push(`Section "${sectionTitle}" has no Markdown links.`)
      }
      inFileList = true
      sectionTitle = heading.title
      sectionLinks = 0
      continue
    }
    if (!inFileList || !line) continue
    if (parseLlmsLinkLine(rawLine)) {
      sectionLinks += 1
      continue
    }
    errors.push(
      `Section "${sectionTitle}" contains a line that is not a Markdown link entry: ${line.slice(0, 120)}`,
    )
  }
  if (inFileList && sectionLinks === 0) {
    errors.push(`Section "${sectionTitle}" has no Markdown links.`)
  }
  return [...new Set(errors)]
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
  const rendered = `${lines.join('\n')}\n`
  const errors = validateLlmsTxtV2(rendered)
  if (errors.length > 0) {
    throw new Error(`Invalid llms.txt v2 output: ${errors.join(' ')}`)
  }
  return rendered
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
 * @deprecated The v2 proposal removed context-expansion tooling. Keep this
 * only for a known consumer that still requires the legacy export.
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
