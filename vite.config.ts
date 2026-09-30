import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readFileSync } from 'fs'

// Relative './' works for GitHub project pages (https://USER.github.io/REPO/).
// Override with VITE_BASE=/REPO/ if you prefer an absolute project base.
const base = process.env.VITE_BASE || './'
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as { version: string }

export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
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
          'User-Agent': 'Mozilla/5.0 (compatible; StockWorkstation/0.8.0)',
        },
      },
      '/api/eastmoney-delay': {
        target: 'https://push2delay.eastmoney.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/eastmoney-delay/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; StockWorkstation/0.8.0)',
          Referer: 'https://quote.eastmoney.com/',
        },
      },
      '/api/eastmoney': {
        target: 'https://push2.eastmoney.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/eastmoney/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; StockWorkstation/0.8.0)',
          Referer: 'https://quote.eastmoney.com/',
        },
      },
      '/api/sina': {
        target: 'https://hq.sinajs.cn',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/sina/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; StockWorkstation/0.8.0)',
          Referer: 'https://finance.sina.com.cn',
        },
      },
      '/api/eastmoney-his': {
        target: 'https://push2his.eastmoney.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/eastmoney-his/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; StockWorkstation/0.8.0)',
          Referer: 'https://quote.eastmoney.com/',
        },
      },
      '/api/ths': {
        target: 'https://d.10jqka.com.cn',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/ths/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; StockWorkstation/0.8.0)',
          Referer: 'https://q.10jqka.com.cn/',
        },
      },
      '/api/people-rss': {
        target: 'https://www.people.com.cn',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/people-rss/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; StockWorkstation/0.8.0)',
          Accept: 'application/rss+xml, application/xml, text/xml, */*',
        },
      },
      '/api/cctv-news': {
        target: 'https://news.cctv.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/cctv-news/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; StockWorkstation/0.8.0)',
          Referer: 'https://finance.cctv.com/',
        },
      },
      '/api/wscn': {
        target: 'https://api-one-wscn.awtmt.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/wscn/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; StockWorkstation/0.8.0)',
        },
      },
    },
  },
  build: {
    outDir: 'dist',
  },
  base,
})
