import { useCallback, useEffect, useState } from 'react'

type FetchFn = <T>(path: string, init?: RequestInit) => Promise<T>

type PowerCreep = {
  _id: string
  name: string
  className: string
  level: number
  hitsMax?: number
  hits?: number
  store?: Record<string, number>
  storeCapacity?: number
  spawnCooldownTime?: number | null
  deleteTime?: number
  powers?: Record<string, { level: number }>
  x?: number
  y?: number
  room?: string
}

export default function PowerCreepsPane({ apiFetch }: { apiFetch: FetchFn }) {
  const [creeps, setCreeps] = useState<PowerCreep[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({})
  const [powerDrafts, setPowerDrafts] = useState<Record<string, string>>({})

  const loadCreeps = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiFetch<{ list: PowerCreep[] }>('/api/game/power-creeps/list')
      setCreeps(data.list ?? [])
      setRenameDrafts(Object.fromEntries((data.list ?? []).map((creep) => [creep._id, creep.name])))
      setPowerDrafts(Object.fromEntries((data.list ?? []).map((creep) => [creep._id, JSON.stringify(Object.fromEntries(Object.entries(creep.powers ?? {}).map(([power, info]) => [power, info.level])), null, 2)])))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  async function createCreep() {
    const name = newName.trim()
    if (!name) return
    setLoading(true)
    try {
      await apiFetch('/api/game/power-creeps/create', {
        method: 'POST',
        body: JSON.stringify({ name, className: 'operator' }),
      })
      setNewName('')
      setCreating(false)
      await loadCreeps()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setLoading(false)
    }
  }

  async function deleteCreep(creep: PowerCreep) {
    if (!confirm(`Delete power creep "${creep.name}"? This cannot be undone.`)) return
    setLoading(true)
    try {
      await apiFetch('/api/game/power-creeps/delete', {
        method: 'POST',
        body: JSON.stringify({ id: creep._id }),
      })
      await loadCreeps()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setLoading(false)
    }
  }

  async function cancelDelete(id: string) {
    setLoading(true)
    try {
      await apiFetch('/api/game/power-creeps/cancel-delete', {
        method: 'POST',
        body: JSON.stringify({ id }),
      })
      await loadCreeps()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancel failed')
    } finally {
      setLoading(false)
    }
  }

  async function renameCreep(creep: PowerCreep) {
    const nextName = renameDrafts[creep._id]?.trim()
    if (!nextName || nextName === creep.name) return
    setLoading(true)
    setError('')
    try {
      await apiFetch('/api/game/power-creeps/rename', {
        method: 'POST',
        body: JSON.stringify({ id: creep._id, name: nextName }),
      })
      await loadCreeps()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rename failed')
    } finally {
      setLoading(false)
    }
  }

  async function upgradeCreep(creep: PowerCreep) {
    const raw = powerDrafts[creep._id] ?? '{}'
    setLoading(true)
    setError('')
    try {
      const powers = JSON.parse(raw) as Record<string, number>
      await apiFetch('/api/game/power-creeps/upgrade', {
        method: 'POST',
        body: JSON.stringify({ id: creep._id, powers }),
      })
      await loadCreeps()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upgrade failed')
    } finally {
      setLoading(false)
    }
  }

  async function startExperimentation() {
    setLoading(true)
    setError('')
    try {
      await apiFetch('/api/game/power-creeps/experimentation', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      await loadCreeps()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Experimentation failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadCreeps()
  }, [loadCreeps])

  return (
    <div className="dock-pane">
      <div className="pane-header">
        <span className="panel-title">Power Creeps</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn-ghost compact" onClick={() => void loadCreeps()} disabled={loading}>
            {loading ? '…' : 'Refresh'}
          </button>
          <button className="btn-ghost compact" onClick={() => void startExperimentation()} disabled={loading}>
            Reset Powers
          </button>
          <button className="btn-ghost compact" onClick={() => setCreating(true)} disabled={creating}>
            + New
          </button>
        </div>
      </div>

      {creating && (
        <div className="mem-toolbar">
          <input
            className="mem-path-input"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Power creep name"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createCreep()
              if (e.key === 'Escape') { setCreating(false); setNewName('') }
            }}
          />
          <button className="btn-primary compact" onClick={() => void createCreep()} disabled={!newName.trim() || loading}>
            Create
          </button>
          <button className="btn-ghost compact" onClick={() => { setCreating(false); setNewName('') }}>✕</button>
        </div>
      )}

      {error && <div className="mem-error">{error}</div>}

      <div className="pane-scroll">
        {creeps.length === 0 && !loading && (
          <span className="muted" style={{ padding: '10px', display: 'block', fontSize: '0.75rem' }}>
            No power creeps. Click Refresh or create one with "+ New".
          </span>
        )}
        {creeps.map((c) => {
          const isExpanded = expanded === c._id
          const isSpawned = c.room != null
          const hasPowers = c.powers && Object.keys(c.powers).length > 0
          return (
            <div key={c._id} className={`pc-row ${isExpanded ? 'expanded' : ''}`}>
              <div className="pc-header" onClick={() => setExpanded(isExpanded ? null : c._id)}>
                <span className="pc-toggle">{isExpanded ? '▼' : '▶'}</span>
                <span className="pc-name">{c.name}</span>
                <span className="pc-class muted">{c.className}</span>
                <span className="pc-level">Lv {c.level}</span>
                {isSpawned && <span className="pc-spawned">● {c.room}</span>}
                <button
                  className="btn-ghost compact"
                  style={{ padding: '1px 5px', fontSize: '0.68rem', color: 'var(--accent-danger)', marginLeft: 4 }}
                  title="Delete"
                  onClick={(e) => { e.stopPropagation(); void deleteCreep(c) }}
                >✕</button>
              </div>

              {isExpanded && (
                <div className="pc-detail">
                  <div className="pc-detail-row">
                    <span className="muted">Name</span>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1 }}>
                      <input value={renameDrafts[c._id] ?? c.name} onChange={(e) => setRenameDrafts((drafts) => ({ ...drafts, [c._id]: e.target.value }))} />
                      <button className="btn-ghost compact" onClick={() => void renameCreep(c)}>Rename</button>
                    </div>
                  </div>
                  {c.hits != null && c.hitsMax != null && (
                    <div className="pc-detail-row">
                      <span className="muted">HP</span>
                      <span>{c.hits.toLocaleString()} / {c.hitsMax.toLocaleString()}</span>
                    </div>
                  )}
                  {c.store && Object.keys(c.store).length > 0 && (
                    <div className="pc-detail-row">
                      <span className="muted">Store</span>
                      <span>{Object.entries(c.store).map(([r, v]) => `${r}: ${v}`).join(', ')}</span>
                    </div>
                  )}
                  {c.spawnCooldownTime != null && (
                    <div className="pc-detail-row">
                      <span className="muted">Cooldown</span>
                      <span>until tick {c.spawnCooldownTime}</span>
                    </div>
                  )}
                  {c.deleteTime != null && (
                    <div className="pc-detail-row" style={{ color: 'var(--accent-danger)' }}>
                      <span>Deleting at tick {c.deleteTime}</span>
                      <button className="btn-ghost compact" style={{ fontSize: '0.68rem' }} onClick={() => void cancelDelete(c._id)}>
                        Cancel
                      </button>
                    </div>
                  )}
                  {hasPowers && (
                    <div className="pc-powers">
                      <div className="muted" style={{ fontSize: '0.68rem', marginBottom: 2 }}>POWERS</div>
                      {Object.entries(c.powers!).map(([power, info]) => (
                        <div key={power} className="pc-power-row">
                          <span>{power}</span>
                          <span className="muted">Lv {info.level}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ marginTop: 8 }}>
                    <div className="muted" style={{ fontSize: '0.68rem', marginBottom: 4 }}>POWER LEVEL JSON</div>
                    <textarea
                      className="script-textarea"
                      style={{ minHeight: 120, padding: 8, fontSize: '0.72rem' }}
                      value={powerDrafts[c._id] ?? '{}'}
                      onChange={(e) => setPowerDrafts((drafts) => ({ ...drafts, [c._id]: e.target.value }))}
                    />
                    <button className="btn-ghost compact" style={{ marginTop: 6 }} onClick={() => void upgradeCreep(c)}>Apply Powers</button>
                  </div>
                  {!hasPowers && <div className="muted" style={{ fontSize: '0.72rem', padding: '4px 0' }}>No powers yet.</div>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
