import { pdfjsLib } from './pdfLoader'

export interface RenderedPage {
  pageNumber: number
  base64: string
  width: number
  height: number
}

/**
 * Render each page of a PDF to a base64 PNG image for OCR.
 * Scale 1.5× — enough for Gemini Vision to read Thai text clearly.
 */
export async function renderPdfPages(
  file: File,
  onProgress?: (current: number, total: number) => void
): Promise<RenderedPage[]> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const pages: RenderedPage[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1.5 })

    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height

    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, viewport }).promise

    const base64 = canvas.toDataURL('image/png').split(',')[1]
    pages.push({ pageNumber: i, base64, width: viewport.width, height: viewport.height })
    onProgress?.(i, pdf.numPages)
  }

  return pages
}
