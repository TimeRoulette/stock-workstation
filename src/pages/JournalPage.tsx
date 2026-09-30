import { useEffect, useMemo, useState } from 'react'
import * as db from '../services/db'
import type { JournalNote, Trade } from '../types'

function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

interface Props {
  draftTradeId?: number | null
  onDraftConsumed?: () => void
}

export function JournalPage({ draftTradeId, onDraftConsumed }: Props) {
  const [notes, setNotes] = useState<JournalNote[]>([])
  const [trades, setTrades] = useState<Trade[]>([])
  const [symbol, setSymbol] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [plan, setPlan] = useState('')
  const [emotion, setEmotion] = useState(3)
  const [deviation, setDeviation] = useState('')
  const [lesson, setLesson] = useState('')
  const [tags, setTags] = useState('')
  const [tradeId, setTradeId] = useState<number | ''>('')
  const [editing, setEditing] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [filterTag, setFilterTag] = useState('')
  const [filterSymbol, setFilterSymbol] = useState('')

  const reload = () => {
    setNotes(db.listJournalNotes(200))
    setTrades(db.listTrades({ limit: 40 }))
  }

  const applyDraft = (t: Trade) => {
    const d = db.draftJournalFromTrade(t)
    setTradeId(d.tradeId!)
    setSymbol(d.symbol)
    setTitle(d.title)
    setBody(d.body || '')
    setPlan(d.plan || '')
    setEmotion(d.emotion && d.emotion > 0 ? d.emotion : 3)
    setDeviation(d.deviation || '')
    setLesson(d.lesson || '')
    setTags(d.tags || '')
    setEditing(null)
    setMsg('已从成交生成草稿，填写模板字段后保存')
  }

  useEffect(() => {
    reload()
  }, [])

  useEffect(() => {
    if (draftTradeId == null) return
    const t = db.listTrades({ limit: 100 }).find((x) => x.id === draftTradeId)
    if (t) applyDraft(t)
    onDraftConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftTradeId])

  useEffect(() => {
    if (draftTradeId != null) return
    if (title || body || symbol || plan) return
    const latest = db.getLatestTrade()
    if (latest) applyDraft(latest)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const allTags = useMemo(() => {
    const s = new Set<string>()
    for (const n of notes) {
      for (const t of (n.tags || '').split(/[,，\s]+/)) {
        if (t.trim()) s.add(t.trim())
      }
    }
    return [...s].sort()
  }, [notes])

  const filtered = useMemo(() => {
    return notes.filter((n) => {
      if (filterSymbol && !n.symbol.toUpperCase().includes(filterSymbol.toUpperCase())) return false
      if (filterTag) {
        const tags = (n.tags || '').split(/[,，\s]+/).map((x) => x.trim())
        if (!tags.includes(filterTag)) return false
      }
      return true
    })
  }, [notes, filterTag, filterSymbol])

  const save = () => {
    try {
      const payload = {
        symbol: symbol || 'GENERAL',
        title: title || '复盘',
        body,
        tradeId: tradeId === '' ? null : Number(tradeId),
        plan,
        emotion,
        deviation,
        lesson,
        tags: tags.trim(),
      }
      if (editing != null) {
        db.updateJournalNote(editing, payload)
        setMsg('笔记已更新')
      } else {
        db.addJournalNote(payload)
        setMsg('笔记已保存')
      }
      clearForm(false)
      reload()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败')
    }
  }

  const startEdit = (n: JournalNote) => {
    setEditing(n.id)
    setSymbol(n.symbol)
    setTitle(n.title)
    setBody(n.body)
    setPlan(n.plan || '')
    setEmotion(n.emotion || 0)
    setDeviation(n.deviation || '')
    setLesson(n.lesson || '')
    setTags(n.tags || '')
    setTradeId(n.tradeId ?? '')
  }

  const clearForm = (clearMsg = true) => {
    setEditing(null)
    setTitle('')
    setBody('')
    setSymbol('')
    setTradeId('')
    setPlan('')
    setEmotion(3)
    setDeviation('')
    setLesson('')
    setTags('')
    if (clearMsg) setMsg(null)
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h2>复盘笔记</h2>
          <p className="subtitle">结构化模板 · 可关联成交 · 导出 Markdown / CSV</p>
        </div>
        <div className="toolbar">
          <button
            className="btn"
            onClick={() => downloadText('journal.md', db.exportJournalMarkdown(filtered), 'text/markdown;charset=utf-8')}
          >
            导出 MD
          </button>
          <button
            className="btn"
            onClick={() => downloadText('journal.csv', db.exportJournalCsv(filtered), 'text/csv;charset=utf-8')}
          >
            导出 CSV
          </button>
          <button
            className="btn primary"
            onClick={() => {
              const latest = db.getLatestTrade()
              if (!latest) {
                setMsg('暂无成交，请先去模拟下单')
                return
              }
              applyDraft(latest)
            }}
          >
            从最近成交生成
          </button>
        </div>
      </header>
      <div className="page-body">
        <div className="grid-2">
          <div className="panel">
            <div className="panel-header">{editing != null ? `编辑 #${editing}` : '写笔记'}</div>
            <div className="panel-body">
              <div className="form-row">
                <label>代码</label>
                <input className="input" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="600519.SH" />
              </div>
              <div className="form-row">
                <label>标题</label>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="今日复盘…" />
              </div>
              <div className="form-row">
                <label>关联成交</label>
                <select
                  className="select"
                  value={tradeId === '' ? '' : String(tradeId)}
                  onChange={(e) => {
                    const id = e.target.value ? Number(e.target.value) : ''
                    setTradeId(id)
                    if (id !== '') {
                      const t = trades.find((x) => x.id === id)
                      if (t) applyDraft(t)
                    }
                  }}
                >
                  <option value="">无</option>
                  {trades.map((t) => (
                    <option key={t.id} value={t.id}>
                      #{t.id} {t.side === 'buy' ? '买' : '卖'} {t.symbol} ×{t.qty}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label>计划</label>
                <textarea className="input textarea" rows={2} value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="交易计划…" />
              </div>
              <div className="form-row">
                <label>情绪 1–5</label>
                <div className="seg-control">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" className={emotion === n ? 'active' : ''} onClick={() => setEmotion(n)}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-row">
                <label>执行偏差</label>
                <textarea className="input textarea" rows={2} value={deviation} onChange={(e) => setDeviation(e.target.value)} placeholder="与计划的差异…" />
              </div>
              <div className="form-row">
                <label>教训</label>
                <textarea className="input textarea" rows={2} value={lesson} onChange={(e) => setLesson(e.target.value)} placeholder="下次改进…" />
              </div>
              <div className="form-row">
                <label>标签</label>
                <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="短线, 突破（逗号分隔）" />
              </div>
              <textarea
                className="input textarea"
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="补充正文…"
              />
              <div className="toolbar" style={{ marginTop: 10 }}>
                <button className="btn primary" onClick={save}>
                  {editing != null ? '更新' : '保存'}
                </button>
                <button className="btn" onClick={() => clearForm()}>
                  清空
                </button>
              </div>
              {msg && <p className="msg-ok">{msg}</p>}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <span>最近成交 · 快捷复盘</span>
            </div>
            {trades.length === 0 ? (
              <div className="empty-state compact">
                <p>暂无成交。去「模拟」或盯盘「一键模拟买入」后再回来。</p>
              </div>
            ) : (
              <table className="data dense">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>方向</th>
                    <th>代码</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {trades.slice(0, 12).map((t) => (
                    <tr key={t.id} style={{ cursor: 'default' }}>
                      <td className="muted" style={{ fontSize: 11 }}>
                        {new Date(t.ts).toLocaleString('zh-CN')}
                      </td>
                      <td className={t.side === 'buy' ? 'up' : 'down'}>{t.side === 'buy' ? '买' : '卖'}</td>
                      <td className="mono">
                        {t.symbol}
                        <div className="muted" style={{ fontSize: 11 }}>
                          ×{t.qty} @{t.price}
                        </div>
                      </td>
                      <td>
                        <button className="btn btn-xs" onClick={() => applyDraft(t)}>
                          写复盘
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-header">
            <span>全部笔记</span>
            <div className="toolbar">
              <input
                className="input compact"
                style={{ maxWidth: 120 }}
                placeholder="筛代码"
                value={filterSymbol}
                onChange={(e) => setFilterSymbol(e.target.value)}
              />
              <select className="select compact" value={filterTag} onChange={(e) => setFilterTag(e.target.value)}>
                <option value="">全部标签</option>
                {allTags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <span className="muted">
                {filtered.length}/{notes.length}
              </span>
            </div>
          </div>
          {filtered.length === 0 ? (
            <div className="empty-state compact">
              <p>还没有复盘笔记，或筛选无结果。点「从最近成交生成」可一键草稿。</p>
            </div>
          ) : (
            <div className="journal-list">
              {filtered.map((n) => (
                <article key={n.id} className="journal-card">
                  <div className="brief-meta">
                    <span className="mono">{n.symbol}</span>
                    {n.tradeId != null && <span className="badge">成交 #{n.tradeId}</span>}
                    {n.emotion > 0 && <span className="badge">情绪 {n.emotion}/5</span>}
                    {n.tags &&
                      n.tags.split(/[,，\s]+/).filter(Boolean).map((t) => (
                        <span key={t} className="topic-chip">
                          {t}
                        </span>
                      ))}
                    <span>·</span>
                    <span>{new Date(n.updatedAt).toLocaleString('zh-CN')}</span>
                  </div>
                  <h3>{n.title}</h3>
                  {n.plan && (
                    <p className="journal-field">
                      <strong>计划</strong> {n.plan}
                    </p>
                  )}
                  {n.deviation && (
                    <p className="journal-field">
                      <strong>偏差</strong> {n.deviation}
                    </p>
                  )}
                  {n.lesson && (
                    <p className="journal-field">
                      <strong>教训</strong> {n.lesson}
                    </p>
                  )}
                  {n.body && <pre className="journal-body">{n.body}</pre>}
                  <div className="toolbar">
                    <button className="btn btn-xs" onClick={() => startEdit(n)}>
                      编辑
                    </button>
                    <button
                      className="btn danger btn-xs"
                      onClick={() => {
                        db.deleteJournalNote(n.id)
                        reload()
                      }}
                    >
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
