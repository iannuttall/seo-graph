import assert from 'node:assert/strict'
import { test } from 'vitest'
import { isExcludedPath } from '../src/exclude-paths.js'

test('matches exact paths and /* prefixes, ignoring trailing slashes', () => {
  const paths = ['/account', '/app/*']
  assert.equal(isExcludedPath(paths, '/account'), true)
  assert.equal(isExcludedPath(paths, '/account/'), true)
  assert.equal(isExcludedPath(paths, '/accounts'), false)
  assert.equal(isExcludedPath(paths, '/app'), true)
  assert.equal(isExcludedPath(paths, '/app/settings'), true)
  assert.equal(isExcludedPath(paths, '/application'), false)
  assert.equal(isExcludedPath(undefined, '/account'), false)
})
