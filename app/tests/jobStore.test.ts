import assert from 'node:assert/strict'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createJobStore } from '../api/jobStore'
import type { StoredJobRequest } from '../api/jobTypes'

const request: StoredJobRequest = {
  filename: 'large.pdf', pageCount: 277, text: '', isDigital: false,
  useOcr: true, customerMaster: [], customerId: null,
  customerInstructions: '', vendorCode: 'auto', vendorBranch: 'auto',
}

interface FixtureTestContext {
  after(fn: () => void | Promise<void>): void
}

async function makeRoot(t: FixtureTestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'job-store-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  return root
}

const appDir = join(fileURLToPath(new URL('.', import.meta.url)), '..')

test('create persists queued metadata, request, and input without credentials', async (t) => {
  const root = await makeRoot(t)
  const store = createJobStore(root)
  const requestWithCredentials = {
    ...request,
    authorization: 'Bearer test-token',
    apiKey: 'test-key',
  }

  const metadata = await store.create('owner-1', requestWithCredentials, Buffer.from('%PDF-test'))
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

test('create removes staging data when persistence fails after directory creation', async (t) => {
  const root = await makeRoot(t)
  const store = createJobStore(root)
  const unserializableRequest: StoredJobRequest = {
    ...request,
    customerMaster: [BigInt(1)],
  }

  await assert.rejects(
    store.create('owner-1', unserializableRequest, Buffer.from('%PDF-private')),
    /BigInt/,
  )

  assert.deepEqual(await readdir(root), [])
})

test('remove deletes only the validated UUID job and rejects invalid ids', async (t) => {
  const root = await makeRoot(t)
  const store = createJobStore(root)
  const removed = await store.create('owner-1', request, Buffer.from('%PDF-remove'))
  const preserved = await store.create('owner-1', request, Buffer.from('%PDF-preserve'))

  await store.remove(removed.id)

  assert.equal(await store.readMetadata(removed.id), null)
  assert.equal((await store.readMetadata(preserved.id))?.id, preserved.id)
  await assert.rejects(store.remove('../escape'), /invalid job id/i)
  assert.equal((await store.readMetadata(preserved.id))?.id, preserved.id)
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

test('OCR checkpoints replace the final file atomically and ignore interrupted artifacts', async (t) => {
  const root = await makeRoot(t)
  const store = createJobStore(root)
  const created = await store.create('owner-1', request, Buffer.from('%PDF-test'))
  const ocrDir = join(root, created.id, 'ocr')

  await store.writeOcrPage(created.id, 1, 'old durable text')
  const before = await stat(join(ocrDir, '000001.txt'))
  await writeFile(join(ocrDir, '000002.txt.11111111-1111-4111-8111-111111111111.tmp'), 'partial')
  await writeFile(join(ocrDir, '000003.txt.partial'), 'partial')
  await store.writeOcrPage(created.id, 1, 'new durable text')
  const after = await stat(join(ocrDir, '000001.txt'))

  assert.notEqual(after.ino, before.ino, 'checkpoint replacement must use rename, not overwrite in place')
  assert.deepEqual(await store.listCompletedOcrPages(created.id), [1])
  assert.equal(await store.readOcrPage(created.id, 1), 'new durable text')
  assert.equal(await store.readOcrPage(created.id, 2), null)
})

test('failed OCR checkpoint replacement cleans its same-directory temp file', async (t) => {
  const root = await makeRoot(t)
  const store = createJobStore(root)
  const created = await store.create('owner-1', request, Buffer.from('%PDF-test'))
  const ocrDir = join(root, created.id, 'ocr')
  await mkdir(ocrDir, { recursive: true })
  await mkdir(join(ocrDir, '000004.txt'))

  await assert.rejects(store.writeOcrPage(created.id, 4, 'must not survive'))

  assert.deepEqual(
    (await readdir(ocrDir)).filter(name => name.endsWith('.tmp')),
    [],
  )
  assert.deepEqual(await store.listCompletedOcrPages(created.id), [])
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
test('cleanupExpired defaults retention to 24 hours', async (t) => {
  const root = await makeRoot(t)
  const store = createJobStore(root)
  const done = await store.create('owner-1', request, Buffer.from('%PDF-test'))
  await store.updateMetadata(done.id, { stage: 'done' })

  const metadataPath = join(root, done.id, 'metadata.json')
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as Record<string, unknown>
  metadata.updatedAt = '2026-10-13T12:00:00.000Z'
  await writeFile(metadataPath, JSON.stringify(metadata), 'utf8')

  await store.cleanupExpired(new Date('2026-10-14T00:00:00.000Z'))

  assert.equal((await store.readMetadata(done.id))?.stage, 'done')
})

test('cleanup scavenges only aged valid staging directories', async (t) => {
  const root = await makeRoot(t)
  const store = createJobStore(root)
  const oldStaging = '.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.tmp'
  const freshStaging = '.33333333-3333-4333-8333-333333333333.44444444-4444-4444-8444-444444444444.tmp'
  const malformedStaging = '.not-a-job.55555555-5555-4555-8555-555555555555.tmp'
  const unrelated = 'operator-notes'
  for (const name of [oldStaging, freshStaging, malformedStaging, unrelated]) {
    await mkdir(join(root, name))
    await writeFile(join(root, name, 'private-data'), 'preserve unless valid and old', 'utf8')
  }
  const oldTime = new Date('2026-10-12T00:00:00.000Z')
  await utimes(join(root, oldStaging), oldTime, oldTime)
  await utimes(join(root, malformedStaging), oldTime, oldTime)
  await utimes(join(root, unrelated), oldTime, oldTime)
  const freshTime = new Date('2026-10-13T23:30:00.000Z')
  await utimes(join(root, freshStaging), freshTime, freshTime)

  await store.cleanupExpired(new Date('2026-10-14T00:00:00.000Z'), 24 * 60 * 60 * 1000)

  await assert.rejects(access(join(root, oldStaging)))
  await access(join(root, freshStaging, 'private-data'))
  await access(join(root, malformedStaging, 'private-data'))
  await access(join(root, unrelated, 'private-data'))
})

test('job directories and persisted files are private where POSIX modes are supported', async (t) => {
  const root = await makeRoot(t)
  const store = createJobStore(root)
  const created = await store.create('owner-1', request, Buffer.from('%PDF-private'))
  if (process.platform === 'win32') return

  const jobDir = join(root, created.id)
  assert.equal((await stat(jobDir)).mode & 0o077, 0)
  for (const filename of ['metadata.json', 'request.json', 'input.pdf']) {
    assert.equal((await stat(join(jobDir, filename))).mode & 0o077, 0)
  }
})

test('private job data is excluded from Git and the Docker build context', async () => {
  const gitIgnore = (await readFile(join(appDir, '..', '.gitignore'), 'utf8')).split(/\r?\n/)
  const dockerIgnore = (await readFile(join(appDir, '.dockerignore'), 'utf8')).split(/\r?\n/)

  assert.ok(gitIgnore.includes('app/job-data/'))
  assert.ok(dockerIgnore.includes('job-data/'))
})
