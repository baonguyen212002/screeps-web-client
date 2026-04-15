import { useEffect, useRef, useState, useCallback, useMemo } from 'react'

type FetchFn = <T>(path: string, init?: RequestInit) => Promise<T>

type RoomStat = {
  status?: string
  own?: { user: string; level: number }
  safeMode?: boolean
  minerals0?: { type: string; density: number }
}

type RoomObject = {
  type?: string
  x?: number
  y?: number
  mineralType?: string
  depositType?: string
}

type RoomMarker = {
  type: 'source' | 'mineral' | 'deposit'
  x: number
  y: number
  mineralType?: string
  depositType?: string
}

interface WorldMapModalProps {
  worldSize: { width: number; height: number }
  userId?: string
  currentRoom: string
  apiFetch: FetchFn
  onNavigate: (room: string) => void
  onClose: () => void
}

const ROOM_PX = 150  // pixels per room on canvas
const ROOM_TILES = 50

function parseRoomName(room: string): { x: number; y: number } | null {
  const match = /^([WE])(\d+)([NS])(\d+)$/.exec(room)
  if (!match) return null
  const x = match[1] === 'W' ? -Number(match[2]) - 1 : Number(match[2])
  const y = match[3] === 'N' ? -Number(match[4]) - 1 : Number(match[4])
  return { x, y }
}

function buildGrid(roomNames: string[]): string[][] {
  const parsed = roomNames
    .map((room) => ({ room, coords: parseRoomName(room) }))
    .filter((entry): entry is { room: string; coords: { x: number; y: number } } => Boolean(entry.coords))

  if (parsed.length === 0) return []

  const xs = [...new Set(parsed.map((entry) => entry.coords.x))].sort((a, b) => a - b)
  const ys = [...new Set(parsed.map((entry) => entry.coords.y))].sort((a, b) => a - b)
  const byCoords = new Map(parsed.map((entry) => [`${entry.coords.x},${entry.coords.y}`, entry.room]))

  return ys.map((y) => xs.map((x) => byCoords.get(`${x},${y}`) ?? ''))
}

const TERRAIN_COLORS = {
  plain: '#2b2b2b',
  wall: '#111111',
  swamp: '#222c14',
}

const MINERAL_COLORS: Record<string, string> = {
  H: '#6ce0ff',
  O: '#9aa4b1',
  U: '#48c6ff',
  L: '#6de36d',
  K: '#c38cff',
  Z: '#f0c15c',
  X: '#ff6b6b',
}

function decodeTerrain(encoded: string): Uint8Array {
  const data = new Uint8Array(2500)
  for (let i = 0; i < Math.min(encoded.length, 2500); i++) {
    data[i] = Number(encoded[i]) || 0
  }
  return data
}

function drawRoomTerrain(
  ctx: CanvasRenderingContext2D,
  terrain: Uint8Array,
  px: number,
  py: number,
  size: number,
) {
  const tileSize = size / ROOM_TILES
  // Fill plain background
  ctx.fillStyle = TERRAIN_COLORS.plain
  ctx.fillRect(px, py, size, size)

  for (let y = 0; y < ROOM_TILES; y++) {
    for (let x = 0; x < ROOM_TILES; x++) {
      const val = terrain[y * ROOM_TILES + x]
      if (val & 1) {
        ctx.fillStyle = TERRAIN_COLORS.wall
        ctx.fillRect(px + x * tileSize, py + y * tileSize, tileSize, tileSize)
      } else if (val & 2) {
        ctx.fillStyle = TERRAIN_COLORS.swamp
        ctx.fillRect(px + x * tileSize, py + y * tileSize, tileSize, tileSize)
      }
    }
  }
}

function drawOwnerOverlay(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  size: number,
  isOwn: boolean,
  level: number,
) {
  // Tinted overlay for owned rooms
  ctx.fillStyle = isOwn ? 'rgba(50,140,50,0.20)' : 'rgba(140,50,50,0.20)'
  ctx.fillRect(px, py, size, size)

  // Level badge in center
  if (level > 0) {
    const badgeR = size * 0.22
    ctx.beginPath()
    ctx.arc(px + size / 2, py + size / 2, badgeR, 0, Math.PI * 2)
    ctx.fillStyle = isOwn ? 'rgba(50,140,50,0.7)' : 'rgba(140,50,50,0.7)'
    ctx.fill()
    ctx.strokeStyle = isOwn ? '#bfdc82' : '#d96c6c'
    ctx.lineWidth = 1.5
    ctx.stroke()

    ctx.fillStyle = '#fff'
    ctx.font = `bold ${Math.round(size * 0.18)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(level), px + size / 2, py + size / 2)
  }
}

export default function WorldMapModal({ worldSize, userId, currentRoom, apiFetch, onNavigate, onClose }: WorldMapModalProps) {
  const [roomNames, setRoomNames] = useState<string[]>([])
  const [stats, setStats] = useState<Record<string, RoomStat>>({})
  const [users, setUsers] = useState<Record<string, { username?: string }>>({})
  const [roomMarkers, setRoomMarkers] = useState<Record<string, RoomMarker[]>>({})
  const [loading, setLoading] = useState(true)
  const [terrainCache, setTerrainCache] = useState<Record<string, Uint8Array>>({})
  const loadedRef = useRef(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hoverInfoRef = useRef<HTMLDivElement>(null)
  const statsRef = useRef(stats)
  const usersRef = useRef(users)
  const markersRef = useRef(roomMarkers)

  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const panRef = useRef(pan)
  const zoomRef = useRef(zoom)
  const dragRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null)

  const grid = useMemo(() => buildGrid(roomNames), [roomNames])
  const allRooms = useMemo(() => grid.flat().filter(Boolean), [grid])
  const gridWidth = grid[0]?.length ?? worldSize.width
  const gridHeight = grid.length || worldSize.height
  const modalWidth = typeof window === 'undefined' ? 960 : Math.min(window.innerWidth - 48, Math.max(560, gridWidth * 64 + 32))
  const modalHeight = typeof window === 'undefined' ? 820 : Math.min(window.innerHeight - 48, Math.max(420, gridHeight * 64 + 112))

  // Room name -> grid col/row
  const roomToGrid = useMemo(() => {
    const map: Record<string, { col: number; row: number }> = {}
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        map[grid[r][c]] = { col: c, row: r }
      }
    }
    return map
  }, [grid])

  const fetchRooms = useCallback(async () => {
    const data = await apiFetch<{ rooms: string[] }>('/api/game/rooms')
    setRoomNames(data.rooms ?? [])
  }, [apiFetch])

  // Fetch stats for all rooms
  const fetchStats = useCallback(async () => {
    if (allRooms.length === 0) return
    const allStats: Record<string, RoomStat> = {}
    const allUsers: Record<string, { username?: string }> = {}
    const batchSize = 50
    for (let i = 0; i < allRooms.length; i += batchSize) {
      const batch = allRooms.slice(i, i + batchSize)
      try {
        const data = await apiFetch<{
          stats: Record<string, RoomStat>
          users: Record<string, { username?: string }>
        }>('/api/game/map-stats', {
          method: 'POST',
          body: JSON.stringify({ rooms: batch, statName: 'owner0' }),
        })
        Object.entries(data.stats ?? {}).forEach(([k, v]) => { allStats[k] = v })
        Object.entries(data.users ?? {}).forEach(([k, v]) => { allUsers[k] = v })
      } catch { /* ignore */ }
    }
    setStats(allStats)
    statsRef.current = allStats
    setUsers(allUsers)
    usersRef.current = allUsers
    setLoading(false)
  }, [allRooms, apiFetch])

  const fetchResources = useCallback(async () => {
    if (allRooms.length === 0) return
    const resources: Record<string, RoomMarker[]> = {}
    const batchSize = 12
    for (let i = 0; i < allRooms.length; i += batchSize) {
      const batch = allRooms.slice(i, i + batchSize)
      await Promise.all(batch.map(async (room) => {
        try {
          const data = await apiFetch<{ objects: RoomObject[] }>(`/api/game/room-objects?room=${encodeURIComponent(room)}`)
          const objects = data.objects ?? []
          const markers: RoomMarker[] = []
          for (const object of objects) {
            if (typeof object.x !== 'number' || typeof object.y !== 'number') continue
            if (object.type === 'source') markers.push({ type: 'source', x: object.x, y: object.y })
            if (object.type === 'mineral') markers.push({ type: 'mineral', x: object.x, y: object.y, mineralType: object.mineralType })
            if (object.type === 'deposit') markers.push({ type: 'deposit', x: object.x, y: object.y, depositType: object.depositType })
          }
          resources[room] = markers
        } catch {
          resources[room] = []
        }
      }))
    }
    setRoomMarkers(resources)
    markersRef.current = resources
  }, [allRooms, apiFetch])

  // Fetch terrain for all rooms
  const fetchTerrain = useCallback(async () => {
    if (allRooms.length === 0) return
    const cache: Record<string, Uint8Array> = {}
    const batchSize = 20
    for (let i = 0; i < allRooms.length; i += batchSize) {
      const batch = allRooms.slice(i, i + batchSize)
      await Promise.all(batch.map(async (room) => {
        try {
          const data = await apiFetch<{ terrain: Array<{ terrain: string }> }>(
            `/api/game/room-terrain?room=${encodeURIComponent(room)}&encoded=1`
          )
          if (data.terrain?.[0]?.terrain) {
            cache[room] = decodeTerrain(data.terrain[0].terrain)
          }
        } catch { /* ignore */ }
      }))
    }
    setTerrainCache(cache)
  }, [allRooms, apiFetch])

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    void fetchRooms()
  }, [fetchRooms])

  useEffect(() => {
    if (allRooms.length === 0) return
    void Promise.resolve().then(async () => {
      await Promise.all([fetchStats(), fetchTerrain(), fetchResources()])
    })
  }, [allRooms.length, fetchResources, fetchStats, fetchTerrain])

  // Center on current room initially
  useEffect(() => {
    const pos = roomToGrid[currentRoom]
    if (!pos || !containerRef.current) return
    const { offsetWidth: vw, offsetHeight: vh } = containerRef.current
    const z = Math.min(vw / (gridWidth * ROOM_PX), vh / (gridHeight * ROOM_PX)) * 0.9
    const cx = (pos.col + 0.5) * ROOM_PX
    const cy = (pos.row + 0.5) * ROOM_PX
    const newPan = { x: vw / 2 - cx * z, y: vh / 2 - cy * z }
    panRef.current = newPan
    zoomRef.current = z
    setPan(newPan)
    setZoom(z)
  }, [currentRoom, gridHeight, gridWidth, roomToGrid])

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const totalW = gridWidth * ROOM_PX
    const totalH = gridHeight * ROOM_PX
    canvas.width = totalW
    canvas.height = totalH

    // Background
    ctx.fillStyle = '#0a0a0a'
    ctx.fillRect(0, 0, totalW, totalH)

    // Draw each room
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const room = grid[r][c]
        if (!room) continue
        const px = c * ROOM_PX
        const py = r * ROOM_PX

        const terrain = terrainCache[room]
        if (terrain) {
          drawRoomTerrain(ctx, terrain, px, py, ROOM_PX)
        } else {
          ctx.fillStyle = '#181818'
          ctx.fillRect(px, py, ROOM_PX, ROOM_PX)
        }

        // Owner overlay
        const stat = stats[room]
        if (stat?.own) {
          const isOwn = stat.own.user === userId
          drawOwnerOverlay(ctx, px, py, ROOM_PX, isOwn, stat.own.level)
        }

        // Current room highlight
        if (room === currentRoom) {
          ctx.strokeStyle = '#bfdc82'
          ctx.lineWidth = 3
          ctx.strokeRect(px + 1.5, py + 1.5, ROOM_PX - 3, ROOM_PX - 3)
        }

        // Room grid border
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'
        ctx.lineWidth = 0.5
        ctx.strokeRect(px, py, ROOM_PX, ROOM_PX)

        const markers = roomMarkers[room] ?? []
        const tile = ROOM_PX / ROOM_TILES
        for (const marker of markers) {
          const cx = px + marker.x * tile + tile / 2
          const cy = py + marker.y * tile + tile / 2

          if (marker.type === 'source') {
            const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, tile * 1.4)
            glow.addColorStop(0, 'rgba(255,229,109,0.75)')
            glow.addColorStop(1, 'rgba(255,229,109,0)')
            ctx.fillStyle = glow
            ctx.beginPath()
            ctx.arc(cx, cy, tile * 1.4, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = '#ffe56d'
            ctx.beginPath()
            ctx.arc(cx, cy, Math.max(1.8, tile * 0.38), 0, Math.PI * 2)
            ctx.fill()
          } else if (marker.type === 'mineral') {
            const color = MINERAL_COLORS[marker.mineralType ?? ''] ?? '#b2bec3'
            ctx.fillStyle = color
            ctx.beginPath()
            ctx.moveTo(cx, cy - tile * 0.6)
            ctx.lineTo(cx + tile * 0.52, cy)
            ctx.lineTo(cx, cy + tile * 0.6)
            ctx.lineTo(cx - tile * 0.52, cy)
            ctx.closePath()
            ctx.fill()
            ctx.strokeStyle = 'rgba(255,255,255,0.45)'
            ctx.lineWidth = 1
            ctx.stroke()
          } else if (marker.type === 'deposit') {
            ctx.fillStyle = '#ff8f5a'
            ctx.beginPath()
            ctx.arc(cx, cy, Math.max(1.5, tile * 0.34), 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = 'rgba(255,216,168,0.7)'
            ctx.lineWidth = 1
            ctx.stroke()
          }
        }
      }
    }
  }, [grid, gridHeight, gridWidth, terrainCache, stats, roomMarkers, userId, currentRoom])

  // Pan & zoom
  useEffect(() => { panRef.current = pan }, [pan])
  useEffect(() => { zoomRef.current = zoom }, [zoom])

  function handleWheel(e: React.WheelEvent) {
    e.stopPropagation()
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    const newZoom = Math.max(0.05, Math.min(4, zoomRef.current * factor))
    const rect = containerRef.current!.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const cx = (sx - panRef.current.x) / zoomRef.current
    const cy = (sy - panRef.current.y) / zoomRef.current
    const newPan = { x: sx - cx * newZoom, y: sy - cy * newZoom }
    panRef.current = newPan
    zoomRef.current = newZoom
    setPan(newPan)
    setZoom(newZoom)
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPanX: panRef.current.x, startPanY: panRef.current.y }
  }

  function handleMouseMove(e: React.MouseEvent) {
    // Hover info
    const rect = containerRef.current!.getBoundingClientRect()
    const mx = (e.clientX - rect.left - panRef.current.x) / zoomRef.current
    const my = (e.clientY - rect.top - panRef.current.y) / zoomRef.current
    const col = Math.floor(mx / ROOM_PX)
    const row = Math.floor(my / ROOM_PX)
    if (col >= 0 && col < gridWidth && row >= 0 && row < gridHeight && grid[row]?.[col]) {
      updateHoverInfo(grid[row][col])
    } else {
      updateHoverInfo(null)
    }

    // Drag
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.startX
      const dy = e.clientY - dragRef.current.startY
      const newPan = { x: dragRef.current.startPanX + dx, y: dragRef.current.startPanY + dy }
      panRef.current = newPan
      setPan(newPan)
    }
  }

  function handleMouseUp(e: React.MouseEvent) {
    if (dragRef.current) {
      const dx = Math.abs(e.clientX - dragRef.current.startX)
      const dy = Math.abs(e.clientY - dragRef.current.startY)
      if (dx < 4 && dy < 4) {
        // Click — navigate
        const rect = containerRef.current!.getBoundingClientRect()
        const mx = (e.clientX - rect.left - panRef.current.x) / zoomRef.current
        const my = (e.clientY - rect.top - panRef.current.y) / zoomRef.current
        const col = Math.floor(mx / ROOM_PX)
        const row = Math.floor(my / ROOM_PX)
        if (col >= 0 && col < gridWidth && row >= 0 && row < gridHeight && grid[row]?.[col]) {
          onNavigate(grid[row][col])
          onClose()
        }
      }
      dragRef.current = null
    }
  }

  function updateHoverInfo(roomName: string | null) {
    const el = hoverInfoRef.current
    if (!el) return
    if (!roomName) {
      el.innerHTML = '<span class="muted">Hover a room for info · click to navigate</span>'
      return
    }
    const s = statsRef.current[roomName]
    const markers = markersRef.current[roomName] ?? []
    const sourceCount = markers.filter((marker) => marker.type === 'source').length
    const mineral = markers.find((marker) => marker.type === 'mineral')?.mineralType ?? s?.minerals0?.type
    const deposit = markers.find((marker) => marker.type === 'deposit')?.depositType
    let html = `<strong>${roomName}</strong>`
    if (s?.own) {
      const uname = usersRef.current[s.own.user]?.username ?? '?'
      html += `<span class="muted"> · ${uname} L${s.own.level}</span>`
    } else if (s) {
      html += '<span class="muted"> · unclaimed</span>'
    }
    if (sourceCount > 0) html += `<span class="muted"> · src ${sourceCount}</span>`
    if (mineral) html += `<span class="muted"> · ${mineral}</span>`
    if (deposit) html += `<span class="muted"> · ${deposit}</span>`
    if (s?.safeMode) html += '<span style="color:#7dc97d"> · safe</span>'
    el.innerHTML = html
  }

  return (
    <div className="modal-backdrop wm-fullscreen" onClick={onClose}>
      <div className="wm-fullscreen-box" style={{ width: modalWidth, height: modalHeight }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="panel-title">World Map — {gridWidth}×{gridHeight}</span>
          {loading && <span className="muted" style={{ fontSize: '0.72rem' }}>Loading terrain…</span>}
          <button className="btn-ghost compact" onClick={onClose}>✕</button>
        </div>

        <div
          ref={containerRef}
          className="wm-canvas-area"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => { dragRef.current = null; updateHoverInfo(null) }}
        >
          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: gridWidth * ROOM_PX,
              height: gridHeight * ROOM_PX,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              imageRendering: 'pixelated',
            }}
          />
        </div>

        <div className="world-map-footer">
          <div className="world-map-legend">
            <span className="wm-leg"><span className="wm-sw" style={{ background: '#1e3a10', border: '1px solid #3d7020' }} />Own</span>
            <span className="wm-leg"><span className="wm-sw" style={{ background: '#3a1414', border: '1px solid #702020' }} />Other</span>
            <span className="wm-leg"><span className="wm-sw" style={{ background: 'transparent', border: '2px solid #bfdc82' }} />Current</span>
          </div>
          <div ref={hoverInfoRef} className="world-map-info">
            <span className="muted">Hover a room for info · click to navigate</span>
          </div>
        </div>
      </div>
    </div>
  )
}
