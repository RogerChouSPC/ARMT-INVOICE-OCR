import type { Handler } from '@netlify/functions'

/**
 * OCR function: Gemini Vision primary, Google Cloud Vision fallback (if API enabled in GCP).
 * Uses gemini-1.5-flash for 1,500 req/day free tier vs 200 for gemini-2.0-flash.
 */
const GEMINI_MODEL = 'gemini-2.5-flash'

const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  const geminiKey = process.env.GEMINI_API_KEY
  const visionKey = process.env.GOOGLE_VISION_API_KEY

  if (!geminiKey && !visionKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'No API key configured. Set GEMINI_API_KEY in Netlify environment variables.' }),
    }
  }

  let image: string
  try {
    const body = JSON.parse(event.body || '{}')
    image = body.image
    if (!image) throw new Error('missing image')
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Expected { image: base64string }' }) }
  }

  // Try Cloud Vision first (better accuracy, but needs API enabled in GCP console)
  if (visionKey) {
    const text = await tryVisionAPI(image, visionKey)
    if (text !== null) {
      return ok({ text, source: 'vision' })
    }
  }

  // Gemini Vision fallback (works immediately, no extra setup)
  if (geminiKey) {
    try {
      const text = await callGeminiVision(image, geminiKey)
      return ok({ text, source: 'gemini' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { statusCode: 502, body: JSON.stringify({ error: message }) }
    }
  }

  return { statusCode: 500, body: JSON.stringify({ error: 'OCR unavailable' }) }
}

async function tryVisionAPI(image: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: image },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
          imageContext: { languageHints: ['th', 'en'] },
        }],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (data?.responses?.[0]?.error) return null
    return (
      data?.responses?.[0]?.fullTextAnnotation?.text ||
      data?.responses?.[0]?.textAnnotations?.[0]?.description ||
      null
    )
  } catch {
    return null
  }
}

async function callGeminiVision(image: string, apiKey: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: 'image/png', data: image } },
            {
              text: 'Extract ALL text from this invoice image exactly as it appears. Include every word, number, date, barcode, and special character. Preserve structure and line breaks. Output only the raw extracted text.',
            },
          ],
        }],
        generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
      }),
    }
  )

  if (!res.ok) {
    const body = await res.text()
    if (res.status === 429) {
      throw new Error('Gemini quota exceeded. Wait a minute or enable billing at console.cloud.google.com')
    }
    throw new Error(`Gemini Vision ${res.status}: ${body.slice(0, 300)}`)
  }

  const data = await res.json()
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

function ok(body: object) {
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

export { handler }
