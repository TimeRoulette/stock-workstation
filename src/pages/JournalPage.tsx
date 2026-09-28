import { useEffect, useState } from 'react'
import * as db from '../services/db'
import type { JournalNote, Trade } from '../types'

interface Props {
  /** 外部指定要草稿的成交 id（成交后跳转） */
  draftTradeId?: number | null
  onDraftConsumed?: () => void
}

export function JournalPage({ draftTradeId, onDraftConsumed }: Props) {
  const [notes, setNotes] = useState<JournalNote[]>([])
  const [trades, setTrades] = useState<Trade[]>([])
  const [symbol, setSymbol] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tradeId, setTradeId] = useState<number | ''>('')
  const [editing, setEditing] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const reload = () => {
    setNotes(db.listJournalNotes(100))
    setTrades(db.listTrades({ limit: 40 }))
  }

  const applyDraft = (t: Trade) => {
    const d = db.draftJournalFromTrade(t)
    setTradeId(d.tradeId)
    setSymbol(d.symbol)
    setTitle(d.title)
    setBody(d.body)
    setEditing(null)
    setMsg('已从成交生成草稿，确认后点保存')
  }

  useEffect(() => {
    reload()
  }, [])

  // 外部跳转：指定成交草稿
  useEffect(() => {
    if (draftTradeId == null) return
    const t = db.listTrades({ limit: 100 }).find((x) => x.id === draftTradeId)
    if (t) applyDraft(t)
    onDraftConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftTradeId])

  // 进入页且表单空时：自动草稿最近一笔
  useEffect(() => {
    if (draftTradeId != null) return
    if (title || body || symbol) return
    const latest = db.getLatestTrade()
    if (latest) applyDraft(latest)
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = () => {
    try {
      if (editing != null) {
        db.updateJournalNote(editing, { symbol, title, body })
        setMsg('笔记已更新')
      } else {
        db.addJournalNote({
          symbol: symbol || 'GENERAL',
          title: title || '复盘',
          body,
          tradeId: tradeId === '' ? null : Number(tradeId),
        })
        setMsg('笔记已保存')
      }
      setTitle('')
      setBody('')
      setSymbol('')
      setTradeId('')
      setEditing(null)
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
    setTradeId(n.tradeId ?? '')
  }

  const clearForm = () => {
    setEditing(null)
    setTitle('')
    setBody('')
    setSymbol('')
    setTradeId('')
    setMsg(null)
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h2>复盘笔记</h2>
          <p className="subtitle">买卖逻辑本地保存 · 可关联成交 · 支持自动草稿</p>
        </div>
        <div className="toolbar">
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
                <input
                  className="input"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="600519.SH"
                />
              </div>
              <div className="form-row">
                <label>标题</label>
                <input
                  className="input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="今日复盘…"
                />
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
              <textarea
                className="input textarea"
                rows={8}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="写下理由、情绪、下次改进…"
              />
              <div className="toolbar" style={{ marginTop: 10 }}>
                <button className="btn primary" onClick={save}>
                  {editing != null ? '更新' : '保存'}
                </button>
                <button className="btn" onClick={clearForm}>
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
            <span className="muted">{notes.length}</span>
          </div>
          {notes.length === 0 ? (
            <div className="empty-state compact">
              <p>还没有复盘笔记。点「从最近成交生成」可一键草稿。</p>
            </div>
          ) : (
            <div className="journal-list">
              {notes.map((n) => (
                <article key={n.id} className="journal-card">
                  <div className="brief-meta">
                    <span className="mono">{n.symbol}</span>
                    {n.tradeId != null && <span className="badge">成交 #{n.tradeId}</span>}
                    <span>·</span>
                    <span>{new Date(n.updatedAt).toLocaleString('zh-CN')}</span>
                  </div>
                  <h3>{n.title}</h3>
                  <pre className="journal-body">{n.body || '（无正文）'}</pre>
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
