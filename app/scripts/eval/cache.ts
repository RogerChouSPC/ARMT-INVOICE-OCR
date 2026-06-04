// Tiny disk cache for the expensive pipeline stages so iteration is cheap:
//   - pdftext / ocr text per PDF  (deterministic-ish; avoids re-render + re-OCR)
//   - raw model output keyed by the exact prompt (avoids re-calling the LLM)
// Post-processing is NOT cached — it's pure and re-runs for free over cached raw
// output, so customers.ts post-processing changes cost $0 to re-evaluate.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '.cache')

export function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 32)
}

function pathFor(ns: string, key: string): string {
  const dir = join(ROOT, ns)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, key + '.json')
}

export function getCache<T>(ns: string, key: string): T | null {
  const p = pathFor(ns, key)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf-8')) as T } catch { return null }
}

export function setCache<T>(ns: string, key: string, value: T): void {
  writeFileSync(pathFor(ns, key), JSON.stringify(value), 'utf-8')
}

/** Cache key for a PDF that invalidates when the file changes (path + size + mtime). */
export function pdfKey(pdfPath: string): string {
  const st = statSync(pdfPath)
  return sha(`${pdfPath}|${st.size}|${st.mtimeMs}`)
}
