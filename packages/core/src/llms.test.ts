import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  llmsTxtCoversPath,
  normalizeLlmsTxtPath,
  renderLlmsFullTxt,
  renderLlmsTxt,
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
