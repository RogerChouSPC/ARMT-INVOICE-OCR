import { pdfjsLib } from './pdfLoader'

export interface PdfTextResult {
  text: string
  pageCount: number
  isDigital: boolean
}

/** Quickly read a PDF's page count (metadata only — no text extraction). */
export async function countPdfPages(file: File): Promise<number> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  return pdf.numPages
}

/**
 * Extract text directly from a PDF using PDF.js.
 * Returns isDigital=true when enough text is found (>100 non-space chars per page).
 * For scanned/image PDFs the text will be sparse → fall back to image OCR path.
 */
export async function extractPdfText(file: File): Promise<PdfTextResult> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  const pageParts: string[] = []
  let totalChars = 0

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .trim()
    pageParts.push(pageText)
    totalChars += pageText.replace(/\s+/g, '').length
  }

  const text = pageParts.join('\n\n--- PAGE BREAK ---\n\n')

  const avgCharsPerPage = totalChars / pdf.numPages
  const pagesWithText = pageParts.filter(p => p.replace(/\s+/g, '').length > 100).length

  // Detect two broken-encoding patterns where the text layer is unusable and
  // we must fall back to the image-OCR path:
  //   (a) CFM / CFR / CMK PDFs embed fonts that map Thai glyphs onto Cyrillic
  //       code points — a genuine Thai invoice has zero Cyrillic, so any
  //       meaningful amount of Cyrillic flags the document.
  //   (b) CP All PDFs use fonts with no Unicode mapping for Thai at all — the
  //       Thai text comes out as random ASCII / control characters with zero
  //       Thai code points. All supported customers are Thai retail chains, so
  //       a document with substantial text content but virtually no Thai must
  //       be a font-encoding issue rather than an English-only invoice.
  const cyrillicCount = (text.match(/[Ѐ-ӿ]/g) || []).length
  const thaiCount     = (text.match(/[฀-๿]/g) || []).length
  const isGarbled = cyrillicCount > 20 || (totalChars > 200 && thaiCount < 20)

  // Require a majority of pages to have real text — a high average caused by one digital
  // summary page among several scanned pages (e.g. CP ALL) would otherwise skip OCR.
  const isDigital = !isGarbled && avgCharsPerPage > 100 && pagesWithText > pdf.numPages / 2

  return { text, pageCount: pdf.numPages, isDigital }
}
