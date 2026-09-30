/**
 * Android / 网页：检查 APK 更新元数据（不强制、不静默升级）
 * 元数据随 GitHub Pages 发布：https://timeroulette.github.io/stock-workstation/app-update.json
 */

import { openExternalLink } from '../utils/openExternalLink'

export const APP_VERSION =
  (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_APP_VERSION as string)) || '0.12.3'

/** 线上权威元数据（APK 内置相对路径可能过期，必须拉 Pages） */
export const APP_UPDATE_META_URL =
  'https://timeroulette.github.io/stock-workstation/app-update.json'

export const GH_RELEASE_API =
  'https://api.github.com/repos/TimeRoulette/stock-workstation/releases/tags/android-debug-latest'

export interface AndroidUpdateMeta {
  latestVersion: string
  minVersion?: string
  apkUrl: string
  releasePage?: string
  publishedAt?: string
  changelog: string[]
}

export interface AppUpdateFile {
  android: AndroidUpdateMeta
}

export type UpdateCheckStatus =
  | 'up_to_date'
  | 'update_available'
  | 'unavailable'
  | 'error'

export interface UpdateCheckResult {
  status: UpdateCheckStatus
  currentVersion: string
  latestVersion?: string
  meta?: AndroidUpdateMeta
  message: string
  source?: 'pages' | 'github-release'
}

export function parseSemver(v: string): [number, number, number] {
  const clean = String(v || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[-+]/)[0]
  const parts = clean.split('.').map((p) => Number.parseInt(p, 10))
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0]
}

/** a > b → 正；相等 → 0；a < b → 负 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

export function isNativeAndroid(): boolean {
  try {
    const c = typeof window !== 'undefined' ? window.Capacitor : undefined
    if (c?.isNativePlatform?.() && c.getPlatform?.() === 'android') return true
    if (c?.getPlatform?.() === 'android') return true
  } catch {
    /* */
  }
  return false
}

export function isCapacitorNative(): boolean {
  try {
    return Boolean(typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.())
  } catch {
    return false
  }
}

/** 运行时版本：优先 Capacitor App 插件，否则构建注入的 VITE_APP_VERSION */
export async function getCurrentAppVersion(): Promise<string> {
  try {
    const info = await window.Capacitor?.Plugins?.App?.getInfo?.()
    if (info?.version) return String(info.version)
  } catch {
    /* */
  }
  return APP_VERSION
}

async function fetchJson(url: string, timeoutMs = 10000): Promise<unknown> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

function normalizeMeta(raw: unknown): AndroidUpdateMeta | null {
  if (!raw || typeof raw !== 'object') return null
  const root = raw as Record<string, unknown>
  const android = (root.android && typeof root.android === 'object' ? root.android : root) as Record<
    string,
    unknown
  >
  const latestVersion = String(android.latestVersion || '').trim()
  const apkUrl = String(android.apkUrl || '').trim()
  if (!latestVersion || !apkUrl) return null
  const changelogRaw = android.changelog
  const changelog = Array.isArray(changelogRaw)
    ? changelogRaw.map((x) => String(x).trim()).filter(Boolean)
    : typeof changelogRaw === 'string'
      ? [changelogRaw.trim()].filter(Boolean)
      : []
  return {
    latestVersion,
    minVersion: android.minVersion != null ? String(android.minVersion) : undefined,
    apkUrl,
    releasePage: android.releasePage != null ? String(android.releasePage) : undefined,
    publishedAt: android.publishedAt != null ? String(android.publishedAt) : undefined,
    changelog,
  }
}

/** 从 GitHub Releases API 拼一个简陋元数据（changelog 取 body 前几行） */
function metaFromGithubRelease(data: unknown): AndroidUpdateMeta | null {
  if (!data || typeof data !== 'object') return null
  const r = data as Record<string, unknown>
  const assets = Array.isArray(r.assets) ? r.assets : []
  const apk = assets.find((a) => {
    if (!a || typeof a !== 'object') return false
    const name = String((a as Record<string, unknown>).name || '')
    return name.endsWith('.apk')
  }) as Record<string, unknown> | undefined
  if (!apk?.browser_download_url) return null
  const name = String(apk.name || '')
  const m = name.match(/(\d+\.\d+\.\d+)/)
  const tagName = String(r.tag_name || '')
  const latestVersion = m?.[1] || (tagName.match(/(\d+\.\d+\.\d+)/)?.[1] ?? '')
  if (!latestVersion) return null
  const body = String(r.body || '')
  const changelog = body
    .split(/\r?\n/)
    .map((l) => l.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim())
    .filter((l) => l && !l.startsWith('http') && l.length < 200)
    .slice(0, 8)
  return {
    latestVersion,
    apkUrl: String(apk.browser_download_url),
    releasePage: String(r.html_url || 'https://github.com/TimeRoulette/stock-workstation/releases/tag/android-debug-latest'),
    publishedAt: r.published_at != null ? String(r.published_at) : undefined,
    changelog: changelog.length ? changelog : [`Release ${latestVersion}`],
  }
}

export async function fetchUpdateMeta(): Promise<{ meta: AndroidUpdateMeta; source: 'pages' | 'github-release' }> {
  try {
    const bust = `${APP_UPDATE_META_URL}?t=${Date.now()}`
    const json = await fetchJson(bust)
    const meta = normalizeMeta(json)
    if (meta) return { meta, source: 'pages' }
  } catch {
    /* fall through */
  }
  const gh = await fetchJson(GH_RELEASE_API)
  const meta = metaFromGithubRelease(gh)
  if (!meta) throw new Error('无法解析更新元数据')
  return { meta, source: 'github-release' }
}

export async function checkForAppUpdate(opts?: {
  currentVersion?: string
}): Promise<UpdateCheckResult> {
  const currentVersion = opts?.currentVersion || (await getCurrentAppVersion())
  try {
    const { meta, source } = await fetchUpdateMeta()
    const cmp = compareSemver(meta.latestVersion, currentVersion)
    if (cmp > 0) {
      return {
        status: 'update_available',
        currentVersion,
        latestVersion: meta.latestVersion,
        meta,
        source,
        message: `发现新版本 v${meta.latestVersion}（当前 v${currentVersion}）`,
      }
    }
    return {
      status: 'up_to_date',
      currentVersion,
      latestVersion: meta.latestVersion,
      meta,
      source,
      message: `已是最新（v${currentVersion}）`,
    }
  } catch (e) {
    return {
      status: 'error',
      currentVersion,
      message: e instanceof Error ? e.message : '检查更新失败',
    }
  }
}

/**
 * 打开 APK 下载：优先 Capacitor Browser，否则系统浏览器 / 下载器。
 * 不做静默安装；用户需在系统安装界面确认。同 debug 签名可覆盖安装。
 */
export async function openApkDownload(apkUrl: string): Promise<{ ok: boolean; method: string }> {
  const url = String(apkUrl || '').trim()
  if (!url) return { ok: false, method: 'none' }
  try {
    const browser = window.Capacitor?.Plugins?.Browser
    if (browser?.open) {
      await browser.open({ url })
      return { ok: true, method: 'capacitor-browser' }
    }
  } catch {
    /* */
  }
  const ok = openExternalLink(url)
  return { ok, method: ok ? 'external' : 'failed' }
}

export const UPDATE_CHECKER_NOTE =
  '从本版本起内置「检查更新」。已经装出去的旧包（如 0.11.0）若当时没有检查器，无法凭空出现该功能，需手动安装一次带检查器的新包，之后即可应用内检查并可选更新。'

export const UPDATE_WEB_NOTE =
  '网页 / PWA 不能升级成 APK。若要用安卓安装包，请下载下方 debug APK（允许未知来源后安装）。'
