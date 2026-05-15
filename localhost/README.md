# ARMT Invoice OCR — Local Development

This folder is the local launcher for the Vercel project.

## Setup (first time)

1. Install dependencies in the vercel project:
   ```
   cd d:\test\vercel
   npm install
   ```

2. Create your `.env` file:
   ```
   cd d:\test\vercel
   copy .env.example .env
   ```
   Then edit `.env` and set your `OPENROUTER_API_KEY`.

3. Install Vercel CLI globally (if not already):
   ```
   npm install -g vercel
   ```

## Run locally

```
cd d:\test\vercel
vercel dev
```

This starts both the Vite frontend AND the `/api/` serverless functions on http://localhost:3000

## Deploy to Vercel

```
cd d:\test\vercel
vercel deploy --prod
```

Set `OPENROUTER_API_KEY` in Vercel dashboard → Project → Settings → Environment Variables.
