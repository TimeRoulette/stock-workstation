import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Relative './' works for GitHub project pages (https://USER.github.io/REPO/).
// Override with VITE_BASE=/REPO/ if you prefer an absolute project base.
const base = process.env.VITE_BASE || './'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api/yahoo': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/yahoo/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; StockWorkstation/0.3)',
        },
      },
      '/api/eastmoney': {
        target: 'https://push2.eastmoney.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/eastmoney/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; StockWorkstation/0.3)',
          Referer: 'https://quote.eastmoney.com/',
        },
      },
      '/api/sina': {
        target: 'https://hq.sinajs.cn',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/sina/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; StockWorkstation/0.3)',
          Referer: 'https://finance.sina.com.cn',
        },
      },
      '/api/eastmoney-his': {
        target: 'https://push2his.eastmoney.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/eastmoney-his/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; StockWorkstation/0.3)',
          Referer: 'https://quote.eastmoney.com/',
        },
      },
    },
  },
  build: {
    outDir: 'dist',
  },
  base,
})
