import { useState } from 'react'

export type GlossaryKind =
  | 'order'
  | 'chart'
  | 'volume'
  | 'screener'
  | 'watchlist'
  | 'paper'
  | 'live'
  | 'brief'
  | 'journal'
  | 'settings'

type Term = { term: string; def: string }

const DISCLAIMER = '仅供学习研究，不构成投资建议。'

const ORDER_TERMS: Term[] = [
  { term: '市价', def: '按当前最新行情价立刻成交（模拟盘用最新价记账）。本应用：点买入/卖出即按展示价记账。' },
  { term: '限价', def: '指定价格；进入待成交队列，行情触及后按演示规则成交。本应用：确认挂单后在「待成交挂单」查看。' },
  { term: '手', def: 'A 股 1 手 = 100 股；买卖数量须为 100 的整数倍。本应用：手数快捷芯片按此换算。' },
  { term: '费用', def: '模拟佣金约按设置费率扣现金；印花税仅卖出计。注意：仅为练习，非真实券商费率。' },
  { term: '止损/止盈', def: '写在持仓备注里的目标价。本应用：可只提醒，或勾选「触及后演示自动平仓」（非券商撮合）。' },
]

const CHART_TERMS: Term[] = [
  { term: 'MA5/10/20', def: '收盘价简单移动平均线，观察趋势与支撑压力。本应用：图表指标开关开「MA」即可叠加。' },
  { term: 'VOL', def: '成交量柱；放量常伴随趋势加速或反转信号。本应用：开「VOL」在主图下方显示。' },
  { term: 'MACD', def: '指数平滑异同：DIF/DEA 与柱状图，看动量与金叉死叉。本应用：开「MACD」副图。' },
  { term: 'DIF/DEA', def: 'MACD 快线/慢线；DIF 上穿 DEA 常称金叉，下穿称死叉。本应用：与柱同在 MACD 区。' },
  { term: '日/周/月', def: '不同周期的 K 线；长周期过滤噪音，短周期看入场。本应用：图表周期切换。' },
  { term: '1m/5m', def: '分钟线（分时附近）；依赖数据源是否提供日内数据。注意：公开源可能缺分钟线。' },
]

const VOLUME_TERMS: Term[] = [
  {
    term: 'RVOL',
    def: '相对成交量 = 最新日线成交量 ÷ 近 N 日均量（不含当日）。默认 N=20；历史不足 5 根时标为不可用。本应用：量监页主列。',
  },
  {
    term: '放量',
    def: 'RVOL ≥ 1.5：今日量明显高于近期均量，常伴随突破或情绪升温。本应用：徽章「放量」。',
  },
  {
    term: '爆量',
    def: 'RVOL ≥ 3.5：极端放量，需警惕追高或主力异动；结合价格位置判断。本应用：徽章「爆量」。',
  },
  {
    term: '缩量 / 极致缩量',
    def: 'RVOL < 0.8 / < 0.5：交投清淡，趋势可能休整或缺乏跟风。本应用：对应缩量徽章。',
  },
  {
    term: '较昨日',
    def: '今日量 ÷ 昨日量，仅作短线对照，不参与 RVOL 分级。本应用：表尾「较昨日」列。',
  },
]

const SCREENER_TERMS: Term[] = [
  {
    term: '涨跌幅榜',
    def: '按当日涨跌幅排序的全市场排名。涨幅榜从高到低，跌幅榜从低到高；可分页加载至前 200。注意：公开源通常有延迟。',
  },
  {
    term: '板块榜',
    def: '东财行业与概念板块涨跌幅；点开查看成分股。本应用：选股 → 板块。',
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
    term: '主升趋势',
    def: '五条件全满足：收盘>MA20、MA20>MA60、MA5>MA10；回看60日半宽3摆动低点取最近两个（间隔≥5），最新低≥前低×1.003；近20日涨日均量≥跌日均量×1.1。演示K不计命中。',
  },
  {
    term: '全市场扫描',
    def: '东财clist分页拉代码表后按需拉日K；并发约3、可停；港美有页数上限。注意：慢，Pages 更受限；非涨跌幅前200限定。',
  },
  {
    term: '量价洗盘',
    def: '近4周周量逐级放大，或突发放量后连续4日振幅/回撤/量能收敛。客观规则，非荐股。',
  },
  {
    term: 'MACD金叉',
    def: 'DIF/DEA(12,26,9)；最近 N 日内 DIF 上穿 DEA。本应用：显示距金叉日数与当前柱值。',
  },
  {
    term: '突破回踩',
    def: '突破近20/60日高点并放量，回踩不有效跌破支撑并企稳。本应用：技术条件卡。',
  },
  {
    term: '成交额/量',
    def: '成交额为金额合计，成交量为股数/手数口径依源而定；榜单用于横向对比情绪强弱。',
  },
  {
    term: '延时行情',
    def: '公开接口非券商 Level-2，可能延时数分钟；仅供学习，实盘请以券商为准。演示 K 线不计入技术命中。',
  },
  {
    term: '旧行情',
    def: '刚才成功拉到后存下来的报价。真源暂不可用时优先使用；可能已过时，不会伪装成最新。',
  },
  {
    term: '演示数据',
    def: '公开源与旧行情都不可用时的本地占位，不是真行情。演示价下单需强确认；绝不会标成最新。',
  },
]

const WATCHLIST_TERMS: Term[] = [
  {
    term: '自选',
    def: '你手动添加的关注代码列表，本地保存。本应用：输入代码回车添加；标签可筛核心/观察等。',
  },
  {
    term: '迷你走势',
    def: '行内近 5–20 日真实收盘序列小图。注意：点数不足或演示行情会弱化显示。',
  },
  {
    term: '提醒',
    def: '价格/涨跌等条件触发时 Toast 或系统通知。本应用：支持模板与稍后；免打扰见设置。',
  },
  {
    term: '数据态徽章',
    def: '最新 / 延时 / 旧行情 / 演示：标明报价来源可信度。注意：演示价勿当真实市价。',
  },
  {
    term: '一键模拟买入',
    def: '从图表把当前代码带入模拟盘下单页。本应用：不真下单，仅纸上练习。',
  },
  {
    term: '图表指标',
    def: 'MA / VOL / MACD 可开关叠加。展开「高级 · 图表术语」看各指标含义。',
  },
]

const PAPER_TERMS: Term[] = [
  {
    term: '纸上交易',
    def: '模拟账户用虚拟现金记账，不连券商。本应用：起始约 ¥100 万本位币 CNY。',
  },
  {
    term: '挂单',
    def: '限价单进入待成交队列。规则：买≤限价 / 卖≥限价时按限价演示成交。注意：非券商撮合。',
  },
  {
    term: '简易绩效',
    def: '按成交与净值快照估算收益、回撤、胜率等，可对照基准指数。注意：仅供练习对照。',
  },
  {
    term: '费率',
    def: '设置里的模拟佣金与印花税，成交时扣现金。本应用：默认约万三量级，可改。',
  },
  {
    term: '净值曲线',
    def: '每次刷新/成交写入的资产快照连线。本应用：快照少时提示继续交易或等刷新。',
  },
  {
    term: '成本摊薄',
    def: '多次买入按数量加权平均；卖出 FIFO 扣减，剩余成本不变。佣金/税进现金不摊进成本价。',
  },
]

const LIVE_TERMS: Term[] = [
  {
    term: '实盘导入',
    def: '你手动导入真实成交（CSV/粘贴/单笔），仅本机保存。注意：不是券商对接，不会上传。',
  },
  {
    term: '与模拟隔离',
    def: '实盘成交与模拟页账户完全分开，互不影响持仓与现金。',
  },
  {
    term: '分析概览',
    def: '按导入成交与当前行情估算已实现/浮动盈亏与集中度。注意：行情可能延时或演示。',
  },
  {
    term: '实盘 vs 模拟',
    def: '并排对照两边绩效卡片，便于复盘纪律差异。本应用：需两边都有数据才有意义。',
  },
  {
    term: '持仓对账',
    def: '按成交推算持仓，可记分红/送股备注做手工对账。本应用：备注仅本地。',
  },
  {
    term: '导出',
    def: '把分析结果导出 Markdown / CSV，便于外存或打印。本应用：顶栏按钮。',
  },
]

const BRIEF_TERMS: Term[] = [
  {
    term: '汇总分析',
    def: '基于已抓取新闻的规则短文归纳，非 AI 荐股。本应用：日报「汇总」分区。',
  },
  {
    term: '早盘表',
    def: '自选股隔夜价差、缺口、RVOL 与新闻命中标签。注意：无可靠数据会标注；非投资建议。',
  },
  {
    term: '新闻情绪',
    def: '对标题/摘要做简单正负中性标记，辅助扫读。注意：规则启发式，不是专业舆情。',
  },
  {
    term: '标题关键词',
    def: '新闻与自选的弱关联（标题命中代码/名称等）。注意：可能误匹配，已单独徽章标明。',
  },
  {
    term: '公开源',
    def: '人民日报财经、央视财经、华尔街见闻、BBC、美联储、东财板块等（均无密钥）。失败不伪造最新新闻。',
  },
  {
    term: '数据态',
    def: '每条可标最新/旧行情/演示。本应用：旧行情与演示不会伪装成最新。',
  },
]

const JOURNAL_TERMS: Term[] = [
  {
    term: '复盘模板',
    def: '结构化字段：计划、情绪、执行偏差、教训、标签、正文。本应用：可关联模拟成交。',
  },
  {
    term: '从成交生成',
    def: '用最近一笔模拟成交预填代码/标题草稿。本应用：顶栏或「最近成交」快捷按钮。',
  },
  {
    term: '情绪 1–5',
    def: '主观打分，帮助回顾交易时心态。注意：仅个人记录，无自动评分。',
  },
  {
    term: '执行偏差',
    def: '实际操作相对计划的差异（提前/追涨/未止损等）。本应用：自由文本。',
  },
  {
    term: '教训',
    def: '下次可改进的要点。本应用：导出 MD/CSV 时一并带出。',
  },
  {
    term: '标签筛选',
    def: '用逗号分隔标签，便于按主题过滤笔记。本应用：列表上方可筛选。',
  },
]

const SETTINGS_TERMS: Term[] = [
  {
    term: '最新',
    def: '公开源刚拉到的行情；免费接口仍可能短暂延迟，做不到券商 Level-2。短徽章写「最新」。',
  },
  {
    term: '延时',
    def: '源标明或通常有数分钟延迟（如 Yahoo）。短徽章写「延时」；实盘以券商为准。',
  },
  {
    term: '旧行情',
    def: '刚才存下的报价，真源暂不可用时优先用；可能过时，不会伪装成最新。',
  },
  {
    term: '演示',
    def: '本地占位假行情，不是真价。演示价下单需强确认；绝不会标成最新。',
  },
  {
    term: 'LLM',
    def: '可选 OpenAI 兼容总结（默认关）。API Key 仅本机；Pages 禁用 Key。输出非投资建议。',
  },
  {
    term: '系统通知',
    def: '价格/RVOL 提醒触发时推送（需授权且非免打扰）。不做微信/钉钉。',
  },
  {
    term: '备份',
    def: '导出/导入本机工作台 JSON。注意：清缓存会丢数据；LLM Key 不在备份中。',
  },
  {
    term: '检查更新',
    def: '拉取 Pages 上 app-update.json 比对版本；不强制、不静默升级。本应用：设置 → 关于/更新。',
  },
]

const GLOSSARIES: Record<GlossaryKind, { title: string; terms: Term[] }> = {
  order: { title: '下单术语', terms: ORDER_TERMS },
  chart: { title: '图表术语', terms: CHART_TERMS },
  volume: { title: '量能术语', terms: VOLUME_TERMS },
  screener: { title: '选股术语', terms: SCREENER_TERMS },
  watchlist: { title: '盯盘术语', terms: WATCHLIST_TERMS },
  paper: { title: '模拟术语', terms: PAPER_TERMS },
  live: { title: '实盘术语', terms: LIVE_TERMS },
  brief: { title: '日报术语', terms: BRIEF_TERMS },
  journal: { title: '复盘术语', terms: JOURNAL_TERMS },
  settings: { title: '设置术语', terms: SETTINGS_TERMS },
}

interface Props {
  kind: GlossaryKind
  /** compact：样式更紧凑；展开状态一律默认折叠，不挡主操作 */
  compact?: boolean
  /** 折叠按钮摘要文案（默认「展开了解 · {title}」） */
  summary?: string
  className?: string
}

export function Glossary({ kind, compact, summary, className = '' }: Props) {
  const [open, setOpen] = useState(false)
  const { title, terms } = GLOSSARIES[kind]
  const closedLabel = summary || `展开了解 · ${title}`

  return (
    <div className={`glossary ${compact ? 'compact' : ''} ${className}`.trim()}>
      <button
        type="button"
        className="glossary-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? '▾' : '▸'} {open ? `收起 · ${title}` : closedLabel}
      </button>
      {open && (
        <>
          <dl className="glossary-list">
            {terms.map((t) => (
              <div key={t.term} className="glossary-item">
                <dt>{t.term}</dt>
                <dd>{t.def}</dd>
              </div>
            ))}
          </dl>
          <p className="glossary-disclaimer muted">{DISCLAIMER}</p>
        </>
      )}
    </div>
  )
}
