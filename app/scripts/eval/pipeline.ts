// Run ONE PDF through the real production pipeline, headless. Mirrors App.tsx:
//   extractPdfText → detectCustomer → shouldUseOcr →
//     (text path)  extract on pdf text
//     (ocr  path)  render → OCR pages → join → re-detect → extract on ocr text
// then the SAME api/extract.ts post-processing. Expensive stages are cached so
// re-runs are cheap and post-processing changes re-evaluate at zero LLM cost.
import { basename } from 'node:path'
import { extractPdfText } from './pdfText.ts'
import { renderPdfPages } from './raster.ts'
import { getCache, setCache, pdfKey, sha } from './cache.ts'
import type { RowRecord } from './fields.ts'
import { detectCustomer, shouldUseOcr, buildCustomerInstructions } from '../../src/config/customers.ts'
import {
  buildExtractMessages, callExtractModel, parseJsonFromText, postProcessRows, buildCustomerMasterJson,
} from '../../api/extract.ts'
import { ocrImageCore } from '../../api/ocr.ts'
import { CUSTOMER_MASTER_SEED } from '../../src/config/customerMasterSeed.ts'

export interface PipelineResult {
  pdf: string
  pageCount: number
  detectedId: string | null
  effectiveId: string | null
  useOcr: boolean
  rows: RowRecord[]
  llmCalled: boolean
  ocrCalls: number
  error?: string
}

const customerMasterJson = buildCustomerMasterJson(CUSTOMER_MASTER_SEED)
const PAGE_BREAK = '\n\n--- PAGE BREAK ---\n\n'

export async function runPdf(pdfPath: string, apiKey: string): Promise<PipelineResult> {
  const filename = basename(pdfPath)
  const base: PipelineResult = {
    pdf: filename, pageCount: 0, detectedId: null, effectiveId: null,
    useOcr: false, rows: [], llmCalled: false, ocrCalls: 0,
  }
  try {
    const key = pdfKey(pdfPath)

    // Stage 1: pdf.js text + isDigital (cached)
    let t = getCache<{ text: string; pageCount: number; isDigital: boolean }>('pdftext', key)
    if (!t) { t = await extractPdfText(pdfPath); setCache('pdftext', key, t) }
    base.pageCount = t.pageCount

    const rule = detectCustomer(t.text, filename)
    base.detectedId = rule?.id ?? null
    const useOcr = shouldUseOcr(rule, t.isDigital)
    base.useOcr = useOcr

    let text: string
    let effRule = rule
    if (!useOcr) {
      text = t.text
    } else {
      // Stage 2: combined OCR text (cached per-pdf; pages cached per-image)
      let ocr = getCache<string>('ocrtext', key)
      if (ocr == null) {
        const pages = renderPdfPages(pdfPath)
        const texts: string[] = []
        for (const page of pages) {
          const ik = sha(page.base64)
          let pt = getCache<string>('ocr', ik)
          if (pt == null) {
            const r = await ocrImageCore(page.base64, apiKey)
            if (!r.ok) throw new Error(`OCR p${page.pageNumber}: ${r.error}`)
            pt = r.text
            setCache('ocr', ik, pt)
            base.ocrCalls++
          }
          texts.push(pt)
        }
        ocr = texts.join(PAGE_BREAK)
        setCache('ocrtext', key, ocr)
      }
      text = ocr
      effRule = rule ?? detectCustomer(ocr, filename)
    }
    base.effectiveId = effRule?.id ?? null

    // Stage 3: extraction LLM (raw output cached by prompt hash) + post-processing (free)
    const customerSection = buildCustomerInstructions(effRule)
    const messages = buildExtractMessages({ text, filename, customerSection, customerMasterJson })
    const rawKey = sha('gemini-2.5-flash\n' + JSON.stringify(messages))
    let raw = getCache<string>('rawllm', rawKey)
    if (raw == null) {
      const r = await callExtractModel(messages, apiKey)
      if (!r.ok) throw new Error(`extract: ${r.error}`)
      raw = r.content
      setCache('rawllm', rawKey, raw)
      base.llmCalled = true
    }
    let rawRows: RowRecord[]
    try { rawRows = parseJsonFromText(raw) as RowRecord[] } catch { rawRows = [] }

    base.rows = postProcessRows(rawRows, {
      text,
      vendorCode: effRule?.vendorCode ?? 'auto',
      vendorBranch: effRule?.vendorBranch ?? 'auto',
      customerId: (effRule?.id ?? '').toUpperCase(),
      customerMasterJson,
    })
    return base
  } catch (err) {
    base.error = err instanceof Error ? err.message : String(err)
    return base
  }
}
