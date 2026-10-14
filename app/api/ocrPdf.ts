import type { Request, Response } from 'express'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ocrImageCore } from './ocr.ts'
import { getPdfPageCount, pageRanges, renderPdfPageRange } from './pdfRaster.ts'
import { verifyAzureToken } from './verifyToken'

// ─────────────────────────────────────────────────────────────────────────────
// Server-side OCR for a whole PDF.
//
// The browser's pdf.js renderer drops Thai combining marks for some embedded
// fonts (e.g. PT/ปิโตรเลียมไทย invoices → "ค่า" became "คา"). poppler renders
// those fonts correctly, so we rasterise on the server with `pdftoppm` and OCR
// each page with Gemini Vision. This matches the eval harness (which already uses
// poppler), so production output now equals the verified test results.
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_BREAK = '\n\n--- PAGE BREAK ---\n\n'
// OCR pages concurrently (like the old browser path did) so multi-page invoices
// aren't slow. Capped so a large PDF doesn't trip OpenRouter rate limits.
const OCR_CONCURRENCY = Number(process.env.OCR_CONCURRENCY || 8)
const OCR_RENDER_BATCH_PAGES = Math.min(Number(process.env.OCR_RENDER_BATCH_PAGES ?? 10), 10)

/** Run fn over items with at most `n` in flight; preserves order. */
async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let idx = 0
  async function worker() {
    while (idx < items.length) {
      const i = idx++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
}

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
  { const v = await verifyAzureToken(req.headers.authorization); if (!v.ok) return res.status(401).json({ error: 'Unauthorized', reason: v.reason }) }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' })

  let pdfBytes: Buffer
  try {
    const base64 = (req.body || {}).pdf
    if (!base64) throw new Error('missing pdf')
    pdfBytes = Buffer.from(base64, 'base64')
  } catch {
    return res.status(400).json({ error: 'Expected { pdf: base64string }' })
  }

  const uploadDir = await mkdtemp(join(tmpdir(), 'armt-ocrpdf-upload-'))
  try {
    const pdfPath = join(uploadDir, 'in.pdf')
    await writeFile(pdfPath, new Uint8Array(pdfBytes))
    const totalPages = await getPdfPageCount(pdfPath)
    const texts: string[] = []

    for (const { startPage, endPage } of pageRanges(totalPages, OCR_RENDER_BATCH_PAGES)) {
      const pages = await renderPdfPageRange(pdfPath, startPage, endPage)
      const batchTexts = await pool(pages, OCR_CONCURRENCY, async ({ page, pngBase64 }) => {
        const r = await ocrImageCore(pngBase64, apiKey)
        if (!r.ok) throw new Error(`page ${page}: ${r.error}`)
        return r.text
      })
      texts.push(...batchTexts)
    }

    return res.status(200).json({ text: texts.join(PAGE_BREAK), pages: totalPages })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  } finally {
    await rm(uploadDir, { recursive: true, force: true })
  }
}
