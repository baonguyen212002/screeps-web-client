import { useEffect, useState, useCallback } from 'react'

type MarketOrder = {
  _id: string
  resourceType: string
  type: 'buy' | 'sell'
  price: number
  amount: number
  roomName?: string
  user?: string
}

type MarketIndexItem = {
  _id: string
  count: number
  buying: number
  selling: number
}

type MarketStat = {
  date: string | number
  transactions?: number
  volume?: number
  avgPrice?: number
  stddevPrice?: number
}

interface MarketPaneProps {
  apiFetch: <T>(path: string, init?: RequestInit) => Promise<T>
}

export default function MarketPane({ apiFetch }: MarketPaneProps) {
  const [index, setIndex] = useState<MarketIndexItem[]>([])
  const [myOrders, setMyOrders] = useState<MarketOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedResourceType, setSelectedResourceType] = useState<string | null>(null)
  const [resourceOrders, setResourceOrders] = useState<MarketOrder[]>([])
  const [resourceStats, setResourceStats] = useState<MarketStat[]>([])
  const [filter, setFilter] = useState('')
  const [tab, setTab] = useState<'all' | 'mine'>('all')

  const loadIndex = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiFetch<{ list: MarketIndexItem[] }>('/api/game/market/orders-index')
      setIndex(data.list ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  const loadMyOrders = useCallback(async () => {
    try {
      const data = await apiFetch<{ list: MarketOrder[] }>('/api/game/market/my-orders')
      setMyOrders(data.list ?? [])
    } catch { /* ignore */ }
  }, [apiFetch])

  const loadResourceOrders = useCallback(async (resourceType: string) => {
    setLoading(true)
    setError('')
    try {
      const [ordersData, statsData] = await Promise.all([
        apiFetch<{ list: MarketOrder[] }>(`/api/game/market/orders?resourceType=${resourceType}`),
        apiFetch<{ stats: MarketStat[] }>(`/api/game/market/stats?resourceType=${resourceType}`),
      ])
      setResourceOrders(ordersData.list ?? [])
      setResourceStats(statsData.stats ?? [])
      setSelectedResourceType(resourceType)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void loadIndex()
  }, [loadIndex])

  useEffect(() => {
    void loadMyOrders()
  }, [loadMyOrders])

  const filteredIndex = filter
    ? index.filter(item => item._id.toLowerCase().includes(filter.toLowerCase()))
    : index

  const myResTypes = new Set(myOrders.map(o => o.resourceType))

  return (
    <div className="dock-pane">
      <div className="pane-header">
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={`btn-ghost compact ${tab === 'all' ? 'tab-active' : ''}`} onClick={() => { setTab('all'); setSelectedResourceType(null) }}>Market</button>
          <button className={`btn-ghost compact ${tab === 'mine' ? 'tab-active' : ''}`} onClick={() => setTab('mine')}>My Orders ({myOrders.length})</button>
        </div>
        {tab === 'all' && !selectedResourceType && (
          <input
            className="console-filter-input"
            style={{ width: 100, height: 20 }}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
          />
        )}
        {selectedResourceType && (
          <button className="btn-ghost compact" onClick={() => setSelectedResourceType(null)}>← Back</button>
        )}
      </div>

      <div className="pane-scroll">
        {loading && <div style={{ padding: 10 }} className="muted">Loading market data…</div>}
        {error && <div style={{ padding: 10 }} className="form-error">{error}</div>}

        {!loading && tab === 'all' && !selectedResourceType && (
          <table className="market-index-table">
            <thead>
              <tr>
                <th>Resource</th>
                <th className="market-count">Sells</th>
                <th className="market-count">Buys</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredIndex.map((item) => (
                <tr key={item._id} className={`market-index-row ${myResTypes.has(item._id) ? 'has-my-order' : ''}`} onClick={() => void loadResourceOrders(item._id)}>
                  <td className="market-res">
                    {item._id}
                    {myResTypes.has(item._id) && <span className="market-my-dot" title="You have orders here">●</span>}
                  </td>
                  <td className="market-count sell-count">{item.selling || '—'}</td>
                  <td className="market-count buy-count">{item.buying || '—'}</td>
                  <td className="market-arrow muted">›</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!loading && tab === 'all' && selectedResourceType && (
          <>
            <div className="market-section-header">PRICE HISTORY</div>
            {resourceStats.slice(0, 7).map((stat, index) => (
              <div key={`${stat.date}-${index}`} className="market-order-row">
                <span className="market-room" style={{ width: 96 }}>{new Date(stat.date).toLocaleDateString()}</span>
                <span className="market-amt" style={{ width: 72 }}>{stat.avgPrice != null ? stat.avgPrice.toFixed(3) : '—'}</span>
                <span className="market-amt" style={{ width: 72 }}>{stat.volume?.toLocaleString() ?? '—'}</span>
                <span className="market-room">tx {stat.transactions?.toLocaleString() ?? '—'}</span>
              </div>
            ))}
            {resourceStats.length === 0 && <div className="market-empty">No market history</div>}

            <div className="market-section-header sell">SELL ORDERS</div>
            {resourceOrders.filter(o => o.type === 'sell').sort((a,b) => a.price - b.price).map(o => (
              <div key={o._id} className="market-order-row">
                <span className="sell-price" style={{ width: 60 }}>{o.price.toFixed(3)}</span>
                <span className="market-amt" style={{ flex: 1 }}>{o.amount.toLocaleString()}</span>
                <span className="market-room">{o.roomName}</span>
              </div>
            ))}
            {!resourceOrders.some(o => o.type === 'sell') && <div className="market-empty">No sell orders</div>}

            <div className="market-section-header buy" style={{ marginTop: 8 }}>BUY ORDERS</div>
            {resourceOrders.filter(o => o.type === 'buy').sort((a,b) => b.price - a.price).map(o => (
              <div key={o._id} className="market-order-row">
                <span className="buy-price" style={{ width: 60 }}>{o.price.toFixed(3)}</span>
                <span className="market-amt" style={{ flex: 1 }}>{o.amount.toLocaleString()}</span>
                <span className="market-room">{o.roomName}</span>
              </div>
            ))}
            {!resourceOrders.some(o => o.type === 'buy') && <div className="market-empty">No buy orders</div>}
          </>
        )}

        {tab === 'mine' && (
          <div className="market-my-list">
            {myOrders.map(o => (
              <div key={o._id} className="market-my-row" onClick={() => void loadResourceOrders(o.resourceType)}>
                <span className={`market-badge ${o.type}`}>{o.type.toUpperCase()}</span>
                <span className="market-res" style={{ width: 80 }}>{o.resourceType}</span>
                <span className={o.type === 'sell' ? 'sell-price' : 'buy-price'} style={{ width: 60 }}>{o.price.toFixed(3)}</span>
                <span className="market-amt" style={{ flex: 1 }}>{o.amount.toLocaleString()}</span>
                <span className="market-room">{o.roomName}</span>
              </div>
            ))}
            {myOrders.length === 0 && <div className="market-empty">You have no active market orders.</div>}
          </div>
        )}
      </div>
    </div>
  )
}
