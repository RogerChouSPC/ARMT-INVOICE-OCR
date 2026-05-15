import type { Handler } from '@netlify/functions'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = 'google/gemini-2.5-flash'

const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }) }
  }

  let image: string
  try {
    const body = JSON.parse(event.body || '{}')
    image = body.image
    if (!image) throw new Error('missing image')
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Expected { image: base64string }' }) }
  }

  try {
    const res = await fetch(OPENROUTER_URL, {
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
              text: 'Extract ALL text from this invoice image exactly as it appears. Include every word, number, date, barcode, and special character. Preserve structure and line breaks. Output only the raw extracted text.',
            },
          ],
        }],
        temperature: 0,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      if (res.status === 429) {
        throw new Error('API quota exceeded. Please try again shortly.')
      }
      throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 300)}`)
    }

    const data = await res.json()
    const text: string = data?.choices?.[0]?.message?.content ?? ''
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, source: 'openrouter' }),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { statusCode: 502, body: JSON.stringify({ error: message }) }
  }
}

export { handler }
