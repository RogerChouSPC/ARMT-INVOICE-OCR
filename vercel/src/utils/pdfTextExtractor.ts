import { pdfjsLib } from './pdfLoader'

export interface PdfTextResult {
  text: string
  pageCount: number
  isDigital: boolean
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

  const avgCharsPerPage = totalChars / pdf.numPages
  const pagesWithText = pageParts.filter(p => p.replace(/\s+/g, '').length > 100).length
  // Require a majority of pages to have real text — a high average caused by one digital
  // summary page among several scanned pages (e.g. CP ALL) would otherwise skip OCR.
  const isDigital = avgCharsPerPage > 100 && pagesWithText > pdf.numPages / 2

  const text = pageParts.join('\n\n--- PAGE BREAK ---\n\n')
  return { text, pageCount: pdf.numPages, isDigital }
}
