import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createActiveJobRegistry,
  createBackgroundJob,
  jobProgressPercent,
  pollBackgroundJob,
} from '../src/api/backgroundJobs'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear() { values.clear() },
    getItem(key) { return values.get(key) ?? null },
    key(index) { return [...values.keys()][index] ?? null },
    removeItem(key) { values.delete(key) },
    setItem(key, value) { values.set(key, String(value)) },
  }
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const doneStatus = {
  jobId: 'j1',
  filename: 'x.pdf',
  status: 'done' as const,
  pagesDone: 277,
  pagesTotal: 277,
  extractBatchesDone: 35,
  extractBatchesTotal: 35,
  progress: 100,
  createdAt: '2026-10-14T00:00:00.000Z',
  updatedAt: '2026-10-14T00:01:00.000Z',
  error: null,
  rows: [{ invoiceno: 'INV-1' }],
}

test('active job registry survives recreation and claims a result once', () => {
  const storage = memoryStorage()
  createActiveJobRegistry(storage).save({ jobId: 'j1', filename: 'x.pdf', pagesTotal: 277 })
  const restored = createActiveJobRegistry(storage)
  assert.deepEqual(restored.list().map(x => x.jobId), ['j1'])
  assert.equal(restored.claimResult('j1'), true)
  assert.equal(restored.claimResult('j1'), false)
})

test('active job registry filters malformed storage without crashing', () => {
  const storage = memoryStorage()
  storage.setItem('armt_active_pdf_jobs_v1', JSON.stringify([
    { jobId: 'good', filename: 'ok.pdf', pagesTotal: 26, delivered: false },
    { jobId: '', filename: 'bad.pdf', pagesTotal: 26, delivered: false },
    { jobId: 'bad-total', filename: 'bad.pdf', pagesTotal: 0, delivered: false },
  ]))
  assert.deepEqual(createActiveJobRegistry(storage).list(), [
    { jobId: 'good', filename: 'ok.pdf', pagesTotal: 26, delivered: false },
  ])

  storage.setItem('armt_active_pdf_jobs_v1', '{not-json')
  assert.deepEqual(createActiveJobRegistry(storage).list(), [])
})

test('progress uses real OCR pages and never reports failed work complete', () => {
  assert.equal(jobProgressPercent({ stage: 'ocr', pagesDone: 83, pagesTotal: 277,
    extractBatchesDone: 0, extractBatchesTotal: 35 }), 27)
  assert.equal(jobProgressPercent({ stage: 'error', pagesDone: 83, pagesTotal: 277,
    extractBatchesDone: 0, extractBatchesTotal: 35 }), 27)
})

test('progress reserves 100 for done and extraction advances only through 99', () => {
  assert.equal(jobProgressPercent({ stage: 'extracting', pagesDone: 277, pagesTotal: 277,
    extractBatchesDone: 34, extractBatchesTotal: 35 }), 98)
  assert.equal(jobProgressPercent({ stage: 'error', pagesDone: 277, pagesTotal: 277,
    extractBatchesDone: 35, extractBatchesTotal: 35 }), 99)
  assert.equal(jobProgressPercent({ stage: 'done', pagesDone: 277, pagesTotal: 277,
    extractBatchesDone: 35, extractBatchesTotal: 35 }), 100)
})

test('create posts an authenticated job request and requires HTTP 202', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init })
    return response(202, { jobId: 'j1', status: 'queued', pagesTotal: 277 })
  }
  const payload = {
    filename: 'x.pdf', pageCount: 277, text: '', isDigital: false, useOcr: true,
    pdf: 'JVBERi0=', customerMaster: [], customerId: null,
    customerInstructions: '', vendorCode: 'auto', vendorBranch: 'auto',
  }

  const created = await createBackgroundJob(payload, async () => 'signed-token', fetchImpl)

  assert.deepEqual(created, { jobId: 'j1', status: 'queued', pagesTotal: 277 })
  assert.equal(requests.length, 1)
  assert.match(requests[0].url, /api\/jobs$/)
  assert.equal(requests[0].init?.method, 'POST')
  assert.equal(new Headers(requests[0].init?.headers).get('Authorization'), 'Bearer signed-token')
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), payload)

  await assert.rejects(
    () => createBackgroundJob(payload, async () => 'signed-token', async () => response(200, created)),
    /create job/i,
  )
})

test('polling returns rows at done and waits two seconds after a running status', async () => {
  const statuses = [
    { ...doneStatus, status: 'ocr' as const, pagesDone: 83, progress: 27, rows: undefined },
    doneStatus,
  ]
  const delays: number[] = []
  const seen: string[] = []
  const terminal = await pollBackgroundJob('j1', async () => 'token', {
    fetchImpl: async () => response(200, statuses.shift()),
    sleep: async ms => { delays.push(ms) },
    onStatus: status => { seen.push(status.status) },
  })

  assert.deepEqual(delays, [2000])
  assert.deepEqual(seen, ['ocr', 'done'])
  assert.deepEqual(terminal.rows, [{ invoiceno: 'INV-1' }])
})

test('two pollers sharing the registry deliver completed rows once', async () => {
  const storage = memoryStorage()
  const registry = createActiveJobRegistry(storage)
  registry.save({ jobId: 'j1', filename: 'x.pdf', pagesTotal: 277 })
  const delivered: unknown[][] = []

  await Promise.all([
    pollBackgroundJob('j1', async () => 'token', {
      registry,
      fetchImpl: async () => response(200, doneStatus),
      sleep: async () => {},
      onResult: rows => { delivered.push(rows) },
    }),
    pollBackgroundJob('j1', async () => 'token', {
      registry: createActiveJobRegistry(storage),
      fetchImpl: async () => response(200, doneStatus),
      sleep: async () => {},
      onResult: rows => { delivered.push(rows) },
    }),
  ])

  assert.equal(delivered.length, 1)
  assert.deepEqual(delivered[0], [{ invoiceno: 'INV-1' }])
})

test('a 401 reacquires a token and retries only once', async () => {
  const tokens = ['old-token', 'new-token']
  const authorization: Array<string | null> = []
  let fetchCalls = 0

  const terminal = await pollBackgroundJob('j1', async () => tokens.shift() ?? null, {
    fetchImpl: async (_input, init) => {
      authorization.push(new Headers(init?.headers).get('Authorization'))
      fetchCalls++
      return fetchCalls === 1 ? response(401, { error: 'Unauthorized' }) : response(200, doneStatus)
    },
    sleep: async () => {},
  })

  assert.equal(terminal.status, 'done')
  assert.deepEqual(authorization, ['Bearer old-token', 'Bearer new-token'])
  assert.equal(tokens.length, 0)

  let repeatedCalls = 0
  await assert.rejects(
    () => pollBackgroundJob('j1', async () => 'token', {
      fetchImpl: async () => { repeatedCalls++; return response(401, { error: 'Unauthorized' }) },
      sleep: async () => {},
    }),
    /unauthorized/i,
  )
  assert.equal(repeatedCalls, 2)
})

test('two network errors back off for two then five seconds without changing job state', async () => {
  const storage = memoryStorage()
  const registry = createActiveJobRegistry(storage)
  registry.save({ jobId: 'j1', filename: 'x.pdf', pagesTotal: 277 })
  const delays: number[] = []
  const seen: string[] = []
  let attempts = 0

  const terminal = await pollBackgroundJob('j1', async () => 'token', {
    registry,
    fetchImpl: async () => {
      attempts++
      if (attempts <= 2) throw new TypeError('network unavailable')
      return response(200, doneStatus)
    },
    sleep: async ms => { delays.push(ms) },
    onStatus: status => { seen.push(status.status) },
  })

  assert.equal(terminal.status, 'done')
  assert.deepEqual(delays, [2000, 5000])
  assert.deepEqual(seen, ['done'])
  assert.deepEqual(registry.list(), [
    { jobId: 'j1', filename: 'x.pdf', pagesTotal: 277, delivered: false },
  ])
})

test('an abort signal stops browser polling without removing the saved reference', async () => {
  const storage = memoryStorage()
  const registry = createActiveJobRegistry(storage)
  registry.save({ jobId: 'j1', filename: 'x.pdf', pagesTotal: 277 })
  const controller = new AbortController()

  await assert.rejects(
    () => pollBackgroundJob('j1', async () => 'token', {
      registry,
      signal: controller.signal,
      fetchImpl: async () => response(200, {
        ...doneStatus, status: 'ocr', pagesDone: 83, progress: 27, rows: undefined,
      }),
      sleep: async () => { controller.abort() },
    }),
    error => error instanceof DOMException && error.name === 'AbortError',
  )

  assert.deepEqual(registry.list(), [
    { jobId: 'j1', filename: 'x.pdf', pagesTotal: 277, delivered: false },
  ])
})
