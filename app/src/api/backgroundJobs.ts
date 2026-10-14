import type { InvoiceRow } from '../types/invoice'

export const ACTIVE_PDF_JOBS_STORAGE_KEY = 'armt_active_pdf_jobs_v1'
const DEFAULT_JOB_ERROR = 'Job processing failed. Please try again.'
const UNAVAILABLE_JOB_ERROR = 'This background job is no longer available. Please upload the PDF again.'

export class BackgroundJobUnavailableError extends Error {
  constructor() {
    super(UNAVAILABLE_JOB_ERROR)
    this.name = 'BackgroundJobUnavailableError'
  }
}

export function isBackgroundJobUnavailableError(
  error: unknown,
): error is BackgroundJobUnavailableError {
  return error instanceof BackgroundJobUnavailableError
}

class UnexpectedBackgroundJobIdError extends Error {}

export type BackgroundJobStage =
  | 'queued'
  | 'rendering'
  | 'ocr'
  | 'extracting'
  | 'done'
  | 'error'

export interface BackgroundJobPayload {
  filename: string
  pageCount: number
  text: string
  isDigital: boolean
  useOcr: boolean
  pdf?: string
  customerMaster: unknown[]
  customerId: string | null
  customerInstructions: string
  vendorCode: string
  vendorBranch: string
}

export interface CreatedBackgroundJob {
  jobId: string
  status: 'queued'
  pagesTotal: number
}

export interface BackgroundJobStatus {
  jobId: string
  filename: string
  status: BackgroundJobStage
  pagesDone: number
  pagesTotal: number
  extractBatchesDone: number
  extractBatchesTotal: number
  progress: number
  createdAt: string
  updatedAt: string
  error: string | null
  rows?: Partial<InvoiceRow>[]
}

export interface ActiveBackgroundJob {
  jobId: string
  filename: string
  pagesTotal: number
  delivered: boolean
}

export interface ActiveJobRegistry {
  list(): ActiveBackgroundJob[]
  save(job: Omit<ActiveBackgroundJob, 'delivered'>): void
  claimResult(jobId: string): boolean
  remove(jobId: string): void
}

export type GetToken = () => Promise<string | null>
export type PollSleep = (milliseconds: number) => Promise<void>

interface JobProgress {
  stage: BackgroundJobStage
  pagesDone: number
  pagesTotal: number
  extractBatchesDone: number
  extractBatchesTotal: number
}

export interface PollBackgroundJobOptions {
  fetchImpl?: typeof fetch
  sleep?: PollSleep
  signal?: AbortSignal
  registry?: ActiveJobRegistry
  onStatus?: (status: BackgroundJobStatus) => void | Promise<void>
  onResult?: (rows: Partial<InvoiceRow>[], status: BackgroundJobStatus) => void | Promise<void>
}

export function createActiveJobRegistry(storage: Storage): ActiveJobRegistry {
  const read = (): ActiveBackgroundJob[] => parseActiveJobs(storage.getItem(ACTIVE_PDF_JOBS_STORAGE_KEY))
  const write = (jobs: ActiveBackgroundJob[]) => {
    storage.setItem(ACTIVE_PDF_JOBS_STORAGE_KEY, JSON.stringify(jobs))
  }
  const restored = read()
  if (restored.some(job => job.delivered)) {
    write(restored.map(job => ({ ...job, delivered: false })))
  }

  return {
    list: read,
    save(job) {
      const jobs = read()
      const existing = jobs.find(entry => entry.jobId === job.jobId)
      const saved = { ...job, delivered: existing?.delivered ?? false }
      write([...jobs.filter(entry => entry.jobId !== job.jobId), saved])
    },
    claimResult(jobId) {
      const jobs = read()
      const index = jobs.findIndex(entry => entry.jobId === jobId)
      if (index < 0 || jobs[index].delivered) return false
      jobs[index] = { ...jobs[index], delivered: true }
      write(jobs)
      return true
    },
    remove(jobId) {
      write(read().filter(entry => entry.jobId !== jobId))
    },
  }
}

export function jobProgressPercent(progress: JobProgress): number {
  if (progress.stage === 'done') return 100
  const failedDuringExtraction = progress.stage === 'error'
    && (progress.extractBatchesDone > 0 || progress.pagesDone >= progress.pagesTotal)
  if (progress.stage === 'extracting' || failedDuringExtraction) {
    if (progress.extractBatchesTotal < 1) return 90
    const completed = clamp(progress.extractBatchesDone, 0, progress.extractBatchesTotal)
    return 90 + Math.floor(9 * completed / progress.extractBatchesTotal)
  }
  if (progress.pagesTotal < 1) return 0
  const completed = clamp(progress.pagesDone, 0, progress.pagesTotal)
  return Math.round(90 * completed / progress.pagesTotal)
}

export async function createBackgroundJob(
  payload: BackgroundJobPayload,
  getToken: GetToken,
  fetchImpl: typeof fetch = fetch,
): Promise<CreatedBackgroundJob> {
  const token = await getToken()
  const response = await fetchImpl(backgroundJobsUrl(), {
    method: 'POST',
    headers: requestHeaders(token),
    body: JSON.stringify(payload),
  })
  if (response.status !== 202) {
    throw new Error(await responseError(response, 'Unable to create job'))
  }
  const value: unknown = await response.json()
  if (!isRecord(value)
    || typeof value.jobId !== 'string'
    || value.status !== 'queued'
    || !isNonNegativeInteger(value.pagesTotal)) {
    throw new Error('Unable to create job: invalid response')
  }
  return { jobId: value.jobId, status: value.status, pagesTotal: value.pagesTotal }
}

export async function pollBackgroundJob(
  jobId: string,
  getToken: GetToken,
  options: PollBackgroundJobOptions = {},
): Promise<BackgroundJobStatus> {
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? delay
  let token = await getToken()
  throwIfAborted(options.signal)
  let refreshedAfterUnauthorized = false
  let consecutiveTransientErrors = 0

  while (true) {
    throwIfAborted(options.signal)
    let response: Response
    try {
      response = await fetchImpl(`${backgroundJobsUrl()}/${encodeURIComponent(jobId)}`, {
        method: 'GET',
        headers: requestHeaders(token, false),
        signal: options.signal,
      })
      throwIfAborted(options.signal)
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) throw abortError()
      consecutiveTransientErrors++
      await sleep(consecutiveTransientErrors === 1 ? 2000 : 5000)
      throwIfAborted(options.signal)
      continue
    }

    if (response.status === 401) {
      if (refreshedAfterUnauthorized) throw new Error('Unauthorized while reading job')
      refreshedAfterUnauthorized = true
      token = await getToken()
      continue
    }
    if (response.status === 404) {
      throw new BackgroundJobUnavailableError()
    }
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel().catch(() => {})
      consecutiveTransientErrors++
      await sleep(consecutiveTransientErrors === 1 ? 2000 : 5000)
      throwIfAborted(options.signal)
      continue
    }
    if (!response.ok) {
      throw new Error(await responseError(response, 'Unable to read job'))
    }

    let status: BackgroundJobStatus
    try {
      const body: unknown = await response.json()
      throwIfAborted(options.signal)
      status = parseBackgroundJobStatus(body, jobId)
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) throw abortError()
      if (error instanceof UnexpectedBackgroundJobIdError) throw error
      consecutiveTransientErrors++
      await sleep(consecutiveTransientErrors === 1 ? 2000 : 5000)
      throwIfAborted(options.signal)
      continue
    }
    consecutiveTransientErrors = 0
    await options.onStatus?.(status)
    throwIfAborted(options.signal)

    if (status.status === 'done') {
      if (options.onResult && (!options.registry || options.registry.claimResult(jobId))) {
        await options.onResult(status.rows ?? [], status)
      }
      return status
    }
    if (status.status === 'error') return status

    await sleep(2000)
    throwIfAborted(options.signal)
  }
}

export async function runBackgroundJobsInOrder<T>(
  jobs: readonly T[],
  run: (job: T, index: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  for (let index = 0; index < jobs.length; index++) {
    throwIfAborted(signal)
    await run(jobs[index], index)
    throwIfAborted(signal)
  }
}

function parseActiveJobs(raw: string | null): ActiveBackgroundJob[] {
  if (raw === null) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is ActiveBackgroundJob =>
      isRecord(entry)
      && typeof entry.jobId === 'string'
      && entry.jobId.length > 0
      && typeof entry.filename === 'string'
      && entry.filename.length > 0
      && isPositiveInteger(entry.pagesTotal)
      && typeof entry.delivered === 'boolean')
  } catch {
    return []
  }
}

function parseBackgroundJobStatus(value: unknown, expectedJobId: string): BackgroundJobStatus {
  if (isRecord(value)
    && typeof value.jobId === 'string'
    && value.jobId !== expectedJobId) {
    throw new UnexpectedBackgroundJobIdError('Unable to read job: invalid response')
  }
  if (!isRecord(value)
    || typeof value.jobId !== 'string'
    || value.jobId !== expectedJobId
    || typeof value.filename !== 'string'
    || !isBackgroundJobStage(value.status)
    || !isNonNegativeInteger(value.pagesDone)
    || !isPositiveInteger(value.pagesTotal)
    || !isNonNegativeInteger(value.extractBatchesDone)
    || !isNonNegativeInteger(value.extractBatchesTotal)
    || typeof value.createdAt !== 'string'
    || typeof value.updatedAt !== 'string'
    || !(value.error === null || typeof value.error === 'string')
    || (value.status === 'done' && !Array.isArray(value.rows))) {
    throw new Error('Unable to read job: invalid response')
  }
  const progress = {
    stage: value.status,
    pagesDone: value.pagesDone,
    pagesTotal: value.pagesTotal,
    extractBatchesDone: value.extractBatchesDone,
    extractBatchesTotal: value.extractBatchesTotal,
  }
  const error = value.status === 'error'
    ? (typeof value.error === 'string' && value.error.trim().length > 0
        ? value.error.trim()
        : DEFAULT_JOB_ERROR)
    : value.error
  return {
    jobId: value.jobId,
    filename: value.filename,
    status: value.status,
    pagesDone: value.pagesDone,
    pagesTotal: value.pagesTotal,
    extractBatchesDone: value.extractBatchesDone,
    extractBatchesTotal: value.extractBatchesTotal,
    progress: jobProgressPercent(progress),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    error,
    ...(Array.isArray(value.rows) ? { rows: value.rows as Partial<InvoiceRow>[] } : {}),
  }
}

function backgroundJobsUrl(): string {
  const base = import.meta.env?.BASE_URL ?? '/'
  return `${base.endsWith('/') ? base : `${base}/`}api/jobs`
}

function requestHeaders(token: string | null, json = true): HeadersInit {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null)
  if (!isRecord(body)) return `${fallback}: HTTP ${response.status}`
  const details = [body.error, body.reason].filter(value => typeof value === 'string')
  return details.length > 0 ? details.join(' — ') : `${fallback}: HTTP ${response.status}`
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function abortError(): DOMException {
  return new DOMException('Polling aborted', 'AbortError')
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isBackgroundJobStage(value: unknown): value is BackgroundJobStage {
  return value === 'queued'
    || value === 'rendering'
    || value === 'ocr'
    || value === 'extracting'
    || value === 'done'
    || value === 'error'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}
