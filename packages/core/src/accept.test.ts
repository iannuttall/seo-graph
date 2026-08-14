import assert from 'node:assert/strict'
import { test } from 'node:test'
import { acceptsMarkdown, parseAccept } from './accept.js'

test('parses strict Accept quality values', () => {
  assert.equal(parseAccept('text/markdown').length, 1)
  assert.equal(acceptsMarkdown('text/markdown'), true)
  assert.equal(acceptsMarkdown('text/html, text/markdown'), false)
  assert.equal(
    acceptsMarkdown('text/html;q=0.7, text/markdown;q=0.8'),
    true,
  )
  assert.equal(acceptsMarkdown('text/markdown;q=0, */*;q=1'), false)
  assert.equal(acceptsMarkdown('text/markdown;q=wat'), false)
})
