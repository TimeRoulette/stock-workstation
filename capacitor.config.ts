import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Android 包装（Capacitor）脚手架。
 * - webDir: 本地 dist（离线 assets）
 * - server.url: 也可指向 GitHub Pages（TWA 式在线壳）；正式包更推荐 sync 本地 dist
 * - CapacitorHttp.enabled: 原生 HTTP 绕过 WebView CORS（与 Electron 主进程代理同目标）
 *
 * 本仓库默认不提交庞大的 android/ 工程目录；用 npm scripts 或 GitHub Actions 生成。
 */
const config: CapacitorConfig = {
  appId: 'com.personal.stockworkstation',
  appName: '股票工作台',
  webDir: 'dist',
  server: {
    // 构建离线包时注释掉 url，仅用 webDir
    // url: 'https://timeroulette.github.io/stock-workstation/',
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
}

export default config
