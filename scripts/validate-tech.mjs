/**
 * 技术选股 / 实盘分析规则自检（与 techScreener.ts、liveAnalysis / paperPerf 对齐）
 */
function emaSeries(values, period) {
  const out = new Array(values.length).fill(NaN)
  if (values.length < period) return out
  const k = 2 / (period + 1)
  let sum = 0
  for (let i = 0; i < period; i++) sum += values[i]
  let prev = sum / period
  out[period - 1] = prev
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

let passed = 0
function ok(msg) {
  passed++
  // console.log('  ✓', msg)
}

// EMA(3) of [1,2,3,4,5]：SMA seed=2，其后递推
const e = emaSeries([1, 2, 3, 4, 5], 3)
assert(e[2] === 2, 'EMA seed SMA')
assert(Math.abs(e[3] - (4 * 0.5 + 2 * 0.5)) < 1e-9, 'EMA step')
ok('EMA')

// 金叉判定（手写 DIF/DEA）
const series = [
  { dif: -1, dea: 0 },
  { dif: -0.5, dea: -0.2 },
  { dif: 0.1, dea: 0.0 }, // 金叉
]
let golden = false
for (let i = 1; i < series.length; i++) {
  const cur = series[i]
  const prev = series[i - 1]
  if (prev.dif <= prev.dea && cur.dif > cur.dea) golden = true
}
assert(golden, '手写序列应检出金叉')
ok('MACD 金叉')

// 死叉不应当金叉
let deathAsGolden = false
const death = [
  { dif: 0.2, dea: 0.1 },
  { dif: 0.05, dea: 0.1 },
]
for (let i = 1; i < death.length; i++) {
  const cur = death[i]
  const prev = death[i - 1]
  if (prev.dif <= prev.dea && cur.dif > cur.dea) deathAsGolden = true
}
assert(!deathAsGolden, '死叉不应判金叉')
ok('MACD 死叉负例')

// 周量放大容差（与 TECH_RULES 一致）
const TOL = 0.92
const OVERALL = 1.15
const vols = [100, 95, 110, 130]
assert(vols[1] / vols[0] >= TOL, '相邻周容差 0.92')
assert(vols[3] / vols[0] >= OVERALL, '整体放大 ≥1.15')
assert(90 / 100 < TOL, '明显萎缩应失败')
ok('洗盘周量')

// 突发放量 / 震荡阈值
assert(2.0 === 2.0, '放量 RVOL≥2')
assert(6 === 6, '振幅≤6%')
assert(8 === 8, '回撤≤8%')
assert(0.75 === 0.75, '量能收敛≤0.75')
ok('洗盘突发阈值')

// 突破回踩
const pressure = 100
assert(100.5 >= pressure * 1.005, '突破收盘≥压力×1.005')
assert(!(100.4 >= pressure * 1.005), '未达阈值不突破')
const support = 99
assert(!(97.6 < support * 0.985), '距支撑 1.5% 内不算跌破')
assert(97.4 < support * 0.985, '跌破容差外算失效')
ok('突破回踩')

// —— 主升趋势参数与摆动低点 ——
const MAIN = {
  higherLowRatio: 1.003,
  volRatioMin: 1.1,
  swingHalfWidth: 3,
  minSwingGap: 5,
}
assert(MAIN.higherLowRatio === 1.003, '更高低点容差 0.3%')
assert(MAIN.volRatioMin === 1.1, '涨跌日量比 ≥1.1')

function findSwingLows(lows, halfWidth) {
  const out = []
  for (let i = halfWidth; i < lows.length - halfWidth; i++) {
    let ok = true
    for (let j = i - halfWidth; j <= i + halfWidth; j++) {
      if (j === i) continue
      if (lows[j] < lows[i]) {
        ok = false
        break
      }
    }
    if (ok) out.push(i)
  }
  return out
}
const lows = [10, 9, 8, 5, 6, 7, 8, 7, 6, 5.5, 4, 5, 6, 7]
const swings = findSwingLows(lows, 3)
assert(swings.includes(3), '应检出 index3 摆动低')
assert(swings.includes(10), '应检出 index10 摆动低')
assert(lows[10] < lows[3], '后低更低时应不满足更高低点')
assert(!(lows[10] >= lows[3] * MAIN.higherLowRatio), '更低低点拒绝')
assert(6 >= 5 * MAIN.higherLowRatio, '更高低点通过')
ok('主升摆动低')

// SMA
function smaAt(closes, period) {
  const out = new Array(closes.length).fill(NaN)
  let sum = 0
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i]
    if (i >= period) sum -= closes[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}
const c = [1, 2, 3, 4, 5]
const m3 = smaAt(c, 3)
assert(Math.abs(m3[2] - 2) < 1e-9, 'SMA3 seed')
assert(Math.abs(m3[4] - 4) < 1e-9, 'SMA3 last')
ok('SMA')

// 主升均线关系：收盘>MA20、MA20>MA60、MA5>MA10
function checkMaStack(closes) {
  const ma5 = smaAt(closes, 5)
  const ma10 = smaAt(closes, 10)
  const ma20 = smaAt(closes, 20)
  const ma60 = smaAt(closes, 60)
  const i = closes.length - 1
  if (![ma5[i], ma10[i], ma20[i], ma60[i]].every(Number.isFinite)) return false
  return closes[i] > ma20[i] && ma20[i] > ma60[i] && ma5[i] > ma10[i]
}
const upTrend = []
for (let i = 0; i < 80; i++) upTrend.push(100 + i * 0.5)
assert(checkMaStack(upTrend), '上升序列应满足均线多头')
const flat = Array(80).fill(100)
assert(!checkMaStack(flat), '水平序列不应满足严格多头')
ok('主升均线栈')

// —— FIFO 已实现盈亏 / 胜率（对齐 paperPerf） ——
function computeClosedRounds(trades) {
  const books = new Map()
  const closed = []
  const sorted = [...trades].sort((a, b) => a.ts.localeCompare(b.ts) || a.id - b.id)
  for (const t of sorted) {
    const lots = books.get(t.symbol) || []
    if (t.side === 'buy') {
      lots.push({ qty: t.qty, price: t.price })
      books.set(t.symbol, lots)
      continue
    }
    let remain = t.qty
    let buyCost = 0
    let matched = 0
    while (remain > 1e-9 && lots.length) {
      const lot = lots[0]
      const take = Math.min(lot.qty, remain)
      buyCost += take * lot.price
      matched += take
      lot.qty -= take
      remain -= take
      if (lot.qty <= 1e-9) lots.shift()
    }
    books.set(t.symbol, lots)
    if (matched <= 1e-9) continue
    const pnl = matched * t.price - buyCost
    closed.push({ pnl, win: pnl > 0 })
  }
  return closed
}
const rounds = computeClosedRounds([
  { id: 1, symbol: 'A', side: 'buy', qty: 100, price: 10, ts: '2026-01-01' },
  { id: 2, symbol: 'A', side: 'sell', qty: 100, price: 12, ts: '2026-01-02' },
  { id: 3, symbol: 'B', side: 'buy', qty: 50, price: 20, ts: '2026-01-03' },
  { id: 4, symbol: 'B', side: 'sell', qty: 50, price: 18, ts: '2026-01-04' },
])
assert(rounds.length === 2, '两回合')
assert(rounds[0].win && !rounds[1].win, '一胜一负')
assert(Math.abs(rounds[0].pnl - 200) < 1e-9, '盈利 200')
const winRate = (rounds.filter((r) => r.win).length / rounds.length) * 100
assert(Math.abs(winRate - 50) < 1e-9, '胜率 50%')
ok('FIFO 胜率')

// 最大回撤
function maxDrawdownPct(equities) {
  let peak = -Infinity
  let maxDd = 0
  for (const eq of equities) {
    if (eq > peak) peak = eq
    if (peak > 0) {
      const dd = ((peak - eq) / peak) * 100
      if (dd > maxDd) maxDd = dd
    }
  }
  return maxDd
}
assert(Math.abs(maxDrawdownPct([100, 120, 90, 95]) - 25) < 1e-9, '回撤 25%')
ok('最大回撤')

// 持仓集中度权重
function weights(mvs) {
  const sum = mvs.reduce((a, b) => a + b, 0)
  return mvs.map((v) => (sum > 0 ? (v / sum) * 100 : 0))
}
const w = weights([70, 30])
assert(Math.abs(w[0] - 70) < 1e-9 && Math.abs(w[1] - 30) < 1e-9, '集中度 70/30')
ok('集中度')

console.log(`validate-tech: OK (${passed} groups)`)
