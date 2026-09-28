import { useCallback, useEffect, useState } from 'react'
import { quoteService } from '../services/quotes'
import type { Quote } from '../types'

export function useQuotes(symbols: string[], intervalSec: number) {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [loading, setLoading] = useState(false)
  const [source, setSource] = useState('')
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (symbols.length === 0) {
      setQuotes({})
      return
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
    } catch (e) {
      setError(e instanceof Error ? e.message : '行情获取失败')
    } finally {
      setLoading(false)
    }
  }, [symbols.join('|')])

  useEffect(() => {
    refresh()
    if (intervalSec <= 0) return
    const t = setInterval(refresh, intervalSec * 1000)
    return () => clearInterval(t)
  }, [refresh, intervalSec])

  return { quotes, loading, source, error, refresh }
}
