import type { Request, Response } from 'express'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ocrImageCore } from './ocr.ts'
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

const DPI = Number(process.env.OCR_RASTER_DPI || 200)
const PAGE_BREAK = '\n\n--- PAGE BREAK ---\n\n'
// OCR pages concurrently (like the old browser path did) so multi-page invoices
// aren't slow. Capped so a large PDF doesn't trip OpenRouter rate limits.
const OCR_CONCURRENCY = Number(process.env.OCR_CONCURRENCY || 8)

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

let cachedBin: string | null = null
function findPdftoppm(): string {
  if (cachedBin) return cachedBin
  if (process.env.POPPLER_PDFTOPPM && existsSync(process.env.POPPLER_PDFTOPPM)) {
    return (cachedBin = process.env.POPPLER_PDFTOPPM)
  }
  // Windows dev: winget install location
  const base = join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages')
  if (existsSync(base)) {
    for (const pkg of readdirSync(base)) {
      if (!pkg.toLowerCase().includes('poppler')) continue
      const pkgDir = join(base, pkg)
      for (const sub of readdirSync(pkgDir)) {
        const cand = join(pkgDir, sub, 'Library', 'bin', 'pdftoppm.exe')
        if (existsSync(cand)) return (cachedBin = cand)
      }
    }
  }
  // Linux/Docker (poppler-utils on PATH)
  return (cachedBin = 'pdftoppm')
}

/** Render every page of a PDF to a base64 PNG (page order preserved), via poppler. */
function renderPdfToPngBase64(pdfBytes: Buffer): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'armt-ocrpdf-'))
  try {
    const pdfPath = join(dir, 'in.pdf')
    writeFileSync(pdfPath, new Uint8Array(pdfBytes))
    execFileSync(findPdftoppm(), ['-png', '-r', String(DPI), pdfPath, join(dir, 'page')], {
      stdio: 'pipe',
      maxBuffer: 512 * 1024 * 1024,
    })
    return readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.png'))
      .map((f) => ({ f, n: parseInt((f.match(/-(\d+)\.png$/i) || [])[1] || '0', 10) }))
      .sort((a, b) => a.n - b.n)
      .map(({ f }) => readFileSync(join(dir, f)).toString('base64'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
  if (!await verifyAzureToken(req.headers.authorization)) return res.status(401).json({ error: 'Unauthorized' })

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

  try {
    const pages = renderPdfToPngBase64(pdfBytes)
    const texts = await pool(pages, OCR_CONCURRENCY, async (png, p) => {
      const r = await ocrImageCore(png, apiKey)
      if (!r.ok) throw new Error(`page ${p + 1}: ${r.error}`)
      return r.text
    })
    return res.status(200).json({ text: texts.join(PAGE_BREAK), pages: pages.length })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
}
