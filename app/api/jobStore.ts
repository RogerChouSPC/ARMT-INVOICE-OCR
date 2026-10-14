import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { JobMetadata, JobResult, JobStore, StoredJobRequest } from './jobTypes'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RECOVERABLE_STAGES = new Set(['queued', 'rendering', 'ocr', 'extracting'])
const TERMINAL_STAGES = new Set(['done', 'error'])
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000

type MetadataUpdate = Parameters<JobStore['updateMetadata']>[1]

export function createJobStore(rootDir: string): JobStore {
  return new FileJobStore(rootDir)
}

class FileJobStore implements JobStore {
  constructor(private readonly rootDir: string) {}

  async create(ownerId: string, request: StoredJobRequest, inputPdf: Buffer): Promise<JobMetadata> {
    await mkdir(this.rootDir, { recursive: true })
    const id = randomUUID()
    const jobDir = this.jobDir(id)
    const stagingDir = join(this.rootDir, `.${id}.${randomUUID()}.tmp`)
    await mkdir(stagingDir, { recursive: false })
    const storedRequest: StoredJobRequest = {
      filename: request.filename, pageCount: request.pageCount, text: request.text, isDigital: request.isDigital,
      useOcr: request.useOcr, customerMaster: request.customerMaster, customerId: request.customerId,
      customerInstructions: request.customerInstructions, vendorCode: request.vendorCode, vendorBranch: request.vendorBranch,
    }

    const createdAt = new Date().toISOString()
    const metadata: JobMetadata = {
      id,
      ownerId,
      filename: request.filename,
      stage: 'queued',
      pagesDone: 0,
      pagesTotal: request.pageCount,
      extractBatchesDone: 0,
      extractBatchesTotal: 0,
      createdAt,
      updatedAt: createdAt,
      error: null,
    }

    try {
      await this.writeJsonAtomic(join(stagingDir, 'request.json'), storedRequest)
      await writeFile(join(stagingDir, 'input.pdf'), new Uint8Array(inputPdf))
      await this.writeJsonAtomic(join(stagingDir, 'metadata.json'), metadata)
      await rename(stagingDir, jobDir)
      return metadata
    } catch (error) {
      await rm(stagingDir, { recursive: true, force: true })
      throw error
    }
  }

  async readMetadata(id: string): Promise<JobMetadata | null> {
    const path = join(this.jobDir(id), 'metadata.json')
    try {
      return JSON.parse(await readFile(path, 'utf8')) as JobMetadata
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  async updateMetadata(id: string, update: MetadataUpdate): Promise<JobMetadata> {
    const current = await this.readMetadata(id)
    if (!current) throw new Error('job not found')

    const updated: JobMetadata = {
      ...current,
      stage: update.stage ?? current.stage,
      pagesDone: update.pagesDone ?? current.pagesDone,
      pagesTotal: update.pagesTotal ?? current.pagesTotal,
      extractBatchesDone: update.extractBatchesDone ?? current.extractBatchesDone,
      extractBatchesTotal: update.extractBatchesTotal ?? current.extractBatchesTotal,
      error: update.error === undefined ? current.error : update.error,
      updatedAt: new Date().toISOString(),
    }
    await this.writeJsonAtomic(join(this.jobDir(id), 'metadata.json'), updated)
    return updated
  }

  async readRequest(id: string): Promise<StoredJobRequest | null> {
    try {
      return JSON.parse(await readFile(join(this.jobDir(id), 'request.json'), 'utf8')) as StoredJobRequest
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  async writeOcrPage(id: string, page: number, text: string): Promise<void> {
    const path = this.ocrPagePath(id, page)
    await mkdir(join(this.jobDir(id), 'ocr'), { recursive: true })
    await writeFile(path, text, 'utf8')
  }

  async readOcrPage(id: string, page: number): Promise<string | null> {
    try {
      return await readFile(this.ocrPagePath(id, page), 'utf8')
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  async listCompletedOcrPages(id: string): Promise<number[]> {
    try {
      const entries = await readdir(join(this.jobDir(id), 'ocr'), { withFileTypes: true })
      return entries
        .filter((entry) => entry.isFile() && /^\d{6}\.txt$/.test(entry.name))
        .map((entry) => Number.parseInt(entry.name.slice(0, 6), 10))
        .sort((left, right) => left - right)
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }
  }

  async writeResult(id: string, result: JobResult): Promise<void> {
    await this.writeJsonAtomic(join(this.jobDir(id), 'result.json'), result)
  }

  async readResult(id: string): Promise<JobResult | null> {
    try {
      return JSON.parse(await readFile(join(this.jobDir(id), 'result.json'), 'utf8')) as JobResult
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  async listRecoverable(): Promise<JobMetadata[]> {
    let entries: Awaited<ReturnType<typeof readdir>>
    try {
      entries = await readdir(this.rootDir, { withFileTypes: true })
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }

    const jobs = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && UUID_PATTERN.test(entry.name))
      .map((entry) => this.readMetadata(entry.name)))
    return jobs
      .filter((job): job is JobMetadata => job !== null && RECOVERABLE_STAGES.has(job.stage))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async cleanupExpired(now: Date, retentionMs = DEFAULT_RETENTION_MS): Promise<void> {
    if (retentionMs < 0) throw new RangeError('retention must not be negative')

    let entries: Awaited<ReturnType<typeof readdir>>
    try {
      entries = await readdir(this.rootDir, { withFileTypes: true })
    } catch (error) {
      if (isNotFound(error)) return
      throw error
    }

    await Promise.all(entries
      .filter((entry) => entry.isDirectory() && UUID_PATTERN.test(entry.name))
      .map(async (entry) => {
        const metadata = await this.readMetadata(entry.name)
        if (!metadata || !TERMINAL_STAGES.has(metadata.stage)) return
        const updatedAt = Date.parse(metadata.updatedAt)
        if (Number.isNaN(updatedAt) || now.getTime() - updatedAt <= retentionMs) return
        await rm(this.jobDir(entry.name), { recursive: true, force: true })
      }))
  }

  private jobDir(id: string): string {
    if (!UUID_PATTERN.test(id)) throw new Error('invalid job id')
    return join(this.rootDir, id)
  }

  private ocrPagePath(id: string, page: number): string {
    if (!Number.isInteger(page) || page < 1 || page > 999999) throw new RangeError('invalid OCR page')
    return join(this.jobDir(id), 'ocr', `${page.toString().padStart(6, '0')}.txt`)
  }

  private async writeJsonAtomic(path: string, value: unknown): Promise<void> {
    const temporaryPath = `${path}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, JSON.stringify(value), 'utf8')
    await rename(temporaryPath, path)
  }
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
