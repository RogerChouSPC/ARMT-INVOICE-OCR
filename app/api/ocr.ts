import type { Request, Response } from 'express'

async function verifyAzureToken(authHeader: string | undefined): Promise<boolean> {
  if (!authHeader?.startsWith('Bearer ')) return false
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: authHeader },
    })
    return res.ok
  } catch {
    return false
  }
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = 'google/gemini-2.5-flash'

export type OcrCoreResult =
  | { ok: true; text: string }
  | { ok: false; status: number; error: string }

/**
 * Pure OCR core: base64 PNG → Gemini Vision → raw text.  No auth/env/Express
 * dependency so it can be reused by the eval harness (scripts/eval).  Behavior
 * is identical to the original handler.
 */
export async function ocrImageCore(image: string, apiKey: string): Promise<OcrCoreResult> {
  try {
    const apiRes = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${image}` },
            },
            {
              type: 'text',
              text: 'Extract ALL text from this invoice image exactly as it appears. Include every word, number, date, barcode, and special character.\nFor any TABLE of line items, read it ROW BY ROW (left to right) and output EACH row on its OWN single line, keeping that row\'s description together with its amount on the same line — e.g. "DF2026053542 Promotion Support Makro_P 14,713.06". Do NOT read a whole column as a separate block; reading the description column and the amount column separately mis-pairs each description with the wrong amount. If a row prints a category/header line above the detail line, keep it with that same row. Preserve the original top-to-bottom row order.\nOutput only the raw extracted text.',
            },
          ],
        }],
        temperature: 0,
      }),
    })

    if (!apiRes.ok) {
      const errText = await apiRes.text()
      if (apiRes.status === 429) {
        return { ok: false, status: 429, error: 'API quota exceeded. Please try again shortly.' }
      }
      return { ok: false, status: 502, error: `OpenRouter ${apiRes.status}: ${errText.slice(0, 300)}` }
    }

    const data = await apiRes.json()
    const text: string = data?.choices?.[0]?.message?.content ?? ''
    return { ok: true, text }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 502, error: message }
  }
}

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  if (!await verifyAzureToken(req.headers.authorization)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' })
  }

  let image: string
  try {
    const body = req.body || {}
    image = body.image
    if (!image) throw new Error('missing image')
  } catch {
    return res.status(400).json({ error: 'Expected { image: base64string }' })
  }

  const result = await ocrImageCore(image, apiKey)
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error })
  }
  return res.status(200).json({ text: result.text, source: 'openrouter' })
}
