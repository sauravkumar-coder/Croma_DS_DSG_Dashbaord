import path from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/analytics/samsung/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    include: ['react-plotly.js', 'plotly.js-dist-min'],
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('plotly.js') || id.includes('react-plotly')) {
              return 'plotly'
            }
            if (id.includes('html2canvas')) {
              return 'html2canvas'
            }
            return 'vendor'
          }
        },
      },
    },
  },
  server: {
    port: 3004,
    historyApiFallback: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
