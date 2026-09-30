import { useCallback, useEffect, useState } from 'react'
import {
  applyTheme,
  resolveTheme,
  setTheme as persistTheme,
  subscribeThemeChange,
  type ThemeMode,
} from '../utils/theme'

/** 启动时解析并挂到根节点；之后与跨组件切换同步 */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => resolveTheme())

  useEffect(() => {
    applyTheme(theme)
    return subscribeThemeChange((t) => setThemeState(t))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setTheme = useCallback((t: ThemeMode) => {
    persistTheme(t)
    setThemeState(t)
  }, [])

  return { theme, setTheme }
}
