import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// Production/normal run: the React app is BUILT (`npm run build`) and served by
// serve.mjs on :3002, which proxies everything. This dev-server proxy only
// matters if you run `npm run dev` for hot-reload — in that case serve.mjs
// (:3002) and Flask (:5001) should also be running.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Gemini proxy + image proxy live on the Node server (serve.mjs).
      '/api/gemini': { target: 'http://localhost:3002', changeOrigin: true },
      '/img': { target: 'http://localhost:3002', changeOrigin: true },
      // Data endpoints live on Flask.
      '/api': { target: 'http://localhost:5001', changeOrigin: true },
    },
  },
})
