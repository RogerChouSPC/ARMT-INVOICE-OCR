/**
 * Single place to import and configure PDF.js.
 * Both pdfRenderer and pdfTextExtractor import from here.
 */
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

export { pdfjsLib }
