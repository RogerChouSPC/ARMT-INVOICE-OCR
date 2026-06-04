// Rasterise a PDF to one base64 PNG per page using poppler `pdftoppm`, matching
// the base64-PNG input that api/ocr.ts (Gemini Vision) expects.
//
// NOTE: this is poppler, not the browser's pdf.js canvas render, so OCR text is
// not byte-identical to production — an accepted approximation for OCR-path eval.
// Override the binary with env POPPLER_PDFTOPPM if auto-detection fails.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DPI = Number(process.env.EVAL_RASTER_DPI || 150)

let cachedBin: string | null = null
function findPdftoppm(): string {
  if (cachedBin) return cachedBin
  if (process.env.POPPLER_PDFTOPPM && existsSync(process.env.POPPLER_PDFTOPPM)) {
    return (cachedBin = process.env.POPPLER_PDFTOPPM)
  }
  // winget install location: %LOCALAPPDATA%\Microsoft\WinGet\Packages\oschwartz10612.Poppler*\poppler-*\Library\bin\pdftoppm.exe
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
  // fall back to PATH
  return (cachedBin = 'pdftoppm')
}

export interface RenderedPage { pageNumber: number; base64: string }

/** Render every page of `pdfPath` to base64 PNGs (page order preserved). */
export function renderPdfPages(pdfPath: string): RenderedPage[] {
  const bin = findPdftoppm()
  const dir = mkdtempSync(join(tmpdir(), 'armt-ocr-'))
  try {
    execFileSync(bin, ['-png', '-r', String(DPI), pdfPath, join(dir, 'page')], { stdio: 'pipe' })
    const files = readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.png'))
      .map((f) => ({ f, n: parseInt((f.match(/-(\d+)\.png$/i) || [])[1] || '0', 10) }))
      .sort((a, b) => a.n - b.n)
    return files.map(({ f, n }) => ({ pageNumber: n, base64: readFileSync(join(dir, f)).toString('base64') }))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
