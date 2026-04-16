import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'screeps-types-virtual',
      resolveId(id) {
        if (id === 'virtual:screeps-types') return '\0virtual:screeps-types'
      },
      load(id) {
        if (id === '\0virtual:screeps-types') {
          const content = readFileSync(resolve(__dirname, 'node_modules/@types/screeps/index.d.ts'), 'utf-8')
          return `export default ${JSON.stringify(content)}`
        }
      },
    },
  ],
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
