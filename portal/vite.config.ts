import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
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
    // Proxy only needed for standalone local dev (not when running inside Docker with nginx).
    // Contexts use a trailing slash so they only match the project-scoped routes
    // (/c/<project>, /d/<diff>, /api/...) and don't swallow portal SPA routes that
    // merely share a prefix — e.g. /cli (was caught by '/c') or /definitions ('/d').
    proxy: process.env.VITE_BASE ? undefined : {
      '/api/': {
        target: 'https://localhost:4444',
        secure: false,
        changeOrigin: true,
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
