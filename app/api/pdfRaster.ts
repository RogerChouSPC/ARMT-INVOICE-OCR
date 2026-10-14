import { execFile } from 'node:child_process'
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

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

const execFileAsync = promisify(execFile)
let cachedPdftoppm: Promise<string> | null = null
let cachedPdfInfo: Promise<string> | null = null

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function findWinGetPopplerBinary(filename: string): Promise<string | null> {
  const base = join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages')
  if (!(await pathExists(base))) return null

  for (const pkg of await readdir(base)) {
    if (!pkg.toLowerCase().includes('poppler')) continue
    const pkgDir = join(base, pkg)
    for (const sub of await readdir(pkgDir)) {
      const candidate = join(pkgDir, sub, 'Library', 'bin', filename)
      if (await pathExists(candidate)) return candidate
    }
  }
  return null
}

async function findPdftoppm(): Promise<string> {
  if (cachedPdftoppm) return cachedPdftoppm
  cachedPdftoppm = (async () => {
    if (process.env.POPPLER_PDFTOPPM && await pathExists(process.env.POPPLER_PDFTOPPM)) {
      return process.env.POPPLER_PDFTOPPM
    }
    return await findWinGetPopplerBinary('pdftoppm.exe') || 'pdftoppm'
  })()
  return cachedPdftoppm
}

async function findPdfInfo(): Promise<string> {
  if (cachedPdfInfo) return cachedPdfInfo
  cachedPdfInfo = (async () => {
    if (process.env.POPPLER_PDFINFO && await pathExists(process.env.POPPLER_PDFINFO)) {
      return process.env.POPPLER_PDFINFO
    }
    return await findWinGetPopplerBinary('pdfinfo.exe') || 'pdfinfo'
  })()
  return cachedPdfInfo
}

export async function getPdfPageCount(pdfPath: string): Promise<number> {
  const { stdout } = await execFileAsync(await findPdfInfo(), [pdfPath], {
    encoding: 'utf8',
    windowsHide: true,
  })
  return parsePdfInfoPages(String(stdout))
}

export interface RasterCommand {
  executable: string
  argsPrefix: string[]
}

export async function renderPdfPageRange(
  pdfPath: string,
  startPage: number,
  endPage: number,
): Promise<RenderedPage[]> {
  validatePdfPageRange(startPage, endPage)
  return renderPdfPageRangeWithCommand(pdfPath, startPage, endPage, {
    executable: await findPdftoppm(),
    argsPrefix: [],
  })
}

export async function renderPdfPageRangeWithCommand(
  pdfPath: string,
  startPage: number,
  endPage: number,
  command: RasterCommand,
): Promise<RenderedPage[]> {
  validatePdfPageRange(startPage, endPage)
  const dir = await mkdtemp(join(tmpdir(), 'armt-ocrpdf-range-'))
  try {
    const outputPrefix = join(dir, 'page')
    await execFileAsync(command.executable, [
      ...command.argsPrefix,
      '-png',
      '-r', String(DPI),
      '-f', String(startPage),
      '-l', String(endPage),
      pdfPath,
      outputPrefix,
    ], {
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      windowsHide: true,
    })

    const names = (await readdir(dir))
      .filter((filename) => filename.toLowerCase().endsWith('.png'))
    return Promise.all(sortRenderedPageNames(names).map(async ({ filename, page }) => ({
      page,
      pngBase64: (await readFile(join(dir, filename))).toString('base64'),
    })))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function validatePdfPageRange(startPage: number, endPage: number): void {
  if (!Number.isInteger(startPage) || !Number.isInteger(endPage) || startPage < 1 || startPage > endPage) {
    throw new Error('PDF page range must use integers with 1 <= start <= end')
  }
  if (endPage - startPage + 1 > 10) {
    throw new Error('PDF page range must contain at most 10 pages')
  }
}
