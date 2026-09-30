/**
 * 可选 LLM 总结（默认关闭）。
 * API Key：Electron → userData；Capacitor 原生 / 非 Pages → 本机 localStorage。
 * 绝不打进 GitHub Pages 静态包；Pages 宿主禁用 Key 输入。
 */
import * as db from './db'
import { isPagesHost } from '../utils/dataStatus'
import {
  chatCompletionsUrl,
  getLlmProvider,
  modelsListUrl,
} from './llmProviders'

const LLM_KEY_LS = 'sw-llm-api-key'

function isNativeCapacitor(): boolean {
  try {
    return Boolean(window.Capacitor?.isNativePlatform?.())
  } catch {
    return false
  }
}

/** 是否允许配置/保存 Key（Pages 公开站禁用） */
export function isLlmFeatureAvailable(): boolean {
  if (typeof window === 'undefined') return false
  if (window.stockWorkstation?.isElectron) return true
  if (isNativeCapacitor()) return true
  if (isPagesHost()) return false
  // 本机浏览器 / electron 以外的本地预览：可用 localStorage
  return true
}

export function llmKeyStorageHint(): string {
  if (typeof window !== 'undefined' && window.stockWorkstation?.isElectron) {
    return 'Key 仅存 Electron userData，不进仓库与 Pages 包'
  }
  if (isNativeCapacitor()) {
    return 'Key 仅存本机（APK 本地存储），不进 Pages 公开包'
  }
  return 'Key 仅存本机浏览器本地存储；公开 Pages 站请用桌面版或 APK'
}

export function isLlmSummaryEnabled(): boolean {
  try {
    return db.getSettings().llmSummaryEnabled === true
  } catch {
    return false
  }
}

export async function loadLlmKey(): Promise<string> {
  if (!isLlmFeatureAvailable()) return ''
  if (window.stockWorkstation?.isElectron && window.stockWorkstation.getLlmKey) {
    const r = await window.stockWorkstation.getLlmKey()
    return r.key || ''
  }
  try {
    return localStorage.getItem(LLM_KEY_LS) || ''
  } catch {
    return ''
  }
}

export async function saveLlmKey(key: string): Promise<{ ok: boolean; error?: string }> {
  if (!isLlmFeatureAvailable()) {
    return { ok: false, error: '当前环境不可保存 Key（请用桌面 Electron 或 Android APK）' }
  }
  if (window.stockWorkstation?.isElectron && window.stockWorkstation.setLlmKey) {
    return window.stockWorkstation.setLlmKey(key)
  }
  try {
    const v = String(key || '').trim()
    if (!v) localStorage.removeItem(LLM_KEY_LS)
    else localStorage.setItem(LLM_KEY_LS, v)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '本地存储失败' }
  }
}

export function getLlmEndpointAndModel(): { endpoint: string; model: string; baseUrl: string } {
  const s = db.getSettings()
  const provider = getLlmProvider(s.llmProvider || 'deepseek')
  const baseUrl = (s.llmBaseUrl || provider.baseUrl || '').trim()
  const model = (s.llmModel || provider.models[0] || 'deepseek-chat').trim()
  return {
    baseUrl,
    endpoint: chatCompletionsUrl(baseUrl),
    model,
  }
}

/** 拉取 OpenAI 兼容 /models；失败抛错，调用方保留预设 */
export async function fetchRemoteModels(opts?: {
  baseUrl?: string
  apiKey?: string
}): Promise<string[]> {
  const key = (opts?.apiKey ?? (await loadLlmKey())).trim()
  if (!key) throw new Error('请先填写并保存 API Key')
  const base =
    (opts?.baseUrl ?? getLlmEndpointAndModel().baseUrl).trim() ||
    getLlmProvider(db.getSettings().llmProvider || 'custom').baseUrl
  const url = modelsListUrl(base)
  if (!url) throw new Error('请先填写 Base URL')
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`刷新模型失败 HTTP ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}`)
  }
  const data = (await res.json()) as { data?: Array<{ id?: string }> }
  const ids = (data.data || [])
    .map((m) => (m.id || '').trim())
    .filter(Boolean)
  if (ids.length === 0) throw new Error('远端未返回模型列表')
  return ids.sort((a, b) => a.localeCompare(b))
}

/**
 * 调用用户自备的 OpenAI 兼容接口做短文总结。
 * 失败原样抛错，不回退伪造内容。非投资建议。
 */
export async function summarizeWithUserLlm(
  text: string,
  opts?: { endpoint?: string; model?: string },
): Promise<string> {
  if (!isLlmSummaryEnabled()) throw new Error('LLM 总结未启用（设置中打开）')
  const key = await loadLlmKey()
  if (!key) throw new Error('未配置 API Key（仅本机可保存；Pages 请用桌面/APK）')
  const cfg = getLlmEndpointAndModel()
  const endpoint = (opts?.endpoint || cfg.endpoint).trim()
  const model = (opts?.model || cfg.model).trim()
  if (!endpoint) throw new Error('未配置 Base URL')
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content:
            '你是个人交易复盘助手。用简体中文、简短条目总结用户给出的成交/分析文本。不要荐股，不要承诺收益，不作投资建议。',
        },
        { role: 'user', content: text.slice(0, 12000) },
      ],
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`LLM 请求失败 HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error('LLM 返回为空')
  return content
}
