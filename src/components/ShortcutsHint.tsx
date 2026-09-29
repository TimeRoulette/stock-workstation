interface Props {
  open: boolean
  onClose: () => void
}

const ROWS: Array<{ keys: string; desc: string }> = [
  { keys: '1–7', desc: '盯盘 / 量监 / 选股 / 模拟 / 日报 / 复盘 / 设置' },
  { keys: 'R', desc: '刷新当前页行情（盯盘/量监/选股/模拟）' },
  { keys: 'N', desc: '聚焦「添加自选」输入框' },
  { keys: '?', desc: '显示 / 关闭本快捷键提示' },
  { keys: 'Esc', desc: '关闭弹层 / 引导' },
]

export function ShortcutsHint({ open, onClose }: Props) {
  if (!open) return null
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-card shortcuts-card"
        role="dialog"
        aria-label="键盘快捷键"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>键盘快捷键</h3>
        <p className="muted" style={{ marginBottom: 12 }}>
          在输入框外生效。可选功能，不影响鼠标操作。
        </p>
        <table className="data dense shortcuts-table">
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.keys} style={{ cursor: 'default' }}>
                <td className="mono">{r.keys}</td>
                <td>{r.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="toolbar" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          <button type="button" className="btn primary" onClick={onClose}>
            知道了
          </button>
        </div>
      </div>
    </div>
  )
}
