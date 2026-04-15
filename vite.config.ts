import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
    'process.env': {},
  },
  optimizeDeps: {
    exclude: ['@screeps/renderer']
  },
  server: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:21025',
        changeOrigin: true,
      },
      '/socket': {
        target: 'http://127.0.0.1:21025',
        changeOrigin: true,
        ws: true,
      },
      '/room-history': {
        target: 'http://127.0.0.1:21025',
        changeOrigin: true,
      },
    },
  },
})
