import { useState, useCallback, useEffect } from 'react'

type InspectedObject = {
  _id: string
  type: string
  name?: string
  [key: string]: unknown
}

interface MemoryPaneProps {
  onFetch: (path?: string) => Promise<string>
  onSave: (path: string, valueJson: string) => Promise<void>
  onWatch: (path: string) => void
  onUnwatch: () => void
  watchedPath: string
  watchedValue: string | null
  onFetchSegment: (segment: number) => Promise<string>
  onSaveSegment: (segment: number, data: string) => Promise<void>
  navigatePath?: string | null
  onNavigateConsumed?: () => void
  inspectedObject?: InspectedObject | null
  onClearInspected?: () => void
}

// ── JSON tree node ──────────────────────────────────────────────────────────

function JsonNode({ data, depth = 0 }: { data: unknown; depth?: number }) {
  const [open, setOpen] = useState(depth < 2)

  if (data === null) return <span className="jv-null">null</span>
  if (data === undefined) return <span className="jv-null">undefined</span>
  if (typeof data === 'boolean') return <span className="jv-bool">{String(data)}</span>
  if (typeof data === 'number') return <span className="jv-num">{data}</span>
  if (typeof data === 'string') return <span className="jv-str">"{data}"</span>

  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="jv-bracket">[]</span>
    if (!open) return <span className="jv-toggle" onClick={() => setOpen(true)}>[{data.length}] ▶</span>
    return (
      <span>
        <span className="jv-toggle" onClick={() => setOpen(false)}>▼ [</span>
        <div className="jv-indent">
          {data.map((v, i) => (
            <div key={i} className="jv-line">
              <span className="jv-idx">{i}:</span>&thinsp;<JsonNode data={v} depth={depth + 1} />
            </div>
          ))}
        </div>
        <span className="jv-bracket">]</span>
      </span>
    )
  }

  const entries = Object.entries(data as object)
  if (entries.length === 0) return <span className="jv-bracket">{'{}'}</span>
  if (!open) return <span className="jv-toggle" onClick={() => setOpen(true)}>{'{…' + entries.length + '}'} ▶</span>
  return (
    <span>
      <span className="jv-toggle" onClick={() => setOpen(false)}>▼ {'{'}</span>
      <div className="jv-indent">
        {entries.map(([k, v]) => (
          <div key={k} className="jv-line">
            <span className="jv-key">"{k}"</span>:&thinsp;<JsonNode data={v} depth={depth + 1} />
          </div>
        ))}
      </div>
      <span className="jv-bracket">{'}'}</span>
    </span>
  )
}

// ── MemoryPane ──────────────────────────────────────────────────────────────

export default function MemoryPane({
  onFetch, onSave, onWatch, onUnwatch, watchedPath, watchedValue,
  onFetchSegment, onSaveSegment, navigatePath, onNavigateConsumed,
  inspectedObject, onClearInspected,
}: MemoryPaneProps) {
  const [mode, setMode] = useState<'memory' | 'segment' | 'object'>('memory')

  // ── Memory mode state ──
  const [path, setPath] = useState('')
  const [rawJson, setRawJson] = useState<string | null>(null)
  const [parsed, setParsed] = useState<unknown>(null)
  const [editBuf, setEditBuf] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [watching, setWatching] = useState(false)
  const [saveOk, setSaveOk] = useState(false)

  // ── Segment mode state ──
  const [segNum, setSegNum] = useState(0)
  const [segData, setSegData] = useState<string | null>(null)
  const [segEditBuf, setSegEditBuf] = useState('')
  const [segEditing, setSegEditing] = useState(false)
  const [segSaveOk, setSegSaveOk] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const parseDisplay = useCallback((json: string) => {
    // Handle undefined/null/empty/error responses from server
    if (!json || json === 'undefined' || json === 'null' || json === 'Incorrect memory path') {
      setParsed(null)
      setRawJson('null')
      setEditBuf('null')
      setError(json === 'Incorrect memory path' ? 'Path does not exist yet' : '')
      return
    }
    try {
      const obj = JSON.parse(json)
      setParsed(obj)
      setRawJson(json)
      setEditBuf(JSON.stringify(obj, null, 2))
      setError('')
    } catch {
      setParsed(null)
      setRawJson(json)
      setEditBuf(json)
      setError('Invalid JSON')
    }
  }, [])

  useEffect(() => {
    if (inspectedObject) {
      setMode('object')
      onNavigateConsumed?.()
      // Also fetch memory if path exists
      if (navigatePath) {
        setPath(navigatePath)
        setLoading(true)
        setError('')
        onFetch(navigatePath)
          .then((raw) => { parseDisplay(raw) })
          .catch(() => { parseDisplay('null') })
          .finally(() => { setLoading(false) })
      }
    } else if (navigatePath) {
      setMode('memory')
      setPath(navigatePath)
      onNavigateConsumed?.()
      setLoading(true)
      setError('')
      onFetch(navigatePath)
        .then((raw) => { parseDisplay(raw) })
        .catch(() => { parseDisplay('null') })
        .finally(() => { setLoading(false) })
    }
  }, [navigatePath, inspectedObject, onFetch, onNavigateConsumed, parseDisplay])

  // ── Memory handlers ──

  async function handleFetch() {
    setLoading(true)
    setError('')
    try {
      const raw = await onFetch(path || undefined)
      parseDisplay(raw)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Fetch failed'
      if (/incorrect.*path|not found/i.test(msg)) {
        parseDisplay('null')
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setLoading(true)
    setError('')
    setSaveOk(false)
    try {
      JSON.parse(editBuf)
      await onSave(path, editBuf)
      parseDisplay(editBuf)
      setIsEditing(false)
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setLoading(false)
    }
  }

  function toggleWatch() {
    if (watching) {
      onUnwatch()
      setWatching(false)
    } else {
      const watchPath = path.trim()
      if (!watchPath) { setError('Enter a path to watch'); return }
      onWatch(watchPath)
      setWatching(true)
    }
  }

  // ── Segment handlers ──

  async function handleSegFetch() {
    setLoading(true)
    setError('')
    try {
      const data = await onFetchSegment(segNum)
      setSegData(data)
      setSegEditBuf(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fetch failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleSegSave() {
    setLoading(true)
    setError('')
    setSegSaveOk(false)
    try {
      await onSaveSegment(segNum, segEditBuf)
      setSegData(segEditBuf)
      setSegEditing(false)
      setSegSaveOk(true)
      setTimeout(() => setSegSaveOk(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setLoading(false)
    }
  }

  const liveDisplay = watching && watchedPath === path.trim() ? watchedValue : null

  // ── Render ──

  return (
    <div className="memory-pane">
      <div className="pane-header">
        <div style={{ display: 'flex', gap: 2 }}>
          {inspectedObject && (
            <button
              className={`btn-ghost compact ${mode === 'object' ? 'tab-active' : ''}`}
              onClick={() => { setMode('object'); setError('') }}
            >{inspectedObject.type}: {inspectedObject.name ?? inspectedObject._id.slice(0, 8)}</button>
          )}
          <button
            className={`btn-ghost compact ${mode === 'memory' ? 'tab-active' : ''}`}
            onClick={() => { setMode('memory'); setError('') }}
          >Memory</button>
          <button
            className={`btn-ghost compact ${mode === 'segment' ? 'tab-active' : ''}`}
            onClick={() => { setMode('segment'); setError('') }}
          >Segment</button>
        </div>
        {(saveOk || segSaveOk) && <span style={{ color: '#7dc97d', fontSize: '0.72rem' }}>✓ Saved</span>}
        {inspectedObject && mode === 'object' && (
          <button className="btn-ghost compact" style={{ fontSize: '0.68rem' }} onClick={() => { onClearInspected?.(); setMode('memory') }}>✕</button>
        )}
      </div>

      {mode === 'object' && inspectedObject ? (
        <>
          <div className="mem-view">
            <div className="mem-tree">
              <JsonNode data={inspectedObject} depth={0} />
            </div>
          </div>
          {rawJson != null && path && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ padding: '6px 10px', fontSize: '0.68rem', color: 'var(--text-dim)', background: '#171717' }}>
                Memory: {path} {error && <span style={{ color: 'var(--accent-warn)' }}>({error})</span>}
              </div>
              {rawJson !== 'null' && (
                <div className="mem-view" style={{ maxHeight: 120 }}>
                  <div className="mem-tree">
                    {parsed != null ? <JsonNode data={parsed} depth={0} /> : <pre className="mem-raw">{rawJson}</pre>}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      ) : mode === 'memory' ? (
        <>
          <div className="mem-toolbar">
            <input
              className="mem-path-input"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="Memory.creeps.Harvester1"
              onKeyDown={(e) => e.key === 'Enter' && void handleFetch()}
              spellCheck={false}
            />
            <button className="btn-ghost compact" onClick={() => void handleFetch()} disabled={loading}>
              {loading ? '…' : 'Fetch'}
            </button>
            <button
              className={watching ? 'btn-primary compact' : 'btn-ghost compact'}
              onClick={toggleWatch}
              title="Live watch this path each tick"
            >
              {watching ? '● Watch' : '○ Watch'}
            </button>
          </div>

          {error && <div className="mem-error">{error}</div>}

          {liveDisplay != null && (
            <div className="mem-live-bar">
              <span className="mem-live-dot">●</span>
              <span className="mem-live-val">{liveDisplay}</span>
            </div>
          )}

          {rawJson != null && (
            <div className="mem-view">
              {isEditing ? (
                <textarea
                  className="mem-editor"
                  value={editBuf}
                  onChange={(e) => setEditBuf(e.target.value)}
                  spellCheck={false}
                />
              ) : (
                <div className="mem-tree">
                  {parsed != null
                    ? <JsonNode data={parsed} depth={0} />
                    : <pre className="mem-raw">{rawJson}</pre>
                  }
                </div>
              )}
            </div>
          )}

          <div className="mem-actions">
            {rawJson != null && !isEditing && (
              <button className="btn-ghost compact" onClick={() => setIsEditing(true)}>Edit</button>
            )}
            {isEditing && (
              <>
                <button className="btn-primary compact" onClick={() => void handleSave()} disabled={loading}>Save</button>
                <button className="btn-ghost compact" onClick={() => {
                  setIsEditing(false)
                  try { setEditBuf(JSON.stringify(JSON.parse(rawJson ?? ''), null, 2)) } catch { setEditBuf(rawJson ?? '') }
                }}>Cancel</button>
              </>
            )}
            {rawJson == null && !loading && (
              <span className="muted" style={{ fontSize: '0.75rem' }}>Fetch to view memory contents.</span>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="mem-toolbar">
            <span className="muted" style={{ fontSize: '0.78rem', flexShrink: 0 }}>Segment</span>
            <input
              className="mem-path-input"
              type="number"
              min={0}
              max={99}
              value={segNum}
              onChange={(e) => setSegNum(Math.max(0, Math.min(99, Number(e.target.value))))}
              style={{ width: 60 }}
              onKeyDown={(e) => e.key === 'Enter' && void handleSegFetch()}
            />
            <button className="btn-ghost compact" onClick={() => void handleSegFetch()} disabled={loading}>
              {loading ? '…' : 'Fetch'}
            </button>
          </div>

          {error && <div className="mem-error">{error}</div>}

          {segData != null && (
            <div className="mem-view">
              {segEditing ? (
                <textarea
                  className="mem-editor"
                  value={segEditBuf}
                  onChange={(e) => setSegEditBuf(e.target.value)}
                  spellCheck={false}
                />
              ) : (
                <div className="mem-tree">
                  {(() => {
                    try {
                      const obj = JSON.parse(segData)
                      return <JsonNode data={obj} depth={0} />
                    } catch {
                      return <pre className="mem-raw">{segData}</pre>
                    }
                  })()}
                </div>
              )}
            </div>
          )}

          <div className="mem-actions">
            {segData != null && !segEditing && (
              <button className="btn-ghost compact" onClick={() => { setSegEditing(true); setSegEditBuf(segData) }}>Edit</button>
            )}
            {segEditing && (
              <>
                <button className="btn-primary compact" onClick={() => void handleSegSave()} disabled={loading}>Save</button>
                <button className="btn-ghost compact" onClick={() => { setSegEditing(false); setSegEditBuf(segData ?? '') }}>Cancel</button>
              </>
            )}
            {segData == null && !loading && (
              <span className="muted" style={{ fontSize: '0.75rem' }}>Select segment (0–99) and Fetch.</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
