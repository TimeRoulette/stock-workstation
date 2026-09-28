import { useState } from 'react'

const STEPS = [
  {
    title: '30 秒上手',
    body: '盯盘加自选 → 看 K 线 → 一键模拟买入。数据存在本机，无需 API Key。',
  },
  {
    title: '常用三件事',
    body: '添加代码（回车即加）、图表旁「一键模拟买入」、提醒模板一键设价。高级选项默认收起。',
  },
  {
    title: '复盘与设置',
    body: '成交后可自动草稿复盘。设置里可探测行情健康、CSV 与账户重置。按 ? 看快捷键。',
  },
]

interface Props {
  onDismiss: () => void
}

export function CoachMarks({ onDismiss }: Props) {
  const [step, setStep] = useState(0)
  const cur = STEPS[step]
  const last = step === STEPS.length - 1

  return (
    <div className="coach-backdrop">
      <div className="coach-card" role="dialog" aria-label="新手引导">
        <div className="coach-progress">
          {STEPS.map((_, i) => (
            <span key={i} className={`coach-dot ${i === step ? 'active' : i < step ? 'done' : ''}`} />
          ))}
        </div>
        <h3>{cur.title}</h3>
        <p>{cur.body}</p>
        <div className="toolbar" style={{ justifyContent: 'space-between', marginTop: 16 }}>
          <button type="button" className="btn" onClick={onDismiss}>
            跳过
          </button>
          <div className="toolbar">
            {step > 0 && (
              <button type="button" className="btn" onClick={() => setStep((s) => s - 1)}>
                上一步
              </button>
            )}
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                if (last) onDismiss()
                else setStep((s) => s + 1)
              }}
            >
              {last ? '开始' : '下一步'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
