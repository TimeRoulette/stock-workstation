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

const VOLUME_TERMS: Array<{ term: string; def: string }> = [
  {
    term: 'RVOL',
    def: '相对成交量 = 最新日线成交量 ÷ 近 N 日均量（不含当日）。默认 N=20；历史不足 5 根时标为不可用。',
  },
  {
    term: '放量',
    def: 'RVOL ≥ 1.5：今日量明显高于近期均量，常伴随突破或情绪升温。',
  },
  {
    term: '爆量',
    def: 'RVOL ≥ 3.5：极端放量，需警惕追高或主力异动；结合价格位置判断。',
  },
  {
    term: '缩量 / 极致缩量',
    def: 'RVOL < 0.8 / < 0.5：交投清淡，趋势可能休整或缺乏跟风。',
  },
  {
    term: '较昨日',
    def: '今日量 ÷ 昨日量，仅作短线对照，不参与 RVOL 分级。',
  },
]

const SCREENER_TERMS: Array<{ term: string; def: string }> = [
  {
    term: '涨跌幅榜',
    def: '按当日涨跌幅排序的全市场排名。涨幅榜从高到低，跌幅榜从低到高；可分页加载至前 200；数据来自公开行情源，通常有延迟。',
  },
  {
    term: '板块榜',
    def: '东财行业（m:90+t:2）与概念（m:90+t:3）板块涨跌幅；点开查看成分股。',
  },
  {
    term: '龙头',
    def: '成分股按涨跌幅降序，在前 5 名中取成交额最大者；启发式标注，非荐股。',
  },
  {
    term: '中军',
    def: '涨幅第 2–5 名中排除龙头后，取成交额最大者；表示跟涨且额靠前、非最极端的标的。',
  },
  {
    term: '成交额/量',
    def: '成交额为金额合计，成交量为股数/手数口径依源而定；榜单用于横向对比情绪强弱。',
  },
  {
    term: '延迟行情',
    def: '公开接口非券商 Level-2，可能延迟数分钟；仅供学习，实盘请以券商为准。',
  },
]

interface Props {
  kind: 'order' | 'chart' | 'volume' | 'screener'
  compact?: boolean
}

export function Glossary({ kind, compact }: Props) {
  const [open, setOpen] = useState(!compact)
  const terms =
    kind === 'order'
      ? ORDER_TERMS
      : kind === 'volume'
        ? VOLUME_TERMS
        : kind === 'screener'
          ? SCREENER_TERMS
          : CHART_TERMS
  const title =
    kind === 'order'
      ? '下单术语'
      : kind === 'volume'
        ? '量能术语'
        : kind === 'screener'
          ? '选股术语'
          : '图表术语'

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
