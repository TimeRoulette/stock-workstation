/**
 * 全站外链打开策略：同 URL 复用已开且未关闭的窗口，否则新开并记入映射。
 * 浏览器无法枚举任意跨域 tab，故仅跟踪本应用打开过的 WindowProxy。
 */

const opened = new Map<string, WindowProxy>()

function normalizeUrl(raw: string): string | null {
  const s = String(raw || '').trim()
  if (!s) return null
  try {
    const u = new URL(s, typeof window !== 'undefined' ? window.location.href : 'https://example.invalid')
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.href
  } catch {
    return null
  }
}

function isClosed(w: WindowProxy | null | undefined): boolean {
  if (!w) return true
  try {
    return w.closed
  } catch {
    return true
  }
}

/**
 * 打开外链：已映射且未关则 focus；否则 window.open 并更新映射。
 * 返回是否成功聚焦或新开（被弹窗拦截时为 false）。
 */
export function openExternalLink(url: string): boolean {
  const href = normalizeUrl(url)
  if (!href) return false

  const prev = opened.get(href)
  if (prev && !isClosed(prev)) {
    try {
      prev.focus()
      return true
    } catch {
      /* fall through to reopen */
    }
  }

  try {
    const w = window.open(href, '_blank', 'noopener,noreferrer')
    if (w) {
      opened.set(href, w)
      try {
        w.focus()
      } catch {
        /* */
      }
      return true
    }
  } catch {
    /* */
  }
  // 弹窗被拦时退回同页导航（极少）
  try {
    window.location.assign(href)
    return true
  } catch {
    return false
  }
}

/** 供测试/调试：清空映射 */
export function clearExternalLinkMap() {
  opened.clear()
}

export const EXTERNAL_LINK_HINT = '同链接将复用已开窗口'
