/** 日间 / 夜间主题：localStorage 持久化，首次跟随系统 */

export type ThemeMode = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'sw-theme'
export const THEME_CHANGE_EVENT = 'sw-theme-change'

export function resolveTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* private mode */
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'light'
  }
  return 'dark'
}

export function applyTheme(theme: ThemeMode) {
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.colorScheme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', theme === 'light' ? '#f4f6f9' : '#0c1015')
  }
}

/** 用户手动切换：写入 localStorage，之后不再跟随系统 */
export function setTheme(theme: ThemeMode) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    /* */
  }
  applyTheme(theme)
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme }))
}

export function getStoredTheme(): ThemeMode | null {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* */
  }
  return null
}

export function toggleTheme(current: ThemeMode): ThemeMode {
  const next = current === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}

/** 图表读 CSS 变量，随主题切换 */
export function getChartThemeColors() {
  const s = getComputedStyle(document.documentElement)
  const css = (name: string, fallback: string) => {
    const v = s.getPropertyValue(name).trim()
    return v || fallback
  }
  return {
    text: css('--text-muted', '#8b949e'),
    border: css('--chart-border', '#30363d'),
    grid: css('--chart-grid', 'rgba(48,54,61,0.55)'),
    gridSoft: css('--chart-grid-soft', 'rgba(48,54,61,0.4)'),
    up: css('--up', '#f07178'),
    down: css('--down', '#7fd99a'),
    upSoft: css('--up-soft', 'rgba(240,113,120,0.55)'),
    downSoft: css('--down-soft', 'rgba(127,217,154,0.55)'),
    accent: css('--accent', '#5b9fd4'),
    warn: css('--warn', '#e0b15a'),
    purple: css('--chart-ma3', '#c4a8f0'),
  }
}

export function subscribeThemeChange(cb: (theme: ThemeMode) => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<ThemeMode>).detail
    cb(detail || resolveTheme())
  }
  window.addEventListener(THEME_CHANGE_EVENT, handler)
  return () => window.removeEventListener(THEME_CHANGE_EVENT, handler)
}
