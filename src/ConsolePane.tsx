import { useEffect, useRef } from 'react'

export interface LogEntry {
  timestamp: number
  message: string
  type?: 'log' | 'warn' | 'error'
}

interface ConsolePaneProps {
  logs: LogEntry[]
}

export default function ConsolePane({ logs }: ConsolePaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  return (
    <div className="console-pane">
      <div className="pane-header">
        <span className="panel-title">Console</span>
      </div>
      <div className="console-output" ref={scrollRef}>
        {logs.length === 0 && <span className="muted">No output yet.</span>}
        {logs.map((log, i) => (
          <div key={i} className={`log-line ${log.type ?? 'log'}`}>
            <span className="log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
            <span className="log-msg">{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
