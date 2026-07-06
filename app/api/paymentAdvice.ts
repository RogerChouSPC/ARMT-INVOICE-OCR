import type { Request, Response } from 'express'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyAzureToken } from './verifyToken'

// ─────────────────────────────────────────────────────────────────────────────
// CP Axtra (Makro) "Payment Advice" extractor.
//
// Faithful 1:1 port of the coworker's Python tool (P1 Makro PDF AR/app.py
// `extract_one`). It reads a remittance PDF's text and pattern-matches known
// labels — NO AI. The only change from the original is the text source:
// pdfplumber → poppler `pdftotext -layout`, which produces the same line
// grouping the regex depends on (verified against the reference output).
// ─────────────────────────────────────────────────────────────────────────────

export interface PaymentAdviceInvoice {
  inv_date: string
  inv_number: string
  inv_seq: number
  store_code: string
  reference: string
  inv_amount: number
  wht_amount: number
  transfer_amount: number
}

export interface PaymentAdviceStore {
  payee: string
  site: string
  email: string
  pdf_total_invoice: number
  pdf_total_wht: number
  pdf_total_transfer: number
  invoices: PaymentAdviceInvoice[]
}

export interface PaymentAdviceFile {
  filename: string
  reference: string
  value_date: string
  transferred_amount: number
  stores: PaymentAdviceStore[]
}

// ── regexes (mirror app.py exactly) ──
const DATE_RE    = /^\d{2}\/\d{2}\/\d{2}$/
const PAYEE_RE   = /Payee\s*:\s*(\S+)/
const SITE_RE    = /Site\s*:\s*(\S+)/
const EMAIL_RE   = /Email\/Fax\s+No\s*:\s*(\S+)/i
const REF_RE     = /Our Reference:\s*(\S+)/
const VALDATE_RE = /Value Date:\s*(\S+)/
const TOTAL_RE   = /^Total\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})$/
const XFER_RE    = /Transferred Amount:\s*([\d,]+\.\d{2})/

/** round(float(s.replace(",","")), 2) — returns NaN for non-numeric (caller skips). */
function amt(s: string): number {
  const n = parseFloat(s.replace(/,/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN
}

const isDigits = (s: string) => /^\d+$/.test(s)

/**
 * Parse the `pdftotext -layout` output of one Payment Advice PDF.
 * Pure (no IO) so it is directly unit-testable against the golden reference.
 */
export function parsePaymentAdviceText(text: string, filename: string): PaymentAdviceFile {
  const result: PaymentAdviceFile = {
    filename, reference: '', value_date: '', transferred_amount: 0, stores: [],
  }
  let current: PaymentAdviceStore | null = null

  // pdfplumber iterates page-by-page then splits on "\n"; poppler joins pages
  // with form-feed (\f). Treat \f and \n identically so line grouping matches.
  for (let raw of text.split(/\r?\n|\f/)) {
    const line = raw.trim()
    if (!line) continue

    let m = REF_RE.exec(line)
    if (m && !result.reference) { result.reference = m[1]; continue }

    m = VALDATE_RE.exec(line)
    if (m && !result.value_date) { result.value_date = m[1]; continue }

    m = XFER_RE.exec(line)
    if (m && !result.transferred_amount) { result.transferred_amount = amt(m[1]); continue }

    m = PAYEE_RE.exec(line)
    if (m) {
      if (current) result.stores.push(current)
      current = {
        payee: m[1], site: '', email: '',
        pdf_total_invoice: 0, pdf_total_wht: 0, pdf_total_transfer: 0, invoices: [],
      }
      continue
    }

    m = SITE_RE.exec(line)
    if (m && current && !current.site) { current.site = m[1]; continue }

    m = EMAIL_RE.exec(line)
    if (m && current) { current.email = m[1]; continue }

    m = TOTAL_RE.exec(line)
    if (m && current) {
      current.pdf_total_invoice  = amt(m[1])
      current.pdf_total_wht      = amt(m[2])
      current.pdf_total_transfer = amt(m[3])
      continue
    }

    const parts = line.split(/\s+/)
    if (parts.length >= 6 && DATE_RE.test(parts[0]) && current) {
      const xfer_amt = amt(parts[parts.length - 1])
      const wht_amt  = amt(parts[parts.length - 2])
      const inv_amt  = amt(parts[parts.length - 3])
      if (Number.isNaN(xfer_amt) || Number.isNaN(wht_amt) || Number.isNaN(inv_amt)) continue // mirror Python ValueError skip

      let raw_inv = parts[1]
      const desc = parts.slice(2, parts.length - 3)
      let inv_seq = 1
      let store_code = ''
      let ref_code = ''

      if (raw_inv.includes('|')) {
        // "E398922|2" — pipe attached to invoice number
        const i = raw_inv.indexOf('|')
        const seq_str = raw_inv.slice(i + 1)
        raw_inv = raw_inv.slice(0, i)
        inv_seq = isDigits(seq_str) ? parseInt(seq_str, 10) : 1
        store_code = desc[0] ?? ''
        ref_code = desc[1] ?? ''
      } else if (desc.length >= 2 && desc[0] === '|' && isDigits(desc[1])) {
        // "QE404337 | 2 400 0040..." — pipe split off by the renderer
        inv_seq = parseInt(desc[1], 10)
        store_code = desc[2] ?? ''
        ref_code = desc[3] ?? ''
      } else {
        store_code = desc[0] ?? ''
        ref_code = desc[1] ?? ''
      }

      current.invoices.push({
        inv_date: parts[0], inv_number: raw_inv, inv_seq,
        store_code, reference: ref_code,
        inv_amount: inv_amt, wht_amount: wht_amt, transfer_amount: xfer_amt,
      })
    }
  }

  if (current) result.stores.push(current)
  return result
}

// ── poppler pdftotext resolution (mirrors scripts/eval/raster.ts) ──
let cachedBin: string | null = null
function findPdftotext(): string {
  if (cachedBin) return cachedBin
  if (process.env.POPPLER_PDFTOTEXT && existsSync(process.env.POPPLER_PDFTOTEXT)) {
    return (cachedBin = process.env.POPPLER_PDFTOTEXT)
  }
  // Windows dev: winget install location
  const base = join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages')
  if (existsSync(base)) {
    for (const pkg of readdirSync(base)) {
      if (!pkg.toLowerCase().includes('poppler')) continue
      const pkgDir = join(base, pkg)
      for (const sub of readdirSync(pkgDir)) {
        const cand = join(pkgDir, sub, 'Library', 'bin', 'pdftotext.exe')
        if (existsSync(cand)) return (cachedBin = cand)
      }
    }
  }
  // Linux/Docker (poppler-utils on PATH) and other setups
  return (cachedBin = 'pdftotext')
}

/** Run `pdftotext -layout` on a PDF file and return its text. */
export function pdftotextLayout(pdfPath: string): string {
  return execFileSync(findPdftotext(), ['-layout', '-enc', 'UTF-8', pdfPath, '-'], {
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
  })
}

/** Extract one Payment Advice from raw PDF bytes (writes a temp file for poppler). */
export function extractPaymentAdvice(pdfBytes: Buffer, filename: string): PaymentAdviceFile {
  const dir = mkdtempSync(join(tmpdir(), 'armt-pa-'))
  const pdfPath = join(dir, 'in.pdf')
  try {
    writeFileSync(pdfPath, new Uint8Array(pdfBytes))
    return parsePaymentAdviceText(pdftotextLayout(pdfPath), filename)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── HTTP handler (auth-gated, mirrors api/ocr.ts) ──
export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
  if (!await verifyAzureToken(req.headers.authorization)) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const body = req.body || {}
    // Accept one or many PDFs as { files: [{ filename, base64 }, ...] }.
    const inputs: { filename: string; base64: string }[] = Array.isArray(body.files) ? body.files : []
    if (inputs.length === 0) return res.status(400).json({ error: 'Expected { files: [{ filename, base64 }] }' })

    const files: PaymentAdviceFile[] = inputs.map(({ filename, base64 }) =>
      extractPaymentAdvice(Buffer.from(base64, 'base64'), filename || 'upload.pdf'))

    return res.status(200).json({ files })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
}
