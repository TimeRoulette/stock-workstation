import { useState } from 'react'

const ORDER_TERMS: Array<{ term: string; def: string }> = [
  { term: '市价', def: '按当前最新行情价立刻成交（模拟盘用最新价记账）。' },
  { term: '限价', def: '指定价格；本模拟盘在确认时按你输入的限价成交。' },
  { term: '手', def: 'A 股 1 手 = 100 股；买卖数量须为 100 的整数倍。' },
  { term: '费用', def: '模拟费率约 0.03%，仅作练习，非真实佣金/印花税。' },
  { term: '止损/止盈', def: '写在持仓备注里的目标价，不会自动下单。' },
]

const CHART_TERMS: Array<{ term: string; def: string }> = [
  { term: 'MA5/10/20', def: '收盘价简单移动平均线，观察趋势与支撑压力。' },
  { term: 'VOL', def: '成交量柱；放量常伴随趋势加速或反转信号。' },
  { term: 'MACD', def: '指数平滑异同：DIF/DEA 与柱状图，看动量与金叉死叉。' },
  { term: '日/周/月', def: '不同周期的 K 线；长周期过滤噪音，短周期看入场。' },
  { term: '1m/5m', def: '分钟线（分时附近）；依赖数据源是否提供日内数据。' },
]

interface Props {
  kind: 'order' | 'chart'
  compact?: boolean
}

export function Glossary({ kind, compact }: Props) {
  const [open, setOpen] = useState(!compact)
  const terms = kind === 'order' ? ORDER_TERMS : CHART_TERMS
  const title = kind === 'order' ? '下单术语' : '图表术语'

  return (
    <div className={`glossary ${compact ? 'compact' : ''}`}>
      <button type="button" className="glossary-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} {title}
      </button>
      {open && (
        <dl className="glossary-list">
          {terms.map((t) => (
            <div key={t.term} className="glossary-item">
              <dt>{t.term}</dt>
              <dd>{t.def}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
