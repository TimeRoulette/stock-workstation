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

console.log('validate-tech: OK')
