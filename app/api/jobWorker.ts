import { join } from 'node:path'
import {
  buildCustomerMasterJson,
  type ExtractCoreInput,
  type ExtractCoreResult,
} from './extract'
import type { JobStore, StoredJobRequest } from './jobTypes'
import { pageRanges, type RenderedPage } from './pdfRaster'
import { buildCustomerInstructions, detectCustomer } from '../src/config/customers'

const PAGE_BREAK = '\n\n--- PAGE BREAK ---\n\n'
const MAX_RENDER_BATCH_PAGES = 10
const TRANSIENT_NETWORK_CODES = new Set([
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'EPIPE',
  'ERR_NETWORK',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
])

export interface JobWorkerConfig {
  jobConcurrency: number
  renderBatchPages: number
  ocrConcurrency: number
  retryDelaysMs: number[]
}

export interface JobWorkerDeps {
  store: JobStore
  getPdfPageCount(path: string): number | Promise<number>
  renderPdfPageRange(
    path: string,
    start: number,
    end: number,
  ): Promise<RenderedPage[]> | RenderedPage[]
  ocrPage(image: string, page: number, apiKey: string): Promise<string>
  extract(
    input: ExtractCoreInput,
    onProgress: (done: number, total: number) => void,
  ): Promise<ExtractCoreResult>
  getApiKey(): string
  sleep(ms: number): Promise<void>
}

export interface JobWorker {
  enqueue(id: string): void
  recover(): Promise<void>
  waitForIdle(): Promise<void>
  stop(): void
}

class UserSafeJobError extends Error {}

export function createJobWorker(deps: JobWorkerDeps, config: JobWorkerConfig): JobWorker {
  validateConfig(config)

  const queued = new Set<string>()
  const active = new Set<string>()
  const idleWaiters = new Set<() => void>()
  const retryDelaysMs = [...config.retryDelaysMs]
  let stopped = false

  function enqueue(id: string): void {
    if (stopped || queued.has(id) || active.has(id)) return
    queued.add(id)
    pump()
  }

  async function recover(): Promise<void> {
    const jobs = await deps.store.listRecoverable()
    for (const job of jobs) enqueue(job.id)
  }

  function waitForIdle(): Promise<void> {
    if (queued.size === 0 && active.size === 0) return Promise.resolve()
    return new Promise((resolve) => idleWaiters.add(resolve))
  }

  function stop(): void {
    stopped = true
    queued.clear()
    settleIdleWaiters()
  }

  function pump(): void {
    while (!stopped && active.size < config.jobConcurrency && queued.size > 0) {
      const id = queued.values().next().value as string
      queued.delete(id)
      active.add(id)
      void processJobSafely(id).finally(() => {
        active.delete(id)
        pump()
        settleIdleWaiters()
      })
    }
    settleIdleWaiters()
  }

  function settleIdleWaiters(): void {
    if (queued.size !== 0 || active.size !== 0) return
    for (const resolve of idleWaiters) resolve()
    idleWaiters.clear()
  }

  async function processJobSafely(id: string): Promise<void> {
    try {
      await processJob(id)
    } catch (error) {
      try {
        const metadata = await deps.store.readMetadata(id)
        if (metadata && metadata.stage !== 'done' && metadata.stage !== 'error') {
          await deps.store.updateMetadata(id, {
            stage: 'error',
            error: safeErrorMessage(error),
          })
        }
      } catch {
        // Persistence failure cannot be safely reported here, but must not stop the queue.
      }
    }
  }

  async function processJob(id: string): Promise<void> {
    const metadata = await deps.store.readMetadata(id)
    if (!metadata || metadata.stage === 'done' || metadata.stage === 'error') return
    const request = await deps.store.readRequest(id)
    if (!request) throw new UserSafeJobError('Job input is unavailable. Please upload the PDF again.')

    let text: string
    if (request.useOcr) {
      text = await processOcr(id)
    } else {
      text = request.text
      await deps.store.updateMetadata(id, {
        stage: 'extracting',
        pagesDone: metadata.pagesTotal,
        extractBatchesDone: 0,
        extractBatchesTotal: 0,
        error: null,
      })
    }

    const apiKey = deps.getApiKey()
    const input = extractionInput(request, text, apiKey)
    const result = await extractWithRetry(id, input)
    await deps.store.writeResult(id, { rows: result.rows })
    await deps.store.updateMetadata(id, { stage: 'done', error: null })
  }

  async function processOcr(id: string): Promise<string> {
    await deps.store.updateMetadata(id, { stage: 'rendering', error: null })
    const pdfPath = inputPdfPath(id)
    const totalPages = await deps.getPdfPageCount(pdfPath)
    if (!Number.isInteger(totalPages) || totalPages < 1) {
      throw new UserSafeJobError('The PDF page count could not be read.')
    }

    const current = await deps.store.readMetadata(id)
    if (current?.pagesTotal !== totalPages) {
      await deps.store.updateMetadata(id, { pagesTotal: totalPages })
    }

    const completed = new Set(
      (await deps.store.listCompletedOcrPages(id))
        .filter((page) => page >= 1 && page <= totalPages),
    )
    await deps.store.updateMetadata(id, { pagesDone: completed.size })
    const apiKey = deps.getApiKey()
    const checkpoint = createCheckpointWriter(id)

    for (const { startPage, endPage } of pageRanges(totalPages, config.renderBatchPages)) {
      const missingPages: number[] = []
      for (let page = startPage; page <= endPage; page++) {
        if (!completed.has(page)) missingPages.push(page)
      }
      if (missingPages.length === 0) continue

      await deps.store.updateMetadata(id, { stage: 'rendering' })
      const rendered = await deps.renderPdfPageRange(pdfPath, startPage, endPage)
      const imagesByPage = new Map(rendered.map((page) => [page.page, page.pngBase64]))
      const work = missingPages.map((page) => {
        const image = imagesByPage.get(page)
        if (image === undefined) {
          throw new UserSafeJobError(`PDF page ${page} could not be rendered.`)
        }
        return { page, image }
      })

      await deps.store.updateMetadata(id, { stage: 'ocr' })
      await orderedPool(work, config.ocrConcurrency, async ({ page, image }) => {
        let pageText: string
        try {
          pageText = await retryTransient(
            () => deps.ocrPage(image, page, apiKey),
            retryDelaysMs,
            deps.sleep,
          )
        } catch {
          throw new UserSafeJobError(`OCR failed on page ${page} after retries. Please try again.`)
        }
        await checkpoint(page, pageText)
        completed.add(page)
        return pageText
      })
    }

    const pageTexts: string[] = []
    for (let page = 1; page <= totalPages; page++) {
      const pageText = await deps.store.readOcrPage(id, page)
      if (pageText === null) {
        throw new UserSafeJobError(`OCR checkpoint for page ${page} is unavailable.`)
      }
      pageTexts.push(pageText)
    }
    await deps.store.updateMetadata(id, { stage: 'extracting' })
    return pageTexts.join(PAGE_BREAK)
  }

  function createCheckpointWriter(id: string) {
    let lock = Promise.resolve()
    return async (page: number, pageText: string): Promise<void> => {
      const previous = lock
      let release = () => {}
      lock = new Promise<void>((resolve) => { release = resolve })
      await previous
      try {
        await deps.store.writeOcrPage(id, page, pageText)
        const pagesDone = (await deps.store.listCompletedOcrPages(id)).length
        await deps.store.updateMetadata(id, { stage: 'ocr', pagesDone })
      } finally {
        release()
      }
    }
  }

  async function extractWithRetry(
    id: string,
    input: ExtractCoreInput,
  ): Promise<Extract<ExtractCoreResult, { ok: true }>> {
    await deps.store.updateMetadata(id, {
      stage: 'extracting',
      extractBatchesDone: 0,
      extractBatchesTotal: 0,
    })

    for (let attempt = 0; ; attempt++) {
      let progressWrites = Promise.resolve()
      const onProgress = (done: number, total: number) => {
        const write = progressWrites.then(async () => {
          await deps.store.updateMetadata(id, {
            stage: 'extracting',
            extractBatchesDone: done,
            extractBatchesTotal: total,
          })
        })
        void write.catch(() => {})
        progressWrites = write
      }

      let result: ExtractCoreResult
      try {
        result = await deps.extract(input, onProgress)
        await progressWrites
      } catch (error) {
        await progressWrites
        if (!isTransient(error) || attempt >= retryDelaysMs.length) {
          throw new UserSafeJobError('Extraction failed after retries. Please try again.')
        }
        await resetExtractionProgress(id)
        await deps.sleep(retryDelaysMs[attempt])
        continue
      }

      if (result.ok) return result
      if (!isTransient(result) || attempt >= retryDelaysMs.length) {
        throw new UserSafeJobError('Extraction failed after retries. Please try again.')
      }
      await resetExtractionProgress(id)
      await deps.sleep(retryDelaysMs[attempt])
    }
  }

  async function resetExtractionProgress(id: string): Promise<void> {
    await deps.store.updateMetadata(id, {
      extractBatchesDone: 0,
      extractBatchesTotal: 0,
    })
  }

  return { enqueue, recover, waitForIdle, stop }
}

function extractionInput(
  request: StoredJobRequest,
  text: string,
  apiKey: string,
): ExtractCoreInput {
  let customerId = request.customerId?.toUpperCase() ?? ''
  let customerSection = request.customerInstructions
  let vendorCode = request.vendorCode
  let vendorBranch = request.vendorBranch

  if (request.customerId === null) {
    const effectiveRule = detectCustomer(text, request.filename)
    customerId = effectiveRule?.id ?? ''
    customerSection = buildCustomerInstructions(effectiveRule)
    vendorCode = effectiveRule?.vendorCode ?? 'auto'
    vendorBranch = effectiveRule?.vendorBranch ?? 'auto'
  }

  return {
    text,
    filename: request.filename,
    customerSection,
    vendorCode,
    vendorBranch,
    customerId,
    customerMasterJson: buildCustomerMasterJson(request.customerMaster),
    apiKey,
  }
}

function inputPdfPath(id: string): string {
  const root = process.env.JOB_DATA_DIR || join(process.cwd(), 'job-data')
  return join(root, id, 'input.pdf')
}

function validateConfig(config: JobWorkerConfig): void {
  if (!Number.isInteger(config.jobConcurrency) || config.jobConcurrency < 1) {
    throw new RangeError('jobConcurrency must be a positive integer')
  }
  if (!Number.isInteger(config.renderBatchPages)
    || config.renderBatchPages < 1
    || config.renderBatchPages > MAX_RENDER_BATCH_PAGES) {
    throw new RangeError('renderBatchPages must be an integer from 1 to 10')
  }
  if (!Number.isInteger(config.ocrConcurrency) || config.ocrConcurrency < 1) {
    throw new RangeError('ocrConcurrency must be a positive integer')
  }
  if (config.retryDelaysMs.some((delay) => !Number.isFinite(delay) || delay < 0)) {
    throw new RangeError('retryDelaysMs must contain non-negative numbers')
  }
}

async function retryTransient<T>(
  operation: () => Promise<T>,
  delays: number[],
  sleep: (ms: number) => Promise<void>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (!isTransient(error) || attempt >= delays.length) throw error
      await sleep(delays[attempt])
    }
  }
}

function isTransient(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const status = Number((error as { status?: unknown }).status)
  if (Number.isFinite(status)) {
    return status === 429 || (status >= 500 && status <= 599)
  }
  return hasTransientNetworkCode(error)
}

function hasTransientNetworkCode(error: object): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth++) {
    const value = current as { code?: unknown; cause?: unknown }
    if (typeof value.code === 'string' && TRANSIENT_NETWORK_CODES.has(value.code)) return true
    current = value.cause
  }
  return false
}

function safeErrorMessage(error: unknown): string {
  return error instanceof UserSafeJobError
    ? error.message
    : 'Job processing failed. Please try again.'
}

async function orderedPool<T, R>(
  items: T[],
  concurrency: number,
  operation: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  let failed = false
  let firstError: unknown

  async function worker(): Promise<void> {
    while (!failed && next < items.length) {
      const index = next++
      try {
        results[index] = await operation(items[index], index)
      } catch (error) {
        if (!failed) firstError = error
        failed = true
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  if (failed) throw firstError
  return results
}
