interface Props {
  message: string
  type?: 'info' | 'error'
  onClose: () => void
}

export function Toast({ message, type = 'info', onClose }: Props) {
  return (
    <div className={`toast ${type === 'error' ? 'error' : ''}`} onClick={onClose} role="status">
      {message}
    </div>
  )
}
