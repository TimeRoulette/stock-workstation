/**
 * 日报新闻聚合：多源公开 RSS/API（无密钥）+ 自选关联 + 早盘分区
 * Pages 无 Vite 代理：直连 → rss2json / corsproxy → 缓存 → 示意降级
 */
import type {
  BriefDataStatus,
  BriefItem,
  BriefMatchMode,
  BriefSentiment,
  BriefSection,
  ProviderHealth,
  WatchlistItem,
} from '../types'

/** 本地轻量规范化，避免与 quotes.ts 循环依赖 */
function normalizeSymbol(raw: string): { symbol: string } {
  let s = raw.trim().toUpperCase().replace(/\s+/g, '')
  if (!s) return { symbol: '' }
  if (s.endsWith('.SH') || s.endsWith('.SS')) {
    const code = s.replace(/\.(SH|SS)$/, '').padStart(6, '0')
    return { symbol: `${code}.SH` }
  }
  if (s.endsWith('.SZ')) {
    return { symbol: `${s.replace(/\.SZ$/, '').padStart(6, '0')}.SZ` }
  }
  if (s.endsWith('.HK')) {
    const code = s.replace(/\.HK$/, '').replace(/^0+/, '') || '0'
    return { symbol: `${code.padStart(5, '0')}.HK` }
  }
  if (/^\d{6}$/.test(s)) {
    if (s.startsWith('6') || s.startsWith('9')) return { symbol: `${s}.SH` }
    return { symbol: `${s}.SZ` }
  }
  if (/^\d{4,5}$/.test(s)) return { symbol: `${s.padStart(5, '0')}.HK` }
  return { symbol: s }
}

const TIMEOUT_MS = 7000
const CACHE_TTL_MS = 8 * 60 * 1000
const CACHE_KEY = 'sw-brief-news-v1'

type RawNews = {
  id: string
  title: string
  summary: string
  source: string
  publishedAt: string
  url?: string
  topics: string[]
  dataStatus: BriefDataStatus
}

type HealthInternal = {
  status: ProviderHealth['status']
  latencyMs: number | null
  lastOkAt: string | null
  lastError: string | null
  message: string
}

const healthMap: Record<string, HealthInternal> = {
  people: { status: 'unknown', latencyMs: null, lastOkAt: null, lastError: null, message: '尚未探测' },
  yangshi: { status: 'unknown', latencyMs: null, lastOkAt: null, lastError: null, message: '尚未探测' },
  eastmoney_brief: { status: 'unknown', latencyMs: null, lastOkAt: null, lastError: null, message: '尚未探测' },
  wscn: { status: 'unknown', latencyMs: null, lastOkAt: null, lastError: null, message: '尚未探测' },
  bbc: { status: 'unknown', latencyMs: null, lastOkAt: null, lastError: null, message: '尚未探测' },
  fed: { status: 'unknown', latencyMs: null, lastOkAt: null, lastError: null, message: '尚未探测' },
}

const HEALTH_LABELS: Record<string, string> = {
  people: '人民日报 · 财经',
  yangshi: '央视财经',
  eastmoney_brief: '东财 · 板块榜',
  wscn: '华尔街见闻',
  bbc: 'BBC Business',
  fed: '美联储 · 新闻稿',
}

function markHealth(id: string, ok: boolean, latencyMs: number, err?: string) {
  const h = healthMap[id]
  if (!h) return
  h.latencyMs = latencyMs
  if (ok) {
    h.status = latencyMs > 5000 ? 'degraded' : 'ok'
    h.lastOkAt = new Date().toISOString()
    h.lastError = null
    h.message = `正常 · ${latencyMs}ms`
  } else {
    h.status = 'down'
    h.lastError = err || '失败'
    h.message = err || '请求失败'
  }
}

export function getBriefHealth(): ProviderHealth[] {
  return Object.keys(HEALTH_LABELS).map((id) => ({
    id,
    label: HEALTH_LABELS[id],
    ...healthMap[id],
  }))
}

function isElectronRuntime(): boolean {
  return Boolean(
    typeof window !== 'undefined' &&
      (window as Window & { stockWorkstation?: { isElectron?: boolean } }).stockWorkstation?.isElectron,
  )
}

function candidateUrls(devProxy: string, absolute: string): string[] {
  if (import.meta.env.DEV) return [devProxy]
  if (isElectronRuntime()) return [absolute]
  return [absolute, `https://corsproxy.io/?${encodeURIComponent(absolute)}`]
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res
  } catch (e) {
    clearTimeout(timer)
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error(`超时 ${timeoutMs}ms`)
    throw e instanceof Error ? e : new Error('请求失败')
  }
}

async function fetchFirstOk(urls: string[], init: RequestInit = {}): Promise<Response> {
  let lastErr: unknown
  for (const url of urls) {
    try {
      return await fetchWithTimeout(url, init)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('全部候选失败')
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function titleKey(title: string): string {
  return title.replace(/\s+/g, '').replace(/[，。！？、：；""''【】\[\]()（）]/g, '').slice(0, 36)
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatPub(raw: string | undefined | null): string {
  if (!raw) return todayStr()
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) {
    const d2 = new Date(String(raw).replace(/-/g, '/'))
    if (!Number.isNaN(d2.getTime())) {
      return `${d2.getFullYear()}-${String(d2.getMonth() + 1).padStart(2, '0')}-${String(d2.getDate()).padStart(2, '0')} ${String(d2.getHours()).padStart(2, '0')}:${String(d2.getMinutes()).padStart(2, '0')}`
    }
    return String(raw).slice(0, 16) || todayStr()
  }
  // 用户时区 Asia/Shanghai（箱内已是 +8）
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}`
}

function parseRssItems(
  xml: string,
  limit = 8,
): Array<{ title: string; summary: string; url?: string; publishedAt: string }> {
  const items: Array<{ title: string; summary: string; url?: string; publishedAt: string }> = []
  const blocks = xml.split(/<item[\s>]/i).slice(1)
  for (const block of blocks) {
    const chunk = block.split(/<\/item>/i)[0] || ''
    const titleM = chunk.match(/<title[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/title>/i)
    const descM = chunk.match(/<description[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/description>/i)
    const linkM = chunk.match(/<link[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/link>/i)
    const dateM = chunk.match(/<pubDate[^>]*>([^<]*)<\/pubDate>/i)
    const title = stripHtml((titleM?.[1] || titleM?.[2] || '').trim())
    if (!title) continue
    const summary = stripHtml((descM?.[1] || descM?.[2] || '').trim()).slice(0, 180)
    const url = (linkM?.[1] || linkM?.[2] || '').trim() || undefined
    items.push({ title, summary: summary || title, url, publishedAt: formatPub(dateM?.[1]) })
    if (items.length >= limit) break
  }
  return items
}

async function fetchRssViaRelay(
  rssUrl: string,
  limit = 6,
): Promise<Array<{ title: string; summary: string; url?: string; publishedAt: string }>> {
  const relay =
    'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(rssUrl)
  const res = await fetchWithTimeout(relay, {
    headers: { Accept: 'application/json' },
  })
  const json = await res.json()
  const arr: Array<Record<string, unknown>> = json?.items || []
  if (!Array.isArray(arr) || arr.length === 0) throw new Error('rss2json 无条目')
  return arr.slice(0, limit).map((it) => ({
    title: stripHtml(String(it.title || '')),
    summary: stripHtml(String(it.description || it.content || it.title || '')).slice(0, 180),
    url: String(it.link || '') || undefined,
    publishedAt: formatPub(String(it.pubDate || '')),
  }))
}

/** 主题关键词：用于分区与宏观标签（规则匹配，非 NLP） */
const TOPIC_RULES: Array<{ topic: string; section: BriefSection; keys: string[] }> = [
  {
    topic: '央行/利率',
    section: 'overnight',
    keys: ['央行', '降息', '加息', '利率', '美联储', 'Fed', 'FOMC', 'LPR', '准备金', '货币政策', '欧央行', '日银', 'yield', 'rate cut', 'rate hike'],
  },
  {
    topic: '地缘局势',
    section: 'overnight',
    keys: ['地缘', '制裁', '冲突', '战争', '中东', '台海', '俄乌', '朝鲜', '关税', '贸易战', '制裁', 'nato', 'ukraine', 'gaza'],
  },
  {
    topic: '商品/汇率',
    section: 'overnight',
    keys: ['原油', '黄金', '铜', '铁矿', '汇率', '人民币', '美元', '离岸', '在岸', '油价', '金价', 'commodity', 'forex', 'oil', 'gold', 'USD', 'CNY'],
  },
  {
    topic: '美股',
    section: 'overnight',
    keys: ['美股', '纳斯达克', '道指', '标普', '华尔街', '纳指', 'NYSE', 'Nasdaq', 'S&P', 'Dow'],
  },
  {
    topic: '港股',
    section: 'focus',
    keys: ['港股', '恒生', '港交所', '南向', '北向', '恒指', 'H股'],
  },
  {
    topic: 'A股',
    section: 'focus',
    keys: ['A股', '沪指', '深成指', '创业板', '科创板', '两市', '沪深', '北交所', '证监会', '上交所', '深交所'],
  },
  {
    topic: '国际宏观',
    section: 'overnight',
    keys: ['GDP', '通胀', 'CPI', 'PPI', '非农', '失业', '衰退', '景气', 'PMI', 'IMF', '世界银行', 'inflation', 'payroll'],
  },
]

function detectTopics(title: string, summary: string): { topics: string[]; section: BriefSection } {
  const text = `${title} ${summary}`
  const topics: string[] = []
  let section: BriefSection = 'general'
  for (const rule of TOPIC_RULES) {
    if (rule.keys.some((k) => text.toLowerCase().includes(k.toLowerCase()))) {
      topics.push(rule.topic)
      if (section === 'general') section = rule.section
    }
  }
  return { topics, section }
}

/** 股票 → 行业/别名标签（用于标题关键词关联） */
const SYMBOL_TAGS: Record<string, string[]> = {
  '600519.SH': ['茅台', '贵州茅台', '白酒', '消费'],
  '000858.SZ': ['五粮液', '白酒', '消费'],
  '000001.SZ': ['平安银行', '银行', '金融'],
  '601318.SH': ['中国平安', '保险', '金融'],
  '300750.SZ': ['宁德时代', '锂电', '新能源', '电池'],
  '002594.SZ': ['比亚迪', '新能源车', '汽车', '电动车'],
  '601012.SH': ['隆基', '光伏', '硅片'],
  '688981.SH': ['中芯国际', '半导体', '芯片'],
  '00700.HK': ['腾讯', '互联网', '游戏', '社交'],
  '09988.HK': ['阿里', '阿里巴巴', '电商', '互联网'],
  '03690.HK': ['美团', '本地生活', '外卖'],
  AAPL: ['苹果', 'Apple', 'iPhone', '科技'],
  TSLA: ['特斯拉', 'Tesla', '电动车', '新能源车'],
  NVDA: ['英伟达', 'NVIDIA', 'GPU', 'AI', '芯片'],
  MSFT: ['微软', 'Microsoft', '科技'],
  GOOGL: ['谷歌', 'Google', 'Alphabet'],
  BABA: ['阿里', '阿里巴巴', '电商'],
  PDD: ['拼多多', '电商'],
}

const BULLISH_KEYS = [
  '增长', '超预期', '利好', '上涨', '突破', '扩产', '中标', '签约', '回购', '降息', '宽松', '复苏',
  '创新高', '盈利', '分红', '获批', '合作', 'rally', 'surge', 'beat', 'upgrade', 'cut rates',
]
const BEARISH_KEYS = [
  '下跌', '不及预期', '利空', '制裁', '调查', '处罚', '亏损', '下调', '加息', '收紧', '衰退',
  '暴跌', '减持', '违约', '召回', '诉讼', 'plunge', 'miss', 'downgrade', 'hike', 'recession', 'sanction',
]

export function inferSentiment(title: string, summary: string): { sentiment: BriefSentiment; note: string } {
  const text = `${title} ${summary}`
  const bull = BULLISH_KEYS.filter((k) => text.toLowerCase().includes(k.toLowerCase()))
  const bear = BEARISH_KEYS.filter((k) => text.toLowerCase().includes(k.toLowerCase()))
  if (bull.length > bear.length) {
    return {
      sentiment: 'bullish',
      note: `标题/摘要含偏积极词（${bull.slice(0, 3).join('、')}），规则化标注「偏利好方向」，非预测。`,
    }
  }
  if (bear.length > bull.length) {
    return {
      sentiment: 'bearish',
      note: `标题/摘要含偏消极词（${bear.slice(0, 3).join('、')}），规则化标注「偏利空方向」，非预测。`,
    }
  }
  if (bull.length && bear.length) {
    return { sentiment: 'watch', note: '标题同时含积极与消极词，建议人工阅读原文后判断。' }
  }
  return { sentiment: 'neutral', note: '未命中明显情绪词，标为中性关注。' }
}

export interface WatchMatchInput {
  symbol: string
  name: string
  tag?: string
}

export function matchWatchlist(
  title: string,
  summary: string,
  watch: WatchMatchInput[],
): { symbols: string[]; matchMode: BriefMatchMode; note: string } {
  if (!watch.length) return { symbols: [], matchMode: 'none', note: '' }
  const text = `${title} ${summary}`
  const textLower = text.toLowerCase()
  const hitSym: string[] = []
  const hitKw: string[] = []
  const hitInd: string[] = []

  for (const w of watch) {
    const { symbol } = normalizeSymbol(w.symbol)
    const code = symbol.replace(/\.(SH|SZ|HK)$/i, '')
    const name = (w.name || '').trim()
    const tags = SYMBOL_TAGS[symbol] || []
    const extras = [w.tag || ''].filter(Boolean)

    // 精确：代码或全名出现
    if (
      (code && (text.includes(code) || textLower.includes(symbol.toLowerCase()))) ||
      (name && name.length >= 2 && text.includes(name))
    ) {
      hitSym.push(symbol)
      continue
    }
    // 别名 / 行业标签
    const nameHits = tags.filter((t) => t.length >= 2 && textLower.includes(t.toLowerCase()))
    if (nameHits.length) {
      // 区分公司别名 vs 宽行业
      const companyLike = nameHits.filter((t) => !['白酒', '银行', '金融', '新能源', '半导体', '芯片', '互联网', '电商', '科技', '光伏', '锂电', '电池', '汽车', '电动车', '消费', '保险', '游戏', '社交', '本地生活', '外卖', '硅片'].includes(t))
      if (companyLike.length) {
        hitKw.push(symbol)
      } else {
        hitInd.push(symbol)
      }
      continue
    }
    for (const ex of extras) {
      if (ex.length >= 2 && text.includes(ex)) {
        hitInd.push(symbol)
        break
      }
    }
  }

  if (hitSym.length) {
    return {
      symbols: [...new Set(hitSym)].slice(0, 5),
      matchMode: 'symbol',
      note: '正文/标题出现代码或股票名称',
    }
  }
  if (hitKw.length) {
    return {
      symbols: [...new Set(hitKw)].slice(0, 5),
      matchMode: 'title_keyword',
      note: '标题关键词关联（别名匹配），非精确事件绑定',
    }
  }
  if (hitInd.length) {
    return {
      symbols: [...new Set(hitInd)].slice(0, 5),
      matchMode: 'industry',
      note: '标题关键词关联（行业/主题标签），仅供研究对照',
    }
  }
  return { symbols: [], matchMode: 'none', note: '' }
}

function dedupeRaw(items: RawNews[]): RawNews[] {
  const seen = new Set<string>()
  const out: RawNews[] = []
  for (const it of items) {
    const k = titleKey(it.title)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(it)
  }
  return out
}

/* ---------- 各源拉取 ---------- */

async function fetchPeopleDaily(): Promise<RawNews[]> {
  const t0 = performance.now()
  try {
    let parsed: Array<{ title: string; summary: string; url?: string; publishedAt: string }> = []
    try {
      parsed = await fetchRssViaRelay('https://www.people.com.cn/rss/finance.xml', 6)
    } catch {
      const urls = candidateUrls(
        '/api/people-rss/rss/finance.xml',
        'https://www.people.com.cn/rss/finance.xml',
      )
      const res = await fetchFirstOk(urls, {
        headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' },
      })
      parsed = parseRssItems(await res.text(), 6)
    }
    parsed = parsed.filter((x) => x.title)
    if (!parsed.length) throw new Error('无条目')
    markHealth('people', true, Math.round(performance.now() - t0))
    return parsed.map((it, i) => {
      const { topics } = detectTopics(it.title, it.summary)
      return {
        id: `people-${i}-${titleKey(it.title).slice(0, 10)}`,
        title: it.title,
        summary: it.summary || it.title,
        source: '人民日报 · 财经',
        publishedAt: it.publishedAt,
        url: it.url,
        topics: topics.length ? topics : ['A股'],
        dataStatus: 'live' as const,
      }
    })
  } catch (e) {
    markHealth('people', false, Math.round(performance.now() - t0), e instanceof Error ? e.message : '失败')
    return []
  }
}

function loadJsonpFixedCallback(url: string, callbackName: string, timeoutMs = 7000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('无 DOM'))
      return
    }
    const w = window as unknown as Record<string, unknown>
    const prev = w[callbackName]
    const script = document.createElement('script')
    let settled = false
    const timer = window.setTimeout(() => cleanup(new Error('JSONP 超时')), timeoutMs)
    function cleanup(err?: Error, data?: unknown) {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      script.remove()
      if (prev !== undefined) w[callbackName] = prev
      else delete w[callbackName]
      if (err) reject(err)
      else resolve(data)
    }
    w[callbackName] = (data: unknown) => cleanup(undefined, data)
    script.onerror = () => cleanup(new Error('JSONP 加载失败'))
    script.src = url
    document.head.appendChild(script)
  })
}

async function fetchYangshi(): Promise<RawNews[]> {
  const t0 = performance.now()
  try {
    let list: Array<Record<string, unknown>> = []
    if (import.meta.env.DEV) {
      const res = await fetchWithTimeout(
        '/api/cctv-news/2019/07/gaiban/cmsdatainterface/page/economy_1.jsonp',
        { headers: { Accept: 'application/json' } },
      )
      const body = await res.text()
      const start = body.indexOf('(')
      const end = body.lastIndexOf(')')
      if (start < 0 || end <= start) throw new Error('JSONP 解析失败')
      const json = JSON.parse(body.slice(start + 1, end)) as { data?: { list?: Array<Record<string, unknown>> } }
      list = json?.data?.list || []
    } else {
      const data = (await loadJsonpFixedCallback(
        'https://news.cctv.com/2019/07/gaiban/cmsdatainterface/page/economy_1.jsonp',
        'economy',
        7000,
      )) as { data?: { list?: Array<Record<string, unknown>> } }
      list = data?.data?.list || []
    }
    if (!list.length) throw new Error('无条目')
    markHealth('yangshi', true, Math.round(performance.now() - t0))
    return list
      .slice(0, 6)
      .map((row, i) => {
        const title = stripHtml(String(row.title || ''))
        const brief = stripHtml(String(row.brief || '')).slice(0, 180)
        const { topics } = detectTopics(title, brief)
        return {
          id: `yangshi-${i}-${titleKey(title).slice(0, 10)}`,
          title,
          summary: brief || title,
          source: '央视财经',
          publishedAt: formatPub(String(row.focus_date || '')),
          url: String(row.url || '') || undefined,
          topics: topics.length ? topics : ['A股'],
          dataStatus: 'live' as const,
        }
      })
      .filter((x) => x.title)
  } catch (e) {
    markHealth('yangshi', false, Math.round(performance.now() - t0), e instanceof Error ? e.message : '失败')
    return []
  }
}

async function fetchEastmoneyBoards(): Promise<RawNews[]> {
  const t0 = performance.now()
  try {
    const path =
      '/api/qt/clist/get?pn=1&pz=8&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=f12,f14,f3,f62'
    const abs = `https://push2delay.eastmoney.com${path}`
    const urls = candidateUrls(`/api/eastmoney-delay${path}`, abs)
    if (!import.meta.env.DEV && !isElectronRuntime()) {
      urls.push(`https://corsproxy.io/?${encodeURIComponent(abs)}`)
    }
    const res = await fetchFirstOk(urls, { headers: { Accept: 'application/json' } })
    const json = await res.json()
    const diffs: Array<Record<string, unknown>> = json?.data?.diff || []
    if (!diffs.length) throw new Error('榜单空')
    markHealth('eastmoney_brief', true, Math.round(performance.now() - t0))
    const day = todayStr()
    return diffs.slice(0, 6).map((row, i) => {
      const code = String(row.f12 || '')
      const name = String(row.f14 || code)
      const pct = Number(row.f3) || 0
      const title = `${name}板块异动 ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
      const summary = `东财公开行业榜：${name} 涨跌幅 ${pct.toFixed(2)}%。延迟行情，仅供研究。`
      return {
        id: `em-board-${i}-${code}`,
        title,
        summary,
        source: '东方财富 · 公开榜',
        publishedAt: day,
        url: undefined,
        topics: ['A股'],
        dataStatus: 'live' as const,
      }
    })
  } catch (e) {
    markHealth('eastmoney_brief', false, Math.round(performance.now() - t0), e instanceof Error ? e.message : '失败')
    return []
  }
}

/** 华尔街见闻 · 全球快讯（公开 JSON，无密钥） */
async function fetchWscn(): Promise<RawNews[]> {
  const t0 = performance.now()
  try {
    const path = '/apiv1/content/information-flow?channel=global-channel&client=pc&limit=12&accept=article'
    const abs = `https://api-one-wscn.awtmt.com${path}`
    const urls = candidateUrls(`/api/wscn${path}`, abs)
    const res = await fetchFirstOk(urls, { headers: { Accept: 'application/json' } })
    const json = await res.json()
    const items: Array<Record<string, unknown>> = json?.data?.items || json?.data || []
    const articles: RawNews[] = []
    for (const wrap of items) {
      const res_ = (wrap.resource || wrap) as Record<string, unknown>
      const title = stripHtml(String(res_.title || res_.content_text || ''))
      if (!title || title.length < 4) continue
      const summary = stripHtml(String(res_.content_short || res_.summary || res_.content_text || title)).slice(0, 180)
      const uri = String(res_.uri || res_.url || '')
      const url = uri
        ? uri.startsWith('http')
          ? uri
          : `https://wallstreetcn.com${uri.startsWith('/') ? '' : '/'}${uri}`
        : undefined
      const ts = Number(res_.display_time || res_.created_at || 0)
      const publishedAt = ts > 0 ? formatPub(new Date(ts * (ts < 1e12 ? 1000 : 1)).toISOString()) : todayStr()
      const { topics, section } = detectTopics(title, summary)
      articles.push({
        id: `wscn-${titleKey(title).slice(0, 12)}`,
        title,
        summary,
        source: '华尔街见闻',
        publishedAt,
        url,
        topics: topics.length ? topics : section === 'overnight' ? ['国际宏观'] : ['国际宏观'],
        dataStatus: 'live',
      })
      if (articles.length >= 8) break
    }
    if (!articles.length) throw new Error('无条目')
    markHealth('wscn', true, Math.round(performance.now() - t0))
    return articles
  } catch (e) {
    markHealth('wscn', false, Math.round(performance.now() - t0), e instanceof Error ? e.message : '失败')
    return []
  }
}

async function fetchBbcBusiness(): Promise<RawNews[]> {
  const t0 = performance.now()
  try {
    const parsed = await fetchRssViaRelay('https://feeds.bbci.co.uk/news/business/rss.xml', 6)
    const ok = parsed.filter((x) => x.title)
    if (!ok.length) throw new Error('无条目')
    markHealth('bbc', true, Math.round(performance.now() - t0))
    return ok.map((it, i) => {
      const { topics } = detectTopics(it.title, it.summary)
      return {
        id: `bbc-${i}-${titleKey(it.title).slice(0, 10)}`,
        title: it.title,
        summary: it.summary || it.title,
        source: 'BBC Business',
        publishedAt: it.publishedAt,
        url: it.url,
        topics: topics.length ? topics : ['国际宏观', '美股'],
        dataStatus: 'live' as const,
      }
    })
  } catch (e) {
    markHealth('bbc', false, Math.round(performance.now() - t0), e instanceof Error ? e.message : '失败')
    return []
  }
}

async function fetchFedPress(): Promise<RawNews[]> {
  const t0 = performance.now()
  try {
    const parsed = await fetchRssViaRelay('https://www.federalreserve.gov/feeds/press_all.xml', 5)
    const ok = parsed.filter((x) => x.title)
    if (!ok.length) throw new Error('无条目')
    markHealth('fed', true, Math.round(performance.now() - t0))
    return ok.map((it, i) => ({
      id: `fed-${i}-${titleKey(it.title).slice(0, 10)}`,
      title: it.title,
      summary: it.summary || it.title,
      source: '美联储 · 新闻稿',
      publishedAt: it.publishedAt,
      url: it.url,
      topics: ['央行/利率', '国际宏观'],
      dataStatus: 'live' as const,
    }))
  } catch (e) {
    markHealth('fed', false, Math.round(performance.now() - t0), e instanceof Error ? e.message : '失败')
    return []
  }
}

/* ---------- 缓存 ---------- */

function readCache(): RawNews[] | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { ts: number; items: RawNews[] }
    if (!parsed?.ts || !Array.isArray(parsed.items)) return null
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null
    return parsed.items.map((x) => ({ ...x, dataStatus: 'cached' as const }))
  } catch {
    return null
  }
}

function writeCache(items: RawNews[]) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), items }))
  } catch {
    /* quota */
  }
}

/* ---------- 组装早盘日报 ---------- */

function sentimentLabel(s: BriefSentiment): string {
  if (s === 'bullish') return '偏利好'
  if (s === 'bearish') return '偏利空'
  if (s === 'watch') return '需关注'
  return '中性'
}

function toBriefItem(
  raw: RawNews,
  watch: WatchMatchInput[],
  forceSection?: BriefSection,
): BriefItem {
  const match = matchWatchlist(raw.title, raw.summary, watch)
  const sent = inferSentiment(raw.title, raw.summary)
  const { section: autoSection } = detectTopics(raw.title, raw.summary)
  let section: BriefSection = forceSection || autoSection
  if (match.symbols.length && section === 'general') section = 'watchlist'

  let summary = raw.summary
  if (match.matchMode === 'title_keyword' || match.matchMode === 'industry') {
    summary = `【标题关键词关联】${match.note}。${summary}`
  }
  if (match.symbols.length) {
    summary += ` 规则摘要（${sentimentLabel(sent.sentiment)}）：${sent.note}`
  }

  return {
    id: raw.id,
    title: raw.title,
    summary,
    source: raw.source,
    category: match.symbols.length ? 'trend' : 'news',
    publishedAt: raw.publishedAt,
    url: raw.url,
    symbols: match.symbols.length ? match.symbols : undefined,
    jumpTo: 'watchlist',
    dataStatus: raw.dataStatus,
    matchMode: match.symbols.length ? match.matchMode : 'none',
    sentiment: match.symbols.length ? sent.sentiment : sent.sentiment,
    sentimentNote: sent.note,
    section,
    topics: raw.topics,
  }
}

function buildMetaItems(
  watch: WatchMatchInput[],
  holdings: Array<{ symbol: string; name: string; qty: number }>,
  liveCount: number,
  usedCache: boolean,
): BriefItem[] {
  const day = todayStr()
  const items: BriefItem[] = []
  const statusNote = usedCache
    ? '部分或全部来自本地缓存（约 8 分钟内）'
    : liveCount > 0
      ? `已聚合 ${liveCount} 条公开源实时条目`
      : '公开源暂不可用，下列为示意骨架'

  items.push({
    id: 'meta-premarket',
    title: '盘前概览',
    summary: `${statusNote}。关注隔夜美股/欧股、美元与商品、央行表态；A 股开盘看高开低开与量能。仅供研究，不构成投资建议。`,
    source: '工作台 · 早盘',
    category: 'tip',
    publishedAt: day,
    dataStatus: liveCount > 0 ? (usedCache ? 'cached' : 'live') : 'sample',
    section: 'premarket',
    matchMode: 'none',
  })

  if (holdings.length > 0) {
    const holdLabel =
      holdings
        .slice(0, 4)
        .map((h) => `${h.name || h.symbol}×${h.qty}`)
        .join('、') + (holdings.length > 4 ? '…' : '')
    items.push({
      id: 'hold-today',
      title: `模拟持仓速览：${holdings.length} 只`,
      summary: `当前纸上持仓：${holdLabel}。点代码进「模拟」；关联新闻见下方「自选影响」。`,
      source: '工作台 · 持仓',
      category: 'holding',
      publishedAt: day,
      symbols: holdings.slice(0, 5).map((h) => h.symbol),
      jumpTo: 'portfolio',
      dataStatus: 'live',
      section: 'holding',
      matchMode: 'symbol',
    })
  }

  const focus = watch.slice(0, 5)
  items.push({
    id: 'meta-watch',
    title: focus.length ? `自选关注：${focus.map((w) => w.name || w.symbol).join('、')}` : '自选关注',
    summary: focus.length
      ? '下方「自选影响」按标题关键词/代码/行业标签关联公开新闻；无法可靠匹配时显示「暂无可靠关联新闻」，不会捏造。'
      : '添加自选后，将按名称/代码/行业标签尝试关联公开新闻。',
    source: '工作台 · 自选',
    category: 'trend',
    publishedAt: day,
    symbols: focus.map((w) => w.symbol),
    jumpTo: 'watchlist',
    dataStatus: 'live',
    section: 'watchlist',
    matchMode: 'none',
  })

  return items
}

function sampleFallbackNews(): RawNews[] {
  const day = todayStr()
  return [
    {
      id: 'sample-1',
      title: '（示意）隔夜美股科技股分化，关注利率预期',
      summary: '此为示意条目，非实时新闻。公开源不可用时占位；请稍后刷新。',
      source: '示意 · 非实时',
      publishedAt: day,
      topics: ['美股', '央行/利率'],
      dataStatus: 'sample',
    },
    {
      id: 'sample-2',
      title: '（示意）国内财经日历：关注政策与流动性表述',
      summary: '示意占位。接入人民日报/央视/见闻等源后将替换为真实标题与链接。',
      source: '示意 · 非实时',
      publishedAt: day,
      topics: ['A股'],
      dataStatus: 'sample',
    },
  ]
}

export interface BriefProvider {
  id: string
  fetchBrief(
    watchSymbols?: string[],
    holdings?: Array<{ symbol: string; name: string; qty: number }>,
    watchItems?: Array<Pick<WatchlistItem, 'symbol' | 'name' | 'tag'>>,
  ): Promise<BriefItem[]>
}

export async function aggregateBrief(
  watchItems: Array<Pick<WatchlistItem, 'symbol' | 'name' | 'tag'>> = [],
  holdings: Array<{ symbol: string; name: string; qty: number }> = [],
): Promise<BriefItem[]> {
  const watch: WatchMatchInput[] = watchItems.map((w) => ({
    symbol: normalizeSymbol(w.symbol).symbol,
    name: w.name,
    tag: w.tag,
  }))

  const results = await Promise.all([
    fetchPeopleDaily(),
    fetchYangshi(),
    fetchEastmoneyBoards(),
    fetchWscn(),
    fetchBbcBusiness(),
    fetchFedPress(),
  ])
  let remote = dedupeRaw(results.flat())
  let usedCache = false

  if (remote.length === 0) {
    const cached = readCache()
    if (cached && cached.length) {
      remote = cached
      usedCache = true
    }
  } else {
    writeCache(remote)
  }

  const liveCount = remote.filter((r) => r.dataStatus === 'live').length
  const meta = buildMetaItems(watch, holdings, liveCount || (usedCache ? remote.length : 0), usedCache)

  if (remote.length === 0) {
    remote = sampleFallbackNews()
  }

  // 分区组装
  const overnight: BriefItem[] = []
  const focus: BriefItem[] = []
  const watchlistHits: BriefItem[] = []
  const general: BriefItem[] = []

  for (const raw of remote) {
    const item = toBriefItem(raw, watch)
    if (item.matchMode && item.matchMode !== 'none' && item.symbols?.length) {
      watchlistHits.push({ ...item, section: 'watchlist', category: 'trend' })
    }
    if (item.section === 'overnight' || (item.topics || []).some((t) => ['央行/利率', '地缘局势', '商品/汇率', '美股', '国际宏观'].includes(t))) {
      overnight.push({ ...item, section: 'overnight' })
    } else if (item.section === 'focus' || (item.topics || []).some((t) => ['A股', '港股'].includes(t))) {
      focus.push({ ...item, section: 'focus' })
    } else {
      general.push(item)
    }
  }

  // 自选无命中时明确提示
  const watchSection: BriefItem[] = []
  if (watch.length > 0) {
    if (watchlistHits.length === 0) {
      watchSection.push({
        id: 'watch-empty',
        title: '自选影响：暂无可靠关联新闻',
        summary:
          '当前聚合新闻的标题/摘要未能与自选代码、名称或已知行业标签可靠匹配，故不展示牵强关联，亦不编造个股新闻。可稍后刷新，或扩大自选名称完整性。',
        source: '工作台 · 关联',
        category: 'tip',
        publishedAt: todayStr(),
        symbols: watch.slice(0, 5).map((w) => w.symbol),
        jumpTo: 'watchlist',
        dataStatus: liveCount > 0 || usedCache ? (usedCache ? 'cached' : 'live') : 'sample',
        section: 'watchlist',
        matchMode: 'none',
        sentiment: 'neutral',
      })
    } else {
      watchSection.push(...watchlistHits.slice(0, 10))
    }
  }

  const disclaimer: BriefItem = {
    id: 'disclaimer',
    title: '声明：仅供研究，不构成投资建议',
    summary:
      '情绪标签与关联均为标题关键词规则，非 AI 精确预测，亦非荐股。公开源常有延迟；状态见各条「实时/缓存/示意」。',
    source: '工作台',
    category: 'tip',
    publishedAt: todayStr(),
    dataStatus: 'live',
    section: 'general',
    matchMode: 'none',
  }

  // 顺序：盘前/持仓/自选说明 → 隔夜全球 → 今日关注 → 自选影响 → 其余 → 声明
  const ordered = [
    ...meta,
    ...overnight.slice(0, 10),
    ...focus.slice(0, 8),
    ...watchSection,
    ...general.slice(0, 6),
    disclaimer,
  ]

  // 去重（meta 与新闻标题可能撞）
  const seen = new Set<string>()
  const out: BriefItem[] = []
  for (const it of ordered) {
    const k = it.id.startsWith('meta') || it.id.startsWith('hold') || it.id.startsWith('watch') || it.id === 'disclaimer'
      ? it.id
      : titleKey(it.title)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(it)
  }
  return out
}

export const morningBriefProvider: BriefProvider = {
  id: 'multi-rss+wscn',
  async fetchBrief(watchSymbols = [], holdings = [], watchItems) {
    const items =
      watchItems && watchItems.length > 0
        ? watchItems
        : watchSymbols.map((s) => {
            const { symbol } = normalizeSymbol(s)
            return { symbol, name: symbol, tag: '' }
          })
    return aggregateBrief(items, holdings)
  },
}

let briefProvider: BriefProvider = morningBriefProvider

export function setBriefProvider(p: BriefProvider) {
  briefProvider = p
}

export function getBriefProvider() {
  return briefProvider
}

/** 设置页探测：并行轻量拉各源 */
export async function probeBriefSources(): Promise<ProviderHealth[]> {
  await Promise.all([
    fetchPeopleDaily(),
    fetchYangshi(),
    fetchEastmoneyBoards(),
    fetchWscn(),
    fetchBbcBusiness(),
    fetchFedPress(),
  ])
  return getBriefHealth()
}
