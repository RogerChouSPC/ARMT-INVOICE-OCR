import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createJobStore } from '../api/jobStore'
import type { StoredJobRequest } from '../api/jobTypes'

const request: StoredJobRequest = {
  filename: 'large.pdf', pageCount: 277, text: '', isDigital: false,
  useOcr: true, customerMaster: [], customerId: null,
  customerInstructions: '', vendorCode: 'auto', vendorBranch: 'auto',
}

async function makeRoot(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'job-store-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  return root
}

test('create persists queued metadata, request, and input without credentials', async (t) => {
  const root = await makeRoot(t)
  const store = createJobStore(root)

  const metadata = await store.create('owner-1', { ...request, authorization: 'Bearer test-token', apiKey: 'test-key' }, Buffer.from('%PDF-test'))
  const jobDir = join(root, metadata.id)
  const metadataJson = await readFile(join(jobDir, 'metadata.json'), 'utf8')
  const requestJson = await readFile(join(jobDir, 'request.json'), 'utf8')

  assert.equal(metadata.stage, 'queued')
  assert.equal(metadata.ownerId, 'owner-1')
  assert.equal(metadata.filename, 'large.pdf')
  await access(join(jobDir, 'input.pdf'))
  assert.doesNotMatch(metadataJson, /Bearer|apiKey/i)
  assert.doesNotMatch(requestJson, /Bearer|apiKey/i)
})

test('updateMetadata keeps immutable identity fields while applying progress', async (t) => {
  const root = await makeRoot(t)
  const store = createJobStore(root)
  const created = await store.create('owner-1', request, Buffer.from('%PDF-test'))

  await store.updateMetadata(created.id, { stage: 'ocr', pagesDone: 7 })
  const updated = await store.readMetadata(created.id)

  assert.ok(updated)
  assert.equal(updated.ownerId, 'owner-1')
  assert.equal(updated.filename, 'large.pdf')
  assert.equal(updated.stage, 'ocr')
  assert.equal(updated.pagesDone, 7)
})

test('OCR pages round-trip and completed page numbers are sorted', async (t) => {
  const root = await makeRoot(t)
  const store = createJobStore(root)
  const created = await store.create('owner-1', request, Buffer.from('%PDF-test'))

  await store.writeOcrPage(created.id, 10, 'page ten')
  await store.writeOcrPage(created.id, 2, 'page two')

  assert.deepEqual(await store.listCompletedOcrPages(created.id), [2, 10])
  assert.equal(await store.readOcrPage(created.id, 2), 'page two')
  assert.equal(await store.readOcrPage(created.id, 10), 'page ten')
})

test('readMetadata rejects path traversal job ids', async (t) => {
  const root = await makeRoot(t)
  const store = createJobStore(root)

  await assert.rejects(store.readMetadata('../escape'), /invalid job id/i)
})

test('cleanup removes expired terminal jobs but preserves recoverable jobs', async (t) => {
  const root = await makeRoot(t)
  const store = createJobStore(root)
  const done = await store.create('owner-1', request, Buffer.from('%PDF-test'))
  const ocr = await store.create('owner-1', request, Buffer.from('%PDF-test'))
  await store.updateMetadata(done.id, { stage: 'done' })
  await store.updateMetadata(ocr.id, { stage: 'ocr' })

  const oldTimestamp = '2026-10-12T00:00:00.000Z'
  for (const job of [done, ocr]) {
    const metadataPath = join(root, job.id, 'metadata.json')
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as Record<string, unknown>
    metadata.updatedAt = oldTimestamp
    await writeFile(metadataPath, JSON.stringify(metadata), 'utf8')
  }

  await store.cleanupExpired(new Date('2026-10-14T00:00:00.000Z'), 24 * 60 * 60 * 1000)

  assert.equal(await store.readMetadata(done.id), null)
  assert.equal((await store.readMetadata(ocr.id))?.stage, 'ocr')
})
