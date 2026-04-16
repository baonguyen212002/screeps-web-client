import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { countBodyParts, type BodyPartType } from './bodyParts'

type ActionTarget = { x: number; y: number; message?: string; isPublic?: boolean }

type RoomObject = {
  _id: string
  type: string
  x?: number
  y?: number
  user?: string
  level?: number
  name?: string
  color?: number
  secondaryColor?: number
  mineralType?: string
  hits?: number
  hitsMax?: number
  store?: Record<string, number>
  spawning?: unknown
  body?: Array<{ type: string; hits: number }>
  progress?: number
  progressTotal?: number
  actionLog?: {
    harvest?: ActionTarget | null
    build?: ActionTarget | null
    repair?: ActionTarget | null
    attack?: ActionTarget | null
    rangedAttack?: ActionTarget | null
    attacked?: ActionTarget | null
    heal?: ActionTarget | null
    healed?: ActionTarget | null
    rangedHeal?: ActionTarget | null
    rangedMassAttack?: ActionTarget | null
    upgradeController?: ActionTarget | null
    reserveController?: ActionTarget | null
    transferEnergy?: ActionTarget | null
    say?: { message?: string; isPublic?: boolean } | null
  }
}

type TerrainCell = 'plain' | 'wall' | 'swamp'

interface RoomRendererProps {
  terrain: TerrainCell[]
  objects: Record<string, RoomObject>
  roomUsers?: Record<string, { username?: string; badge?: { color1?: string | number; color2?: string | number; color3?: string | number } }>
  userId?: string
  roomName: string
  tickDuration?: number
  selectedObjectId?: string
  onTileClick?: (x: number, y: number) => void
}

const ROOM_SIZE = 50
const TILE = 32
const CANVAS_SIZE = ROOM_SIZE * TILE  // 1600px

const COLORS = {
  plain: '#2b2b2b',
  swamp: '#222c14',
  wall: '#111111',
  wallBorder: '#1a1a1a',
  swampDot: '#1d2610',
}

const MINERAL_COLORS: Record<string, string> = {
  // Base
  H: '#7ed6df', O: '#dfe6e9', U: '#4bcffa', L: '#78e08f',
  K: '#f8a5c2', Z: '#f9ca24', X: '#ff5e57', G: '#c3c3c3',
  // Compounds
  OH: '#7ed6df', ZK: '#f9ca24', UL: '#4bcffa',
  GHO2: '#c3c3c3', UH2O: '#4bcffa', UHO2: '#4bcffa', KH2O: '#f8a5c2', KHO2: '#f8a5c2', LH2O: '#78e08f', LHO2: '#78e08f', ZH2O: '#f9ca24', ZHO2: '#f9ca24',
  UH: '#4bcffa', UO: '#4bcffa', KH: '#f8a5c2', KO: '#f8a5c2', LH: '#78e08f', LO: '#78e08f', ZH: '#f9ca24', ZO: '#f9ca24', GH: '#c3c3c3', GO: '#c3c3c3',
  // T3
  XUH2O: '#4bcffa', XUHO2: '#4bcffa', XKH2O: '#f8a5c2', XKHO2: '#f8a5c2', XLH2O: '#78e08f', XLHO2: '#78e08f', XZH2O: '#f9ca24', XZHO2: '#f9ca24', XGHO2: '#c3c3c3',
  // Power / Ops / Bio
  power: '#f1c40f', ops: '#e74c3c',
  biomass: '#27ae60', metal: '#95a5a6', silicon: '#3498db', mist: '#9b59b6',
}

// Badge palette: 80 colors matching the server's hsl2rgb palette
function badgePaletteColor(index: number): string {
  const row = Math.floor(index / 20)
  const col = index % 20
  if (col === 0) {
    const l = [0.8, 0.5, 0.3, 0.1][row] ?? 0.5
    return `hsl(0,0%,${Math.round(l * 100)}%)`
  }
  const hue = Math.round(((col - 1) * 360) / 19)
  const [s, l] = [[0.6, 0.8], [0.7, 0.5], [0.4, 0.3], [0.5, 0.1]][row] ?? [0.6, 0.5]
  return `hsl(${hue},${Math.round(s * 100)}%,${Math.round(l * 100)}%)`
}

function resolveBadgeColor(color: string | number | undefined): string | null {
  if (color == null) return null
  if (typeof color === 'string') return color
  return badgePaletteColor(color)
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

// Official renderer: move goes on bottom half (backSide), others fan symmetrically from top.
// Carry and tough are excluded from the ring.
// Each part type appears mirrored on both sides of the vertical axis.
const RING_PARTS: { type: BodyPartType; color: string; backSide: boolean }[] = [
  { type: 'work',          color: '#fde574', backSide: false },
  { type: 'attack',        color: '#f72e41', backSide: false },
  { type: 'ranged_attack', color: '#7fa7e5', backSide: false },
  { type: 'heal',          color: '#56cf5e', backSide: false },
  { type: 'claim',         color: '#b99cfb', backSide: false },
  { type: 'move',          color: '#aab7c5', backSide: true  },
]
const RING_PART_ANGLE = Math.PI / 50  // radians per 1 body part (50 parts = PI = half circle each side)

function drawBodyRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  lineWidth: number,
  counts: Record<BodyPartType, number>,
) {
  const ANGLE_SHIFT = -Math.PI / 2  // start from top
  let frontAngle = 0   // grows from top toward sides
  let backAngle = Math.PI  // grows from bottom toward sides

  for (const { type, color, backSide } of RING_PARTS) {
    const count = counts[type]
    if (!count) continue
    const sweep = RING_PART_ANGLE * count
    const start = backSide ? backAngle : frontAngle

    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth
    ctx.lineCap = 'butt'

    // Right side arc (clockwise)
    ctx.beginPath()
    ctx.arc(cx, cy, radius, ANGLE_SHIFT + start, ANGLE_SHIFT + start + sweep, false)
    ctx.stroke()

    // Left side mirror (counterclockwise)
    ctx.beginPath()
    ctx.arc(cx, cy, radius, ANGLE_SHIFT - start, ANGLE_SHIFT - start - sweep, true)
    ctx.stroke()

    if (backSide) backAngle += sweep
    else frontAngle += sweep
  }
}

function buildTerrainCanvas(terrain: TerrainCell[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_SIZE
  canvas.height = CANVAS_SIZE
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = COLORS.plain
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

  for (let y = 0; y < ROOM_SIZE; y++) {
    for (let x = 0; x < ROOM_SIZE; x++) {
      const cell = terrain[y * ROOM_SIZE + x]
      if (!cell || cell === 'plain') continue
      const px = x * TILE, py = y * TILE
      if (cell === 'wall') {
        ctx.fillStyle = COLORS.wall
        ctx.fillRect(px, py, TILE, TILE)
        ctx.fillStyle = COLORS.wallBorder
        ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2)
        ctx.fillStyle = COLORS.wall
        ctx.fillRect(px + 3, py + 3, TILE - 6, TILE - 6)
      } else {
        ctx.fillStyle = COLORS.swamp
        ctx.fillRect(px, py, TILE, TILE)
        ctx.fillStyle = COLORS.swampDot
        ctx.fillRect(px + 6, py + 10, 2, 2)
        ctx.fillRect(px + 18, py + 6, 2, 2)
        ctx.fillRect(px + 24, py + 20, 2, 2)
        ctx.fillRect(px + 10, py + 24, 2, 2)
      }
    }
  }

  const half = CANVAS_SIZE / 2
  const vignette = ctx.createRadialGradient(half, half, half * 0.3, half, half, half * 1.1)
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,0,0,0.22)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

  return canvas
}

const ACTION_COLORS: Record<string, string> = {
  harvest:           '#ffe56d',
  transferEnergy:    '#4bcffa',
  build:             '#7fb3f0',
  repair:            '#5b9ef4',
  attack:            '#e05050',
  rangedAttack:      '#e07050',
  attacked:          '#ff4040',
  heal:              '#7dc97d',
  healed:            '#7dc97d',
  rangedHeal:        '#7dc97d',
  rangedMassAttack:  '#e05050',
  upgradeController: '#c084fc',
  reserveController: '#4bcffa',
}

function drawActions(
  ctx: CanvasRenderingContext2D,
  objects: Record<string, RoomObject>,
  alpha: number,
) {
  for (const obj of Object.values(objects)) {
    if (!obj.actionLog || obj.x == null || obj.y == null) continue
    const ox = obj.x * TILE + TILE / 2
    const oy = obj.y * TILE + TILE / 2

    for (const [action, target] of Object.entries(obj.actionLog)) {
      if (!target || action === 'say') continue
      if (!('x' in target) || typeof target.x !== 'number') continue
      const color = ACTION_COLORS[action] ?? '#ffffff'
      const tx = (target as ActionTarget).x * TILE + TILE / 2
      const ty = (target as ActionTarget).y * TILE + TILE / 2

      ctx.save()
      ctx.globalAlpha = alpha * 0.75

      // Main beam
      const grad = ctx.createLinearGradient(ox, oy, tx, ty)
      grad.addColorStop(0, color + 'cc')
      grad.addColorStop(1, color + '22')
      ctx.strokeStyle = grad
      ctx.lineWidth = (action === 'attack' || action === 'rangedAttack' || action === 'attacked' || action === 'rangedMassAttack') ? 2.5 : 1.5
      ctx.shadowColor = color
      ctx.shadowBlur = 6
      ctx.beginPath()
      ctx.moveTo(ox, oy)
      ctx.lineTo(tx, ty)
      ctx.stroke()

      // Dot at target
      ctx.shadowBlur = 10
      ctx.fillStyle = color + 'aa'
      ctx.beginPath()
      ctx.arc(tx, ty, action === 'harvest' ? 5 : 3, 0, Math.PI * 2)
      ctx.fill()

      // Harvest: radiating rays at target
      if (action === 'harvest') {
        const rayCount = 6
        ctx.lineWidth = 1
        ctx.shadowBlur = 4
        for (let r = 0; r < rayCount; r++) {
          const angle = (Math.PI * 2 * r) / rayCount
          ctx.beginPath()
          ctx.moveTo(tx + Math.cos(angle) * 4, ty + Math.sin(angle) * 4)
          ctx.lineTo(tx + Math.cos(angle) * 10, ty + Math.sin(angle) * 10)
          ctx.stroke()
        }
      }

      ctx.restore()
    }
  }
}

function drawObjects(
  ctx: CanvasRenderingContext2D,
  objects: Record<string, RoomObject>,
  userId: string | undefined,
  roomUsers: Record<string, { username?: string; badge?: { color1?: string | number } }> | undefined,
  fromPos: Map<string, { x: number; y: number }>,
  t: number,
) {
  const sorted = Object.values(objects).sort((a, b) => {
    const order = ['source', 'mineral', 'controller', 'constructedWall', 'rampart', 'road',
      'spawn', 'extension', 'tower', 'storage', 'terminal', 'lab', 'link', 'factory',
      'creep', 'powerCreep', 'resource', 'ruin', 'tombstone']
    return (order.indexOf(a.type) ?? 99) - (order.indexOf(b.type) ?? 99)
  })

  // Pre-compute road positions for connected rendering
  const roadSet = new Set<string>()
  for (const obj of sorted) {
    if (obj.type === 'road' && obj.x != null && obj.y != null) {
      roadSet.add(`${obj.x},${obj.y}`)
    }
  }

  for (const obj of sorted) {
    if (typeof obj.x !== 'number' || typeof obj.y !== 'number') continue

    let rx = obj.x, ry = obj.y
    if (obj.type === 'creep' || obj.type === 'powerCreep') {
      const from = fromPos.get(obj._id)
      if (from && (from.x !== obj.x || from.y !== obj.y)) {
        const et = easeInOut(t)
        rx = lerp(from.x, obj.x, et)
        ry = lerp(from.y, obj.y, et)
      }
    }

    const cx = rx * TILE + TILE / 2
    const cy = ry * TILE + TILE / 2
    const isOwn = obj.user === userId

    ctx.save()
    switch (obj.type) {
      case 'source': {
        const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, TILE * 0.9)
        g.addColorStop(0, 'rgba(255,229,80,0.35)')
        g.addColorStop(1, 'rgba(255,229,80,0)')
        ctx.fillStyle = g
        ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.9, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.28, 0, Math.PI * 2)
        ctx.fillStyle = '#ffe56d'; ctx.fill()
        break
      }
      case 'mineral': {
        const mColor = MINERAL_COLORS[obj.mineralType ?? ''] ?? '#b2bec3'
        ctx.beginPath()
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i - Math.PI / 6, r = TILE * 0.32
          if (i === 0) {
            ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
          } else {
            ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
          }
        }
        ctx.closePath(); ctx.fillStyle = mColor; ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.5; ctx.stroke()
        if (obj.mineralType) {
          ctx.fillStyle = 'rgba(0,0,0,0.7)'
          ctx.font = `bold ${TILE * 0.3}px monospace`
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillText(obj.mineralType, cx, cy)
        }
        break
      }
      case 'controller': {
        ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.46, 0, Math.PI * 2)
        ctx.strokeStyle = '#5b8dd9'; ctx.lineWidth = 2; ctx.stroke()
        if ((obj.level ?? 0) > 0) {
          ctx.beginPath()
          ctx.arc(cx, cy, TILE * 0.46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ((obj.level ?? 0) / 8))
          ctx.strokeStyle = '#7fb3f0'; ctx.lineWidth = 3; ctx.stroke()
        }
        ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.3, 0, Math.PI * 2)
        ctx.fillStyle = isOwn ? 'rgba(91,141,217,0.3)' : 'rgba(91,141,217,0.1)'; ctx.fill()
        if ((obj.level ?? 0) > 0) {
          ctx.fillStyle = '#7fb3f0'; ctx.font = `bold ${TILE * 0.32}px sans-serif`
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillText(String(obj.level), cx, cy)
        }
        break
      }
      case 'spawn': {
        ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.52, 0, Math.PI * 2)
        ctx.fillStyle = isOwn ? 'rgba(191,220,130,0.08)' : 'rgba(180,180,180,0.08)'; ctx.fill()
        ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.42, 0, Math.PI * 2)
        ctx.strokeStyle = isOwn ? '#bfdc82' : '#a0a0a0'; ctx.lineWidth = 2
        ctx.fillStyle = '#1a1a1a'; ctx.fill(); ctx.stroke()
        ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.24, 0, Math.PI * 2)
        ctx.strokeStyle = isOwn ? '#bfdc82' : '#a0a0a0'; ctx.lineWidth = 1.5; ctx.stroke()
        ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.1, 0, Math.PI * 2)
        ctx.fillStyle = isOwn ? '#bfdc82' : '#a0a0a0'; ctx.fill()
        if (obj.spawning) {
          ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.48, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(191,220,130,0.5)'; ctx.lineWidth = 2; ctx.stroke()
        }
        break
      }
      case 'extension': {
        ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.28, 0, Math.PI * 2)
        ctx.fillStyle = '#1c1c1c'; ctx.strokeStyle = isOwn ? '#bfdc82' : '#888'
        ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke()
        ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.12, 0, Math.PI * 2)
        ctx.fillStyle = isOwn ? 'rgba(191,220,130,0.8)' : 'rgba(136,136,136,0.8)'; ctx.fill()
        break
      }
      case 'tower': {
        const ts = TILE * 0.38
        ctx.fillStyle = '#1c1c1c'; ctx.strokeStyle = isOwn ? '#bfdc82' : '#888'; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.rect(cx - ts, cy - ts, ts * 2, ts * 2); ctx.fill(); ctx.stroke()
        ctx.fillStyle = isOwn ? '#bfdc82' : '#888'
        ctx.fillRect(cx - TILE * 0.07, cy - ts * 1.4, TILE * 0.14, ts * 0.9)
        break
      }
      case 'storage': {
        const ss = TILE * 0.4
        ctx.fillStyle = '#1a1a1a'; ctx.strokeStyle = isOwn ? '#bfdc82' : '#888'; ctx.lineWidth = 2
        ctx.beginPath(); ctx.roundRect(cx - ss, cy - ss * 0.8, ss * 2, ss * 1.6, 4); ctx.fill(); ctx.stroke()
        const energy = obj.store?.energy ?? 0
        if (energy > 0) {
          ctx.fillStyle = 'rgba(255,229,109,0.5)'
          ctx.fillRect(cx - ss + 3, cy - ss * 0.8 + 3, (ss * 2 - 6) * Math.min(energy / 1000000, 1), ss * 1.6 - 6)
        }
        break
      }
      case 'container': {
        const cs = TILE * 0.34
        ctx.fillStyle = '#222'; ctx.strokeStyle = '#555'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.rect(cx - cs, cy - cs * 0.7, cs * 2, cs * 1.4); ctx.fill(); ctx.stroke()
        const energy = obj.store?.energy ?? 0
        if (energy > 0) {
          ctx.fillStyle = 'rgba(255,229,109,0.4)'
          ctx.fillRect(cx - cs + 2, cy - cs * 0.7 + 2, (cs * 2 - 4) * Math.min(energy / 2000, 1), cs * 1.4 - 4)
        }
        break
      }
      case 'terminal': {
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 4)
        const tss = TILE * 0.38
        ctx.fillStyle = '#1c1c1c'; ctx.strokeStyle = isOwn ? '#bfdc82' : '#888'; ctx.lineWidth = 2
        ctx.beginPath(); ctx.rect(-tss, -tss, tss * 2, tss * 2); ctx.fill(); ctx.stroke()
        const ti = TILE * 0.18
        ctx.fillStyle = isOwn ? 'rgba(191,220,130,0.4)' : 'rgba(136,136,136,0.4)'
        ctx.fillRect(-ti, -ti, ti * 2, ti * 2); ctx.restore()
        break
      }
      case 'link': {
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 4)
        const ls = TILE * 0.26
        ctx.fillStyle = '#1c1c1c'; ctx.strokeStyle = isOwn ? '#bfdc82' : '#888'; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.rect(-ls, -ls, ls * 2, ls * 2); ctx.fill(); ctx.stroke()
        ctx.restore(); break
      }
      case 'lab': {
        ctx.beginPath(); ctx.arc(cx, cy + TILE * 0.06, TILE * 0.34, 0, Math.PI * 2)
        ctx.fillStyle = '#1c1c1c'; ctx.strokeStyle = isOwn ? '#bfdc82' : '#888'; ctx.lineWidth = 1.5
        ctx.fill(); ctx.stroke()
        // Flask neck
        ctx.fillStyle = isOwn ? '#bfdc82' : '#888'
        ctx.fillRect(cx - TILE * 0.08, cy - TILE * 0.44, TILE * 0.16, TILE * 0.22)
        // Liquid
        ctx.beginPath(); ctx.arc(cx, cy + TILE * 0.1, TILE * 0.18, 0, Math.PI * 2)
        ctx.fillStyle = isOwn ? 'rgba(191,220,130,0.4)' : 'rgba(136,136,136,0.3)'; ctx.fill()
        break
      }
      case 'factory': {
        const fs2 = TILE * 0.4
        ctx.fillStyle = '#1c1c1c'; ctx.strokeStyle = isOwn ? '#bfdc82' : '#888'; ctx.lineWidth = 2
        ctx.beginPath(); ctx.rect(cx - fs2, cy - fs2, fs2 * 2, fs2 * 2); ctx.fill(); ctx.stroke()
        // Gear teeth (simplified)
        const teeth = 8; const ir = TILE * 0.16; const or2 = TILE * 0.26
        ctx.beginPath()
        for (let i = 0; i < teeth; i++) {
          const a1 = (Math.PI * 2 * i) / teeth - Math.PI / teeth / 2
          const a2 = a1 + Math.PI / teeth
          const a3 = a2 + Math.PI / teeth / 2
          ctx.lineTo(cx + or2 * Math.cos(a1), cy + or2 * Math.sin(a1))
          ctx.lineTo(cx + or2 * Math.cos(a2), cy + or2 * Math.sin(a2))
          ctx.lineTo(cx + ir * Math.cos(a3), cy + ir * Math.sin(a3))
        }
        ctx.closePath()
        ctx.fillStyle = isOwn ? 'rgba(191,220,130,0.6)' : 'rgba(136,136,136,0.5)'; ctx.fill()
        ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.1, 0, Math.PI * 2)
        ctx.fillStyle = '#1c1c1c'; ctx.fill()
        break
      }
      case 'observer': {
        ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.3, 0, Math.PI * 2)
        ctx.fillStyle = '#1c1c1c'; ctx.strokeStyle = isOwn ? '#bfdc82' : '#888'; ctx.lineWidth = 1.5
        ctx.fill(); ctx.stroke()
        // Eye
        ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.14, 0, Math.PI * 2)
        ctx.fillStyle = isOwn ? 'rgba(191,220,130,0.8)' : 'rgba(136,136,136,0.7)'; ctx.fill()
        ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.06, 0, Math.PI * 2)
        ctx.fillStyle = '#111'; ctx.fill()
        break
      }
      case 'extractor': {
        // Hexagon ring
        ctx.beginPath()
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i - Math.PI / 6
          const r = TILE * 0.44
          if (i === 0) ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
          else ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
        }
        ctx.closePath()
        ctx.strokeStyle = isOwn ? 'rgba(191,220,130,0.7)' : 'rgba(136,136,136,0.6)'; ctx.lineWidth = 2; ctx.stroke()
        // Inner ring
        ctx.beginPath()
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i - Math.PI / 6
          const r = TILE * 0.28
          if (i === 0) ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
          else ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
        }
        ctx.closePath()
        ctx.strokeStyle = isOwn ? 'rgba(191,220,130,0.4)' : 'rgba(136,136,136,0.3)'; ctx.lineWidth = 1.5; ctx.stroke()
        break
      }
      case 'nuker': {
        // Rocket / cone shape
        ctx.beginPath()
        ctx.moveTo(cx, cy - TILE * 0.44)
        ctx.lineTo(cx + TILE * 0.28, cy + TILE * 0.36)
        ctx.lineTo(cx - TILE * 0.28, cy + TILE * 0.36)
        ctx.closePath()
        ctx.fillStyle = '#1c1c1c'; ctx.strokeStyle = isOwn ? '#ff6b6b' : '#888'; ctx.lineWidth = 1.5
        ctx.fill(); ctx.stroke()
        ctx.beginPath(); ctx.arc(cx, cy + TILE * 0.08, TILE * 0.12, 0, Math.PI * 2)
        ctx.fillStyle = isOwn ? 'rgba(255,107,107,0.6)' : 'rgba(136,136,136,0.5)'; ctx.fill()
        break
      }
      case 'powerSpawn': {
        ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.42, 0, Math.PI * 2)
        ctx.fillStyle = '#1c1c1c'; ctx.strokeStyle = isOwn ? '#f1c40f' : '#888'; ctx.lineWidth = 2
        ctx.fill(); ctx.stroke()
        // Power symbol (P)
        ctx.beginPath(); ctx.arc(cx, cy - TILE * 0.06, TILE * 0.16, 0, Math.PI * 2)
        ctx.strokeStyle = isOwn ? '#f1c40f' : '#888'; ctx.lineWidth = 2; ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(cx - TILE * 0.16, cy - TILE * 0.32)
        ctx.lineTo(cx - TILE * 0.16, cy + TILE * 0.24)
        ctx.strokeStyle = isOwn ? '#f1c40f' : '#888'; ctx.lineWidth = 2; ctx.stroke()
        break
      }
      case 'road': {
        // Draw lines to adjacent road tiles
        ctx.strokeStyle = '#444'
        ctx.lineWidth = TILE * 0.18
        ctx.lineCap = 'round'
        const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]
        for (const [ddx, ddy] of dirs) {
          const nx = obj.x! + ddx, ny = obj.y! + ddy
          if (roadSet.has(`${nx},${ny}`)) {
            const ncx = nx * TILE + TILE / 2
            const ncy = ny * TILE + TILE / 2
            ctx.beginPath()
            ctx.moveTo(cx, cy)
            ctx.lineTo(ncx, ncy)
            ctx.stroke()
          }
        }
        // Small dot at each road tile
        ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.1, 0, Math.PI * 2)
        ctx.fillStyle = '#444'; ctx.fill()
        break
      }
      case 'constructedWall': {
        ctx.fillStyle = '#333'; ctx.strokeStyle = '#444'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.rect(cx - TILE * 0.46, cy - TILE * 0.46, TILE * 0.92, TILE * 0.92)
        ctx.fill(); ctx.stroke(); break
      }
      case 'rampart': {
        ctx.strokeStyle = isOwn ? 'rgba(80,180,80,0.6)' : 'rgba(200,80,80,0.6)'; ctx.lineWidth = 2
        ctx.beginPath(); ctx.rect(cx - TILE * 0.44, cy - TILE * 0.44, TILE * 0.88, TILE * 0.88)
        ctx.stroke(); break
      }
      case 'constructionSite': {
        ctx.strokeStyle = isOwn ? 'rgba(191,220,130,0.5)' : 'rgba(150,150,150,0.5)'; ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.beginPath(); ctx.rect(cx - TILE * 0.42, cy - TILE * 0.42, TILE * 0.84, TILE * 0.84)
        ctx.stroke(); ctx.setLineDash([])
        if (obj.progress != null && obj.progressTotal) {
          const pct = obj.progress / obj.progressTotal
          ctx.fillStyle = isOwn ? 'rgba(191,220,130,0.4)' : 'rgba(150,150,150,0.4)'
          ctx.fillRect(cx - TILE * 0.4, cy + TILE * 0.3, TILE * 0.8 * pct, TILE * 0.1)
        }
        break
      }
      case 'flag': {
        const primary = `hsl(${((obj.color ?? 1) - 1) * 36} 70% 55%)`
        const secondary = `hsl(${((obj.secondaryColor ?? 1) - 1) * 36} 70% 40%)`
        ctx.strokeStyle = '#111'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(cx - TILE * 0.14, cy + TILE * 0.38)
        ctx.lineTo(cx - TILE * 0.14, cy - TILE * 0.38)
        ctx.stroke()
        ctx.fillStyle = primary
        ctx.beginPath()
        ctx.moveTo(cx - TILE * 0.1, cy - TILE * 0.34)
        ctx.lineTo(cx + TILE * 0.3, cy - TILE * 0.22)
        ctx.lineTo(cx - TILE * 0.1, cy - TILE * 0.02)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = secondary
        ctx.beginPath()
        ctx.moveTo(cx - TILE * 0.1, cy - TILE * 0.02)
        ctx.lineTo(cx + TILE * 0.2, cy + TILE * 0.08)
        ctx.lineTo(cx - TILE * 0.1, cy + TILE * 0.2)
        ctx.closePath()
        ctx.fill()
        break
      }
      case 'creep':
      case 'powerCreep': {
        const counts = countBodyParts(obj.body)
        const badgeColor = resolveBadgeColor(roomUsers?.[obj.user ?? '']?.badge?.color1)
        const coreColor = isOwn ? '#4c4c4c' : '#575757'
        const ringOutline = isOwn ? '#2a2a2a' : '#323232'
        const playerColor = badgeColor ?? (isOwn ? '#ffe56d' : '#d8d8d8')
        const shadowRadius = TILE * 0.32
        const outerRadius = TILE * 0.38
        const innerRadius = TILE * 0.2

        ctx.beginPath(); ctx.arc(cx, cy + 2, shadowRadius, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill()

        // Glow halo màu badge
        ctx.beginPath(); ctx.arc(cx, cy, outerRadius + TILE * 0.1, 0, Math.PI * 2)
        ctx.strokeStyle = playerColor + '55'
        ctx.lineWidth = TILE * 0.08
        ctx.stroke()

        ctx.beginPath(); ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2)
        ctx.strokeStyle = ringOutline
        ctx.lineWidth = TILE * 0.16
        ctx.stroke()

        drawBodyRing(ctx, cx, cy, outerRadius, TILE * 0.14, counts)

        ctx.beginPath(); ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2)
        ctx.fillStyle = coreColor
        ctx.fill()
        ctx.strokeStyle = playerColor + 'aa'
        ctx.lineWidth = 1.5
        ctx.stroke()

        // Center dot màu badge
        ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.06, 0, Math.PI * 2)
        ctx.fillStyle = playerColor
        ctx.fill()

        if (obj.hits != null && obj.hitsMax != null && obj.hitsMax > 0) {
          const hpPct = obj.hits / obj.hitsMax
          const bw = TILE * 0.6, bh = 3
          const bx = cx - bw / 2, by = cy - TILE * 0.58
          ctx.fillStyle = 'rgba(0,0,0,0.5)'
          ctx.fillRect(bx, by, bw, bh)
          ctx.fillStyle = hpPct > 0.5 ? '#7dc97d' : hpPct > 0.25 ? '#f9ca24' : '#d96c6c'
          ctx.fillRect(bx, by, bw * hpPct, bh)
        }

        if (obj.actionLog?.say?.message) {
          const msg = obj.actionLog.say.message.slice(0, 20)
          const fs = TILE * 0.28
          ctx.font = `${fs}px monospace`
          const tw = ctx.measureText(msg).width
          const bw2 = tw + 8, bh2 = fs + 6
          const bx2 = cx - bw2 / 2, by2 = cy - TILE * 0.7 - bh2
          ctx.fillStyle = 'rgba(20,20,20,0.85)'
          ctx.beginPath(); ctx.rect(bx2, by2, bw2, bh2); ctx.fill()
          ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 0.5; ctx.stroke()
          ctx.fillStyle = '#eee'
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillText(msg, cx, by2 + bh2 / 2)
        }
        break
      }
      case 'resource': {
        const resType = (obj as { resourceType?: string }).resourceType ?? 'energy'
        const color = resType === 'energy' ? '#ffe56d' : (MINERAL_COLORS[resType] ?? '#ffffff')
        const amount = (obj as { amount?: number }).amount ?? 0
        const radius = Math.max(TILE * 0.08, TILE * 0.14 * Math.min(1, amount / 1000))
        
        ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx.fillStyle = color; ctx.fill()
        if (resType !== 'energy') {
          ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1; ctx.stroke()
        }
        break
      }
      default: {
        ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.18, 0, Math.PI * 2)
        ctx.fillStyle = '#666'; ctx.fill(); break
      }
    }
    ctx.restore()
  }
}

export default function RoomRenderer({ terrain, objects, roomUsers, userId, roomName, tickDuration = 1000, selectedObjectId, onTileClick }: RoomRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const isDraggingRef = useRef(false)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const panRef = useRef(pan)
  const zoomRef = useRef(zoom)
  const dragRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null)
  const didDragRef = useRef(false)
  const initializedRef = useRef(false)

  // Animation state
  const terrainCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const objectsRef = useRef(objects)
  const fromPosRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const tickDurationRef = useRef(tickDuration)
  const animStartRef = useRef<number>(0)
  const hoverTileRef = useRef<{ x: number; y: number } | null>(null)
  const userIdRef = useRef(userId)
  const roomUsersRef = useRef(roomUsers)
  const selectedObjectIdRef = useRef(selectedObjectId)

  useEffect(() => { panRef.current = pan }, [pan])
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => { tickDurationRef.current = tickDuration }, [tickDuration])
  useEffect(() => { userIdRef.current = userId }, [userId])
  useEffect(() => { roomUsersRef.current = roomUsers }, [roomUsers])
  useEffect(() => { selectedObjectIdRef.current = selectedObjectId }, [selectedObjectId])

  // Rebuild terrain offscreen canvas when terrain changes
  useEffect(() => {
    terrainCanvasRef.current = buildTerrainCanvas(terrain)
  }, [terrain])

  // When objects change (new tick): capture fromPositions, reset animation timer
  useLayoutEffect(() => {
    const now = performance.now()
    const elapsed = now - animStartRef.current
    const prevT = Math.min(1, elapsed / Math.max(100, tickDurationRef.current))
    const prevEased = easeInOut(prevT)

    const newFrom = new Map<string, { x: number; y: number }>()
    for (const obj of Object.values(objectsRef.current)) {
      if ((obj.type === 'creep' || obj.type === 'powerCreep') && obj.x != null && obj.y != null) {
        // Use the current visual (interpolated) position so animation is continuous
        const prevFrom = fromPosRef.current.get(obj._id)
        if (prevFrom && (prevFrom.x !== obj.x || prevFrom.y !== obj.y)) {
          newFrom.set(obj._id, {
            x: lerp(prevFrom.x, obj.x, prevEased),
            y: lerp(prevFrom.y, obj.y, prevEased),
          })
        } else {
          newFrom.set(obj._id, { x: obj.x, y: obj.y })
        }
      }
    }
    fromPosRef.current = newFrom
    objectsRef.current = objects
    animStartRef.current = now
  }, [objects])

  // Persistent render loop — deps=[] so it never restarts on hover/pan/zoom
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let rafId: number

    function draw() {
      const terrainCanvas = terrainCanvasRef.current
      if (terrainCanvas) {
        const elapsed = performance.now() - animStartRef.current
        const t = Math.min(1, elapsed / Math.max(100, tickDurationRef.current))
        ctx!.drawImage(terrainCanvas, 0, 0)
        // Rays fade out over the first half of the tick
        const rayAlpha = Math.max(0, 1 - t * 2)
        if (rayAlpha > 0) drawActions(ctx!, objectsRef.current, rayAlpha)
        drawObjects(ctx!, objectsRef.current, userIdRef.current, roomUsersRef.current, fromPosRef.current, t)
        // Highlight selected object
        const selId = selectedObjectIdRef.current
        if (selId) {
          const selObj = objectsRef.current[selId]
          if (selObj && selObj.x != null && selObj.y != null) {
            const sx = selObj.x * TILE + TILE / 2
            const sy = selObj.y * TILE + TILE / 2
            const now = performance.now()
            const pulse = 0.5 + 0.5 * Math.sin(now / 300)
            ctx!.save()
            ctx!.beginPath()
            ctx!.arc(sx, sy, TILE * 0.52 + pulse * 4, 0, Math.PI * 2)
            ctx!.strokeStyle = `rgba(255,229,80,${0.6 + pulse * 0.4})`
            ctx!.lineWidth = 2
            ctx!.stroke()
            ctx!.restore()
          }
        }
        // Hover tile highlight
        const ht = hoverTileRef.current
        if (ht) {
          ctx!.save()
          ctx!.strokeStyle = 'rgba(255,255,255,0.3)'
          ctx!.lineWidth = 1
          ctx!.strokeRect(ht.x * TILE + 0.5, ht.y * TILE + 0.5, TILE - 1, TILE - 1)
          ctx!.restore()
        }
      }
      rafId = requestAnimationFrame(draw)
    }

    rafId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafId)
  }, [])

  // Initial fit via ResizeObserver
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(entries => {
      if (initializedRef.current) return
      const { width: w, height: h } = entries[0]?.contentRect ?? {}
      if (!w || !h) return
      const z = Math.min(w, h) / CANVAS_SIZE
      const newPan = { x: (w - CANVAS_SIZE * z) / 2, y: (h - CANVAS_SIZE * z) / 2 }
      panRef.current = newPan
      zoomRef.current = z
      setPan(newPan)
      setZoom(z)
      initializedRef.current = true
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Non-passive wheel zoom
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const newZoom = Math.max(0.15, Math.min(12, zoomRef.current * factor))
      const rect = container.getBoundingClientRect()
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
    container.addEventListener('wheel', handler, { passive: false })
    return () => container.removeEventListener('wheel', handler)
  }, [])

  function tileAt(clientX: number, clientY: number) {
    const rect = containerRef.current!.getBoundingClientRect()
    const sx = clientX - rect.left
    const sy = clientY - rect.top
    const tx = Math.floor((sx - panRef.current.x) / (zoomRef.current * TILE))
    const ty = Math.floor((sy - panRef.current.y) / (zoomRef.current * TILE))
    return (tx >= 0 && tx < ROOM_SIZE && ty >= 0 && ty < ROOM_SIZE) ? { x: tx, y: ty } : null
  }

  function hideTooltip() {
    const el = tooltipRef.current
    if (el) el.style.display = 'none'
  }

  function updateTooltip(clientX: number, clientY: number, t: { x: number; y: number } | null) {
    const el = tooltipRef.current
    if (!el) return
    if (!t) { el.style.display = 'none'; return }
    const hits = Object.values(objectsRef.current).filter(o => o.x === t.x && o.y === t.y)
    if (!hits.length) { el.style.display = 'none'; return }
    const priority = ['spawn', 'creep', 'powerCreep', 'source', 'controller', 'mineral',
      'tower', 'storage', 'terminal', 'extension', 'link', 'container', 'road']
    hits.sort((a, b) => {
      const ai = priority.indexOf(a.type); const bi = priority.indexOf(b.type)
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
    })
    const lines = hits.map(obj => {
      const parts = [obj.type.toUpperCase()]
      if (obj.name) parts.push(obj.name)
      if (obj.mineralType) parts.push(obj.mineralType)
      if (obj.user) parts.push(`[${roomUsers?.[obj.user]?.username ?? obj.user.slice(0, 6)}]`)
      if (obj.level != null) parts.push(`lvl ${obj.level}`)
      if (obj.hits != null && obj.hitsMax != null) parts.push(`${obj.hits}/${obj.hitsMax}`)
      if (obj.progress != null && obj.progressTotal) parts.push(`⚒${obj.progress}/${obj.progressTotal}`)
      const energy = obj.store?.energy
      if (energy != null) parts.push(`⚡${energy}`)
      return parts.join(' ')
    })
    lines.push(`(${t.x}, ${t.y})`)
    const rect = containerRef.current!.getBoundingClientRect()
    el.style.display = ''
    el.style.left = `${clientX - rect.left + 14}px`
    el.style.top = `${clientY - rect.top + 14}px`
    el.textContent = ''
    for (const line of lines) {
      const div = document.createElement('div')
      div.textContent = line
      el.appendChild(div)
    }
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPanX: panRef.current.x, startPanY: panRef.current.y }
    didDragRef.current = false
    isDraggingRef.current = true
    containerRef.current!.style.cursor = 'grabbing'
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.startX
      const dy = e.clientY - dragRef.current.startY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        didDragRef.current = true
        const newPan = { x: dragRef.current.startPanX + dx, y: dragRef.current.startPanY + dy }
        panRef.current = newPan
        setPan(newPan)
        hideTooltip()
        hoverTileRef.current = null
        return
      }
    }
    const t = tileAt(e.clientX, e.clientY)
    hoverTileRef.current = t
    updateTooltip(e.clientX, e.clientY, t)
  }

  function handleMouseUp(e: React.MouseEvent) {
    const wasDrag = didDragRef.current
    dragRef.current = null
    didDragRef.current = false
    isDraggingRef.current = false
    containerRef.current!.style.cursor = 'crosshair'
    if (!wasDrag) {
      const t = tileAt(e.clientX, e.clientY)
      if (t) onTileClick?.(t.x, t.y)
    }
  }

  function fitToScreen() {
    const container = containerRef.current
    if (!container) return
    const { offsetWidth: w, offsetHeight: h } = container
    const z = Math.min(w, h) / CANVAS_SIZE
    const newPan = { x: (w - CANVAS_SIZE * z) / 2, y: (h - CANVAS_SIZE * z) / 2 }
    panRef.current = newPan; zoomRef.current = z
    setPan(newPan); setZoom(z)
  }

  function zoomBy(factor: number, centerX?: number, centerY?: number) {
    const container = containerRef.current
    if (!container) return
    const newZoom = Math.max(0.15, Math.min(12, zoomRef.current * factor))
    const w = container.offsetWidth, h = container.offsetHeight
    const sx = centerX ?? w / 2, sy = centerY ?? h / 2
    const cx = (sx - panRef.current.x) / zoomRef.current
    const cy = (sy - panRef.current.y) / zoomRef.current
    const newPan = { x: sx - cx * newZoom, y: sy - cy * newZoom }
    panRef.current = newPan; zoomRef.current = newZoom
    setPan(newPan); setZoom(newZoom)
  }

  return (
    <div
      ref={containerRef}
      className="viewer-container"
      style={{ cursor: 'crosshair' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        dragRef.current = null
        isDraggingRef.current = false
        containerRef.current!.style.cursor = 'crosshair'
        hoverTileRef.current = null
        hideTooltip()
      }}
    >
      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        style={{
          position: 'absolute',
          top: 0, left: 0,
          width: CANVAS_SIZE,
          height: CANVAS_SIZE,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          imageRendering: 'pixelated',
          userSelect: 'none',
        }}
      />

      {/* Zoom controls */}
      <div className="zoom-stack">
        <button className="square-btn" onClick={() => zoomBy(1.4)} title="Zoom in">+</button>
        <button className="square-btn zoom-fit" onClick={fitToScreen} title="Fit to screen">⊡</button>
        <button className="square-btn" onClick={() => zoomBy(1 / 1.4)} title="Zoom out">−</button>
      </div>

      {/* Room label */}
      <div className="viewer-room-label">
        <span className="viewer-room-name">{roomName}</span>
        <span className="viewer-zoom-level">{Math.round(zoom * 100)}%</span>
      </div>

      {/* Tooltip — managed via ref to avoid re-renders on mouse move */}
      <div ref={tooltipRef} className="room-tooltip" style={{ display: 'none' }} />
    </div>
  )
}
