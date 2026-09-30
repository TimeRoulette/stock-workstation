/**
 * 行情请求传输层：DEV 代理 / Electron·Capacitor 原生 HTTP / 浏览器直连+多 CORS 中继 / 用户自备代理
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

/** Capacitor 原生壳（APK）：可走 CapacitorHttp 绕过 WebView CORS */
export function isCapacitorNative(): boolean {
  try {
    const c = typeof window !== 'undefined' ? window.Capacitor : undefined
    return Boolean(c?.isNativePlatform?.())
  } catch {
    return false
  }
}

function hasCapacitorHttp(): boolean {
  try {
    const c = typeof window !== 'undefined' ? window.Capacitor : undefined
    if (!c?.isNativePlatform?.()) return false
    const http = c.Plugins?.CapacitorHttp
    return Boolean(http && (typeof http.request === 'function' || typeof http.get === 'function'))
  } catch {
    return false
  }
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

/**
 * 公共 CORS 中继（按实测可达性排序）。
 * 注意：corsproxy.io 匿名 keyless 已于 2025+ 失效（403），勿再排首位。
 * 中继本身不稳定，调用方应对中继 URL 使用更短超时。
 */
const PUBLIC_CORS_RELAYS: Array<(u: string) => string> = [
  (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u: string) => `https://cors.eu.org/${u}`,
]

/** 是否为公共中继 URL（用于缩短超时、减少重试） */
export function isPublicRelayUrl(url: string): boolean {
  return /allorigins\.win|cors\.eu\.org|corsproxy\.(io|org)|codetabs\.com|jina\.ai/i.test(url)
}

/**
 * 构建候选 URL：
 * - DEV：Vite 代理
 * - Electron / Capacitor 原生：直连（原生 HTTP 无 CORS，无需公共中继）
 * - Pages 浏览器：直连 → 用户代理 → 公共 CORS 中继
 */
export function quoteCandidateUrls(devProxyUrl: string, absoluteUrl: string): string[] {
  if (import.meta.env.DEV) return [devProxyUrl]
  // 原生壳：只直连（Electron httpFetch / CapacitorHttp / 已 patch 的 fetch）
  if (isElectronRuntime() || isCapacitorNative()) return [absoluteUrl]

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

type CapHttpPlugin = {
  request?: (opts: Record<string, unknown>) => Promise<{
    status?: number
    data?: unknown
    headers?: Record<string, string>
    url?: string
  }>
  get?: (opts: Record<string, unknown>) => Promise<{
    status?: number
    data?: unknown
    headers?: Record<string, string>
  }>
}

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  const h = new Headers(headers)
  h.forEach((v, k) => {
    out[k] = v
  })
  return out
}

function capacitorDataToBody(data: unknown): { text: string; raw?: ArrayBuffer } {
  if (data == null) return { text: '' }
  if (typeof data === 'string') return { text: data }
  if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
    return { text: '', raw: data }
  }
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView
    const raw = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
    return { text: '', raw }
  }
  // Capacitor 有时把二进制放在 base64 字段；或直接给 object
  if (typeof data === 'object' && data !== null && 'data' in (data as object)) {
    return capacitorDataToBody((data as { data: unknown }).data)
  }
  try {
    return { text: JSON.stringify(data) }
  } catch {
    return { text: String(data) }
  }
}

export async function capacitorHttpGet(
  url: string,
  init: { headers?: HeadersInit; timeoutMs?: number } = {},
): Promise<Response> {
  const http = window.Capacitor?.Plugins?.CapacitorHttp as CapHttpPlugin | undefined
  if (!http) throw new Error('无 CapacitorHttp')
  const headers = headersToRecord(init.headers)
  const timeout = init.timeoutMs ?? 8000
  const opts = {
    url,
    method: 'GET',
    headers,
    connectTimeout: timeout,
    readTimeout: timeout,
    // arraybuffer 便于新浪 GB18030；JSON 源仍可按文本解
    responseType: 'arraybuffer' as const,
  }
  const r = http.request
    ? await http.request(opts)
    : await http.get!({ url, headers, connectTimeout: timeout, readTimeout: timeout, responseType: 'arraybuffer' })
  const status = r.status ?? 0
  if (status < 200 || status >= 300) {
    throw new Error(`HTTP ${status || 'error'}`)
  }
  const { text, raw } = capacitorDataToBody(r.data)
  const body: BodyInit = raw && raw.byteLength > 0 ? raw : text
  return new Response(body, {
    status: status || 200,
    headers: r.headers || { 'content-type': 'application/octet-stream' },
  })
}

export async function electronHttpGet(
  url: string,
  init: { headers?: HeadersInit; timeoutMs?: number } = {},
): Promise<Response> {
  const api = window.stockWorkstation?.httpFetch
  if (!api) throw new Error('无 Electron HTTP')
  const headers = headersToRecord(init.headers)
  const r = await api({ url, method: 'GET', headers, timeoutMs: init.timeoutMs })
  if (!r.ok && r.error) throw new Error(r.error)
  // Prefer base64 for binary (新浪 GB18030)；否则文本
  if (r.bodyBase64) {
    const bin = Uint8Array.from(atob(r.bodyBase64), (c) => c.charCodeAt(0))
    return new Response(bin.buffer, {
      status: r.status || (r.ok ? 200 : 502),
      headers: r.headers || { 'content-type': r.contentType || 'application/octet-stream' },
    })
  }
  const body = r.bodyText != null ? r.bodyText : ''
  return new Response(body, {
    status: r.status || (r.ok ? 200 : 502),
    headers: r.headers || { 'content-type': r.contentType || 'application/octet-stream' },
  })
}

/** Electron 主进程 HTTP 或 Capacitor 原生 HTTP（均绕 CORS） */
export function preferNativeHttpTransport(): boolean {
  return hasElectronHttp() || hasCapacitorHttp() || isCapacitorNative()
}

/** @deprecated 用 preferNativeHttpTransport */
export function preferElectronTransport(): boolean {
  return preferNativeHttpTransport()
}

/**
 * 原生 HTTP GET：Electron → CapacitorHttp → 抛错由调用方改走 fetch
 */
export async function nativeHttpGet(
  url: string,
  init: { headers?: HeadersInit; timeoutMs?: number } = {},
): Promise<Response> {
  if (hasElectronHttp()) return electronHttpGet(url, init)
  if (hasCapacitorHttp()) return capacitorHttpGet(url, init)
  throw new Error('无原生 HTTP')
}
