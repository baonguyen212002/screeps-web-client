import { useEffect, useState, useCallback } from 'react'

type Season = { _id: string; name: string; date: string }
type LeaderboardEntry = { user: string; score: number; rank: number }

interface LeaderboardPaneProps {
  apiFetch: <T>(path: string, init?: RequestInit) => Promise<T>
}

export default function LeaderboardPane({ apiFetch }: LeaderboardPaneProps) {
  const [seasons, setSeasons] = useState<Season[]>([])
  const [selectedSeason, setSelectedSeason] = useState('')
  const [mode, setMode] = useState<'world' | 'power'>('world')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [list, setList] = useState<LeaderboardEntry[]>([])
  const [users, setUsers] = useState<Record<string, { username?: string; badge?: unknown }>>({})

  const loadSeasons = useCallback(async () => {
    try {
      const data = await apiFetch<{ seasons: Season[] }>('/api/leaderboard/seasons')
      setSeasons(data.seasons ?? [])
    } catch { /* ignore */ }
  }, [apiFetch])

  const loadLeaderboard = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ limit: '20', mode, offset: '0' })
      if (selectedSeason) params.set('season', selectedSeason)
      const data = await apiFetch<{
        list: LeaderboardEntry[]
        users: Record<string, { username?: string; badge?: unknown }>
      }>(`/api/leaderboard/list?${params}`)
      setList(data.list ?? [])
      setUsers(data.users ?? {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [apiFetch, mode, selectedSeason])

  useEffect(() => {
    void loadSeasons()
  }, [loadSeasons])

  useEffect(() => {
    void loadLeaderboard()
  }, [loadLeaderboard])

  return (
    <div className="dock-pane">
      <div className="pane-header">
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={`btn-ghost compact ${mode === 'world' ? 'tab-active' : ''}`} onClick={() => setMode('world')}>World</button>
          <button className={`btn-ghost compact ${mode === 'power' ? 'tab-active' : ''}`} onClick={() => setMode('power')}>Power</button>
        </div>
        <select
          className="branch-select"
          style={{ maxWidth: 140 }}
          value={selectedSeason}
          onChange={(e) => setSelectedSeason(e.target.value)}
        >
          <option value="">Current Season</option>
          {seasons.map((s) => (
            <option key={s._id} value={s._id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div className="pane-scroll">
        {loading && <div style={{ padding: 10 }} className="muted">Loading leaderboard…</div>}
        {error && <div style={{ padding: 10 }} className="form-error">{error}</div>}

        {!loading && !error && (
          <table className="market-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>Rank</th>
                <th>Player</th>
                <th style={{ textAlign: 'right' }}>Score</th>
              </tr>
            </thead>
            <tbody>
              {list.map((entry) => (
                <tr key={entry.user} className="market-row">
                  <td>{entry.rank}.</td>
                  <td style={{ color: 'var(--accent-hi)' }}>{users[entry.user]?.username ?? entry.user}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{entry.score.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
