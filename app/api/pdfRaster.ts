import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DPI = Number(process.env.OCR_RASTER_DPI || 200)

export interface PageRange {
  startPage: number
  endPage: number
}

export interface RenderedPage {
  page: number
  pngBase64: string
}

export function pageRanges(totalPages: number, batchSize: number): PageRange[] {
  if (!Number.isInteger(totalPages) || totalPages < 1) {
    throw new Error('Total pages must be a positive integer')
  }
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('Batch size must be a positive integer')
  }

  const ranges: PageRange[] = []
  for (let startPage = 1; startPage <= totalPages; startPage += batchSize) {
    ranges.push({ startPage, endPage: Math.min(startPage + batchSize - 1, totalPages) })
  }
  return ranges
}

export function parsePdfInfoPages(output: string): number {
  const match = output.match(/^Pages:\s+(\d+)\s*$/im)
  const pages = match ? Number(match[1]) : 0
  if (!Number.isInteger(pages) || pages < 1) {
    throw new Error('Unable to parse PDF page count')
  }
  return pages
}

export function sortRenderedPageNames(names: string[]): Array<{ filename: string; page: number }> {
  return names
    .map((filename) => ({
      filename,
      page: Number((filename.match(/-(\d+)\.png$/i) || [])[1] || 0),
    }))
    .sort((a, b) => a.page - b.page)
}

let cachedPdftoppm: string | null = null
let cachedPdfInfo: string | null = null

function findWinGetPopplerBinary(filename: string): string | null {
  const base = join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages')
  if (!existsSync(base)) return null

  for (const pkg of readdirSync(base)) {
    if (!pkg.toLowerCase().includes('poppler')) continue
    const pkgDir = join(base, pkg)
    for (const sub of readdirSync(pkgDir)) {
      const candidate = join(pkgDir, sub, 'Library', 'bin', filename)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function findPdftoppm(): string {
  if (cachedPdftoppm) return cachedPdftoppm
  if (process.env.POPPLER_PDFTOPPM && existsSync(process.env.POPPLER_PDFTOPPM)) {
    return (cachedPdftoppm = process.env.POPPLER_PDFTOPPM)
  }
  return (cachedPdftoppm = findWinGetPopplerBinary('pdftoppm.exe') || 'pdftoppm')
}

function findPdfInfo(): string {
  if (cachedPdfInfo) return cachedPdfInfo
  if (process.env.POPPLER_PDFINFO && existsSync(process.env.POPPLER_PDFINFO)) {
    return (cachedPdfInfo = process.env.POPPLER_PDFINFO)
  }
  return (cachedPdfInfo = findWinGetPopplerBinary('pdfinfo.exe') || 'pdfinfo')
}

export function getPdfPageCount(pdfPath: string): number {
  const output = execFileSync(findPdfInfo(), [pdfPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return parsePdfInfoPages(output)
}

export function renderPdfPageRange(pdfPath: string, startPage: number, endPage: number): RenderedPage[] {
  if (!Number.isInteger(startPage) || !Number.isInteger(endPage) || startPage < 1 || startPage > endPage) {
    throw new Error('PDF page range must use integers with 1 <= start <= end')
  }
  if (endPage - startPage + 1 > 10) {
    throw new Error('PDF page range must contain at most 10 pages')
  }

  const dir = mkdtempSync(join(tmpdir(), 'armt-ocrpdf-range-'))
  try {
    const outputPrefix = join(dir, 'page')
    execFileSync(findPdftoppm(), [
      '-png',
      '-r', String(DPI),
      '-f', String(startPage),
      '-l', String(endPage),
      pdfPath,
      outputPrefix,
    ], {
      stdio: 'pipe',
      maxBuffer: 512 * 1024 * 1024,
    })

    return sortRenderedPageNames(
      readdirSync(dir).filter((filename) => filename.toLowerCase().endsWith('.png')),
    ).map(({ filename, page }) => ({
      page,
      pngBase64: readFileSync(join(dir, filename)).toString('base64'),
    }))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
