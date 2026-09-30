import { useCallback, useEffect, useRef, useState } from 'react'
import { peekCachedQuotes, quoteService } from '../services/quotes'
import { normalizeSymbol } from '../services/quoteSymbols'
import type { Quote } from '../types'

function dispatchQuotes(map: Record<string, Quote>, fetching = false) {
  try {
    window.dispatchEvent(
      new CustomEvent('sw:quotes-updated', { detail: { quotes: map, fetching } }),
    )
  } catch {
    /* */
  }
}

export function useQuotes(symbols: string[], intervalSec: number) {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [loading, setLoading] = useState(false)
  const [source, setSource] = useState('')
  const [error, setError] = useState<string | null>(null)
  const quotesRef = useRef(quotes)
  quotesRef.current = quotes

  const refresh = useCallback(async () => {
    if (symbols.length === 0) {
      setQuotes({})
      dispatchQuotes({}, false)
      return
    }

    // 首屏：先掏本地旧行情，避免空白或立刻「演示」
    try {
      const cached = peekCachedQuotes(symbols)
      if (cached.length > 0) {
        const seeded: Record<string, Quote> = { ...quotesRef.current }
        for (const q of cached) {
          const cur = seeded[q.symbol]
          // 已有真源则不覆盖；无或 mock/cache 可用更完整缓存顶上
          if (!cur || cur.source === 'mock' || cur.source === 'cache') {
            seeded[q.symbol] = q
          }
        }
        setQuotes(seeded)
        dispatchQuotes(seeded, true)
      } else {
        dispatchQuotes(quotesRef.current, true)
      }
    } catch {
      dispatchQuotes(quotesRef.current, true)
    }

    setLoading(true)
    setError(null)
    try {
      const list = await quoteService.fetchQuotes(symbols)
      const map: Record<string, Quote> = {}
      list.forEach((q) => {
        map[q.symbol] = q
      })
      setQuotes(map)
      setSource(await quoteService.activeSourceLabel())
      dispatchQuotes(map, false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '行情获取失败')
      // 失败时尽量保留已有非 mock；若全空再标结束拉取
      dispatchQuotes(quotesRef.current, false)
    } finally {
      setLoading(false)
    }
  }, [symbols.map((s) => normalizeSymbol(s).symbol).join('|')])

  useEffect(() => {
    refresh()
    if (intervalSec <= 0) return
    const t = setInterval(refresh, intervalSec * 1000)
    return () => clearInterval(t)
  }, [refresh, intervalSec])

  return { quotes, loading, source, error, refresh }
}
