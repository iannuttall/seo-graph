/**
 * Whether a page path is excluded from Markdown twins. Each entry is an exact
 * path (`/account`) or a prefix ending in `/*` (`/app/*`), which matches the
 * prefix itself and every path below it. Trailing slashes are ignored. List
 * signed-in routes here: their Markdown could show agents what a signed-out
 * visitor cannot see.
 */
export function isExcludedPath(
  excludePaths: readonly string[] | undefined,
  pathname: string,
): boolean {
  if (!excludePaths?.length) return false
  const path = trimSlash(pathname)
  return excludePaths.some((entry) => {
    if (entry.endsWith('/*')) {
      const prefix = trimSlash(entry.slice(0, -2))
      return path === prefix || path.startsWith(`${prefix}/`)
    }
    return path === trimSlash(entry)
  })
}

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/u, '') : path
}
