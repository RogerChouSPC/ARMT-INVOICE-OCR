// OpenRouter model used for both OCR and extraction. Override with OPENROUTER_MODEL.
// gemini-2.5-flash stopped working: its only endpoint fails the account's
// Zero Data Retention policy (OpenRouter returns 404).
export const MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-3.5-flash-lite'
