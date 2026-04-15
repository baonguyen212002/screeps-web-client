import { useEffect, useRef, useState } from 'react'

export interface LogEntry {
  timestamp: number
  message: string
  type?: 'log' | 'warn' | 'error' | 'system'
}

interface ConsolePaneProps {
  logs: LogEntry[]
  onCommand?: (expression: string) => void
  onClear?: () => void
}

export default function ConsolePane({ logs, onCommand, onClear }: ConsolePaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [input, setInput] = useState('')
  const [filter, setFilter] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [autoScroll, setAutoScroll] = useState(true)

  const filterLower = filter.toLowerCase()
  const filtered = filter
    ? logs.filter((l) => l.message.toLowerCase().includes(filterLower))
    : logs

  useEffect(() => {
    if (autoScroll && scrollRef.current && !filter) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, autoScroll, filter])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32
    setAutoScroll(atBottom)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const expr = input.trim()
    if (!expr) return
    onCommand?.(expr)
    setHistory((h) => [expr, ...h].slice(0, 50))
    setHistoryIdx(-1)
    setInput('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.min(historyIdx + 1, history.length - 1)
      setHistoryIdx(next)
      setInput(history[next] ?? '')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = historyIdx - 1
      if (next < 0) { setHistoryIdx(-1); setInput('') }
      else { setHistoryIdx(next); setInput(history[next] ?? '') }
    }
  }

  return (
    <div className="console-pane">
      <div className="pane-header">
        <span className="panel-title">Console</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1, marginLeft: 10 }}>
          <input
            className="console-filter-input"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            spellCheck={false}
          />
          {filter && (
            <span className="muted" style={{ fontSize: '0.7rem', flexShrink: 0 }}>
              {filtered.length}/{logs.length}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 6 }}>
          {!autoScroll && !filter && (
            <button
              className="btn-ghost compact"
              onClick={() => {
                setAutoScroll(true)
                if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
              }}
            >↓</button>
          )}
          <button
            className="btn-ghost compact"
            onClick={onClear}
            title="Clear output"
          >✕</button>
        </div>
      </div>

      <div className="console-output" ref={scrollRef} onScroll={handleScroll}>
        {filtered.length === 0 && (
          <span className="muted">
            {filter ? `No messages matching "${filter}"` : 'No output yet. Try running your code or typing a command below.'}
          </span>
        )}
        {filtered.map((log, i) => (
          <div key={i} className={`log-line ${log.type ?? 'log'}`}>
            <span className="log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
            <span className="log-msg" dangerouslySetInnerHTML={{ __html: log.message.replace(/</g, '&lt;').replace(/>/g, '&gt;') }} />
          </div>
        ))}
      </div>

      <form className="console-input-row" onSubmit={handleSubmit}>
        <span className="console-prompt">&gt;</span>
        <input
          ref={inputRef}
          className="console-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. Game.creeps['Creep1'].pos"
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className="btn-ghost compact" disabled={!input.trim()}>Run</button>
      </form>
    </div>
  )
}
