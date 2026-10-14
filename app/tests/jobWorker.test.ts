import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { ExtractCoreInput, ExtractCoreResult } from '../api/extract'
import { createJobStore } from '../api/jobStore'
import type { StoredJobRequest } from '../api/jobTypes'
import {
  createJobWorker,
  type JobWorkerConfig,
  type JobWorkerDeps,
} from '../api/jobWorker'

const baseRequest: StoredJobRequest = {
  filename: 'large.pdf', pageCount: 23, text: '', isDigital: false,
  useOcr: true, customerMaster: [], customerId: null,
  customerInstructions: '', vendorCode: 'auto', vendorBranch: 'auto',
}

interface FixtureOptions {
  pageCount?: number
  request?: Partial<StoredJobRequest>
  config?: Partial<JobWorkerConfig>
  render?: JobWorkerDeps['renderPdfPageRange']
  getPdfPageCount?: JobWorkerDeps['getPdfPageCount']
  ocr?: JobWorkerDeps['ocrPage']
  onOcr?: (page: number) => void
  extract?: JobWorkerDeps['extract']
}

interface FixtureTestContext {
  after(fn: () => void | Promise<void>): void
}

async function fixture(t: FixtureTestContext, options: FixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'job-worker-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  const store = createJobStore(root)
  const pageCount = options.pageCount ?? 23
  const request: StoredJobRequest = {
    ...baseRequest,
    pageCount,
    ...options.request,
  }
  const job = await store.create('owner-1', request, Buffer.from('%PDF-test'))
  const sleepCalls: number[] = []
  const extractInputs: ExtractCoreInput[] = []
  const metadataUpdates: Array<Record<string, unknown>> = []
  const originalUpdateMetadata = store.updateMetadata.bind(store)
  store.updateMetadata = async (id, update) => {
    metadataUpdates.push({ ...update })
    return originalUpdateMetadata(id, update)
  }

  const deps: JobWorkerDeps = {
    store,
    getPdfPageCount: options.getPdfPageCount ?? (() => pageCount),
    renderPdfPageRange: options.render ?? (async (_path, start, end) =>
      Array.from({ length: end - start + 1 }, (_, i) => ({
        page: start + i,
        pngBase64: `png-${start + i}`,
      }))),
    ocrPage: options.ocr ?? (async (_image, page) => {
      options.onOcr?.(page)
      return `text-${page}`
    }),
    extract: async (input, onProgress) => {
      extractInputs.push(input)
      if (options.extract) return options.extract(input, onProgress)
      onProgress(1, 1)
      return { ok: true, rows: [{ invoiceno: 'INV-1' }] }
    },
    getApiKey: () => 'test-key',
    sleep: async (ms) => { sleepCalls.push(ms) },
  }
  const config: JobWorkerConfig = {
    jobConcurrency: 1,
    renderBatchPages: 10,
    ocrConcurrency: 3,
    retryDelaysMs: [2000, 5000, 10000],
    ...options.config,
  }
  const worker = createJobWorker(deps, config)
  t.after(() => worker.stop())
  return { root, store, worker, job, request, deps, sleepCalls, extractInputs, metadataUpdates }
}

test('processes 23 pages in ranges no larger than ten and persists final rows', async (t) => {
  const seenRanges: Array<[number, number]> = []
  const { store, worker, job } = await fixture(t, {
    pageCount: 23,
    render: async (_path, start, end) => {
      seenRanges.push([start, end])
      return Array.from({ length: end - start + 1 }, (_, i) => ({
        page: start + i, pngBase64: `png-${start + i}`,
      }))
    },
  })

  worker.enqueue(job.id)
  await worker.waitForIdle()

  assert.deepEqual(seenRanges, [[1, 10], [11, 20], [21, 23]])
  assert.equal((await store.readMetadata(job.id))?.stage, 'done')
  assert.equal((await store.readResult(job.id))?.rows.length, 1)
})

test('accepts a 300-page job asynchronously with bounded rendering and durable checkpoints', async (t) => {
  const seenRanges: Array<[number, number]> = []
  let extractCalls = 0
  const { store, worker, job } = await fixture(t, {
    pageCount: 300,
    render: async (_path, start, end) => {
      seenRanges.push([start, end])
      return Array.from({ length: end - start + 1 }, (_, i) => ({
        page: start + i,
        pngBase64: `png-${start + i}`,
      }))
    },
    ocr: async (_image, page) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 1))
      return `text-${page}`
    },
    extract: async (input, onProgress) => {
      extractCalls++
      onProgress(1, 1)
      const pages = input.text.split('\n\n--- PAGE BREAK ---\n\n')
      return {
        ok: true,
        rows: pages.map((text, index) => ({
          invoiceno: `INV-${index + 1}`,
          description: text,
        })),
      }
    },
  })

  worker.enqueue(job.id)
  let becameIdle = false
  const idle = worker.waitForIdle().then(() => { becameIdle = true })
  await Promise.resolve()

  assert.equal(becameIdle, false, 'job creation must return before background work becomes idle')
  await idle

  const widths = seenRanges.map(([start, end]) => end - start + 1)
  const checkpoints = await store.listCompletedOcrPages(job.id)
  const result = await store.readResult(job.id)
  assert.equal(seenRanges.length, 30)
  assert.equal(Math.max(...widths), 10)
  assert.deepEqual(checkpoints, Array.from({ length: 300 }, (_, index) => index + 1))
  assert.equal(extractCalls, 1)
  assert.equal(result?.rows.length, 300)
  assert.equal((await store.readMetadata(job.id))?.stage, 'done')
})

test('recovery skips durable OCR pages after restart', async (t) => {
  const called: number[] = []
  const { store, worker, job } = await fixture(t, {
    pageCount: 5,
    onOcr: page => called.push(page),
  })
  await store.writeOcrPage(job.id, 1, 'already done')
  await store.writeOcrPage(job.id, 2, 'already done')
  await store.updateMetadata(job.id, { stage: 'ocr', pagesDone: 2 })

  await worker.recover()
  await worker.waitForIdle()

  assert.deepEqual(called, [3, 4, 5])
})

test('recovery reconciles pagesDone from durable OCR files when no pages are missing', async (t) => {
  const called: number[] = []
  const { store, worker, job } = await fixture(t, {
    pageCount: 3,
    onOcr: page => called.push(page),
  })
  await store.writeOcrPage(job.id, 1, 'page one')
  await store.writeOcrPage(job.id, 2, 'page two')
  await store.writeOcrPage(job.id, 3, 'page three')
  await store.updateMetadata(job.id, { stage: 'ocr', pagesDone: 1 })

  await worker.recover()
  await worker.waitForIdle()

  assert.deepEqual(called, [])
  assert.equal((await store.readMetadata(job.id))?.pagesDone, 3)
  assert.equal((await store.readMetadata(job.id))?.stage, 'done')
})

test('retries only a transient OCR page and checkpoints it once', async (t) => {
  let attempts = 0
  const { store, worker, job, sleepCalls } = await fixture(t, {
    pageCount: 1,
    config: { ocrConcurrency: 1 },
    ocr: async () => {
      attempts++
      if (attempts < 3) throw Object.assign(new Error('rate limited'), { status: 429 })
      return 'durable page text'
    },
  })

  worker.enqueue(job.id)
  await worker.waitForIdle()

  assert.equal(attempts, 3)
  assert.deepEqual(sleepCalls, [2000, 5000])
  assert.deepEqual(await store.listCompletedOcrPages(job.id), [1])
  assert.equal(await store.readOcrPage(job.id, 1), 'durable page text')
})

test('exhausted OCR retries become terminal at the last durable checkpoint', async (t) => {
  let attempts = 0
  let extractCalls = 0
  const { store, worker, job, sleepCalls } = await fixture(t, {
    pageCount: 2,
    config: { ocrConcurrency: 1 },
    ocr: async () => {
      attempts++
      throw Object.assign(new Error('Bearer secret-token customer invoice'), { status: 502 })
    },
    extract: async () => {
      extractCalls++
      return { ok: true, rows: [] }
    },
  })
  await store.writeOcrPage(job.id, 1, 'already durable')
  await store.updateMetadata(job.id, { stage: 'ocr', pagesDone: 1 })

  worker.enqueue(job.id)
  await worker.waitForIdle()

  const metadata = await store.readMetadata(job.id)
  assert.equal(attempts, 4)
  assert.deepEqual(sleepCalls, [2000, 5000, 10000])
  assert.equal(metadata?.stage, 'error')
  assert.equal(metadata?.pagesDone, 1)
  assert.doesNotMatch(metadata?.error ?? '', /secret-token|customer invoice|Bearer/i)
  assert.equal(extractCalls, 0)
})

test('retries transient extraction from zero batch progress without repeating OCR', async (t) => {
  const ocrCalls: number[] = []
  const progressAtAttempt: Array<[number, number]> = []
  let attempts = 0
  let storeForExtract: Awaited<ReturnType<typeof fixture>>['store']
  let jobId = ''
  const setup = await fixture(t, {
    pageCount: 2,
    onOcr: page => ocrCalls.push(page),
    extract: async (_input, onProgress): Promise<ExtractCoreResult> => {
      attempts++
      const metadata = await storeForExtract.readMetadata(jobId)
      progressAtAttempt.push([
        metadata?.extractBatchesDone ?? -1,
        metadata?.extractBatchesTotal ?? -1,
      ])
      if (attempts === 1) {
        onProgress(1, 2)
        return { ok: false, status: 502, error: 'temporary upstream body' }
      }
      onProgress(1, 1)
      return { ok: true, rows: [{ invoiceno: 'INV-2' }] }
    },
  })
  storeForExtract = setup.store
  jobId = setup.job.id

  setup.worker.enqueue(setup.job.id)
  await setup.worker.waitForIdle()

  assert.equal(attempts, 2)
  assert.deepEqual(progressAtAttempt, [[0, 0], [0, 0]])
  assert.deepEqual(ocrCalls, [1, 2])
  assert.deepEqual(setup.sleepCalls, [2000])
  assert.equal((await setup.store.readMetadata(setup.job.id))?.stage, 'done')
})

test('does not retry a deterministic status-less extraction error', async (t) => {
  let attempts = 0
  const { store, worker, job, sleepCalls } = await fixture(t, {
    pageCount: 1,
    request: { text: 'digital', isDigital: true, useOcr: false },
    extract: async () => {
      attempts++
      throw new TypeError('deterministic post-processing failure')
    },
  })

  worker.enqueue(job.id)
  await worker.waitForIdle()

  assert.equal(attempts, 1)
  assert.deepEqual(sleepCalls, [])
  assert.equal((await store.readMetadata(job.id))?.stage, 'error')
})

test('retries a status-less extraction failure with concrete network evidence', async (t) => {
  let attempts = 0
  const { store, worker, job, sleepCalls } = await fixture(t, {
    pageCount: 1,
    request: { text: 'digital', isDigital: true, useOcr: false },
    extract: async () => {
      attempts++
      if (attempts === 1) {
        throw Object.assign(new Error('socket reset'), { code: 'ECONNRESET' })
      }
      return { ok: true, rows: [{ invoiceno: 'network-retry' }] }
    },
  })

  worker.enqueue(job.id)
  await worker.waitForIdle()

  assert.equal(attempts, 2)
  assert.deepEqual(sleepCalls, [2000])
  assert.equal((await store.readMetadata(job.id))?.stage, 'done')
})

test('contains rejected extraction progress writes and continues draining the queue', async (t) => {
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
  process.on('unhandledRejection', onUnhandled)
  t.after(() => process.off('unhandledRejection', onUnhandled))

  const setup = await fixture(t, {
    pageCount: 1,
    request: { filename: 'first.pdf', text: 'first', isDigital: true, useOcr: false },
    extract: async (input, onProgress) => {
      onProgress(1, 1)
      if (input.filename === 'first.pdf') {
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      return { ok: true, rows: [{ filename: input.filename }] }
    },
  })
  const second = await setup.store.create('owner-1', {
    ...baseRequest,
    filename: 'second.pdf', pageCount: 1, text: 'second', isDigital: true, useOcr: false,
  }, Buffer.alloc(0))
  const originalUpdateMetadata = setup.store.updateMetadata.bind(setup.store)
  let rejectProgressOnce = true
  setup.store.updateMetadata = async (id, update) => {
    if (rejectProgressOnce
      && id === setup.job.id
      && update.stage === 'extracting'
      && update.extractBatchesDone === 1) {
      rejectProgressOnce = false
      throw new Error('metadata write failed')
    }
    return originalUpdateMetadata(id, update)
  }

  setup.worker.enqueue(setup.job.id)
  setup.worker.enqueue(second.id)
  await setup.worker.waitForIdle()
  await new Promise<void>((resolve) => setImmediate(resolve))

  assert.deepEqual(unhandled, [])
  assert.equal((await setup.store.readMetadata(setup.job.id))?.stage, 'error')
  assert.equal((await setup.store.readMetadata(second.id))?.stage, 'done')
})

test('joins OCR checkpoints in page order even when OCR completes out of order', async (t) => {
  let releaseFirst: (() => void) | undefined
  const firstMayFinish = new Promise<void>((resolve) => { releaseFirst = resolve })
  const { worker, job, extractInputs } = await fixture(t, {
    pageCount: 3,
    ocr: async (_image, page) => {
      if (page === 1) await firstMayFinish
      if (page === 3) releaseFirst?.()
      return `page-${page}`
    },
  })

  worker.enqueue(job.id)
  await worker.waitForIdle()

  assert.equal(extractInputs[0].text, 'page-1\n\n--- PAGE BREAK ---\n\npage-2\n\n--- PAGE BREAK ---\n\npage-3')
})

test('digital text bypasses OCR and uses shared post-text customer detection', async (t) => {
  const exactText = '  heading\n0105535134278\ntrailing spaces  '
  const { store, worker, job, extractInputs } = await fixture(t, {
    pageCount: 2,
    request: {
      filename: 'unknown.pdf', text: exactText, isDigital: true, useOcr: false,
      customerId: null, customerInstructions: 'stale', vendorCode: 'stale', vendorBranch: 'stale',
    },
    getPdfPageCount: () => { throw new Error('digital job must not count PDF pages') },
    render: () => { throw new Error('digital job must not render') },
    ocr: async () => { throw new Error('digital job must not OCR') },
  })

  worker.enqueue(job.id)
  await worker.waitForIdle()

  assert.equal(extractInputs[0].text, exactText)
  assert.equal(extractInputs[0].customerId, 'CFR')
  assert.equal(extractInputs[0].vendorCode, 'top-m-line')
  assert.equal(extractInputs[0].vendorBranch, 'blank')
  assert.match(extractInputs[0].customerSection, /Central Food Retail/)
  assert.equal((await store.readMetadata(job.id))?.pagesDone, 2)
})

test('deduplicates active jobs and continues draining after an uncaught failure', async (t) => {
  let failedJobId = ''
  const pageCountCalls = new Map<string, number>()
  const setup = await fixture(t, {
    pageCount: 1,
    config: { jobConcurrency: 1, ocrConcurrency: 1 },
    getPdfPageCount: (path) => {
      const id = path.includes(failedJobId) ? failedJobId : 'second'
      pageCountCalls.set(id, (pageCountCalls.get(id) ?? 0) + 1)
      if (id === failedJobId) throw new Error('private invoice body')
      return 1
    },
  })
  failedJobId = setup.job.id
  const second = await setup.store.create('owner-1', { ...baseRequest, pageCount: 1 }, Buffer.from('%PDF-test'))

  setup.worker.enqueue(setup.job.id)
  setup.worker.enqueue(setup.job.id)
  setup.worker.enqueue(second.id)
  await setup.worker.waitForIdle()

  assert.equal(pageCountCalls.get(setup.job.id), 1)
  assert.equal((await setup.store.readMetadata(setup.job.id))?.stage, 'error')
  assert.doesNotMatch((await setup.store.readMetadata(setup.job.id))?.error ?? '', /private invoice body/)
  assert.equal((await setup.store.readMetadata(second.id))?.stage, 'done')
})
