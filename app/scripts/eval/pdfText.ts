// Headless PDF text extraction using the SAME pdf.js library and the SAME
// isDigital logic as the browser app (src/utils/pdfTextExtractor.ts), so the
// text-path and the OCR-vs-text routing decision match production exactly.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// pdf.js legacy build runs on the main thread in Node (no Worker/canvas needed
// for text extraction). Loaded lazily so importing this module is cheap.
const require = createRequire(import.meta.url)
let pdfjsPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null
function getPdfjs() {
  if (!pdfjsPromise) {
    const path = require.resolve('pdfjs-dist/legacy/build/pdf.mjs')
    pdfjsPromise = import(pathToFileURL(path).href)
  }
  return pdfjsPromise
}

export interface PdfTextResult {
  text: string
  pageCount: number
  isDigital: boolean
}

export async function extractPdfText(pdfPath: string): Promise<PdfTextResult> {
  const pdfjs = await getPdfjs()
  const data = new Uint8Array(readFileSync(pdfPath))
  const pdf = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise

  const pageParts: string[] = []
  let totalChars = 0
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? item.str ?? '' : ''))
      .join(' ')
      .trim()
    pageParts.push(pageText)
    totalChars += pageText.replace(/\s+/g, '').length
  }
  await pdf.cleanup()

  const text = pageParts.join('\n\n--- PAGE BREAK ---\n\n')

  // --- identical to src/utils/pdfTextExtractor.ts ---
  const avgCharsPerPage = totalChars / pdf.numPages
  const pagesWithText = pageParts.filter((p) => p.replace(/\s+/g, '').length > 100).length
  const cyrillicCount = (text.match(/[Ѐ-ӿ]/g) || []).length
  const thaiCount = (text.match(/[฀-๿]/g) || []).length
  const thaiRatio = totalChars > 0 ? thaiCount / totalChars : 0
  const isGarbled = cyrillicCount > 20 || (totalChars > 200 && thaiRatio < 0.05)
  const isDigital = !isGarbled && avgCharsPerPage > 100 && pagesWithText > pdf.numPages / 2

  return { text, pageCount: pdf.numPages, isDigital }
}
