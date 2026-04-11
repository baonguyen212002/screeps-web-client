import { useEffect, useRef, useState } from 'react'

type RoomObject = {
  _id: string
  type: string
  x?: number
  y?: number
  user?: string
  level?: number
  name?: string
  mineralType?: string
}

type TerrainCell = 'plain' | 'wall' | 'swamp'

interface RoomRendererProps {
  terrain: TerrainCell[]
  objects: Record<string, RoomObject>
  userId?: string
  roomName: string
  onTileClick?: (x: number, y: number) => void
}

const ROOM_SIZE = 50
const TILE_SIZE = 20 // Base tile size, can be scaled

function getMineralColor(mineralType?: string) {
  switch (mineralType) {
    case 'H': return '#7ed6df'
    case 'O': return '#dfe6e9'
    case 'U': return '#54a0ff'
    case 'L': return '#78e08f'
    case 'K': return '#ff9ff3'
    case 'Z': return '#feca57'
    case 'X': return '#ff6b6b'
    default: return '#b2bec3'
  }
}

export default function RoomRenderer({ terrain, objects, userId, roomName, onTileClick }: RoomRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tooltip, setTooltip] = useState<{ left: number; top: number; label: string } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const render = () => {
      // Clear
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const scale = Math.min(canvas.width, canvas.height) / (ROOM_SIZE * TILE_SIZE)
      ctx.save()
      ctx.scale(scale, scale)

      // Draw Terrain
      for (let y = 0; y < ROOM_SIZE; y++) {
        for (let x = 0; x < ROOM_SIZE; x++) {
          const idx = y * ROOM_SIZE + x
          const cell = terrain[idx]
          
          if (cell === 'wall') {
            ctx.fillStyle = '#111'
          } else if (cell === 'swamp') {
            ctx.fillStyle = '#1a2a1a'
          } else {
            ctx.fillStyle = '#0a0a0a'
          }

          ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE - 1, TILE_SIZE - 1)
        }
      }

      // Draw Objects
      Object.values(objects).forEach((obj) => {
        if (typeof obj.x !== 'number' || typeof obj.y !== 'number') return

        const cx = obj.x * TILE_SIZE + TILE_SIZE / 2
        const cy = obj.y * TILE_SIZE + TILE_SIZE / 2
        const radius = TILE_SIZE / 2.5

        ctx.beginPath()
        
        if (obj.type === 'creep') {
          ctx.beginPath()
          ctx.arc(cx, cy, radius, 0, Math.PI * 2)
          ctx.fillStyle = obj.user === userId ? '#2ecc71' : '#e74c3c'
          ctx.fill()
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 2
          ctx.stroke()
        } else if (obj.type === 'spawn') {
          ctx.beginPath()
          ctx.rect(cx - radius, cy - radius, radius * 2, radius * 2)
          ctx.fillStyle = '#f39c12'
          ctx.fill()
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 3
          ctx.stroke()
          // Lõi Spawn
          ctx.beginPath()
          ctx.arc(cx, cy, radius / 2, 0, Math.PI * 2)
          ctx.fillStyle = '#fff'
          ctx.fill()
        } else if (obj.type === 'source') {
          ctx.arc(cx, cy, radius * 1.2, 0, Math.PI * 2)
          ctx.fillStyle = '#f1c40f'
          ctx.fill()
        } else if (obj.type === 'controller') {
          ctx.arc(cx, cy, radius, 0, Math.PI * 2)
          ctx.strokeStyle = '#3498db'
          ctx.lineWidth = 2
          ctx.stroke()
          ctx.fillStyle = 'rgba(52, 152, 219, 0.2)'
          ctx.fill()
        } else if (obj.type === 'mineral') {
          ctx.beginPath()
          ctx.arc(cx, cy, radius, 0, Math.PI * 2)
          ctx.fillStyle = getMineralColor(obj.mineralType)
          ctx.fill()
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 2
          ctx.stroke()
        } else {
          ctx.arc(cx, cy, radius / 2, 0, Math.PI * 2)
          ctx.fillStyle = '#95a5a6'
          ctx.fill()
        }
      })

      ctx.restore()
    }

    render()
  }, [terrain, objects, userId])

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas || !onTileClick) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    
    // Calculate scale based on actual canvas display size vs internal coordinate space
    const viewSize = Math.min(rect.width, rect.height)
    const scale = viewSize / (ROOM_SIZE * TILE_SIZE)
    
    const tileX = Math.floor(x / (scale * TILE_SIZE))
    const tileY = Math.floor(y / (scale * TILE_SIZE))

    if (tileX >= 0 && tileX < ROOM_SIZE && tileY >= 0 && tileY < ROOM_SIZE) {
      onTileClick(tileX, tileY)
    }
  }

  const handlePointerMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const viewSize = Math.min(rect.width, rect.height)
    const scale = viewSize / (ROOM_SIZE * TILE_SIZE)
    const tileX = Math.floor(x / (scale * TILE_SIZE))
    const tileY = Math.floor(y / (scale * TILE_SIZE))

    if (tileX < 0 || tileX >= ROOM_SIZE || tileY < 0 || tileY >= ROOM_SIZE) {
      setTooltip(null)
      return
    }

    const hoveredObjects = Object.values(objects).filter(
      (obj) => obj.x === tileX && obj.y === tileY,
    )

    if (!hoveredObjects.length) {
      setTooltip(null)
      return
    }

    const priority = ['spawn', 'creep', 'source', 'controller', 'mineral']
    const hovered =
      hoveredObjects.sort((a, b) => priority.indexOf(a.type) - priority.indexOf(b.type))[0]

    const labelParts = [hovered.type]
    if (hovered.name) labelParts.push(hovered.name)
    if (hovered.mineralType) labelParts.push(hovered.mineralType)
    labelParts.push(`(${tileX},${tileY})`)

    setTooltip({
      left: x + 14,
      top: y + 14,
      label: labelParts.join(' '),
    })
  }

  return (
    <div className="viewer-container">
      <canvas
        ref={canvasRef}
        className="room-canvas"
        width={1000}
        height={1000}
        onClick={handleClick}
        onMouseMove={handlePointerMove}
        onMouseLeave={() => setTooltip(null)}
      />
      <div className="viewer-overlay">
        <span className="eyebrow">Room</span>
        <h2>{roomName}</h2>
        <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.35rem', fontSize: '0.8rem' }}>
          <span><span style={{ color: '#f1c40f' }}>●</span> Source</span>
          <span><span style={{ color: '#3498db' }}>●</span> Controller</span>
          <span><span style={{ color: '#f39c12' }}>●</span> Spawn</span>
          <span><span style={{ color: '#2ecc71' }}>●</span> Your Creep</span>
          <span><span style={{ color: '#ff9ff3' }}>●</span> Mineral</span>
        </div>
      </div>
      {tooltip && (
        <div
          style={{
            position: 'absolute',
            left: tooltip.left,
            top: tooltip.top,
            pointerEvents: 'none',
            zIndex: 3,
            background: 'rgba(9, 11, 15, 0.92)',
            color: '#f5f6fa',
            border: '1px solid rgba(255,255,255,0.16)',
            borderRadius: '8px',
            padding: '0.35rem 0.55rem',
            fontSize: '0.78rem',
            whiteSpace: 'nowrap',
            boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
          }}
        >
          {tooltip.label}
        </div>
      )}
    </div>
  )
}
