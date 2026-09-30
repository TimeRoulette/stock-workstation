/**
 * 行情请求传输层：DEV 代理 / Electron 原生 HTTP / 浏览器直连+多 CORS 中继 / 用户自备代理
 */
let customProxyUrl = ''

export function setQuoteProxyUrl(url: string) {
  customProxyUrl = String(url || '').trim().replace(/\/$/, '')
}

export function getQuoteProxyUrl(): string {
  return customProxyUrl
}

function isElectronRuntime(): boolean {
  return Boolean(
    typeof window !== 'undefined' &&
      (window as Window & { stockWorkstation?: { isElectron?: boolean } }).stockWorkstation?.isElectron,
  )
}

function hasElectronHttp(): boolean {
  return Boolean(typeof window !== 'undefined' && window.stockWorkstation?.httpFetch)
}

/** 把绝对 URL 套上用户自备中继（支持 {url} 占位或末尾拼接） */
export function wrapWithUserProxy(absoluteUrl: string): string | null {
  if (!customProxyUrl) return null
  if (customProxyUrl.includes('{url}')) {
    return customProxyUrl.replace(/\{url\}/g, encodeURIComponent(absoluteUrl))
  }
  // 形如 https://my.relay/? → 追加 encodeURIComponent
  if (customProxyUrl.endsWith('=') || customProxyUrl.endsWith('?') || customProxyUrl.includes('?')) {
    const sep = customProxyUrl.endsWith('=') || customProxyUrl.endsWith('?') ? '' : '&url='
    return `${customProxyUrl}${sep}${encodeURIComponent(absoluteUrl)}`
  }
  // 路径前缀网关：https://my.gateway/proxy/https://...
  return `${customProxyUrl}/${absoluteUrl}`
}

const PUBLIC_CORS_RELAYS = [
  (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u: string) => `https://cors.eu.org/${u}`,
]

/**
 * 构建候选 URL：
 * - DEV：Vite 代理
 * - Electron：直连（主进程也可 httpFetch）
 * - Pages：直连 → 用户代理 → 多个公共 CORS 中继
 */
export function quoteCandidateUrls(devProxyUrl: string, absoluteUrl: string): string[] {
  if (import.meta.env.DEV) return [devProxyUrl]
  if (isElectronRuntime()) return [absoluteUrl]

  const out: string[] = [absoluteUrl]
  const user = wrapWithUserProxy(absoluteUrl)
  if (user) out.unshift(user) // 用户自备优先于公共中继
  for (const mk of PUBLIC_CORS_RELAYS) {
    try {
      out.push(mk(absoluteUrl))
    } catch {
      /* */
    }
  }
  return out
}

export async function electronHttpGet(
  url: string,
  init: { headers?: HeadersInit; timeoutMs?: number } = {},
): Promise<Response> {
  const api = window.stockWorkstation?.httpFetch
  if (!api) throw new Error('无 Electron HTTP')
  const headers: Record<string, string> = {}
  if (init.headers) {
    const h = new Headers(init.headers)
    h.forEach((v, k) => {
      headers[k] = v
    })
  }
  const r = await api({ url, method: 'GET', headers, timeoutMs: init.timeoutMs })
  if (!r.ok && r.error) throw new Error(r.error)
  const body = r.bodyText != null ? r.bodyText : r.bodyBase64 ? atob(r.bodyBase64) : ''
  return new Response(body, {
    status: r.status || (r.ok ? 200 : 502),
    headers: r.headers || { 'content-type': r.contentType || 'application/octet-stream' },
  })
}

export function preferElectronTransport(): boolean {
  return hasElectronHttp()
}
