import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanMdx } from './mdx.js'

test('cleans MDX module statements and components', () => {
  assert.equal(
    cleanMdx(`import Note from './Note.astro'

# Guide

<Note kind="tip">Keep this text.</Note>

<Badge />

<address>Keep this HTML.</address>`),
    `# Guide

Keep this text.

<address>Keep this HTML.</address>
`,
  )
})

test('preserves fenced and inline MDX examples', () => {
  const input = `# Example

\`<Badge />\`

\`\`\`tsx
import Note from './Note.astro'
export const value = 1
<Note>Example</Note>
\`\`\`
`
  assert.equal(cleanMdx(input), input)
})

test('cleans nested components without a fixed nesting limit', () => {
  assert.equal(
    cleanMdx('<Outer><Middle><Inner>Text</Inner></Middle></Outer>'),
    'Text\n',
  )
})

test('returns an empty string when only module statements remain', () => {
  assert.equal(cleanMdx("import Thing from './Thing.astro'"), '')
})
