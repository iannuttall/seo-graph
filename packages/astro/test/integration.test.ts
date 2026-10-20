import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'vitest'
import {
  agentMarkdown,
  writeAgentMarkdownArtifacts,
} from '../src/integration.js'

const llmsTxt = {
  title: 'Example',
  summary: 'Useful docs for agents.',
  sections: [{ heading: 'Start here', items: [{ path: '/' }] }],
} as const

function page(path: string, title: string, noindex = false): string {
  return `<!doctype html><html lang="en"><head>
    <title>${title}</title>
    <meta name="description" content="${title} description">
    ${noindex ? '<meta name="robots" content="noindex, follow">' : ''}
    <link rel="canonical" href="https://example.com${path}">
  </head><body><main><h1>${title}</h1><p>Useful ${title} content.</p></main></body></html>`
}

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'seo-astro-integration-'))
  await mkdir(join(directory, 'docs'), { recursive: true })
  await writeFile(join(directory, 'index.html'), page('/', 'Home'))
  await writeFile(
    join(directory, 'docs', 'index.html'),
    page('/docs', 'Docs', true),
  )
  await writeFile(
    join(directory, 'old.html'),
    '<html><head><meta http-equiv="refresh" content="0;url=/docs"></head></html>',
  )
  await writeFile(
    join(directory, '404.html'),
    page('/404', 'Missing page', true),
  )
  return directory
}

async function artifactHash(directory: string): Promise<string> {
  const values = await Promise.all(
    ['index.md', 'docs.md', 'agent-routes.json', 'llms.txt'].map((file) =>
      readFile(join(directory, file)),
    ),
  )
  return createHash('sha256').update(Buffer.concat(values)).digest('hex')
}

// Apply the documented Cloudflare splat and ordered set/unset behavior to
// generated path rules, so scope tests check the headers a request receives.
function headersForPath(source: string, path: string): Headers {
  const headers = new Headers()
  let matches = false
  for (const line of source.split('\n')) {
    if (line.startsWith('/')) {
      const pattern = line.split('*').map((part) =>
        part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'),
      ).join('.*')
      matches = new RegExp(`^${pattern}$`, 'u').test(path)
    } else if (matches && line.startsWith('  ! ')) {
      headers.delete(line.slice(4))
    } else if (matches && line.startsWith('  ')) {
      const colon = line.indexOf(':')
      headers.append(line.slice(2, colon), line.slice(colon + 1).trim())
    }
  }
  return headers
}

test('writes one deterministic artifact for each public content page', async () => {
  const directory = await fixtureDirectory()
  try {
    const first = await writeAgentMarkdownArtifacts({
      outputDir: directory,
      site: 'https://example.com',
      llmsTxt,
    })
    const firstHash = await artifactHash(directory)
    const second = await writeAgentMarkdownArtifacts({
      outputDir: directory,
      site: 'https://example.com',
      llmsTxt,
    })

    assert.equal(first.length, 2)
    assert.deepEqual(second, first)
    assert.equal(await artifactHash(directory), firstHash)
    assert.deepEqual(
      first.map((entry) => [entry.htmlPath, entry.markdownPath, entry.noindex]),
      [
        ['/', '/index.md', false],
        ['/docs', '/docs.md', true],
      ],
    )
    assert.equal(
      (
        (await readFile(join(directory, 'index.html'), 'utf8')).match(
          /type="text\/markdown"/gu,
        ) ?? []
      ).length,
      1,
    )
    assert.match(
      await readFile(join(directory, 'index.html'), 'utf8'),
      /rel="describedby" href="https:\/\/example\.com\/llms\.txt"/u,
    )
    await assert.rejects(readFile(join(directory, 'old.md')), /ENOENT/u)
    await assert.rejects(readFile(join(directory, '404.md')), /ENOENT/u)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('two clean checkout paths produce identical artifact bytes', async () => {
  const first = await fixtureDirectory()
  const second = await fixtureDirectory()
  try {
    await writeAgentMarkdownArtifacts({
      outputDir: first,
      site: 'https://example.com',
      llmsTxt,
    })
    await writeAgentMarkdownArtifacts({
      outputDir: second,
      site: 'https://example.com',
      llmsTxt,
    })
    assert.equal(await artifactHash(first), await artifactHash(second))
  } finally {
    await rm(first, { force: true, recursive: true })
    await rm(second, { force: true, recursive: true })
  }
})

test('refuses a conflicting hand-authored Markdown target', async () => {
  const directory = await fixtureDirectory()
  try {
    await writeFile(join(directory, 'index.md'), '# Hand-authored\n')
    await assert.rejects(
      writeAgentMarkdownArtifacts({
        outputDir: directory,
        site: 'https://example.com',
      }),
      /Refusing to overwrite existing Markdown: index\.md/u,
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('supports directory, file, and mixed static build layouts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seo-astro-layouts-'))
  try {
    await mkdir(join(directory, 'guide'), { recursive: true })
    await writeFile(
      join(directory, 'guide', 'index.html'),
      page('/guide/', 'Directory page'),
    )
    await writeFile(
      join(directory, 'reference.html'),
      page('/reference', 'File page'),
    )

    const entries = await writeAgentMarkdownArtifacts({
      outputDir: directory,
      site: 'https://example.com',
    })

    assert.deepEqual(
      entries.map((entry) => [entry.htmlFile, entry.markdownFile]),
      [
        ['guide/index.html', 'guide/index.md'],
        ['reference.html', 'reference.md'],
      ],
    )
    assert.match(
      await readFile(join(directory, 'guide', 'index.md'), 'utf8'),
      /# Directory page/u,
    )
    assert.match(
      await readFile(join(directory, 'reference.md'), 'utf8'),
      /# File page/u,
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('appends idempotent per-file markdown headers to _headers when requested', async () => {
  const directory = await fixtureDirectory()
  try {
    await writeFile(
      join(directory, '_headers'),
      '/*\n  Vary: Accept\n',
      'utf8',
    )
    await writeAgentMarkdownArtifacts({
      cloudflareHeaders: 'per-page',
      outputDir: directory,
      site: 'https://example.com',
      llmsTxt,
    })
    const first = await readFile(join(directory, '_headers'), 'utf8')
    assert.ok(first.startsWith('/*\n  Vary: Accept\n'))
    assert.ok(first.includes('/index.md\n'))
    assert.match(first, /X-Markdown-Tokens: \d+/)
    assert.ok(
      first.includes('Link: <https://example.com/>; rel="canonical"'),
    )
    await writeAgentMarkdownArtifacts({
      cloudflareHeaders: 'per-page',
      outputDir: directory,
      site: 'https://example.com',
      llmsTxt,
    })
    const second = await readFile(join(directory, '_headers'), 'utf8')
    assert.equal(second, first)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('uses one wildcard rule for 150 pages, including nested and directory paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seo-astro-headers-'))
  try {
    await mkdir(join(directory, 'post'), { recursive: true })
    for (let index = 0; index < 150; index++) {
      await writeFile(
        join(directory, 'post', `${index}.html`),
        page(`/post/${index}${index % 2 ? '/' : ''}`, `Post ${index}`),
      )
    }
    const siteHeaders = '# Site headers\n/*\n  Vary: Accept\n  X-Site: example\n'
    await writeFile(join(directory, '_headers'), siteHeaders)
    const options = { outputDir: directory, site: 'https://example.com' }
    const manifest = await writeAgentMarkdownArtifacts(options)
    const first = await readFile(join(directory, '_headers'), 'utf8')
    assert.equal(manifest.length, 150)
    assert.ok(first.startsWith(siteHeaders))
    const patterns = first.split('\n').filter((line) => line.startsWith('/'))
    assert.deepEqual(patterns, ['/*', '/*.md'])
    for (const path of [
      '/post/slug.md', '/post/slug/index.md', '/index.md',
      ...manifest.map((entry) => entry.markdownPath),
    ]) {
      const response = headersForPath(first, path)
      assert.equal(response.get('Content-Type'), 'text/markdown; charset=utf-8')
      assert.equal(response.get('Vary'), 'Accept')
    }
    assert.equal(headersForPath(first, '/post/slug.html').get('Content-Type'), null)
    assert.doesNotMatch(first, /Link:|X-Markdown-Tokens/u)
    await writeAgentMarkdownArtifacts(options)
    assert.equal(await readFile(join(directory, '_headers'), 'utf8'), first)
    await assert.rejects(
      writeAgentMarkdownArtifacts({ ...options, cloudflareHeaders: 'per-page' }),
      /151 rules.*100.*cloudflareHeaders/u,
    )
    assert.equal(await readFile(join(directory, '_headers'), 'utf8'), first)
    await writeAgentMarkdownArtifacts({
      ...options,
      llmsTxt: [
        { title: 'All pages' },
        { title: 'Posts', outputPath: '/post/llms.txt' },
      ],
    })
    const scoped = await readFile(join(directory, '_headers'), 'utf8')
    assert.deepEqual(
      scoped.split('\n').filter((line) => line.startsWith('/')),
      ['/*', '/*.md', '/post/*.md'],
    )
    assert.equal(
      headersForPath(scoped, '/post/slug/index.md').get('Link'),
      '<https://example.com/post/llms.txt>; rel="describedby"',
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('counts existing site rules at the per-page limit and replaces old generated rules', async () => {
  const directory = await fixtureDirectory()
  try {
    const siteHeaders = Array.from({ length: 98 }, (_, index) =>
      `${index % 2 ? 'https://example.com' : ''}/site-${index}\n  X-Site: yes\n`,
    ).join('\n')
    const headersPath = join(directory, '_headers')
    await writeFile(headersPath, `# Site rules\n${siteHeaders}`)
    const options = { outputDir: directory, site: 'https://example.com' }
    await writeAgentMarkdownArtifacts({ ...options, cloudflareHeaders: 'per-page' })
    const first = await readFile(headersPath, 'utf8')
    await writeAgentMarkdownArtifacts({ ...options, cloudflareHeaders: 'per-page' })
    assert.equal(await readFile(headersPath, 'utf8'), first)
    await writeFile(headersPath, `/another\n  X-Site: yes\n${first}`)
    await assert.rejects(
      writeAgentMarkdownArtifacts({ ...options, cloudflareHeaders: 'per-page' }),
      /101 rules.*100/u,
    )
    await writeAgentMarkdownArtifacts({ ...options, cloudflareHeaders: true })
    const wildcard = await readFile(headersPath, 'utf8')
    assert.ok(wildcard.includes(siteHeaders.trimEnd()))
    assert.doesNotMatch(wildcard, /X-Markdown-Tokens|rel="canonical"/u)
    assert.equal(
      wildcard.split('\n').filter((line) => /^(\/|https:\/\/)/u.test(line)).length,
      100,
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('skips _headers emission when cloudflareHeaders is false', async () => {
  const directory = await fixtureDirectory()
  try {
    await writeAgentMarkdownArtifacts({
      cloudflareHeaders: false,
      outputDir: directory,
      site: 'https://example.com',
      llmsTxt,
    })
    let found = true
    try {
      await readFile(join(directory, '_headers'), 'utf8')
    } catch {
      found = false
    }
    assert.equal(found, false)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('writes scoped llms.txt and optional llms-full.txt files', async () => {
  const directory = await fixtureDirectory()
  try {
    await writeFile(
      join(directory, 'docs', 'index.html'),
      page('/docs', 'Docs'),
    )
    await writeAgentMarkdownArtifacts({
      outputDir: directory,
      site: 'https://example.com',
      llmsTxt: {
        outputPath: '/docs/llms.txt',
        title: 'Documentation',
        summary: 'Product documentation.',
      },
      llmsFullTxt: true,
    })

    const index = await readFile(join(directory, 'docs', 'llms.txt'), 'utf8')
    assert.match(index, /## Pages/u)
    assert.match(index, /https:\/\/example\.com\/docs\.md/u)
    assert.doesNotMatch(index, /index\.md/u)

    const full = await readFile(
      join(directory, 'docs', 'llms-full.txt'),
      'utf8',
    )
    assert.match(full, /## Docs/u)
    assert.match(full, /Useful Docs content\./u)

    const homeHtml = await readFile(join(directory, 'index.html'), 'utf8')
    const docsHtml = await readFile(
      join(directory, 'docs', 'index.html'),
      'utf8',
    )
    assert.doesNotMatch(homeHtml, /describedby/u)
    assert.match(
      docsHtml,
      /rel="describedby" href="https:\/\/example\.com\/docs\/llms\.txt"/u,
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('writes overlapping llms.txt scopes and advertises the most specific file', async () => {
  const directory = await fixtureDirectory()
  try {
    await writeFile(
      join(directory, 'docs', 'index.html'),
      page('/docs', 'Docs'),
    )
    await writeAgentMarkdownArtifacts({
      outputDir: directory,
      site: 'https://example.com',
      llmsTxt: [
        { title: 'Example', summary: 'All site pages.' },
        {
          outputPath: '/docs/llms.txt',
          title: 'Example docs',
          summary: 'Documentation pages.',
        },
      ],
    })

    assert.match(
      await readFile(join(directory, 'llms.txt'), 'utf8'),
      /https:\/\/example\.com\/index\.md/u,
    )
    const docsIndex = await readFile(
      join(directory, 'docs', 'llms.txt'),
      'utf8',
    )
    assert.match(docsIndex, /https:\/\/example\.com\/docs\.md/u)
    assert.doesNotMatch(docsIndex, /index\.md/u)

    assert.match(
      await readFile(join(directory, 'index.html'), 'utf8'),
      /href="https:\/\/example\.com\/llms\.txt"/u,
    )
    assert.match(
      await readFile(join(directory, 'docs', 'index.html'), 'utf8'),
      /href="https:\/\/example\.com\/docs\/llms\.txt"/u,
    )
    const headers = await readFile(join(directory, '_headers'), 'utf8')
    assert.match(
      headers,
      /\/docs\.md[\s\S]*<https:\/\/example\.com\/docs\/llms\.txt>; rel="describedby"/u,
    )
    for (const path of ['/docs.md', '/docs/guide.md', '/docs/guide/index.md']) {
      const response = headersForPath(headers, path)
      assert.equal(
        response.get('Link'),
        '<https://example.com/docs/llms.txt>; rel="describedby"',
      )
      assert.equal(response.get('Content-Type'), 'text/markdown; charset=utf-8')
      assert.equal(response.get('Vary'), 'Accept')
    }
    for (const path of ['/index.md', '/docs-other/guide.md']) {
      assert.equal(
        headersForPath(headers, path).get('Link'),
        '<https://example.com/llms.txt>; rel="describedby"',
      )
    }
    assert.equal(headersForPath(headers, '/docs/guide.html').get('Link'), null)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('rejects duplicate llms.txt outputs and legacy full output with many scopes', async () => {
  const directory = await fixtureDirectory()
  try {
    await assert.rejects(
      writeAgentMarkdownArtifacts({
        outputDir: directory,
        site: 'https://example.com',
        llmsTxt: [{ title: 'One' }, { title: 'Two' }],
      }),
      /output paths must be unique/u,
    )
    await assert.rejects(
      writeAgentMarkdownArtifacts({
        outputDir: directory,
        site: 'https://example.com',
        llmsTxt: [
          { title: 'All' },
          { outputPath: '/docs/llms.txt', title: 'Docs' },
        ],
        llmsFullTxt: true,
      }),
      /supports exactly one/u,
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('requires llms.txt when llms-full.txt is enabled', async () => {
  const directory = await fixtureDirectory()
  try {
    await assert.rejects(
      writeAgentMarkdownArtifacts({
        llmsFullTxt: true,
        outputDir: directory,
        site: 'https://example.com',
      }),
      /requires an llmsTxt/u,
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('adds runtime middleware only when it is enabled', () => {
  for (const [enabled, expected] of [
    [false, 0],
    [true, 1],
  ] as const) {
    const added: unknown[] = []
    const integration = agentMarkdown({ runtimeMiddleware: enabled })
    const hook = integration.hooks['astro:config:setup']
    assert.equal(typeof hook, 'function')
    ;(hook as (input: unknown) => void)({
      addMiddleware: (value: unknown) => added.push(value),
    })
    assert.equal(added.length, expected)
  }
})

test('warns when v2 changes a trailing-slash Markdown route', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seo-astro-migration-'))
  try {
    await mkdir(join(directory, 'docs'), { recursive: true })
    await writeFile(
      join(directory, 'docs', 'index.html'),
      page('/docs/', 'Docs'),
    )
    const warnings: string[] = []
    const integration = agentMarkdown()
    const configDone = integration.hooks['astro:config:done']
    const buildDone = integration.hooks['astro:build:done']
    assert.equal(typeof configDone, 'function')
    assert.equal(typeof buildDone, 'function')
    ;(configDone as (input: unknown) => void)({
      config: {
        base: '/',
        output: 'static',
        site: new URL('https://example.com'),
      },
    })
    await (buildDone as (input: unknown) => Promise<void>)({
      dir: pathToFileURL(`${directory}/`),
      logger: {
        info: () => {},
        warn: (message: string) => warnings.push(message),
      },
    })

    assert.ok(
      warnings.some((message) =>
        message.includes('/docs/: /docs.md -> /docs/index.md'),
      ),
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('places default llms.txt inside the public Astro base', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seo-astro-base-'))
  try {
    await writeFile(join(directory, 'index.html'), page('/seo', 'Home'))
    await writeAgentMarkdownArtifacts({
      base: '/seo',
      llmsTxt: { title: 'Example', summary: 'Base path example.' },
      outputDir: directory,
      site: 'https://example.com/seo',
    })
    assert.match(
      await readFile(join(directory, 'llms.txt'), 'utf8'),
      /https:\/\/example\.com\/seo\/index\.md/u,
    )
    assert.match(
      await readFile(join(directory, 'index.html'), 'utf8'),
      /href="https:\/\/example\.com\/seo\/llms\.txt"/u,
    )
    const headers = await readFile(join(directory, '_headers'), 'utf8')
    assert.deepEqual(
      headers.split('\n').filter((line) => line.startsWith('/')),
      ['/seo/*.md'],
    )
    const response = headersForPath(headers, '/seo/index.md')
    assert.equal(response.get('Content-Type'), 'text/markdown; charset=utf-8')
    assert.equal(
      response.get('Link'),
      '<https://example.com/seo/llms.txt>; rel="describedby"',
    )
    assert.equal(headersForPath(headers, '/index.md').get('Content-Type'), null)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
