import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // GitHub Pages serves the app under /<repo>/; the deploy workflow sets BASE_PATH
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  server: { port: 5173, host: true },
  // maplibre-gl alone is ~1 MB minified
  build: { chunkSizeWarningLimit: 2000 },
  test: { environment: 'node' },
} as never)
