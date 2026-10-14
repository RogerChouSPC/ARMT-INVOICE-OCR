export type JobStage = 'queued' | 'rendering' | 'ocr' | 'extracting' | 'done' | 'error'

export interface StoredJobRequest {
  filename: string; pageCount: number; text: string; isDigital: boolean; useOcr: boolean
  customerMaster: unknown[]; customerId: string | null; customerInstructions: string
  vendorCode: string; vendorBranch: string
}

export interface JobMetadata {
  id: string; ownerId: string; filename: string; stage: JobStage
  pagesDone: number; pagesTotal: number
  extractBatchesDone: number; extractBatchesTotal: number
  createdAt: string; updatedAt: string; error: string | null
}

export interface JobResult { rows: Record<string, unknown>[] }

export interface JobStore {
  create(ownerId: string, request: StoredJobRequest, inputPdf: Buffer): Promise<JobMetadata>
  readMetadata(id: string): Promise<JobMetadata | null>
  updateMetadata(id: string, update: Partial<Pick<JobMetadata, 'stage' | 'pagesDone' | 'pagesTotal' | 'extractBatchesDone' | 'extractBatchesTotal' | 'error'>>): Promise<JobMetadata>
  readRequest(id: string): Promise<StoredJobRequest | null>
  writeOcrPage(id: string, page: number, text: string): Promise<void>
  readOcrPage(id: string, page: number): Promise<string | null>
  listCompletedOcrPages(id: string): Promise<number[]>
  writeResult(id: string, result: JobResult): Promise<void>
  readResult(id: string): Promise<JobResult | null>
  listRecoverable(): Promise<JobMetadata[]>
  cleanupExpired(now: Date, retentionMs?: number): Promise<void>
}
