import { parseHTML } from 'linkedom'

const markdownAlternatePattern =
  /<link\b(?=[^>]*\brel\s*=\s*["'][^"']*\balternate\b[^"']*["'])(?=[^>]*\btype\s*=\s*["']text\/markdown["'])[^>]*>\s*/giu

const llmsDescribedByPattern =
  /<link\b(?=[^>]*\brel\s*=\s*["'][^"']*\bdescribedby\b[^"']*["'])(?=[^>]*\bhref\s*=\s*["'][^"']*\/llms\.txt["'])[^>]*>\s*/giu

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function attributeValue(element: Element, name: string): string | null {
  const actualName = [...element.getAttributeNames()].find(
    (attribute) => attribute.toLowerCase() === name,
  )
  return actualName ? element.getAttribute(actualName) : null
}

export function injectMarkdownAlternate(
  html: string,
  markdownUrl: string,
): string {
  return injectAgentDiscoveryLinks(html, { markdownUrl })
}

export interface AgentDiscoveryLinks {
  llmsTxtUrl?: string
  markdownUrl: string
}

export function injectAgentDiscoveryLinks(
  html: string,
  links: AgentDiscoveryLinks,
): string {
  const withoutManagedLinks = html.replace(markdownAlternatePattern, '')
  const withoutDiscoveryLinks = withoutManagedLinks.replace(
    llmsDescribedByPattern,
    '',
  )
  const closeHead = /<\/head\s*>/iu
  if (!closeHead.test(withoutDiscoveryLinks)) {
    throw new Error('Cannot inject Markdown alternate without </head>')
  }
  const tags = [
    `<link rel="alternate" type="text/markdown" href="${escapeAttribute(links.markdownUrl)}">`,
  ]
  if (links.llmsTxtUrl) {
    tags.push(
      `<link rel="describedby" href="${escapeAttribute(links.llmsTxtUrl)}">`,
    )
  }
  return withoutDiscoveryLinks.replace(closeHead, `${tags.join('\n')}\n</head>`)
}

export function isRedirectHtml(html: string): boolean {
  const { document } = parseHTML(html)
  return (
    [...document.querySelectorAll('meta')].some(
      (meta) => attributeValue(meta, 'http-equiv')?.toLowerCase() === 'refresh',
    ) || Boolean(document.querySelector('[data-astro-redirect]'))
  )
}

export function isNoindexHtml(html: string): boolean {
  const { document } = parseHTML(html)
  return [...document.querySelectorAll('meta')]
    .filter((meta) => attributeValue(meta, 'name')?.toLowerCase() === 'robots')
    .some((meta) =>
      (attributeValue(meta, 'content') ?? '')
        .split(',')
        .some((directive) => directive.trim().toLowerCase() === 'noindex'),
    )
}

export function canonicalFromHtml(html: string): string | undefined {
  const { document } = parseHTML(html)
  const link = [...document.querySelectorAll('link')].find((candidate) =>
    (attributeValue(candidate, 'rel') ?? '')
      .toLowerCase()
      .split(/\s+/u)
      .includes('canonical'),
  )
  return link ? attributeValue(link, 'href')?.trim() : undefined
}
