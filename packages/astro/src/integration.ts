import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AstroConfig, AstroIntegration } from 'astro'
import {
  canonicalFromHtml,
  injectAgentDiscoveryLinks,
  isNoindexHtml,
  isRedirectHtml,
  llmsTxtCoversPath,
  normalizeLlmsTxtPath,
} from '@iannuttall/seo-graph-core'
import {
  type LlmsTxtConfig,
  renderLlmsFullTxt,
  renderLlmsTxt,
} from '@iannuttall/seo-graph-core'
import {
  type AgentRouteManifest,
  type AgentRouteManifestEntry,
  renderAgentRouteManifest,
  sha256,
} from '@iannuttall/seo-graph-core'
import { renderAgentMarkdown } from '@iannuttall/seo-graph-core'
import { assertNoRouteCollisions, markdownRouteForPath } from '@iannuttall/seo-graph-core'

export interface AgentLlmsTxtOptions extends LlmsTxtConfig {
  /** Public output path. Defaults to `<base>/llms.txt`. */
  outputPath?: string
}

export interface AgentLlmsFullTxtOptions {
  /** Public output path. Defaults beside llms.txt as `llms-full.txt`. */
  outputPath?: string
}

export interface AgentMarkdownIntegrationOptions {
  excludeSelectors?: readonly string[]
  manifestFile?: string
  llmsTxt?: AgentLlmsTxtOptions
  /** Optional one-file export. Disabled by default and requires `llmsTxt`. */
  llmsFullTxt?: boolean | AgentLlmsFullTxtOptions
  /**
   * Add package middleware for live twins and canonical URL content
   * negotiation. Disabled by default. Use `agentMarkdownMiddleware()`
   * directly when you need custom runtime options.
   */
  runtimeMiddleware?: boolean
  strict?: boolean
  /**
   * Append per-file rules for every generated `.md` route to the build's
   * `_headers` file (Cloudflare/Netlify format): `Content-Type`, a
   * canonical `Link`, `Vary: Accept`, and `X-Markdown-Tokens`. Enabled by
   * default; pass `false` on hosts that don't read `_headers`.
   */
  cloudflareHeaders?: boolean
}

type BuildConfig = Pick<AstroConfig, 'base' | 'build' | 'output' | 'site'>

async function walkHtmlFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en-US'))
    for (const entry of entries) {
      const path = resolve(current, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && entry.name.endsWith('.html')) files.push(path)
    }
  }
  await walk(directory)
  return files
}

function outputRelativePath(outputDir: string, file: string): string {
  return relative(outputDir, file).split(sep).join('/')
}

function isStatusPage(file: string): boolean {
  return /(?:^|\/)(?:404|500)(?:\/index)?\.html$/u.test(file)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function assertCanonicalSite(canonical: URL, site: URL): void {
  if (canonical.origin !== site.origin) {
    throw new Error(`Canonical ${canonical} is outside configured site ${site}`)
  }
}

function normalizedBase(base = '/'): string {
  if (!base.startsWith('/')) throw new Error('Base path must start with /')
  return base.replace(/\/+$/u, '') || '/'
}

function resolveLlmsTxtPublicPath(
  outputPath: string | undefined,
  base: string | undefined,
): string {
  const basePath = normalizedBase(base)
  return normalizeLlmsTxtPath(
    outputPath ?? `${basePath === '/' ? '' : basePath}/llms.txt`,
  )
}

function normalizeLlmsFullTxtPath(path: string): string {
  if (!path.startsWith('/') || path.includes('?') || path.includes('#')) {
    throw new Error('llms-full.txt path must be an absolute URL path')
  }
  if (path.includes('\\') || /%(?:2f|5c)/iu.test(path)) {
    throw new Error('llms-full.txt path contains a separator')
  }
  const segments = path.split('/').filter(Boolean)
  for (const segment of segments) {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      throw new Error(`llms-full.txt path contains invalid encoding: ${segment}`)
    }
    if (decoded === '.' || decoded === '..') {
      throw new Error('llms-full.txt path contains traversal')
    }
  }
  if (segments.at(-1)?.toLowerCase() !== 'llms-full.txt') {
    throw new Error('llms-full.txt path must end with /llms-full.txt')
  }
  return `/${segments.join('/')}`
}

function resolveLlmsFullTxtPublicPath(
  outputPath: string | undefined,
  llmsTxtPath: string,
): string {
  return normalizeLlmsFullTxtPath(
    outputPath ?? llmsTxtPath.replace(/llms\.txt$/u, 'llms-full.txt'),
  )
}

function outputFileForPublicPath(
  outputDir: string,
  publicPath: string,
  base: string | undefined,
): string {
  const basePath = normalizedBase(base)
  if (
    basePath !== '/' &&
    publicPath !== basePath &&
    !publicPath.startsWith(`${basePath}/`)
  ) {
    throw new Error(`Output path ${publicPath} is outside base ${basePath}`)
  }
  const relativePath =
    basePath === '/'
      ? publicPath.slice(1)
      : publicPath.slice(basePath.length).replace(/^\//u, '')
  const target = resolve(
    outputDir,
    ...relativePath.split('/').map((segment) => decodeURIComponent(segment)),
  )
  if (!target.startsWith(`${outputDir}${sep}`)) {
    throw new Error(`Output path escapes build directory: ${publicPath}`)
  }
  return target
}

const HEADERS_MARKER =
  '# Generated agent markdown headers. Do not edit in build output.'

export async function writeAgentMarkdownArtifacts(input: {
  base?: string
  excludeSelectors?: readonly string[]
  manifestFile?: string
  llmsTxt?: AgentLlmsTxtOptions
  llmsFullTxt?: boolean | AgentLlmsFullTxtOptions
  cloudflareHeaders?: boolean
  outputDir: string
  site: string
}): Promise<AgentRouteManifestEntry[]> {
  const outputDir = resolve(input.outputDir)
  const site = new URL(input.site)
  if (input.llmsFullTxt && !input.llmsTxt) {
    throw new Error('llmsFullTxt requires an llmsTxt configuration')
  }
  const llmsTxtPath = input.llmsTxt
    ? resolveLlmsTxtPublicPath(input.llmsTxt.outputPath, input.base)
    : undefined
  const llmsTxtUrl = llmsTxtPath
    ? new URL(llmsTxtPath, site).toString()
    : undefined
  const prepared: Array<{
    entry: AgentRouteManifestEntry
    html: string
    htmlFile: string
    markdown: string
    markdownFile: string
  }> = []

  for (const htmlFile of await walkHtmlFiles(outputDir)) {
    const relativeHtmlFile = outputRelativePath(outputDir, htmlFile)
    if (isStatusPage(relativeHtmlFile)) continue

    const html = await readFile(htmlFile, 'utf8')
    if (isRedirectHtml(html)) continue
    const canonicalValue = canonicalFromHtml(html)
    if (!canonicalValue) {
      throw new Error(`Missing canonical in ${relativeHtmlFile}`)
    }
    const canonical = new URL(canonicalValue, site)
    assertCanonicalSite(canonical, site)
    const route = markdownRouteForPath(canonical.pathname, input.base)
    const markdownFile = resolve(outputDir, route.filePath)
    if (!markdownFile.startsWith(`${outputDir}${sep}`)) {
      throw new Error(`Markdown target escapes output: ${route.filePath}`)
    }

    const rendered = renderAgentMarkdown(html, canonical.toString(), {
      excludeSelectors: input.excludeSelectors,
    })
    const absoluteMarkdownUrl = new URL(route.markdownPath, site).toString()
    const injectedHtml = injectAgentDiscoveryLinks(html, {
      markdownUrl: absoluteMarkdownUrl,
      llmsTxtUrl:
        llmsTxtPath && llmsTxtCoversPath(llmsTxtPath, canonical.pathname)
          ? llmsTxtUrl
          : undefined,
    })
    const bytes = Buffer.byteLength(rendered.markdown)
    prepared.push({
      entry: {
        bytes,
        canonical: canonical.toString(),
        description: rendered.metadata.description,
        htmlFile: relativeHtmlFile,
        htmlPath: route.htmlPath,
        language: rendered.metadata.language,
        markdownFile: outputRelativePath(outputDir, markdownFile),
        markdownPath: route.markdownPath,
        noindex: isNoindexHtml(html),
        sha256: sha256(rendered.markdown),
        title: rendered.metadata.title,
        tokens: rendered.tokenEstimate,
      },
      html: injectedHtml,
      htmlFile,
      markdown: rendered.markdown,
      markdownFile,
    })
  }

  assertNoRouteCollisions(
    prepared.map((item) =>
      markdownRouteForPath(item.entry.htmlPath, input.base),
    ),
  )
  prepared.sort((left, right) =>
    left.entry.htmlPath.localeCompare(right.entry.htmlPath, 'en-US'),
  )

  for (const item of prepared) {
    if (await exists(item.markdownFile)) {
      const existing = await readFile(item.markdownFile, 'utf8')
      if (existing !== item.markdown) {
        throw new Error(
          `Refusing to overwrite existing Markdown: ${item.entry.markdownFile}`,
        )
      }
    }
  }

  for (const item of prepared) {
    await mkdir(dirname(item.markdownFile), { recursive: true })
    await writeFile(item.markdownFile, item.markdown, 'utf8')
    await writeFile(item.htmlFile, item.html, 'utf8')
  }

  const manifestPath = resolve(
    outputDir,
    input.manifestFile ?? 'agent-routes.json',
  )
  const manifest: AgentRouteManifest = {
    version: 1,
    site: site.origin,
    pages: prepared.map((item) => item.entry),
  }
  await writeFile(
    manifestPath,
    renderAgentRouteManifest(site.origin, manifest.pages),
    'utf8',
  )
  if (input.llmsTxt) {
    const scopedManifest: AgentRouteManifest = {
      ...manifest,
      pages: manifest.pages.filter((page) =>
        llmsTxtCoversPath(llmsTxtPath!, page.htmlPath),
      ),
    }
    const llmsFile = outputFileForPublicPath(
      outputDir,
      llmsTxtPath!,
      input.base,
    )
    await mkdir(dirname(llmsFile), { recursive: true })
    await writeFile(
      llmsFile,
      renderLlmsTxt(scopedManifest, input.llmsTxt),
      'utf8',
    )
    if (input.llmsFullTxt) {
      const fullOptions =
        typeof input.llmsFullTxt === 'object' ? input.llmsFullTxt : {}
      const fullPath = resolveLlmsFullTxtPublicPath(
        fullOptions.outputPath,
        llmsTxtPath!,
      )
      const fullFile = outputFileForPublicPath(
        outputDir,
        fullPath,
        input.base,
      )
      const markdownByHtmlPath = new Map(
        prepared.map((item) => [item.entry.htmlPath, item.markdown]),
      )
      await mkdir(dirname(fullFile), { recursive: true })
      await writeFile(
        fullFile,
        renderLlmsFullTxt(
          scopedManifest,
          input.llmsTxt,
          markdownByHtmlPath,
        ),
        'utf8',
      )
    }
  }

  if (input.cloudflareHeaders !== false) {
    const headersPath = resolve(outputDir, '_headers')
    const existingRaw = (await exists(headersPath))
      ? await readFile(headersPath, 'utf8')
      : ''
    // Idempotent: strip a previously generated section before appending so
    // repeated runs produce identical bytes.
    const markerIndex = existingRaw.indexOf(HEADERS_MARKER)
    const existing = (
      markerIndex === -1 ? existingRaw : existingRaw.slice(0, markerIndex)
    ).trimEnd()
    const rules = manifest.pages.map((page) => {
      const linkValues = [`<${page.canonical}>; rel="canonical"`]
      if (
        llmsTxtPath &&
        llmsTxtUrl &&
        llmsTxtCoversPath(llmsTxtPath, page.htmlPath)
      ) {
        linkValues.push(`<${llmsTxtUrl}>; rel="describedby"`)
      }
      return [
        page.markdownPath,
        '  ! Vary',
        '  Content-Type: text/markdown; charset=utf-8',
        `  Link: ${linkValues.join(', ')}`,
        '  Vary: Accept',
        `  X-Markdown-Tokens: ${page.tokens}`,
      ].join('\n')
    })
    await writeFile(
      headersPath,
      `${existing}${existing ? '\n\n' : ''}${HEADERS_MARKER}\n${rules.join('\n\n')}\n`,
      'utf8',
    )
  }

  return prepared.map((item) => item.entry)
}

export function agentMarkdown(
  options: AgentMarkdownIntegrationOptions = {},
): AstroIntegration {
  const strict = options.strict !== false
  let config: BuildConfig | undefined

  return {
    name: '@iannuttall/seo-graph-astro',
    hooks: {
      'astro:config:setup': ({ addMiddleware }) => {
        if (options.runtimeMiddleware) {
          addMiddleware({
            entrypoint: new URL('./runtime-middleware.js', import.meta.url),
            order: 'post',
          })
        }
      },
      'astro:config:done': ({ config: resolvedConfig }) => {
        if (strict && !resolvedConfig.site) {
          throw new Error('@iannuttall/seo-graph-astro requires a configured site URL')
        }
        config = resolvedConfig
      },
      'astro:build:done': async ({ dir, logger }) => {
        if (!config?.site) {
          if (strict) throw new Error('@iannuttall/seo-graph-astro did not receive a site URL')
          return
        }
        const pages = await writeAgentMarkdownArtifacts({
          base: config.base,
          excludeSelectors: options.excludeSelectors,
          manifestFile: options.manifestFile,
          llmsTxt: options.llmsTxt,
          llmsFullTxt: options.llmsFullTxt,
          cloudflareHeaders: options.cloudflareHeaders,
          // Static builds emit HTML into the build dir itself; server and
          // hybrid builds put prerendered HTML in build.client.
          outputDir: fileURLToPath(
            config.output === 'static' ? dir : config.build.client,
          ),
          site: config.site.toString(),
        })
        logger.info(`Generated ${pages.length} Markdown alternatives.`)
      },
    },
  }
}
