import express from 'express'
import path from 'node:path'
import ocrHandler from '../api/ocr.ts'
import extractHandler from '../api/extract.ts'
import paymentAdviceHandler from '../api/paymentAdvice.ts'

const app = express()
const PORT = Number(process.env.PORT) || 3000
const distDir = path.join(process.cwd(), 'dist')

// Scanned-page images arrive as base64 in the request body — the default
// 100 KB limit is far too small, so allow up to 25 MB.
app.use(express.json({ limit: '25mb' }))

// Liveness probe used by Docker HEALTHCHECK and any external monitoring.
app.get('/healthz', (_req, res) => {
  res.json({ ok: true })
})

app.post('/api/ocr', ocrHandler)
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
})
