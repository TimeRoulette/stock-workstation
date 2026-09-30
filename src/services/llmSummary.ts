/**
 * 可选 LLM 总结（默认关闭）。
 * API Key 仅通过 Electron IPC 存 userData；浏览器/Pages 不提供 Key 存储入口，
 * 也不会把 Key 打进静态包。
 */
import * as db from './db'

export function isLlmFeatureAvailable(): boolean {
  return Boolean(typeof window !== 'undefined' && window.stockWorkstation?.isElectron)
}

export function isLlmSummaryEnabled(): boolean {
  try {
    return db.getSettings().llmSummaryEnabled === true
  } catch {
    return false
  }
}

export async function loadLlmKey(): Promise<string> {
  if (!isLlmFeatureAvailable() || !window.stockWorkstation?.getLlmKey) return ''
  const r = await window.stockWorkstation.getLlmKey()
  return r.key || ''
}

export async function saveLlmKey(key: string): Promise<{ ok: boolean; error?: string }> {
  if (!isLlmFeatureAvailable() || !window.stockWorkstation?.setLlmKey) {
    return { ok: false, error: '仅 Electron 桌面端可保存 API Key' }
  }
  return window.stockWorkstation.setLlmKey(key)
}

/**
 * 调用用户自备的 OpenAI 兼容接口做短文总结。
 * 默认 endpoint 可改；失败原样抛错，不回退伪造内容。
 */
export async function summarizeWithUserLlm(
  text: string,
  opts?: { endpoint?: string; model?: string },
): Promise<string> {
  if (!isLlmSummaryEnabled()) throw new Error('LLM 总结未启用（设置中打开）')
  const key = await loadLlmKey()
  if (!key) throw new Error('未配置 API Key（仅本机 Electron 可保存）')
  const endpoint = (opts?.endpoint || 'https://api.openai.com/v1/chat/completions').trim()
  const model = opts?.model || 'gpt-4o-mini'
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
            '你是个人交易复盘助手。用简体中文、简短条目总结用户给出的成交/分析文本。不要荐股，不要承诺收益。',
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
