import assert from 'node:assert/strict'
import test from 'node:test'
import { tokenSubjectFromClaims } from '../api/verifyToken'

test('uses Azure object id before sub', () => {
  assert.equal(tokenSubjectFromClaims({ oid: 'object-id', sub: 'subject-id' }), 'object-id')
})

test('falls back to sub and rejects missing identity', () => {
  assert.equal(tokenSubjectFromClaims({ sub: 'subject-id' }), 'subject-id')
  assert.equal(tokenSubjectFromClaims({}), null)
})
