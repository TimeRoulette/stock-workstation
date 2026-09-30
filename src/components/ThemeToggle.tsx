import type { ThemeMode } from '../utils/theme'
import { Icons } from './Icon'

interface Props {
  theme: ThemeMode
  onChange: (theme: ThemeMode) => void
  /** compact = 图标按钮（侧栏/顶栏）；full = 日间/夜间分段 */
  variant?: 'compact' | 'full'
  className?: string
}

export function ThemeToggle({ theme, onChange, variant = 'compact', className = '' }: Props) {
  if (variant === 'full') {
    return (
      <div className={`theme-seg seg-control ${className}`.trim()} role="group" aria-label="外观主题">
        <button
          type="button"
          className={theme === 'light' ? 'active' : ''}
          onClick={() => onChange('light')}
          aria-pressed={theme === 'light'}
        >
          <Icons.sun /> 日间
        </button>
        <button
          type="button"
          className={theme === 'dark' ? 'active' : ''}
          onClick={() => onChange('dark')}
          aria-pressed={theme === 'dark'}
        >
          <Icons.moon /> 夜间
        </button>
      </div>
    )
  }

  const isDark = theme === 'dark'
  const next: ThemeMode = isDark ? 'light' : 'dark'
  return (
    <button
      type="button"
      className={`btn btn-xs theme-toggle-btn touch-target ${className}`.trim()}
      onClick={() => onChange(next)}
      title={isDark ? '切换到日间' : '切换到夜间'}
      aria-label={isDark ? '切换到日间' : '切换到夜间'}
    >
      <span aria-hidden="true">{isDark ? <Icons.sun /> : <Icons.moon />}</span>
      <span className="theme-toggle-label">{isDark ? '日间' : '夜间'}</span>
    </button>
  )
}
