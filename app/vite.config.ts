import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  // Production: /armt-invoice-ocr/ behind Nginx. Local dev: npm run dev uses /.
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  // Local dev: the Vite dev server (5173) proxies /api calls to the
  // Express server (run `npm run server` in a second terminal on port 3000).
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    rollupOptions: {
      input: {
        main:  resolve(__dirname, 'index.html'),
        popup: resolve(__dirname, 'popup.html'),
      },
      output: {
        manualChunks: {
          'pdf':   ['pdfjs-dist'],
          'excel': ['xlsx'],
        },
      },
    },
  },
})
