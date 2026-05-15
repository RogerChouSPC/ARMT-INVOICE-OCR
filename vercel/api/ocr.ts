import type { VercelRequest, VercelResponse } from '@vercel/node'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = 'google/gemini-2.5-flash'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
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
              text: 'Extract ALL text from this invoice image exactly as it appears. Include every word, number, date, barcode, and special character. Preserve structure and line breaks. Output only the raw extracted text.',
            },
          ],
        }],
        temperature: 0,
      }),
    })

    if (!apiRes.ok) {
      const errText = await apiRes.text()
      if (apiRes.status === 429) {
        return res.status(429).json({ error: 'API quota exceeded. Please try again shortly.' })
      }
      return res.status(502).json({ error: `OpenRouter ${apiRes.status}: ${errText.slice(0, 300)}` })
    }

    const data = await apiRes.json()
    const text: string = data?.choices?.[0]?.message?.content ?? ''
    return res.status(200).json({ text, source: 'openrouter' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return res.status(502).json({ error: message })
  }
}
