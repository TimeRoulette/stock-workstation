import type { Market, QuoteSource } from '../types'

/** 内部统一代码：600519.SH / 000001.SZ / 00700.HK / AAPL */
export function normalizeSymbol(raw: string): { symbol: string; market: Market } {
  let s = raw.trim().toUpperCase().replace(/\s+/g, '')
  if (!s) return { symbol: '', market: 'US' }

  const prefix = s.match(/^(SH|SZ|HK)(\d{1,6})$/)
  if (prefix) {
    const m = prefix[1] as Market
    const code = prefix[2]
    if (m === 'HK') return { symbol: `${code.padStart(5, '0')}.HK`, market: 'HK' }
    return { symbol: `${code.padStart(6, '0')}.${m}`, market: m }
  }

  if (s.endsWith('.SH') || s.endsWith('.SS')) {
    const code = s.replace(/\.(SH|SS)$/, '').padStart(6, '0')
    return { symbol: `${code}.SH`, market: 'SH' }
  }
  if (s.endsWith('.SZ')) {
    const code = s.replace(/\.SZ$/, '').padStart(6, '0')
    return { symbol: `${code}.SZ`, market: 'SZ' }
  }
  if (s.endsWith('.HK')) {
    const code = s.replace(/\.HK$/, '').replace(/^0+/, '') || '0'
    return { symbol: `${code.padStart(5, '0')}.HK`, market: 'HK' }
  }

  if (/^\d{6}$/.test(s)) {
    if (s.startsWith('6') || s.startsWith('9')) return { symbol: `${s}.SH`, market: 'SH' }
    return { symbol: `${s}.SZ`, market: 'SZ' }
  }

  if (/^\d{4,5}$/.test(s)) {
    return { symbol: `${s.padStart(5, '0')}.HK`, market: 'HK' }
  }

  return { symbol: s, market: 'US' }
}

export function toYahooSymbol(symbol: string): string {
  const { symbol: s, market } = normalizeSymbol(symbol)
  if (market === 'SH') return s.replace('.SH', '.SS')
  if (market === 'SZ') return s
  if (market === 'HK') {
    const code = s.replace('.HK', '').replace(/^0+/, '') || '0'
    return `${code.padStart(4, '0')}.HK`
  }
  return s
}

export function toEastmoneySecid(symbol: string): string | null {
  const { symbol: s, market } = normalizeSymbol(symbol)
  if (market === 'SH') return `1.${s.replace('.SH', '')}`
  if (market === 'SZ') return `0.${s.replace('.SZ', '')}`
  if (market === 'HK') {
    const code = s.replace('.HK', '').replace(/^0+/, '') || '0'
    return `116.${code.padStart(5, '0')}`
  }
  return null
}

export function toSinaListCode(symbol: string): string | null {
  const { symbol: s, market } = normalizeSymbol(symbol)
  if (market === 'SH') return `sh${s.replace('.SH', '')}`
  if (market === 'SZ') return `sz${s.replace('.SZ', '')}`
  if (market === 'HK') {
    const code = s.replace('.HK', '').replace(/^0+/, '') || '0'
    return `rt_hk${code.padStart(5, '0')}`
  }
  return null
}

export function detectMarket(symbol: string): Market {
  return normalizeSymbol(symbol).market
}

export function currencyFor(symbol: string): string {
  const m = detectMarket(symbol)
  if (m === 'HK') return 'HKD'
  if (m === 'US') return 'USD'
  return 'CNY'
}

export function lotSize(symbol: string): number {
  const m = detectMarket(symbol)
  return m === 'SH' || m === 'SZ' ? 100 : 1
}

export function sourceBadgeLabel(source: QuoteSource): string {
  switch (source) {
    case 'eastmoney':
      return '东财'
    case 'sina':
      return '新浪'
    case 'ths':
      return '同花顺'
    case 'yahoo':
      return 'Yahoo'
    case 'cache':
      return '缓存'
    default:
      return '模拟'
  }
}

/** 简单 FX 提示（非实时汇率，仅展示用） */
export const FX_HINT: Record<string, { vsCny: number; note: string }> = {
  CNY: { vsCny: 1, note: '记账本位币' },
  HKD: { vsCny: 0.92, note: '示意汇率 ≈0.92，非实时' },
  USD: { vsCny: 7.2, note: '示意汇率 ≈7.2，非实时' },
}

export function toCnyHint(amount: number, currency: string): string {
  const fx = FX_HINT[currency] || FX_HINT.CNY
  if (currency === 'CNY') return ''
  return `≈¥${(amount * fx.vsCny).toFixed(0)}（${fx.note}）`
}

