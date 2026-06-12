import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import svgLoader from 'vite-svg-loader'
import { resolve } from 'path'
import fs from 'fs'

// Serve the dev server over HTTPS when a self-signed cert is present
// (./.certs/{cert,key}.pem). A secure context is required for the embedded
// Selkies browser stream (WebRTC) to run on a non-localhost host.
const certDir = resolve(__dirname, '.certs')
const httpsConfig = fs.existsSync(`${certDir}/cert.pem`) && fs.existsSync(`${certDir}/key.pem`)
  ? { cert: fs.readFileSync(`${certDir}/cert.pem`), key: fs.readFileSync(`${certDir}/key.pem`) }
  : undefined

export default defineConfig({
  // svgo:false keeps our hand-authored icons intact (preserves viewBox +
  // stroke/fill="currentColor"). Import icons with `?component`, e.g.
  //   import EditIcon from '@/assets/icons/edit.svg?component'
  plugins: [vue(), svgLoader({ svgo: false })],
  base: process.env.VITE_BASE || '/',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    https: httpsConfig,
    // Proxy only needed for standalone local dev (not when running inside Docker with nginx).
    // Contexts use a trailing slash so they only match the project-scoped routes
    // (/c/<project>, /d/<diff>, /api/...) and don't swallow portal SPA routes that
    // merely share a prefix — e.g. /cli (was caught by '/c') or /definitions ('/d').
    proxy: process.env.VITE_BASE ? undefined : {
      '/api/': {
        target: 'https://localhost:4444',
        secure: false,
        changeOrigin: true,
        ws: true, // forward the /api/events WebSocket upgrade, not just HTTP
      },
      '/ws/': {
        target: 'https://localhost:4444',
        secure: false,
        changeOrigin: true,
        ws: true,
      },
      '/c/': {
        target: 'https://localhost:4444',
        secure: false,
        changeOrigin: true,
        ws: true,
      },
      '/d/': {
        target: 'https://localhost:4444',
        secure: false,
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
