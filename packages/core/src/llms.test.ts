import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  llmsTxtCoversPath,
  llmsTxtPathForPage,
  normalizeLlmsTxtPath,
  renderLlmsFullTxt,
  renderLlmsTxt,
  validateLlmsTxtV2,
} from './llms.js'
import type { AgentRouteManifest } from './manifest.js'

const manifest: AgentRouteManifest = {
  version: 1,
  site: 'https://example.com',
  pages: [
    {
      bytes: 12,
      canonical: 'https://example.com/docs',
      description: 'Read the useful documentation.',
      htmlFile: 'docs/index.html',
      htmlPath: '/docs',
      language: 'en',
      markdownFile: 'docs.md',
      markdownPath: '/docs.md',
      noindex: false,
      sha256: 'digest',
      title: 'Documentation | Example',
      tokens: 3,
    },
    {
      bytes: 12,
      canonical: 'https://example.com/privacy',
      description: 'Private policy.',
      htmlFile: 'privacy/index.html',
      htmlPath: '/privacy',
      language: 'en',
      markdownFile: 'privacy.md',
      markdownPath: '/privacy.md',
      noindex: true,
      sha256: 'digest',
      title: 'Privacy | Example',
      tokens: 3,
    },
  ],
}

test('renders a stable curated map from manifest metadata', () => {
  assert.equal(
    renderLlmsTxt(manifest, {
      title: 'Example',
      summary: 'Useful docs for agents.',
      sections: [
        {
          heading: 'Start here',
          items: [{ path: '/docs' }],
        },
        {
          heading: 'Capabilities',
          items: [
            {
              label: 'Agent skill',
              url: '/.well-known/agent-skills/example/SKILL.md',
              description: 'Instructions for the agent.',
            },
          ],
        },
      ],
    }),
    `# Example

> Useful docs for agents.

## Start here

- [Documentation](https://example.com/docs.md): Read the useful documentation.

## Capabilities

- [Agent skill](https://example.com/.well-known/agent-skills/example/SKILL.md): Instructions for the agent.
`,
  )
})

test('rejects stale, noindex and duplicate curated routes', () => {
  for (const path of ['/missing', '/privacy']) {
    assert.throws(
      () =>
        renderLlmsTxt(manifest, {
          title: 'Example',
          summary: 'Useful docs.',
          sections: [{ heading: 'Start', items: [{ path }] }],
        }),
      /manifest|indexable/u,
    )
  }
  assert.throws(
    () =>
      renderLlmsTxt(manifest, {
        title: 'Example',
        summary: 'Useful docs.',
        sections: [
          { heading: 'Start', items: [{ path: '/docs' }, { path: '/docs' }] },
        ],
      }),
    /Duplicate/u,
  )
})

test('creates an automatic section when manual sections are omitted', () => {
  assert.equal(
    renderLlmsTxt(manifest, {
      title: 'Example',
      summary: 'Useful docs.',
    }),
    `# Example

> Useful docs.

## Pages

- [Documentation](https://example.com/docs.md): Read the useful documentation.
`,
  )
})

test('mixes details, manual sections and remaining automatic pages', () => {
  assert.equal(
    renderLlmsTxt(manifest, {
      title: 'Example',
      summary: 'Useful docs.',
      details: 'Use the start page first.',
      autoSection: { heading: 'More pages', position: 'before' },
      sections: [
        {
          heading: 'External',
          items: [{ label: 'Status', url: 'https://status.example.com' }],
        },
      ],
    }),
    `# Example

> Useful docs.

Use the start page first.

## More pages

- [Documentation](https://example.com/docs.md): Read the useful documentation.

## External

- [Status](https://status.example.com/)
`,
  )
})

test('renders an optional full export from selected page Markdown', () => {
  const markdown = new Map([
    [
      '/docs',
      `---
title: "Documentation"
---

# Documentation

Read the full documentation.
`,
    ],
  ])
  assert.equal(
    renderLlmsFullTxt(
      manifest,
      { title: 'Example', summary: 'Useful docs.' },
      markdown,
    ),
    `# Example

> Useful docs.

## Documentation

Read the full documentation.
`,
  )
})

test('normalizes scoped llms.txt paths and checks their coverage', () => {
  assert.equal(normalizeLlmsTxtPath('/docs/llms.txt'), '/docs/llms.txt')
  assert.equal(llmsTxtCoversPath('/docs/llms.txt', '/docs'), true)
  assert.equal(llmsTxtCoversPath('/docs/llms.txt', '/docs/start'), true)
  assert.equal(llmsTxtCoversPath('/docs/llms.txt', '/blog'), false)
  assert.throws(() => normalizeLlmsTxtPath('/docs/index.txt'), /llms\.txt/u)
  assert.throws(() => normalizeLlmsTxtPath('/../llms.txt'), /traversal/u)
})

test('selects the most specific llms.txt scope for each page', () => {
  const paths = ['/llms.txt', '/docs/llms.txt', '/docs/api/llms.txt']
  assert.equal(llmsTxtPathForPage(paths, '/about'), '/llms.txt')
  assert.equal(llmsTxtPathForPage(paths, '/docs/start'), '/docs/llms.txt')
  assert.equal(
    llmsTxtPathForPage(paths, '/docs/api/reference'),
    '/docs/api/llms.txt',
  )
  assert.equal(llmsTxtPathForPage('/docs/llms.txt', '/blog'), undefined)
})

test('accepts a title-only v2 file and validates file-list structure', () => {
  const titleOnly = renderLlmsTxt(manifest, {
    autoSection: false,
    title: 'Example',
  })
  assert.equal(titleOnly, '# Example\n')
  assert.deepEqual(validateLlmsTxtV2(titleOnly), [])
  assert.match(
    validateLlmsTxtV2('# Example\n\n## Docs\n\nPlain text\n').join(' '),
    /not a Markdown link entry/u,
  )
  assert.match(
    validateLlmsTxtV2('# Example\n\n### Wrong\n').join(' '),
    /only level-one and level-two/u,
  )
})

test('normalizes inline metadata and rejects headings in details', () => {
  const rendered = renderLlmsTxt(manifest, {
    title: 'Example\nsite',
    summary: 'Useful\nsummary',
    sections: [
      {
        heading: 'Start\nhere',
        items: [{ label: 'Docs \\ [quick]', path: '/docs' }],
      },
    ],
  })
  assert.match(rendered, /^# Example site$/mu)
  assert.match(rendered, /^> Useful summary$/mu)
  assert.match(rendered, /^## Start here$/mu)
  assert.match(rendered, /\[Docs \\\\ \[quick\\\]\]/u)
  assert.deepEqual(validateLlmsTxtV2(rendered), [])

  assert.throws(
    () =>
      renderLlmsTxt(manifest, {
        autoSection: false,
        details: '## Hidden section',
        title: 'Example',
      }),
    /must not contain Markdown headings/u,
  )

  const codeExample = renderLlmsTxt(manifest, {
    autoSection: false,
    details: '```md\n## This is code\n```\n\n---',
    title: 'Example',
  })
  assert.deepEqual(validateLlmsTxtV2(codeExample), [])
})

test('does not treat local audit limits as llms.txt v2 protocol rules', () => {
  const largeManifest: AgentRouteManifest = {
    ...manifest,
    pages: Array.from({ length: 101 }, (_, index) => ({
      ...manifest.pages[0]!,
      canonical: `https://example.com/page-${index}`,
      htmlPath: `/page-${index}`,
      markdownPath: `/page-${index}.md`,
      title: `Page ${index}`,
    })),
  }
  const rendered = renderLlmsTxt(largeManifest, { title: 'Example' })
  assert.equal((rendered.match(/^- \[/gmu) ?? []).length, 101)
  assert.deepEqual(validateLlmsTxtV2(rendered), [])
})
