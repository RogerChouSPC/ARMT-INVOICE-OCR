import express from 'express'
import path from 'node:path'
import ocrHandler from '../api/ocr.ts'
import ocrPdfHandler from '../api/ocrPdf.ts'
import extractHandler, { extractRowsCore } from '../api/extract.ts'
import paymentAdviceHandler from '../api/paymentAdvice.ts'
import { createJobsHandlers, readJobsRuntimeConfig, registerJobsRoutes } from '../api/jobs.ts'
import { createJobStore } from '../api/jobStore.ts'
import { createJobWorker } from '../api/jobWorker.ts'
import { ocrImageCore } from '../api/ocr.ts'
import { getPdfPageCount, renderPdfPageRange } from '../api/pdfRaster.ts'
import { verifyAzureToken } from '../api/verifyToken.ts'

const app = express()
const PORT = Number(process.env.PORT) || 3000
const distDir = path.join(process.cwd(), 'dist')
const jobDataDir = process.env.JOB_DATA_DIR || path.join(process.cwd(), 'job-data')
const jobsConfig = readJobsRuntimeConfig(process.env)
const jobStore = createJobStore(jobDataDir)
const jobWorker = createJobWorker({
  store: jobStore,
  getPdfPageCount,
  renderPdfPageRange,
  async ocrPage(image, page, apiKey) {
    const result = await ocrImageCore(image, apiKey)
    if (!result.ok) {
      throw Object.assign(
        new Error(`OCR failed on page ${page}. Please try again.`),
        { status: result.status },
      )
    }
    return result.text
  },
  extract: (input, progress) => extractRowsCore(input, {
    onProgress: ({ completedBatches, totalBatches }) => {
      progress(completedBatches, totalBatches)
    },
  }),
  getApiKey() {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) throw new Error('OpenRouter API key is not configured.')
    return apiKey
  },
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
}, {
  jobConcurrency: jobsConfig.jobConcurrency,
  renderBatchPages: jobsConfig.renderBatchPages,
  ocrConcurrency: jobsConfig.ocrConcurrency,
  retryDelaysMs: jobsConfig.retryDelaysMs,
})
const jobs = createJobsHandlers({
  store: jobStore,
  worker: jobWorker,
  verify: verifyAzureToken,
})

// Scanned-page images and whole PDFs arrive as base64 in the request body — the
// default 100 KB limit is far too small, so allow up to 50 MB.
const jsonBodyParser = express.json({ limit: '50mb' })
registerJobsRoutes(app, jobs, jsonBodyParser)
app.use(jsonBodyParser)

// Liveness probe used by Docker HEALTHCHECK and any external monitoring.
app.get('/healthz', (_req, res) => {
  res.json({ ok: true })
})

app.post('/api/ocr', ocrHandler)
app.post('/api/ocr-pdf', ocrPdfHandler)
app.post('/api/extract', extractHandler)
app.post('/api/payment-advice', paymentAdviceHandler)

// Serve the built React app (index.html, popup.html, hashed assets, favicon).
app.use(express.static(distDir))

// SPA fallback — any non-API GET returns index.html so client-side routing works.
app.use((req, res) => {
  if (req.method !== 'GET') {
    res.status(404).json({ error: 'Not found' })
    return
  }
  res.sendFile(path.join(distDir, 'index.html'))
})

app.listen(PORT, () => {
  console.log(`ARMT Invoice OCR server listening on port ${PORT}`)
  void recoverJobs()
  void cleanupJobs()
  const cleanupTimer = setInterval(() => { void cleanupJobs() }, 60 * 60 * 1000)
  cleanupTimer.unref()
})

async function recoverJobs(): Promise<void> {
  try {
    const recoverable = await jobStore.listRecoverable()
    console.log('[jobs] recovery state=starting', {
      count: recoverable.length,
      jobs: recoverable.map(({ id, stage }) => ({ id, state: stage })),
    })
    await jobWorker.recover()
    console.log('[jobs] recovery state=queued', { count: recoverable.length })
  } catch {
    console.error('[jobs] recovery state=error')
  }
}

async function cleanupJobs(): Promise<void> {
  try {
    await jobStore.cleanupExpired(new Date(), jobsConfig.retentionMs)
    console.log('[jobs] cleanup state=complete')
  } catch {
    console.error('[jobs] cleanup state=error')
  }
}
