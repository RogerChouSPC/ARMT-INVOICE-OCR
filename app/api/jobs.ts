import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { JobMetadata, JobStore, StoredJobRequest } from './jobTypes'
import type { JobWorker } from './jobWorker'
import type { VerifyResult } from './verifyToken'

export const MAX_PDF_BYTES = 37 * 1024 * 1024

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const INVALID_BASE64_CHARACTER = /[^A-Za-z0-9+/=]/
const CLIENT_PATH_FIELDS = ['path', 'filePath', 'pdfPath'] as const

interface JobsHandlerDependencies {
  store: JobStore
  worker: Pick<JobWorker, 'enqueue'>
  verify(authHeader: string | undefined): Promise<VerifyResult>
}

interface JobsHandlers {
  authenticate: RequestHandler
  createJob: RequestHandler
  getJob: RequestHandler
}

export interface JobsRouteRegistrar {
  post(path: string, ...handlers: RequestHandler[]): unknown
  get(path: string, ...handlers: RequestHandler[]): unknown
}

interface ValidatedCreate {
  request: StoredJobRequest
  pdf: Buffer
}

type ValidationResult =
  | { ok: true; value: ValidatedCreate }
  | { ok: false; status: 400 | 413 }

export interface JobsRuntimeConfig {
  jobConcurrency: number
  renderBatchPages: number
  ocrConcurrency: number
  retryDelaysMs: number[]
  retentionMs: number
}

export function readJobsRuntimeConfig(
  environment: Record<string, string | undefined>,
): JobsRuntimeConfig {
  const retentionHours = positiveNumberEnvironment(
    environment,
    'JOB_RETENTION_HOURS',
    24,
  )
  const retentionMs = retentionHours * 60 * 60 * 1000
  if (!Number.isFinite(retentionMs)) {
    throw new RangeError('JOB_RETENTION_HOURS environment variable is too large')
  }
  return {
    jobConcurrency: positiveIntegerEnvironment(environment, 'JOB_CONCURRENCY', 1),
    renderBatchPages: positiveIntegerEnvironment(environment, 'OCR_RENDER_BATCH_PAGES', 10, 10),
    ocrConcurrency: positiveIntegerEnvironment(environment, 'OCR_CONCURRENCY', 8, 8),
    retryDelaysMs: [2000, 5000, 10000],
    retentionMs,
  }
}

export function createJobsHandlers({ store, worker, verify }: JobsHandlerDependencies) {
  const verifiedSubjects = new WeakMap<Request, string>()

  async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
    const subject = await authenticatedSubject(req, verify)
    if (subject === null) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    verifiedSubjects.set(req, subject)
    next()
  }

  async function requestSubject(req: Request): Promise<string | null> {
    const verified = verifiedSubjects.get(req)
    return verified ?? authenticatedSubject(req, verify)
  }

  async function createJob(req: Request, res: Response): Promise<void> {
    const subject = await requestSubject(req)
    if (subject === null) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const validated = validateCreateBody(req.body)
    if (!validated.ok) {
      res.status(validated.status).json({
        error: validated.status === 413 ? 'PDF is too large' : 'Invalid job request',
      })
      return
    }

    let metadata: JobMetadata
    try {
      metadata = await store.create(subject, validated.value.request, validated.value.pdf)
    } catch {
      res.status(500).json({ error: 'Unable to create job' })
      return
    }

    try {
      worker.enqueue(metadata.id)
    } catch {
      await store.updateMetadata(metadata.id, {
        stage: 'error',
        error: 'Job could not be queued. Please try again.',
      })
      res.status(500).json({ error: 'Unable to create job' })
      return
    }

    res.status(202).json({
      jobId: metadata.id,
      status: metadata.stage,
      pagesTotal: metadata.pagesTotal,
    })
  }

  async function getJob(req: Request, res: Response): Promise<void> {
    const subject = await requestSubject(req)
    if (subject === null) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const jobId = req.params.jobId
    if (typeof jobId !== 'string' || !UUID_PATTERN.test(jobId)) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    try {
      const metadata = await store.readMetadata(jobId)
      if (!metadata || metadata.ownerId !== subject) {
        res.status(404).json({ error: 'Not found' })
        return
      }

      const response = publicStatus(metadata)
      if (metadata.stage === 'done') {
        const result = await store.readResult(jobId)
        res.status(200).json({ ...response, rows: result?.rows ?? [] })
        return
      }
      res.status(200).json(response)
    } catch {
      res.status(500).json({ error: 'Unable to read job' })
    }
  }

  return { authenticate, createJob, getJob }
}

export function registerJobsRoutes(
  router: JobsRouteRegistrar,
  handlers: JobsHandlers,
  jsonParser: RequestHandler,
): void {
  router.post('/api/jobs', handlers.authenticate, jsonParser, handlers.createJob)
  router.get('/api/jobs/:jobId', handlers.authenticate, handlers.getJob)
}

async function authenticatedSubject(
  req: Request,
  verify: JobsHandlerDependencies['verify'],
): Promise<string | null> {
  try {
    const result = await verify(req.headers.authorization)
    return result.ok && result.reason === 'ok' ? result.subject : null
  } catch {
    return null
  }
}

function validateCreateBody(value: unknown): ValidationResult {
  if (!isRecord(value) || CLIENT_PATH_FIELDS.some(field => field in value)) {
    return { ok: false, status: 400 }
  }

  const {
    filename, pageCount, text, isDigital, useOcr, customerMaster,
    customerId, customerInstructions, vendorCode, vendorBranch,
  } = value
  if (typeof filename !== 'string'
    || filename.trim().length === 0
    || /[\\/]/.test(filename)
    || !Number.isInteger(pageCount)
    || (pageCount as number) < 1
    || typeof text !== 'string'
    || typeof isDigital !== 'boolean'
    || typeof useOcr !== 'boolean'
    || !Array.isArray(customerMaster)
    || !(customerId === null || typeof customerId === 'string')
    || typeof customerInstructions !== 'string'
    || typeof vendorCode !== 'string'
    || typeof vendorBranch !== 'string') {
    return { ok: false, status: 400 }
  }

  let pdf = Buffer.alloc(0)
  if (useOcr || value.pdf !== undefined) {
    if (typeof value.pdf !== 'string' || value.pdf.length === 0) {
      return { ok: false, status: 400 }
    }
    if (!hasStandardBase64Syntax(value.pdf)) {
      return { ok: false, status: 400 }
    }
    pdf = Buffer.from(value.pdf, 'base64')
    if (pdf.toString('base64') !== value.pdf) {
      return { ok: false, status: 400 }
    }
    if (pdf.length > MAX_PDF_BYTES) {
      return { ok: false, status: 413 }
    }
    if (pdf.length < 5 || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
      return { ok: false, status: 400 }
    }
  }

  if (!useOcr && text.trim().length === 0) {
    return { ok: false, status: 400 }
  }

  return {
    ok: true,
    value: {
      request: {
        filename,
        pageCount: pageCount as number,
        text,
        isDigital,
        useOcr,
        customerMaster,
        customerId,
        customerInstructions,
        vendorCode,
        vendorBranch,
      },
      pdf,
    },
  }
}

function publicStatus(metadata: JobMetadata): Record<string, unknown> {
  return {
    jobId: metadata.id,
    filename: metadata.filename,
    status: metadata.stage,
    pagesDone: metadata.pagesDone,
    pagesTotal: metadata.pagesTotal,
    extractBatchesDone: metadata.extractBatchesDone,
    extractBatchesTotal: metadata.extractBatchesTotal,
    progress: progressPercent(metadata),
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    error: metadata.stage === 'error' ? metadata.error : null,
  }
}

function progressPercent(metadata: JobMetadata): number {
  if (metadata.stage === 'done') return 100
  if (metadata.stage === 'extracting'
    || (metadata.stage === 'error' && metadata.extractBatchesTotal > 0)) {
    if (metadata.extractBatchesTotal < 1) return 90
    const completed = clamp(metadata.extractBatchesDone, 0, metadata.extractBatchesTotal)
    return 90 + Math.floor(9 * completed / metadata.extractBatchesTotal)
  }
  if (metadata.pagesTotal < 1) return 0
  const completed = clamp(metadata.pagesDone, 0, metadata.pagesTotal)
  return Math.round(90 * completed / metadata.pagesTotal)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasStandardBase64Syntax(value: string): boolean {
  if (value.length % 4 !== 0 || INVALID_BASE64_CHARACTER.test(value)) return false
  const paddingStart = value.indexOf('=')
  if (paddingStart === -1) return true
  const paddingLength = value.length - paddingStart
  return paddingLength <= 2
    && paddingStart >= value.length - 2
    && value.slice(paddingStart) === '='.repeat(paddingLength)
}

function positiveIntegerEnvironment(
  environment: Record<string, string | undefined>,
  name: string,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const raw = environment[name]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} environment variable must be an integer from 1 to ${maximum}`)
  }
  return value
}

function positiveNumberEnvironment(
  environment: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = environment[name]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} environment variable must be a positive number`)
  }
  return value
}
