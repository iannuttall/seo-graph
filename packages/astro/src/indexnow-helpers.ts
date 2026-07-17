/**
 * Pure helpers for IndexNow submission, extracted from the upstream
 * seo-graph integration (see NOTICE) so they are importable without the
 * full build integration.
 */
export interface IndexNowIncrementalOptions {
  /** Build-output path the manifest is written to and served from. Defaults to `indexnow-manifest.json`. */
  manifestPath?: string
  /** Absolute URL to fetch the previous manifest from. Defaults to `<siteUrl>/<manifestPath>`. */
  manifestUrl?: string
  /** Normalize HTML before hashing to strip per-build volatile markup. */
  normalize?: (html: string, url: string) => string
  /** Behaviour when the previous manifest fetch fails (non-404): 'skip' (default) or 'full'. */
  onError?: 'skip' | 'full'
}

export interface IndexNowIntegrationOptions {
  /** IndexNow key (8-128 chars from `[A-Za-z0-9-]`). Required to enable submission. */
  key: string
  /** Bare host, e.g. `example.com`. */
  host: string
  /** Absolute site origin used to resolve built HTML paths into URLs. */
  siteUrl: string
  /** Optional absolute URL to the key file. Defaults to `https://<host>/<key>.txt`. */
  keyLocation?: string
  /** Override the IndexNow endpoint. Defaults to `api.indexnow.org`. */
  endpoint?: string
  /** Filter URLs before submission; return false to skip. Composed on top of the built-in /404 exclusion. */
  filter?: (url: string) => boolean
  /** Submit only URLs changed since the last build. `true` for defaults or an options object. */
  incremental?: boolean | IndexNowIncrementalOptions
}

/**
 * Return `options` only when `branch` matches `productionBranch` (default
 * `"main"`), otherwise return `undefined` so IndexNow submission is
 * skipped entirely on preview deployments.
 */
export function indexNowOnBranch(
  branch: string,
  options: IndexNowIntegrationOptions,
  productionBranch = 'main',
) {
  return branch === productionBranch ? options : undefined
}

/**
 * Map a built HTML file's relative path to its public URL.
 */
export function htmlFileToUrl(relativePath: string, siteUrl: string): string {
  const origin = siteUrl.replace(/\/+$/, '')
  const normalized = relativePath.split(/[\\/]/).join('/')
  let pathname: string
  if (normalized === 'index.html' || normalized === '/index.html') {
    pathname = '/'
  } else if (normalized.endsWith('/index.html')) {
    pathname = '/' + normalized.slice(0, -'index.html'.length)
  } else if (normalized.endsWith('.html')) {
    pathname = '/' + normalized.slice(0, -'.html'.length)
  } else {
    pathname = '/' + normalized
  }
  return `${origin}${pathname}`
}

/**
 * Pathnames excluded from IndexNow submission by default (the 404 page).
 */
export function isDefaultExcludedFromIndexNow(url: string): boolean {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    return false
  }
  return pathname === '/404' || pathname === '/404/'
}
