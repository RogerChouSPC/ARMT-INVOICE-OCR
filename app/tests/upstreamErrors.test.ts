import assert from 'node:assert/strict'
import test from 'node:test'
import { callExtractModel } from '../api/extract'
import { ocrImageCore } from '../api/ocr'
import * as ocrModule from '../api/ocr'

const secretBody = 'Bearer upstream-secret private invoice response'

test('OpenRouter adapters classify 4xx as permanent and 429/5xx as retryable without leaking bodies', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const cases = [
    { status: 400, retryable: false },
    { status: 401, retryable: false },
    { status: 403, retryable: false },
    { status: 429, retryable: true },
    { status: 500, retryable: true },
  ]

  for (const entry of cases) {
    await t.test(String(entry.status), async () => {
      globalThis.fetch = async () => new Response(secretBody, { status: entry.status })

      const ocr = await ocrImageCore('base64-image', 'private-api-key')
      const extract = await callExtractModel(
        [{ role: 'user', content: 'safe prompt' }],
        'private-api-key',
      )

      assert.equal(ocr.ok, false)
      assert.equal(extract.ok, false)
      if (ocr.ok || extract.ok) return
      assert.equal((ocr as { retryable?: boolean }).retryable, entry.retryable)
      assert.equal((extract as { retryable?: boolean }).retryable, entry.retryable)
      assert.equal(ocr.status, entry.status === 429 ? 429 : 502)
      assert.equal(extract.status, entry.status === 429 ? 429 : 502)
      assert.doesNotMatch(ocr.error, /upstream-secret|private invoice|Bearer|private-api-key/i)
      assert.doesNotMatch(extract.error, /upstream-secret|private invoice|Bearer|private-api-key/i)
    })
  }
})

test('network adapter failures are retryable and expose only a safe message', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => {
    throw Object.assign(new Error('Bearer upstream-secret socket detail'), { code: 'ECONNRESET' })
  }

  const ocr = await ocrImageCore('base64-image', 'private-api-key')
  const extract = await callExtractModel(
    [{ role: 'user', content: 'safe prompt' }],
    'private-api-key',
  )

  assert.equal(ocr.ok, false)
  assert.equal(extract.ok, false)
  if (ocr.ok || extract.ok) return
  assert.equal((ocr as { retryable?: boolean }).retryable, true)
  assert.equal((extract as { retryable?: boolean }).retryable, true)
  assert.doesNotMatch(ocr.error, /upstream-secret|Bearer|private-api-key/i)
  assert.doesNotMatch(extract.error, /upstream-secret|Bearer|private-api-key/i)
})

test('the OCR worker adapter preserves retryability without copying private details', () => {
  type WorkerAdapter = (
    page: number,
    failure: { status: number; error: string; retryable: boolean },
  ) => Error & { status: number; retryable: boolean }
  const toWorkerError = Reflect.get(ocrModule, 'ocrFailureForWorker') as WorkerAdapter | undefined
  assert.equal(typeof toWorkerError, 'function')

  const error = toWorkerError!(7, {
    status: 502,
    error: 'Bearer upstream-secret invoice body',
    retryable: false,
  })

  assert.equal(error.status, 502)
  assert.equal(error.retryable, false)
  assert.match(error.message, /page 7/i)
  assert.doesNotMatch(error.message, /upstream-secret|invoice body|Bearer/i)
})
