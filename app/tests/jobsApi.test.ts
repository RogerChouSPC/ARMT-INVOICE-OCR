import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Request, RequestHandler, Response } from 'express'
import { createJobsHandlers, readJobsRuntimeConfig, registerJobsRoutes } from '../api/jobs'
import { createJobStore } from '../api/jobStore'
import type { JobStore, StoredJobRequest } from '../api/jobTypes'
import type { VerifyResult } from '../api/verifyToken'

const MAX_PDF_BYTES = 37 * 1024 * 1024
const validPdfBase64 = Buffer.from('%PDF-test').toString('base64')
const storedRequest: StoredJobRequest = {
  filename: 'large.pdf', pageCount: 277, text: '', isDigital: false,
  useOcr: true, customerMaster: [], customerId: null,
  customerInstructions: '', vendorCode: 'auto', vendorBranch: 'auto',
}

interface RecordedResponse {
  code: number
  body: Record<string, unknown>
  response: Response
}

interface Fixture {
  root: string
  store: JobStore
  enqueued: string[]
  handlers: ReturnType<typeof createJobsHandlers>
  setVerifyResult(result: VerifyResult): void
}

interface FixtureTestContext {
  after(fn: () => void | Promise<void>): void
}

function responseRecorder(): RecordedResponse {
  const recorded: RecordedResponse = {
    code: 200,
    body: {},
    response: undefined as unknown as Response,
  }
  recorded.response = {
    status(code: number) {
      recorded.code = code
      return this
    },
    json(value: Record<string, unknown>) {
      recorded.body = value
      return this
    },
  } as unknown as Response
  return recorded
}

function request(
  body: Record<string, unknown> = {},
  params: Record<string, string> = {},
): Request {
  return {
    body,
    params,
    headers: { authorization: 'Bearer test-token' },
  } as unknown as Request
}

function validCreateBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...storedRequest,
    pdf: validPdfBase64,
    ...overrides,
  }
}

async function fixture(t: FixtureTestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'jobs-api-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  const store = createJobStore(root)
  const enqueued: string[] = []
  let verifyResult: VerifyResult = { ok: true, reason: 'ok', subject: 'owner-a' }
  const handlers = createJobsHandlers({
    store,
    worker: { enqueue: id => { enqueued.push(id) } },
    verify: async () => verifyResult,
  })
  return {
    root,
    store,
    enqueued,
    handlers,
    setVerifyResult(result) { verifyResult = result },
  }
}

async function jobDirectories(root: string): Promise<string[]> {
  return (await readdir(root, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
}

function captureUnhandledRejections(t: FixtureTestContext): unknown[] {
  const reasons: unknown[] = []
  const listener = (reason: unknown) => { reasons.push(reason) }
  process.on('unhandledRejection', listener)
  t.after(() => { process.off('unhandledRejection', listener) })
  return reasons
}

async function flushUnhandledRejections(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve))
}

async function runMiddlewarePipeline(
  handlers: RequestHandler[],
  req: Request,
  res: Response,
): Promise<void> {
  async function dispatch(index: number): Promise<void> {
    const handler = handlers[index]
    if (!handler) return
    let nextPromise: Promise<void> | undefined
    await handler(req, res, () => {
      nextPromise = dispatch(index + 1)
    })
    await nextPromise
  }
  await dispatch(0)
}

test('create returns 202 and enqueues only after durable creation', async (t) => {
  const setup = await fixture(t)
  const events: string[] = []
  const originalCreate = setup.store.create.bind(setup.store)
  setup.store.create = async (...args) => {
    const metadata = await originalCreate(...args)
    events.push(`created:${metadata.id}`)
    return metadata
  }
  const handlers = createJobsHandlers({
    store: setup.store,
    worker: { enqueue: id => { events.push(`enqueued:${id}`); setup.enqueued.push(id) } },
    verify: async () => ({ ok: true, reason: 'ok', subject: 'owner-a' }),
  })
  const res = responseRecorder()

  await handlers.createJob(request(validCreateBody()), res.response)

  assert.equal(res.code, 202)
  assert.match(String(res.body.jobId), /^[0-9a-f-]{36}$/)
  assert.equal(res.body.status, 'queued')
  assert.equal(res.body.pagesTotal, 277)
  assert.deepEqual(setup.enqueued, [res.body.jobId])
  assert.deepEqual(events, [
    `created:${String(res.body.jobId)}`,
    `enqueued:${String(res.body.jobId)}`,
  ])
  assert.equal((await setup.store.readMetadata(String(res.body.jobId)))?.ownerId, 'owner-a')
})

test('enqueue failure marks the durable job terminal with a safe error before returning 500', async (t) => {
  const { root, store } = await fixture(t)
  const handlers = createJobsHandlers({
    store,
    worker: {
      enqueue() {
        throw new Error('Bearer private-token upstream queue detail')
      },
    },
    verify: async () => ({ ok: true, reason: 'ok', subject: 'owner-a' }),
  })
  const res = responseRecorder()

  await handlers.createJob(request(validCreateBody()), res.response)

  assert.equal(res.code, 500)
  const directories = await jobDirectories(root)
  assert.equal(directories.length, 1)
  const metadata = await store.readMetadata(directories[0])
  assert.equal(metadata?.stage, 'error')
  assert.equal(metadata?.error, 'Job could not be queued. Please try again.')
  assert.doesNotMatch(metadata?.error ?? '', /private-token|upstream|Bearer/i)
})

test('enqueue and terminal metadata failures remove the just-created job and return a safe 500', async (t) => {
  const { root, store } = await fixture(t)
  const removedIds: string[] = []
  const originalRemove = store.remove.bind(store)
  store.updateMetadata = async () => {
    throw new Error('private metadata persistence detail')
  }
  store.remove = async (id) => {
    removedIds.push(id)
    await originalRemove(id)
  }
  const handlers = createJobsHandlers({
    store,
    worker: {
      enqueue() {
        throw new Error('private queue detail')
      },
    },
    verify: async () => ({ ok: true, reason: 'ok', subject: 'owner-a' }),
  })
  const unhandled = captureUnhandledRejections(t)
  const res = responseRecorder()

  await assert.doesNotReject(() => handlers.createJob(request(validCreateBody()), res.response))
  await flushUnhandledRejections()

  assert.equal(res.code, 500)
  assert.deepEqual(res.body, { error: 'Unable to create job' })
  assert.equal(removedIds.length, 1)
  assert.match(removedIds[0], /^[0-9a-f-]{36}$/)
  assert.deepEqual(await jobDirectories(root), [])
  assert.deepEqual(await store.listRecoverable(), [])
  assert.deepEqual(unhandled, [])
  assert.doesNotMatch(JSON.stringify(res.body), /private|metadata|persistence|queue/i)
})

test('rollback removal failure still resolves with the same safe 500', async (t) => {
  const { root, store } = await fixture(t)
  let removeCalls = 0
  store.updateMetadata = async () => {
    throw new Error('private metadata persistence detail')
  }
  store.remove = async () => {
    removeCalls++
    throw new Error('private rollback removal detail')
  }
  const handlers = createJobsHandlers({
    store,
    worker: {
      enqueue() {
        throw new Error('private queue detail')
      },
    },
    verify: async () => ({ ok: true, reason: 'ok', subject: 'owner-a' }),
  })
  const unhandled = captureUnhandledRejections(t)
  const res = responseRecorder()

  await assert.doesNotReject(() => handlers.createJob(request(validCreateBody()), res.response))
  await flushUnhandledRejections()

  assert.equal(removeCalls, 1)
  assert.equal(res.code, 500)
  assert.deepEqual(res.body, { error: 'Unable to create job' })
  assert.equal((await jobDirectories(root)).length, 1)
  assert.deepEqual(unhandled, [])
  assert.doesNotMatch(JSON.stringify(res.body), /private|metadata|persistence|queue|rollback|removal/i)
})

test('digital create accepts text without a client PDF', async (t) => {
  const { handlers, store, enqueued } = await fixture(t)
  const res = responseRecorder()

  await handlers.createJob(request(validCreateBody({
    useOcr: false,
    isDigital: true,
    text: 'digital invoice text',
    pdf: undefined,
  })), res.response)

  assert.equal(res.code, 202)
  assert.deepEqual(enqueued, [res.body.jobId])
  assert.equal((await store.readRequest(String(res.body.jobId)))?.text, 'digital invoice text')
})

test('invalid create payloads leave no job directory and do not enqueue', async (t) => {
  const cases: Array<{ name: string; body: Record<string, unknown>; status?: number }> = [
    { name: 'missing base64', body: validCreateBody({ pdf: undefined }) },
    { name: 'empty base64', body: validCreateBody({ pdf: '' }) },
    { name: 'invalid base64 alphabet', body: validCreateBody({ pdf: '!!!!' }) },
    {
      name: 'non-canonical base64 padding',
      body: validCreateBody({ pdf: Buffer.from('%PDF-xx').toString('base64').replace(/=+$/, '') }),
    },
    { name: 'non-PDF bytes', body: validCreateBody({ pdf: Buffer.from('plain text').toString('base64') }) },
    { name: 'OCR job without PDF', body: validCreateBody({ pdf: null }) },
    { name: 'digital job with empty text', body: validCreateBody({ useOcr: false, isDigital: true, text: '', pdf: undefined }) },
    { name: 'empty filename', body: validCreateBody({ filename: '' }) },
    { name: 'client path in filename', body: validCreateBody({ filename: 'C:\\private\\large.pdf' }) },
    { name: 'client path field', body: { ...validCreateBody(), path: 'C:\\private\\large.pdf' } },
    { name: 'zero page count', body: validCreateBody({ pageCount: 0 }) },
    { name: 'fractional page count', body: validCreateBody({ pageCount: 1.5 }) },
    { name: 'string useOcr', body: validCreateBody({ useOcr: 'true' }) },
    { name: 'numeric isDigital', body: validCreateBody({ isDigital: 1 }) },
    { name: 'object customer master', body: validCreateBody({ customerMaster: {} }) },
    { name: 'numeric customer id', body: validCreateBody({ customerId: 1 }) },
    { name: 'non-string text', body: validCreateBody({ text: null }) },
    { name: 'non-string instructions', body: validCreateBody({ customerInstructions: null }) },
    { name: 'non-string vendor code', body: validCreateBody({ vendorCode: null }) },
    { name: 'non-string vendor branch', body: validCreateBody({ vendorBranch: null }) },
  ]

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const { root, handlers, enqueued } = await fixture(t)
      const res = responseRecorder()

      await handlers.createJob(request(entry.body), res.response)

      assert.equal(res.code, entry.status ?? 400)
      assert.deepEqual(await jobDirectories(root), [])
      assert.deepEqual(enqueued, [])
    })
  }
})

test('decoded PDF above 37 MiB returns 413 without persistence', async (t) => {
  const { root, handlers, enqueued } = await fixture(t)
  const oversized = Buffer.alloc(MAX_PDF_BYTES + 1)
  oversized.write('%PDF-', 0, 'ascii')
  const res = responseRecorder()

  await handlers.createJob(request(validCreateBody({ pdf: oversized.toString('base64') })), res.response)

  assert.equal(res.code, 413)
  assert.deepEqual(await jobDirectories(root), [])
  assert.deepEqual(enqueued, [])
})

test('both handlers return 401 when token verification fails', async (t) => {
  const { root, handlers, enqueued, setVerifyResult } = await fixture(t)
  setVerifyResult({ ok: false, reason: 'invalid-test-token' })
  const createRes = responseRecorder()
  const getRes = responseRecorder()

  await handlers.createJob(request(validCreateBody()), createRes.response)
  await handlers.getJob(request({}, { jobId: 'not-a-job' }), getRes.response)

  assert.equal(createRes.code, 401)
  assert.equal(getRes.code, 401)
  assert.deepEqual(await jobDirectories(root), [])
  assert.deepEqual(enqueued, [])
})

test('claims-only verifier success is rejected by both background-job handlers', async (t) => {
  const { root, store, handlers, enqueued, setVerifyResult } = await fixture(t)
  const forgedOwnerJob = await store.create('forged-owner', storedRequest, Buffer.from('%PDF-test'))
  const directoriesBefore = await jobDirectories(root)
  setVerifyResult({
    ok: true,
    reason: 'ok-claims-only (jwks-cooldown)',
    subject: 'forged-owner',
  })
  const createRes = responseRecorder()
  const getRes = responseRecorder()

  await handlers.createJob(request(validCreateBody()), createRes.response)
  await handlers.getJob(request({}, { jobId: forgedOwnerJob.id }), getRes.response)

  assert.equal(createRes.code, 401)
  assert.equal(getRes.code, 401)
  assert.deepEqual(await jobDirectories(root), directoriesBefore)
  assert.deepEqual(enqueued, [])
})

test('registered POST pipeline authenticates before parsing and reuses the signed subject', async (t) => {
  const { store } = await fixture(t)
  const enqueued: string[] = []
  let verifyCalls = 0
  let parserCalls = 0
  let verifyResult: VerifyResult = { ok: false, reason: 'invalid-test-token' }
  const handlers = createJobsHandlers({
    store,
    worker: { enqueue: id => { enqueued.push(id) } },
    verify: async () => {
      verifyCalls++
      return verifyResult
    },
  })
  let postPath = ''
  let postHandlers: RequestHandler[] = []
  registerJobsRoutes({
    post(path, ...routeHandlers) {
      postPath = path
      postHandlers = routeHandlers
    },
    get() {},
  }, handlers, (req, _res, next) => {
    parserCalls++
    req.body = validCreateBody()
    next()
  })

  const unauthorizedReq = request()
  const unauthorizedRes = responseRecorder()
  await runMiddlewarePipeline(postHandlers, unauthorizedReq, unauthorizedRes.response)
  assert.equal(postPath, '/api/jobs')
  assert.equal(unauthorizedRes.code, 401)
  assert.equal(parserCalls, 0)
  assert.equal(verifyCalls, 1)

  verifyResult = { ok: true, reason: 'ok', subject: 'owner-a' }
  const signedReq = request()
  const signedRes = responseRecorder()
  await runMiddlewarePipeline(postHandlers, signedReq, signedRes.response)

  assert.equal(signedRes.code, 202)
  assert.equal(parserCalls, 1)
  assert.equal(verifyCalls, 2)
  assert.deepEqual(enqueued, [signedRes.body.jobId])
})

test('another authenticated owner receives 404 for running and completed jobs', async (t) => {
  const { store, handlers, setVerifyResult } = await fixture(t)
  const job = await store.create('owner-a', storedRequest, Buffer.from('%PDF-test'))
  setVerifyResult({ ok: true, reason: 'ok', subject: 'owner-b' })
  const runningRes = responseRecorder()

  await handlers.getJob(request({}, { jobId: job.id }), runningRes.response)
  assert.equal(runningRes.code, 404)

  await store.writeResult(job.id, { rows: [{ invoiceno: 'private-invoice' }] })
  await store.updateMetadata(job.id, { stage: 'done' })
  const doneRes = responseRecorder()
  await handlers.getJob(request({}, { jobId: job.id }), doneRes.response)

  assert.equal(doneRes.code, 404)
  assert.doesNotMatch(JSON.stringify(doneRes.body), /private-invoice/)
})

test('missing and invalid job IDs receive the same 404 response', async (t) => {
  const { handlers } = await fixture(t)
  for (const jobId of ['00000000-0000-4000-8000-000000000000', '../escape']) {
    const res = responseRecorder()
    await handlers.getJob(request({}, { jobId }), res.response)
    assert.equal(res.code, 404)
    assert.deepEqual(res.body, { error: 'Not found' })
  }
})

test('running status exposes only public metadata and calculated progress', async (t) => {
  const { store, handlers } = await fixture(t)
  const job = await store.create('owner-a', {
    ...storedRequest,
    text: 'private OCR text',
    customerInstructions: 'private customer instructions',
  }, Buffer.from('%PDF-private'))
  await store.updateMetadata(job.id, {
    stage: 'ocr',
    pagesDone: 83,
    pagesTotal: 277,
    extractBatchesDone: 0,
    extractBatchesTotal: 0,
  })
  const res = responseRecorder()

  await handlers.getJob(request({}, { jobId: job.id }), res.response)

  assert.equal(res.code, 200)
  assert.deepEqual(Object.keys(res.body).sort(), [
    'createdAt', 'error', 'extractBatchesDone', 'extractBatchesTotal', 'filename',
    'jobId', 'pagesDone', 'pagesTotal', 'progress', 'status', 'updatedAt',
  ])
  assert.equal(res.body.status, 'ocr')
  assert.equal(res.body.progress, 27)
  assert.equal(res.body.error, null)
  assert.doesNotMatch(JSON.stringify(res.body), /private|owner-a|job-data|request|rows|token|apiKey/i)
})

test('done status adds result rows and error status adds only its safe stored error', async (t) => {
  const { store, handlers } = await fixture(t)
  const done = await store.create('owner-a', storedRequest, Buffer.from('%PDF-test'))
  const rows = [{ invoiceno: 'INV-1', amount: 1250 }]
  await store.writeResult(done.id, { rows })
  await store.updateMetadata(done.id, {
    stage: 'done', pagesDone: 277, extractBatchesDone: 35, extractBatchesTotal: 35,
  })
  const doneRes = responseRecorder()

  await handlers.getJob(request({}, { jobId: done.id }), doneRes.response)

  assert.equal(doneRes.code, 200)
  assert.equal(doneRes.body.progress, 100)
  assert.deepEqual(doneRes.body.rows, rows)

  const failed = await store.create('owner-a', storedRequest, Buffer.from('%PDF-test'))
  await store.updateMetadata(failed.id, {
    stage: 'error', pagesDone: 83, error: 'OCR failed on page 84 after retries. Please try again.',
  })
  const errorRes = responseRecorder()
  await handlers.getJob(request({}, { jobId: failed.id }), errorRes.response)

  assert.equal(errorRes.code, 200)
  assert.equal(errorRes.body.progress, 27)
  assert.equal(errorRes.body.error, 'OCR failed on page 84 after retries. Please try again.')
  assert.equal('rows' in errorRes.body, false)
})

test('job runtime config applies production defaults and validates numeric environment values', () => {
  assert.deepEqual(readJobsRuntimeConfig({}), {
    jobConcurrency: 1,
    renderBatchPages: 10,
    ocrConcurrency: 8,
    retryDelaysMs: [2000, 5000, 10000],
    retentionMs: 24 * 60 * 60 * 1000,
  })
  assert.deepEqual(readJobsRuntimeConfig({
    JOB_CONCURRENCY: '2',
    OCR_RENDER_BATCH_PAGES: '7',
    OCR_CONCURRENCY: '4',
    JOB_RETENTION_HOURS: '12.5',
  }), {
    jobConcurrency: 2,
    renderBatchPages: 7,
    ocrConcurrency: 4,
    retryDelaysMs: [2000, 5000, 10000],
    retentionMs: 12.5 * 60 * 60 * 1000,
  })

  const invalid = [
    { JOB_CONCURRENCY: '0' },
    { JOB_CONCURRENCY: '1.5' },
    { OCR_RENDER_BATCH_PAGES: '11' },
    { OCR_RENDER_BATCH_PAGES: 'not-a-number' },
    { OCR_CONCURRENCY: '9' },
    { JOB_RETENTION_HOURS: '0' },
    { JOB_RETENTION_HOURS: 'Infinity' },
    { JOB_RETENTION_HOURS: '1e308' },
  ]
  for (const environment of invalid) {
    assert.throws(() => readJobsRuntimeConfig(environment), /environment variable/i)
  }
})
