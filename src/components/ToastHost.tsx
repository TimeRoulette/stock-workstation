import type { ToastItem } from '../types'

interface Props {
  toasts: ToastItem[]
  onClose: (id: string) => void
}

export function ToastHost({ toasts, onClose }: Props) {
  if (toasts.length === 0) return null
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.type}`}
          onClick={() => onClose(t.id)}
          role="status"
        >
          {t.type === 'alert' && <span className="toast-tag">提醒</span>}
          {t.message}
        </div>
      ))}
    </div>
  )
}
