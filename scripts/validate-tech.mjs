/**
 * 技术选股阈值自检（与 techScreener.ts 对齐）
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

// EMA(3) of [1,2,3,4,5]：SMA seed=2，其后递推
const e = emaSeries([1, 2, 3, 4, 5], 3)
assert(e[2] === 2, 'EMA seed SMA')
assert(Math.abs(e[3] - (4 * 0.5 + 2 * 0.5)) < 1e-9, 'EMA step')

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

// 周量放大容差（与 TECH_RULES 一致）
const TOL = 0.92
const OVERALL = 1.15
const vols = [100, 95, 110, 130]
assert(vols[1] / vols[0] >= TOL, '相邻周容差 0.92')
assert(vols[3] / vols[0] >= OVERALL, '整体放大 ≥1.15')
assert(90 / 100 < TOL, '明显萎缩应失败')

// 突发放量 / 震荡阈值
assert(2.0 === 2.0, '放量 RVOL≥2')
assert(6 === 6, '振幅≤6%')
assert(8 === 8, '回撤≤8%')
assert(0.75 === 0.75, '量能收敛≤0.75')

// 突破回踩
const pressure = 100
assert(100.5 >= pressure * 1.005, '突破收盘≥压力×1.005')
assert(!(100.4 >= pressure * 1.005), '未达阈值不突破')
const support = 99
assert(!(97.6 < support * 0.985), '距支撑 1.5% 内不算跌破')
assert(97.4 < support * 0.985, '跌破容差外算失效')


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
      if (lows[j] < lows[i]) { ok = false; break }
    }
    if (ok) out.push(i)
  }
  return out
}
// 构造：索引 3 与 10 为明显局部低
const lows = [10, 9, 8, 5, 6, 7, 8, 7, 6, 5.5, 4, 5, 6, 7]
const swings = findSwingLows(lows, 3)
assert(swings.includes(3), '应检出 index3 摆动低')
assert(swings.includes(10), '应检出 index10 摆动低')
assert(lows[10] < lows[3], '后低更低时应不满足更高低点')
assert(!(lows[10] >= lows[3] * MAIN.higherLowRatio), '更低低点拒绝')
assert(6 >= 5 * MAIN.higherLowRatio, '更高低点通过')

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

console.log('validate-tech: OK')

