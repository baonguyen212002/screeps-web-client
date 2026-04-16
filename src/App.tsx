import { useCallback, useEffect, useRef, useState } from 'react'
import Editor, { type Monaco } from '@monaco-editor/react'
import SockJS from 'sockjs-client'
import screepsTypes from 'virtual:screeps-types'

import './App.css'
import RoomRenderer from './RoomRenderer'
import ConsolePane from './ConsolePane'
import MemoryPane from './MemoryPane'
import MarketPane from './MarketPane'
import PowerCreepsPane from './PowerCreepsPane'
import MessagesPane from './MessagesPane'
import WorldMapModal from './WorldMapModal'
import CraftPane from './CraftPane'
import CpuChart from './CpuChart'
import LeaderboardPane from './LeaderboardPane'
import BadgeEditor from './BadgeEditor'
import type { LogEntry } from './ConsolePane'

type ScreepsUser = {
  _id: string
  username?: string
  cpu?: number
  gcl?: number
  power?: number
}

function gclLevel(gcl: number) {
  let level = 1
  while (Math.pow(level, 2.4) * 1000000 <= gcl) level++
  return level - 1 || 1
}
function gclProgress(gcl: number) {
  const level = gclLevel(gcl)
  const current = Math.pow(level, 2.4) * 1000000
  const next = Math.pow(level + 1, 2.4) * 1000000
  return { level, progress: gcl - current, total: next - current, pct: ((gcl - current) / (next - current)) * 100 }
}
function gplLevel(power: number) {
  let level = 0
  while (Math.pow(level + 1, 2.4) * 1000000 <= power) level++
  return level
}

type TerrainCell = 'plain' | 'wall' | 'swamp'

type RoomObject = {
  _id: string
  type: string
  room?: string
  x?: number
  y?: number
  user?: string
  level?: number
  progress?: number
  progressTotal?: number
  hits?: number
  hitsMax?: number
  store?: Record<string, number>
  storeCapacityResource?: Record<string, number>
  reservation?: { user?: string; ticksToEnd?: number }
  sign?: { user?: string; text?: string }
  name?: string
  spawning?: unknown
  structureType?: string
  mineralType?: string
  mineralAmount?: number
  color?: number
  secondaryColor?: number
  energy?: number
  energyCapacity?: number
  nextRegenerationTime?: number
  ticksToRegeneration?: number
  safeMode?: number
  safeModeAvailable?: number
  downgradeTime?: number
  effects?: Array<{ effect: number; level?: number; ticksRemaining: number }>
  ticksToLive?: number
  fatigue?: number
  body?: Array<{ type: string; hits: number; boost?: string }>
  density?: number
  nextSpawnTime?: number
  decayTime?: number
  deployTime?: number
  strongholdId?: string
  depositType?: string
  harvested?: number
  cooldownTime?: number
  lastCooldown?: number
  userSummoned?: string
  storeCapacity?: number
}

type RoomSnapshot = {
  objects: RoomObject[]
  users?: Record<string, { username?: string }>
  flags?: unknown
}

type BranchInfo = {
  branch: string
  activeWorld?: boolean
  activeSim?: boolean
  modules?: Record<string, string>
}

type RoomStatusInfo = {
  status?: string
  novice?: number
  respawnArea?: number
  openTime?: number
}

type FlagTuple = [string, number, number, number, number]

type ToolMode = 'none' | 'spawn' | 'build' | 'invader' | 'flag' | 'creep'
type DockTab = 'script' | 'console' | 'memory' | 'market' | 'craft' | 'power' | 'messages' | 'leaderboard'

type SocketPayload = Record<string, unknown>
type RoomSocketPayload = {
  objects?: Record<string, RoomObject | null>
  users?: Record<string, { username?: string }>
  gameTime?: number
  flags?: unknown
}
type ConsoleSocketPayload = {
  messages?: { log?: string[]; results?: string[] }
  error?: string
}
type CpuSocketPayload = {
  cpu?: number
  bucket?: number
  memory?: number
}
type ResourceSocketPayload = {
  credits?: number
}
type MemorySocketPayload = {
  data?: string
}

const TOKEN_KEY = 'screeps-web-client-token'
const SERVER_URL_KEY = 'screeps-web-client-server-url'
const SERVER_PASSWORD_KEY = 'screeps-web-client-server-password'
const USER_PASSWORD_KEY = 'screeps-web-client-user-password'
const USERNAME_KEY = 'screeps-web-client-username'
const USERNAME_HEADER = 'local-web-client'
const DEFAULT_ROOM = 'W3N5'
const ROOM_SIZE = 50
const DEFAULT_SERVER_URL = window.location.origin

const CONTROLLER_LEVELS: Record<number, number> = { 1: 200, 2: 45000, 3: 135000, 4: 405000, 5: 1215000, 6: 3645000, 7: 10935000 }

const BODY_PARTS: Record<string, { cost: number; color: string; label: string }> = {
  move: { cost: 50, color: '#a9b7c6', label: 'MOVE' },
  work: { cost: 100, color: '#ffe56d', label: 'WORK' },
  carry: { cost: 50, color: '#7f7f7f', label: 'CARRY' },
  attack: { cost: 80, color: '#f93842', label: 'ATTACK' },
  ranged_attack: { cost: 150, color: '#5d80b2', label: 'RANGED' },
  heal: { cost: 250, color: '#65fd62', label: 'HEAL' },
  claim: { cost: 600, color: '#b99cfb', label: 'CLAIM' },
  tough: { cost: 10, color: '#ffffff', label: 'TOUGH' },
}

const CONSTRUCTABLE_STRUCTURES: Array<{ type: string; label: string; level: number }> = [
  { type: 'road', label: 'Road', level: 1 },
  { type: 'spawn', label: 'Spawn', level: 1 },
  { type: 'rampart', label: 'Rampart', level: 1 },
  { type: 'constructedWall', label: 'Constructed Wall', level: 1 },
  { type: 'extension', label: 'Extension', level: 2 },
  { type: 'container', label: 'Container', level: 2 },
  { type: 'tower', label: 'Tower', level: 3 },
  { type: 'storage', label: 'Storage', level: 4 },
  { type: 'link', label: 'Link', level: 5 },
  { type: 'terminal', label: 'Terminal', level: 6 },
  { type: 'lab', label: 'Lab', level: 6 },
  { type: 'extractor', label: 'Extractor', level: 6 },
  { type: 'factory', label: 'Factory', level: 7 },
  { type: 'observer', label: 'Observer', level: 8 },
  { type: 'powerSpawn', label: 'Power Spawn', level: 8 },
  { type: 'nuker', label: 'Nuker', level: 8 },
]

const DEFAULT_MODULES: Record<string, string> = {
  main: `const spawnManager = require('spawn.manager')
const roleHarvester = require('role.harvester')
const roleUpgrader = require('role.upgrader')
const roleBuilder = require('role.builder')

module.exports.loop = function () {
  cleanupMemory()

  for (const name in Game.creeps) {
    const creep = Game.creeps[name]
    const role = creep.memory.role

    if (role === 'harvester') roleHarvester.run(creep)
    else if (role === 'upgrader') roleUpgrader.run(creep)
    else if (role === 'builder') roleBuilder.run(creep)
  }

  for (const name in Game.spawns) {
    spawnManager.run(Game.spawns[name])
  }
}

function cleanupMemory() {
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) delete Memory.creeps[name]
  }
}
`,
  'spawn.manager': `const WORKER_BODY = [WORK, CARRY, MOVE]

module.exports.run = function (spawn) {
  if (spawn.spawning) return

  const creeps = _.values(Game.creeps)
  const harvesters = _.filter(creeps, (creep) => creep.memory.role === 'harvester')
  const upgraders = _.filter(creeps, (creep) => creep.memory.role === 'upgrader')
  const builders = _.filter(creeps, (creep) => creep.memory.role === 'builder')

  if (harvesters.length < 2) return spawnCreep(spawn, 'harvester')
  if (upgraders.length < 2) return spawnCreep(spawn, 'upgrader')
  if (builders.length < 1) return spawnCreep(spawn, 'builder')
}

function spawnCreep(spawn, role) {
  const name = role + '-' + Game.time
  spawn.spawnCreep(WORKER_BODY, name, { memory: { role: role, working: false } })
}
`,
  'role.harvester': `module.exports.run = function (creep) {
  const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE)
  const target = findEnergyTarget(creep.room)

  if (creep.store.getFreeCapacity() === 0) creep.memory.working = true
  if (creep.store[RESOURCE_ENERGY] === 0) creep.memory.working = false

  if (!creep.memory.working) {
    if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { visualizePathStyle: { stroke: '#f1c40f' } })
    }
    return
  }

  if (target && creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { visualizePathStyle: { stroke: '#7dc97d' } })
  }
}

function findEnergyTarget(room) {
  return room.find(FIND_STRUCTURES, {
    filter: (structure) =>
      (structure.structureType === STRUCTURE_SPAWN ||
        structure.structureType === STRUCTURE_EXTENSION ||
        structure.structureType === STRUCTURE_TOWER) &&
      structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  })[0]
}
`,
  'role.upgrader': `module.exports.run = function (creep) {
  const controller = creep.room.controller
  const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE)

  if (!controller) return
  if (creep.store.getFreeCapacity() === 0) creep.memory.working = true
  if (creep.store[RESOURCE_ENERGY] === 0) creep.memory.working = false

  if (!creep.memory.working) {
    if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { visualizePathStyle: { stroke: '#f1c40f' } })
    }
    return
  }

  if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
    creep.moveTo(controller, { visualizePathStyle: { stroke: '#5b8dd9' } })
  }
}
`,
  'role.builder': `module.exports.run = function (creep) {
  const site = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES)
  const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE)

  if (creep.store.getFreeCapacity() === 0) creep.memory.working = true
  if (creep.store[RESOURCE_ENERGY] === 0) creep.memory.working = false

  if (!creep.memory.working) {
    if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { visualizePathStyle: { stroke: '#f1c40f' } })
    }
    return
  }

  if (site) {
    if (creep.build(site) === ERR_NOT_IN_RANGE) {
      creep.moveTo(site, { visualizePathStyle: { stroke: '#a78bfa' } })
    }
    return
  }

  if (creep.room.controller && creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
    creep.moveTo(creep.room.controller, { visualizePathStyle: { stroke: '#5b8dd9' } })
  }
}
`,
}

function decodeTerrain(encoded: string): TerrainCell[] {
  return Array.from({ length: ROOM_SIZE * ROOM_SIZE }, (_, index) => {
    const code = Number(encoded[index] ?? 0)
    if (code & 1) return 'wall'
    if (code & 2) return 'swamp'
    return 'plain'
  })
}

function applyDiff(
  previous: Record<string, RoomObject>,
  diff: Record<string, RoomObject | null> | undefined,
): Record<string, RoomObject> {
  if (!diff) return previous
  const next = { ...previous }
  for (const [id, value] of Object.entries(diff)) {
    if (value === null) { delete next[id]; continue }
    next[id] = { ...(next[id] ?? {}), ...value }
  }
  return next
}

function indexObjects(objects: RoomObject[] | undefined): Record<string, RoomObject> {
  return Object.fromEntries((objects ?? []).map((o) => [o._id, o]))
}

function flagObjects(flags: unknown): RoomObject[] {
  if (!flags) return []

  // String format from private server: "name~color~sc~x~y" entries separated by
  // newline or pipe characters.
  if (typeof flags === 'string') {
    if (!flags.trim()) return []
    let lines = flags.split('\n').filter(l => l.trim())
    // Some servers join multiple flags with pipe at the top level
    if (lines.length === 1 && lines[0].split('~').length > 5) {
      // More than 5 tilde-separated parts means multiple flags concatenated
      // Try splitting by pipe first
      if (lines[0].includes('|')) {
        lines = lines[0].split('|').filter(l => l.trim())
      }
    }
    return lines.map(line => {
      const parts = line.split('~')
      if (parts.length < 5) return null
      return {
        _id: `flag:${parts[0]}`,
        type: 'flag',
        name: parts[0],
        color: Number(parts[1]) || 1,
        secondaryColor: Number(parts[2]) || 1,
        x: Number(parts[3]) || 0,
        y: Number(parts[4]) || 0,
      }
    }).filter(Boolean) as RoomObject[]
  }

  // Array of tuples: [[name, color, sc, x, y], ...]
  if (Array.isArray(flags)) {
    return (flags as FlagTuple[]).map(([name, color, secondaryColor, x, y]) => ({
      _id: `flag:${name}`,
      type: 'flag',
      name,
      color,
      secondaryColor,
      x,
      y,
    }))
  }

  // Object/Record format: { flagName: [name, color, sc, x, y] }
  if (typeof flags === 'object') {
    return Object.values(flags as Record<string, FlagTuple>).map(([name, color, secondaryColor, x, y]) => ({
      _id: `flag:${name}`,
      type: 'flag',
      name,
      color,
      secondaryColor,
      x,
      y,
    }))
  }

  return []
}

function indexRoomState(snapshot: RoomSnapshot): Record<string, RoomObject> {
  return indexObjects([...(snapshot.objects ?? []), ...flagObjects(snapshot.flags)])
}

function objectSelectionPriority(object: RoomObject): number {
  switch (object.type) {
    case 'constructionSite': return 0
    case 'flag': return 1
    case 'spawn':
    case 'extension':
    case 'tower':
    case 'storage':
    case 'terminal':
    case 'lab':
    case 'link':
    case 'factory':
    case 'road':
    case 'rampart':
    case 'constructedWall':
    case 'container':
    case 'observer':
    case 'extractor':
    case 'nuker':
    case 'powerSpawn':
      return 2
    case 'controller':
    case 'source':
    case 'mineral':
    case 'deposit':
      return 3
    case 'creep':
    case 'powerCreep':
      return 9
    default:
      return 5
  }
}

function pickObjectAtTile(
  objects: Record<string, RoomObject>,
  x: number,
  y: number,
  selectedObjectId?: string,
): RoomObject | null {
  const matches = Object.values(objects)
    .filter((object) => object.x === x && object.y === y)
    .sort((a, b) => {
      const byPriority = objectSelectionPriority(a) - objectSelectionPriority(b)
      if (byPriority !== 0) return byPriority
      return String(a._id).localeCompare(String(b._id))
    })

  if (matches.length === 0) return null
  if (!selectedObjectId) return matches[0]

  const currentIndex = matches.findIndex((object) => object._id === selectedObjectId)
  if (currentIndex === -1) return matches[0]
  return matches[(currentIndex + 1) % matches.length]
}

function humanizeObjectType(type: string): string {
  switch (type) {
    case 'constructionSite':
      return 'Construction Site'
    case 'powerCreep':
      return 'Power Creep'
    case 'constructedWall':
      return 'Constructed Wall'
    default:
      return type.replace(/([a-z])([A-Z])/g, '$1 $2')
  }
}

function humanizeStructureType(type: string): string {
  const entry = CONSTRUCTABLE_STRUCTURES.find((item) => item.type === type)
  if (entry) return entry.label
  return humanizeObjectType(type)
}

function canConstructStructure(type: string, rcl: number | null | undefined): boolean {
  const entry = CONSTRUCTABLE_STRUCTURES.find((item) => item.type === type)
  if (!entry) return false
  return (rcl ?? 0) >= entry.level
}

function reportIgnoredError(error: unknown): void {
  void error
}

function dockTabLabel(tab: DockTab): string {
  switch (tab) {
    case 'script': return 'Code'
    case 'console': return 'Console'
    case 'memory': return 'Memory'
    case 'market': return 'Market'
    case 'craft': return 'Craft'
    case 'power': return 'Power Creeps'
    case 'messages': return 'Messages'
    case 'leaderboard': return 'Leaderboard'
  }
}

function worldStatusLabel(status: string): string {
  switch (status) {
    case 'normal': return 'colony active'
    case 'empty': return 'choose start room'
    case 'spawn': return 'place first spawn'
    case 'lost': return 'respawn required'
    default: return status || 'unknown'
  }
}

function branchRoleLabel(branch: BranchInfo): string {
  if (branch.activeWorld) return 'world'
  if (branch.activeSim) return 'sim'
  return 'branch'
}


async function readResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? ''
  const raw = await response.text()

  if (!contentType.includes('application/json')) {
    const snippet = raw.trim().slice(0, 80)
    throw new Error(snippet.startsWith('<') ? `Expected JSON but received HTML (${response.status})` : `Expected JSON but received ${contentType || 'non-JSON'} (${response.status})`)
  }

  let payload: ({ ok?: number; error?: string } & T)
  try {
    payload = JSON.parse(raw) as { ok?: number; error?: string } & T
  } catch {
    throw new Error(`Invalid JSON response (${response.status})`)
  }

  if (!response.ok || payload.error || ('ok' in payload && payload.ok !== 1)) {
    throw new Error(payload.error || `Request failed with status ${response.status}`)
  }
  return payload
}

async function decompressGz(b64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  writer.write(bytes)
  writer.close()
  return new Response(ds.readable).text()
}

function SpawnConfirmDialog({ x, y, defaultName, onConfirm, onCancel }: {
  x: number; y: number; defaultName: string
  onConfirm: (name: string) => void; onCancel: () => void
}) {
  const [name, setName] = useState(defaultName || 'Spawn1')
  return (
    <div className="spawn-confirm-overlay" onClick={onCancel}>
      <div className="spawn-confirm-card" onClick={(e) => e.stopPropagation()}>
        <div className="spawn-confirm-title">Place Spawn</div>
        <div className="spawn-confirm-pos">Position: ({x}, {y})</div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Spawn name"
          onKeyDown={(e) => {
            if (e.key === 'Enter') onConfirm(name)
            if (e.key === 'Escape') onCancel()
          }}
        />
        <div className="spawn-confirm-btns">
          <button className="btn-primary" onClick={() => onConfirm(name)}>Place Spawn</button>
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function SpawnCalculator() {
  const [parts, setParts] = useState<string[]>([])
  const totalCost = parts.reduce((s, p) => s + (BODY_PARTS[p]?.cost ?? 0), 0)
  const moveParts = parts.filter((p) => p === 'move').length
  const otherParts = parts.length - moveParts
  const plainFatigue = otherParts * 2
  const moveReduce = moveParts * 2
  const plainSpeed = moveReduce >= plainFatigue ? '1/tick' : moveReduce > 0 ? `1/${Math.ceil(plainFatigue / moveReduce)}t` : 'immobile'

  return (
    <div className="stack" style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        {Object.entries(BODY_PARTS).map(([key, info]) => (
          <button key={key} className="tool-tab" style={{ fontSize: '0.65rem', padding: '2px 4px', flex: 'none' }}
            onClick={() => parts.length < 50 && setParts([...parts, key])}>
            <span style={{ color: info.color }}>{info.label[0]}</span>
            <span className="muted" style={{ fontSize: '0.6rem', marginLeft: 2 }}>{info.cost}</span>
          </button>
        ))}
      </div>
      {parts.length > 0 && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {parts.map((p, i) => (
              <span key={i} style={{
                fontSize: '0.65rem', padding: '1px 4px', borderRadius: 2,
                background: 'rgba(255,255,255,0.08)', color: BODY_PARTS[p]?.color ?? '#fff',
                cursor: 'pointer', fontFamily: 'var(--font-mono)',
              }} onClick={() => setParts(parts.filter((_, j) => j !== i))}>
                {p.slice(0, 2).toUpperCase()}
              </span>
            ))}
          </div>
          <div style={{ fontSize: '0.7rem', lineHeight: 1.8, color: 'var(--text-muted)' }}>
            <div>Cost: <strong style={{ color: totalCost <= 300 ? '#7dc97d' : '#ffe56d' }}>{totalCost}</strong> energy · Parts: <strong>{parts.length}</strong></div>
            <div>Plain: <strong>{plainSpeed}</strong></div>
          </div>
          <button className="btn-ghost compact" style={{ fontSize: '0.68rem' }} onClick={() => setParts([])}>Clear</button>
        </>
      )}
    </div>
  )
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '')
  const [serverUrl] = useState(() => localStorage.getItem(SERVER_URL_KEY) ?? DEFAULT_SERVER_URL)
  const [serverPassword] = useState(() => localStorage.getItem(SERVER_PASSWORD_KEY) ?? '')
  const [loginName, setLoginName] = useState(() => localStorage.getItem(USERNAME_KEY) ?? '')
  const [userPassword, setUserPassword] = useState(() => localStorage.getItem(USER_PASSWORD_KEY) ?? '')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isRegistering, setIsRegistering] = useState(false)
  const [user, setUser] = useState<ScreepsUser | null>(null)
  const [worldStatus, setWorldStatus] = useState('disconnected')
  const [worldSize, setWorldSize] = useState<{ width: number; height: number } | null>(null)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [userRooms, setUserRooms] = useState<string[]>([])
  const [roomName, setRoomName] = useState(DEFAULT_ROOM)
  const [roomStatusInfo, setRoomStatusInfo] = useState<RoomStatusInfo | null>(null)
  const [terrain, setTerrain] = useState<TerrainCell[]>([])
  const [objects, setObjects] = useState<Record<string, RoomObject>>({})
  const [roomUsers, setRoomUsers] = useState<Record<string, { username?: string }>>({})
  const [gameTime, setGameTime] = useState<number | null>(null)
  const [tickDuration, setTickDuration] = useState<number | null>(null)
  const [modules, setModules] = useState<Record<string, string>>({ main: '' })
  const [activeModule, setActiveModule] = useState('main')
  const [editingBranch, setEditingBranch] = useState('default')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [cpuUsed, setCpuUsed] = useState<number | null>(null)
  const [cpuBucket, setCpuBucket] = useState<number | null>(null)
  const [cpuHistory, setCpuHistory] = useState<Array<{ cpu: number; memory: number }>>([])
  const [credits, setCredits] = useState<number | null>(null)
  const [spawnName, setSpawnName] = useState('Spawn1')
  const [busy, setBusy] = useState(false)
  const [socketState, setSocketState] = useState('offline')
  const [socketReconnectKey, setSocketReconnectKey] = useState(0)
  const [authError, setAuthError] = useState('')
  const [dockTab, setDockTab] = useState<DockTab>('script')
  const [dockHeight, setDockHeight] = useState(380)
  const [leftWidth, setLeftWidth] = useState(200)
  const [rightWidth, setRightWidth] = useState(210)
  const [toolMode, setToolMode] = useState<ToolMode>('none')
  const [showConstructMenu, setShowConstructMenu] = useState(false)
  const [showFlagMenu, setShowFlagMenu] = useState(false)
  const [showCreepMenu, setShowCreepMenu] = useState(false)
  const [selectedObject, setSelectedObject] = useState<RoomObject | null>(null)
  const [memoryWatchPath, setMemoryWatchPath] = useState('')
  const [memoryLiveValue, setMemoryLiveValue] = useState<string | null>(null)
  const [showWorldMap, setShowWorldMap] = useState(false)
  const [showBadgeEditor, setShowBadgeEditor] = useState(false)
  const [spawnConfirm, setSpawnConfirm] = useState<{ x: number; y: number } | null>(null)
  const [flagDraft, setFlagDraft] = useState({ name: 'Flag1', color: 1, secondaryColor: 1 })
  const [buildStructureType, setBuildStructureType] = useState('extension')
  const [memoryNavigatePath, setMemoryNavigatePath] = useState<string | null>(null)
  const [inspectedObjectData, setInspectedObjectData] = useState<RoomObject | null>(null)
  const [cloneSourceBranch, setCloneSourceBranch] = useState('default')
  const [newBranchName, setNewBranchName] = useState('')
  const [newModuleName, setNewModuleName] = useState('')

  const isDraggingDock = useRef(false); const dragStartY = useRef(0); const dragStartHeight = useRef(0)
  const isDraggingLeft = useRef(false); const isDraggingRight = useRef(false); const dragStartX = useRef(0); const dragStartWidth = useRef(0)
  const socketRef = useRef<{ close: () => void; send: (m: string) => void } | null>(null)
  const tokenRef = useRef(token); const userRef = useRef<ScreepsUser | null>(null)
  const hydratedProfileTokenRef = useRef(''); const memoryWatchPathRef = useRef('')
  const lastGameTimeRef = useRef<number | null>(null); const lastTickTimeRef = useRef<number | null>(null)
  const authVersionRef = useRef(0)
  const autoLoadedRoomRef = useRef(false)
  const reconnectCountRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const rotateToken = useCallback((nextToken: string | null) => {
    if (!nextToken) return
    tokenRef.current = nextToken; setToken(nextToken); localStorage.setItem(TOKEN_KEY, nextToken)
  }, [])

  const applyBranchModules = useCallback((branch: BranchInfo | undefined) => {
    if (branch?.modules) {
      const loaded: Record<string, string> = {}
      for (const [n, c] of Object.entries(branch.modules)) if (typeof c === 'string') loaded[n] = c
      if (Object.values(loaded).some((c) => c.trim().length > 0)) {
        setModules(loaded)
        setActiveModule((p) => (p in loaded ? p : Object.keys(loaded)[0]))
      } else {
        setModules(DEFAULT_MODULES)
        setActiveModule('main')
      }
      setEditingBranch(branch.branch)
      return
    }
    setModules(DEFAULT_MODULES)
    setActiveModule('main')
  }, [])

  function storeToken(nextToken: string) {
    tokenRef.current = nextToken; setToken(nextToken)
    if (!nextToken) hydratedProfileTokenRef.current = ''
    if (nextToken) localStorage.setItem(TOKEN_KEY, nextToken)
    else localStorage.removeItem(TOKEN_KEY)
  }

  function normalizeUsername(value: string) {
    const n = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
    return n.length >= 3 ? n : ''
  }

  const resetWorldView = useCallback(() => { setObjects({}); setRoomUsers({}); setTerrain([]); setRoomStatusInfo(null); setGameTime(null); setTickDuration(null); setRoomName(DEFAULT_ROOM); setSelectedObject(null) }, [])

  const handleSignOut = useCallback(() => {
    authVersionRef.current += 1
    socketRef.current?.close()
    socketRef.current = null
    memoryWatchPathRef.current = ''
    storeToken('')
    setUser(null)
    setBranches([])
    setLogs([])
    setCpuUsed(null)
    setCpuBucket(null)
    setCpuHistory([])
    setCredits(null)
    setSocketState('offline')
    setAuthError('')
    setBusy(false)
    setShowBadgeEditor(false)
    setShowWorldMap(false)
    setSpawnConfirm(null)
    setMemoryWatchPath('')
    setMemoryLiveValue(null)
    setMemoryNavigatePath(null)
    setInspectedObjectData(null)
    hydratedProfileTokenRef.current = ''
    localStorage.removeItem(USER_PASSWORD_KEY)
    resetWorldView()
    autoLoadedRoomRef.current = false
  }, [resetWorldView])

  useEffect(() => { tokenRef.current = token }, [token])
  useEffect(() => { userRef.current = user }, [user])

  const handleDockResizeStart = useCallback((e: React.MouseEvent) => {
    isDraggingDock.current = true; dragStartY.current = e.clientY; dragStartHeight.current = dockHeight; e.preventDefault()
  }, [dockHeight])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (isDraggingDock.current) setDockHeight(Math.max(220, Math.min(window.innerHeight - 140, dragStartHeight.current + (dragStartY.current - e.clientY))))
      if (isDraggingLeft.current) setLeftWidth(Math.max(140, Math.min(400, dragStartWidth.current + (e.clientX - dragStartX.current))))
      if (isDraggingRight.current) setRightWidth(Math.max(140, Math.min(400, dragStartWidth.current + (dragStartX.current - e.clientX))))
    }
    function onUp() { isDraggingDock.current = false; isDraggingLeft.current = false; isDraggingRight.current = false }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [])

  const apiFetch = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const requestAuthVersion = authVersionRef.current
    const h = new Headers(init?.headers ?? {})
    h.set('Content-Type', 'application/json')
    if (tokenRef.current) h.set('X-Token', tokenRef.current)
    h.set('X-Username', userRef.current?.username || normalizeUsername(loginName) || USERNAME_HEADER)
    if (serverPassword) h.set('X-Server-Password', serverPassword)
    const res = await fetch(`${serverUrl}${path}`, { ...init, headers: h })
    const rt = res.headers.get('X-Token'); if (rt && requestAuthVersion === authVersionRef.current && tokenRef.current) rotateToken(rt)
    return readResponse<T>(res)
  }, [serverUrl, serverPassword, loginName, rotateToken])

  const refreshProfile = useCallback(async () => {
    const me = await apiFetch<ScreepsUser>('/api/auth/me'); setUser(me)
    const w = await apiFetch<{ status: string }>('/api/user/world-status'); setWorldStatus(w.status)
    const b = await apiFetch<{ list: BranchInfo[] }>('/api/user/branches')
    setBranches(b.list ?? [])
    const tb = b.list.find((x) => x.branch === editingBranch) ?? b.list.find((x) => x.activeWorld) ?? b.list[0]
    applyBranchModules(tb)
    const rs = await apiFetch<{ rooms: string[] }>(`/api/user/rooms?id=${encodeURIComponent(me._id)}`); setUserRooms(rs.rooms ?? [])
  }, [apiFetch, editingBranch, applyBranchModules])

  const fetchRoomSnapshot = useCallback(async (room: string) => {
    const data = await apiFetch<RoomSnapshot>(`/api/game/room-objects?room=${encodeURIComponent(room)}`)
    setObjects((cur) => {
      const next = indexRoomState(data)
      // Preserve local flags when API doesn't return them
      if (!data.flags) {
        for (const [k, v] of Object.entries(cur)) {
          if (k.startsWith('flag:') && !(k in next)) next[k] = v
        }
      }
      return next
    })
    setRoomUsers(data.users ?? {})
  }, [apiFetch])

  const loadRoom = useCallback(async (room: string) => {
    const [terrainData, roomData, roomStatusData] = await Promise.all([
      apiFetch<{ terrain: Array<{ terrain: string }> }>(`/api/game/room-terrain?room=${encodeURIComponent(room)}&encoded=1`),
      apiFetch<RoomSnapshot>(`/api/game/room-objects?room=${encodeURIComponent(room)}`),
      apiFetch<{ room: RoomStatusInfo }>(`/api/game/room-status?room=${encodeURIComponent(room)}`),
    ])
    setTerrain(decodeTerrain(terrainData.terrain[0]?.terrain ?? ''))
    setObjects(indexRoomState(roomData)); setRoomUsers(roomData.users ?? {})
    setRoomStatusInfo(roomStatusData.room ?? null)
    setRoomName(room); setSelectedObject(null); lastGameTimeRef.current = null; lastTickTimeRef.current = null
  }, [apiFetch])

  const findAndLoadFreeRoom = useCallback(async () => {
    const sd = await apiFetch<{ width: number; height: number }>('/api/game/world-size')
    const max = Math.floor(Math.min(sd.width, sd.height) / 2); const rooms: string[] = []
    for (let x = 1; x <= max; x++) for (let y = 1; y <= max; y++) {
      if (x % 10 === 0 || y % 10 === 0) continue
      if (x % 10 >= 4 && x % 10 <= 6 && y % 10 >= 4 && y % 10 <= 6) continue
      rooms.push(`W${x}N${y}`)
    }
    for (let i = rooms.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[rooms[i], rooms[j]] = [rooms[j], rooms[i]] }
    const BATCH = 50
    for (let i = 0; i < rooms.length; i += BATCH) {
      const batch = rooms.slice(i, i + BATCH)
      const st = await apiFetch<{ stats: Record<string, { own?: unknown }> }>('/api/game/map-stats', { method: 'POST', body: JSON.stringify({ rooms: batch, statName: 'owner0' }) })
      const free = batch.find((r) => !st.stats[r]?.own)
      if (free) { await loadRoom(free); return }
    }
    await loadRoom(DEFAULT_ROOM)
  }, [apiFetch, loadRoom])

  const bootstrapSession = useCallback(async () => {
    const u = normalizeUsername(loginName)
    if (!u || !userPassword) { setAuthError('Required'); return }
    if (isRegistering && confirmPassword !== userPassword) { setAuthError('Passwords do not match'); return }
    setBusy(true); setAuthError('')
    try {
      const ep = isRegistering ? '/api/auth/register' : '/api/auth/signin'
      const auth = await apiFetch<{ token: string }>(ep, { method: 'POST', body: JSON.stringify({ username: u, password: userPassword }) })
      localStorage.setItem(USERNAME_KEY, u); localStorage.setItem(USER_PASSWORD_KEY, userPassword)
      resetWorldView(); setUser(null); if (isRegistering) setIsRegistering(false)
      autoLoadedRoomRef.current = true
      storeToken(auth.token); await refreshProfile()
      const sr = await apiFetch<{ room: string[] }>('/api/user/world-start-room')
      let ok = false
      if (sr.room.length > 0) {
        try {
          const ch = await apiFetch<{ objects: RoomObject[] }>(`/api/game/room-objects?room=${encodeURIComponent(sr.room[0])}`)
          if (ch.objects?.some((o) => o.type === 'controller')) { await loadRoom(sr.room[0]); ok = true }
        } catch (error) { reportIgnoredError(error) }
      }
      if (!ok) await findAndLoadFreeRoom()
    } catch (e) { setAuthError(e instanceof Error ? e.message : 'Error') } finally { setBusy(false) }
  }, [apiFetch, isRegistering, loginName, userPassword, refreshProfile, loadRoom, findAndLoadFreeRoom, resetWorldView])

  useEffect(() => {
    void apiFetch<{ width: number; height: number }>('/api/game/world-size').then((s) => setWorldSize(s)).catch(() => { })
  }, [apiFetch])

  useEffect(() => {
    if (!token || user) return
    if (hydratedProfileTokenRef.current) return
    hydratedProfileTokenRef.current = token
    void refreshProfile().catch(() => {
      hydratedProfileTokenRef.current = ''
    })
  }, [token, user, refreshProfile])
  useEffect(() => { resetWorldView() }, [user?._id, resetWorldView])

  // Auto-load room on page reload (hydration path)
  useEffect(() => {
    if (!user || terrain.length > 0 || autoLoadedRoomRef.current) return
    autoLoadedRoomRef.current = true
    void (async () => {
      try {
        const sr = await apiFetch<{ room: string[] }>('/api/user/world-start-room')
        if (sr.room?.length > 0) {
          try {
            const ch = await apiFetch<{ objects: RoomObject[] }>(`/api/game/room-objects?room=${encodeURIComponent(sr.room[0])}`)
            if (ch.objects?.some((o) => o.type === 'controller')) { await loadRoom(sr.room[0]); return }
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      try { await loadRoom(DEFAULT_ROOM) } catch { /* ignore */ }
    })()
  }, [user, terrain.length, apiFetch, loadRoom])

  useEffect(() => {
    if (!tokenRef.current || !roomName) return
    const socket = new SockJS('/socket')
    socketRef.current = socket; setSocketState('connecting')
    const socketAuthVersion = authVersionRef.current
    socket.onopen = () => { if (socketRef.current !== socket || socketAuthVersion !== authVersionRef.current) return; setSocketState('authenticating'); socket.send(`auth ${tokenRef.current}`) }
    socket.onmessage = (ev) => {
      if (socketRef.current !== socket || socketAuthVersion !== authVersionRef.current) return
      const msg = String(ev.data)
      if (msg.startsWith('auth ok ')) { reconnectCountRef.current = 0; rotateToken(msg.slice(8)); setSocketState('live'); socket.send(`subscribe room:${roomName}`); if (userRef.current) { ['console', 'cpu', 'resources', 'code'].forEach(s => socket.send(`subscribe user:${userRef.current!._id}/${s}`)); if (memoryWatchPathRef.current) socket.send(`subscribe user:${userRef.current!._id}/memory/${memoryWatchPathRef.current}`) }; return }
      if (msg.startsWith('auth failed')) { storeToken(''); setSocketState('auth failed'); return }
      if (!msg.startsWith('[')) return
      const [ch, d] = JSON.parse(msg) as [string, SocketPayload]
      if (ch === `room:${roomName}`) {
        const payload = d as RoomSocketPayload
        setObjects((cur) => {
          let next = applyDiff(cur, payload.objects)
          // Process flags from socket: replace all flags with the fresh set
          if (payload.flags != null) {
            const cleaned: Record<string, RoomObject> = {}
            for (const [k, v] of Object.entries(next)) {
              if (!k.startsWith('flag:')) cleaned[k] = v
            }
            for (const f of flagObjects(payload.flags)) {
              cleaned[f._id] = f
            }
            next = cleaned
          }
          return next
        }); if (payload.users) setRoomUsers((cur) => ({ ...cur, ...payload.users }))
        if (payload.gameTime !== undefined) { const now = Date.now(); if (lastGameTimeRef.current != null && lastTickTimeRef.current != null && payload.gameTime > lastGameTimeRef.current) setTickDuration(now - lastTickTimeRef.current); lastGameTimeRef.current = payload.gameTime; lastTickTimeRef.current = now; setGameTime(payload.gameTime) }
      } else if (ch.includes('/console')) {
        const payload = d as ConsoleSocketPayload
        const logs = payload.messages?.log
        const results = payload.messages?.results
        const errorMessage = payload.error
        if (logs) setLogs((p) => [...p, ...logs.map((m: string) => ({ timestamp: Date.now(), message: m, type: 'log' as const }))].slice(-200))
        if (results) setLogs((p) => [...p, ...results.map((m: string) => ({ timestamp: Date.now(), message: `← ${m}`, type: 'system' as const }))].slice(-200))
        if (typeof errorMessage === 'string') setLogs((p) => [...p, { timestamp: Date.now(), message: errorMessage, type: 'error' as const }].slice(-200))
      } else if (ch.includes('/cpu')) { const payload = d as CpuSocketPayload; const cpu = payload.cpu; if (cpu != null) { setCpuUsed(cpu); if (payload.bucket != null) setCpuBucket(payload.bucket); setCpuHistory((h) => [...h.slice(-59), { cpu, memory: payload.memory ?? 0 }]) } }
      else if (ch.includes('/resources')) { const payload = d as ResourceSocketPayload; if (payload.credits != null) setCredits(payload.credits) }
      else if (ch.includes('/memory/')) { const payload = d as MemorySocketPayload; const raw = String(payload.data ?? ''); if (raw.startsWith('gz:')) void decompressGz(raw.slice(3)).then(setMemoryLiveValue); else setMemoryLiveValue(raw) }
    }
    socket.onclose = () => {
      if (socketRef.current !== socket) return
      setSocketState('offline')
      // Auto-reconnect unless signed out or auth failed
      if (authVersionRef.current === socketAuthVersion && tokenRef.current) {
        const delay = Math.min(30000, 1000 * Math.pow(2, reconnectCountRef.current))
        reconnectCountRef.current++
        reconnectTimerRef.current = setTimeout(() => setSocketReconnectKey(k => k + 1), delay)
      }
    }
    return () => {
      socket.close()
      socketRef.current = null
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
    }
  }, [roomName, user?._id, rotateToken, socketReconnectKey])

  async function handleSaveCode() { setBusy(true); try { await apiFetch('/api/user/code', { method: 'POST', body: JSON.stringify({ branch: editingBranch, modules }) }) } catch (error) { reportIgnoredError(error) } finally { setBusy(false) } }
  function handleCreateModule() {
    const nextName = newModuleName.trim().replace(/\.js$/i, '')
    if (!nextName) return
    if (!/^[A-Za-z0-9_.-]+$/.test(nextName)) return
    if (modules[nextName] != null) {
      setActiveModule(nextName)
      setNewModuleName('')
      return
    }
    setModules((prev) => ({ ...prev, [nextName]: '' }))
    setActiveModule(nextName)
    setNewModuleName('')
  }
  async function handleConsoleExpression(expr: string) { try { await apiFetch('/api/user/console', { method: 'POST', body: JSON.stringify({ expression: expr }) }) } catch (error) { reportIgnoredError(error) } }
  async function handleMemoryFetch(path?: string): Promise<string> {
    const res = await apiFetch<{ data: string }>(`/api/user/memory${path ? `?path=${encodeURIComponent(path)}` : ''}`)
    let raw = res.data ?? 'null'; if (typeof raw === 'string' && raw.startsWith('gz:')) raw = await decompressGz(raw.slice(3)); return raw
  }
  async function handleMemorySave(path: string, val: string) { await apiFetch('/api/user/memory', { method: 'POST', body: JSON.stringify({ path, value: val }) }) }
  function handleMemoryWatch(path: string) { if (!userRef.current) return; if (memoryWatchPathRef.current) socketRef.current?.send(`unsubscribe user:${userRef.current._id}/memory/${memoryWatchPathRef.current}`); memoryWatchPathRef.current = path; setMemoryWatchPath(path); setMemoryLiveValue(null); socketRef.current?.send(`subscribe user:${userRef.current!._id}/memory/${path}`) }
  function handleMemoryUnwatch() { if (userRef.current && memoryWatchPathRef.current) socketRef.current?.send(`unsubscribe user:${userRef.current._id}/memory/${memoryWatchPathRef.current}`); memoryWatchPathRef.current = ''; setMemoryWatchPath(''); setMemoryLiveValue(null) }
  async function handleMemoryFetchSegment(seg: number) { return (await apiFetch<{ data: string }>(`/api/user/memory-segment?segment=${seg}`)).data ?? '' }
  async function handleMemorySaveSegment(seg: number, data: string) { await apiFetch('/api/user/memory-segment', { method: 'POST', body: JSON.stringify({ segment: seg, data }) }) }
  async function handleCloneBranch() {
    const nextName = newBranchName.trim()
    if (!nextName) return
    await apiFetch('/api/user/clone-branch', { method: 'POST', body: JSON.stringify({ branch: cloneSourceBranch, newName: nextName }) })
    setNewBranchName('')
    await refreshProfile()
    handleBranchChange(nextName)
  }
  async function handleSetActiveBranch(activeName: 'activeWorld' | 'activeSim') {
    await apiFetch('/api/user/set-active-branch', { method: 'POST', body: JSON.stringify({ branch: editingBranch, activeName }) })
    await refreshProfile()
  }
  async function handleDeleteBranch(branch: string) {
    await apiFetch('/api/user/delete-branch', { method: 'POST', body: JSON.stringify({ branch }) })
    if (branch === editingBranch) setEditingBranch('default')
    await refreshProfile()
  }
  async function handleRespawn() {
    await apiFetch('/api/user/respawn', { method: 'POST', body: JSON.stringify({}) })
    await refreshProfile()
  }
  async function handleCreateConstruction(x: number, y: number) {
    await apiFetch('/api/game/create-construction', {
      method: 'POST',
      body: JSON.stringify({ room: roomName, x, y, structureType: buildStructureType }),
    })
    await fetchRoomSnapshot(roomName)
  }
  async function handleRemoveObject(obj: RoomObject) {
    const safeId = obj._id.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    await apiFetch('/api/user/console', {
      method: 'POST',
      body: JSON.stringify({ expression: `Game.getObjectById('${safeId}')?.remove?.()` }),
    })
    // Optimistically remove from local state
    setObjects((cur) => {
      const next = { ...cur }
      delete next[obj._id]
      return next
    })
    setSelectedObject(null)
    await fetchRoomSnapshot(roomName)
  }
  async function handleCreateFlag(x: number, y: number) {
    const name = flagDraft.name.trim() || (await apiFetch<{ name: string }>('/api/game/gen-unique-flag-name', { method: 'POST', body: JSON.stringify({}) })).name
    await apiFetch('/api/game/create-flag', {
      method: 'POST',
      body: JSON.stringify({ room: roomName, x, y, name, color: flagDraft.color, secondaryColor: flagDraft.secondaryColor }),
    })
    // Optimistically add flag to local state so it renders immediately
    setObjects((cur) => ({
      ...cur,
      [`flag:${name}`]: {
        _id: `flag:${name}`,
        type: 'flag',
        name,
        color: flagDraft.color,
        secondaryColor: flagDraft.secondaryColor,
        x,
        y,
      },
    }))
    await fetchRoomSnapshot(roomName)
  }
  async function handleRemoveFlag(flag: RoomObject) {
    if (!flag.name) return
    await apiFetch('/api/game/remove-flag', {
      method: 'POST',
      body: JSON.stringify({ room: roomName, name: flag.name }),
    })
    // Optimistically remove the flag from local state
    setObjects((cur) => {
      const next = { ...cur }
      delete next[`flag:${flag.name}`]
      return next
    })
    await fetchRoomSnapshot(roomName)
  }
  async function handleChangeFlagColor(flag: RoomObject) {
    if (!flag.name) return
    const nextColor = flag.secondaryColor ?? flagDraft.secondaryColor
    await apiFetch('/api/game/change-flag-color', {
      method: 'POST',
      body: JSON.stringify({ room: roomName, name: flag.name, color: flag.color ?? flagDraft.color, secondaryColor: nextColor }),
    })
    await fetchRoomSnapshot(roomName)
  }
  function handleBranchChange(nextBranch: string) {
    const branch = branches.find((item) => item.branch === nextBranch)
    setCloneSourceBranch(nextBranch)
    applyBranchModules(branch)
  }

  const roomObjectList = Object.values(objects)
  const roomController = roomObjectList.find((o) => o.type === 'controller')
  const roomOwnerId = roomController?.user ?? roomController?.reservation?.user
  const roomRcl = roomController?.level ?? 0
  const socketIndicator = socketState === 'live' ? 'live' : socketState === 'connecting' || socketState === 'authenticating' ? 'connecting' : 'offline'
  const selectedBranch = branches.find((branch) => branch.branch === editingBranch)
  const moduleNames = Object.keys(modules)
  const maxDockHeight = typeof window === 'undefined' ? dockHeight : Math.max(220, window.innerHeight - 220)
  const effectiveDockHeight = Math.min(dockHeight, maxDockHeight)
  const terrainStats = terrain.reduce((acc, cell) => {
    acc[cell] += 1
    return acc
  }, { plain: 0, swamp: 0, wall: 0 } as Record<TerrainCell, number>)

  useEffect(() => {
    if (!branches.length) return
    if (branches.some((branch) => branch.branch === cloneSourceBranch)) return
    setCloneSourceBranch(editingBranch || branches[0].branch)
  }, [branches, cloneSourceBranch, editingBranch])

  if (!user) return (
    <div className="login-page"><div className="login-card"><div className="login-logo">Screeps</div><form className="stack" onSubmit={(e) => { e.preventDefault(); void bootstrapSession() }}>
      <input value={loginName} onChange={(e) => setLoginName(e.target.value)} placeholder="Username" disabled={busy} autoFocus />
      <input type="password" value={userPassword} onChange={(e) => setUserPassword(e.target.value)} placeholder="Password" disabled={busy} />
      {isRegistering && <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm password" disabled={busy} />}
      {authError && <div className="form-error">{authError}</div>}
      <button className="btn-primary" disabled={busy}>{busy ? '…' : isRegistering ? 'Register' : 'Login'}</button>
      <button type="button" className="btn-ghost" onClick={() => { setIsRegistering(!isRegistering); setConfirmPassword(''); setAuthError('') }}>{isRegistering ? 'Sign in' : 'Register'}</button>
    </form></div></div>
  )

  return (
    <div className="sim-shell" style={{ gridTemplateRows: `minmax(220px,1fr) ${effectiveDockHeight}px` }}>
      <div className="world-shell" style={{ gridTemplateColumns: `${leftWidth}px minmax(0,1fr) ${rightWidth}px` }}>
        <aside className="world-left-rail">
          <div className="rail-resize-handle rail-resize-right" onMouseDown={(e) => { isDraggingLeft.current = true; dragStartX.current = e.clientX; dragStartWidth.current = leftWidth; e.preventDefault() }} />
          <div className="flat-panel"><div className="flat-title">Player</div>
            <div className="info-row"><span>name</span><strong>{user.username ?? loginName}</strong></div>
            {user.gcl != null && (() => { const g = gclProgress(user.gcl); return (<div style={{ padding: '3px 0' }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem' }}><span>GCL {g.level}</span><span>{Math.round(g.pct)}%</span></div><div className="obj-hp-wrap" style={{ height: 4 }}><div className="obj-hp-bar" style={{ width: `${g.pct}%`, background: '#bfdc82' }} /></div></div>) })()}
            {user.power != null && user.power > 0 && (() => {
              const current = Math.pow(gplLevel(user.power), 2.4) * 1000000;
              const next = Math.pow(gplLevel(user.power) + 1, 2.4) * 1000000;
              const pct = ((user.power - current) / (next - current)) * 100;
              return (<div style={{ padding: '3px 0' }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem' }}><span>GPL {gplLevel(user.power)}</span><span>{Math.round(pct)}%</span></div><div className="obj-hp-wrap" style={{ height: 4 }}><div className="obj-hp-bar" style={{ width: `${pct}%`, background: '#f1c40f' }} /></div></div>)
            })()}
            <div className="info-row"><span>CPU</span><strong>{cpuUsed != null ? Math.round(cpuUsed) : '—'}/{user.cpu ?? '?'}</strong></div>
            {cpuBucket != null && <div className="info-row"><span>bucket</span><strong>{cpuBucket}</strong></div>}
            {credits != null && <div className="info-row"><span>credits</span><strong>{credits.toFixed(2)}</strong></div>}
            <button className="btn-ghost" style={{ marginTop: 6, width: '100%' }} onClick={() => setShowBadgeEditor(true)}>Badge</button>
            <button className="btn-ghost" style={{ marginTop: 4, width: '100%' }} onClick={handleSignOut}>Sign out</button>
          </div>
          {userRooms.length > 0 && <div className="flat-panel"><div className="flat-title">Rooms</div>{userRooms.map(r => <div key={r} className="info-row" style={{ cursor: 'pointer' }} onClick={() => void loadRoom(r)}><span>{r}</span><strong>→</strong></div>)}</div>}
          <div className="flat-panel"><div className="flat-title">Users in Room</div>{Object.entries(roomUsers).map(([id, u]) => <div key={id} className="info-row"><span style={{ color: id === user?._id ? '#bfdc82' : '#eee' }}>{u?.username || id.slice(0, 8)}</span><strong style={{ fontSize: '0.6rem' }}>{id.slice(0, 4)}</strong></div>)}</div>
          <div className="flat-panel"><div className="flat-title">Room</div><div className="info-row"><span>name</span><strong>{roomName}</strong></div><div className="info-row"><span>owner</span><strong>{roomOwnerId ? (roomUsers[roomOwnerId]?.username ?? roomOwnerId) : 'unclaimed'}</strong></div>
            {roomStatusInfo?.status && <div className="info-row"><span>status</span><strong>{roomStatusInfo.status}</strong></div>}
            {roomStatusInfo?.openTime != null && <div className="info-row"><span>opens</span><strong>{roomStatusInfo.openTime}</strong></div>}
            {roomStatusInfo?.novice != null && <div className="info-row"><span>novice</span><strong>{roomStatusInfo.novice}</strong></div>}
            {roomStatusInfo?.respawnArea != null && <div className="info-row"><span>respawn</span><strong>{roomStatusInfo.respawnArea}</strong></div>}
            {roomController && (
              <>
                <div className="info-row"><span>RCL</span><strong>{roomController.level}</strong></div>
                {roomController.progress != null && roomController.progressTotal != null && roomController.progressTotal > 0 && (
                  <div style={{ padding: '3px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', marginBottom: 2 }}>
                      <span className="muted">{roomController.progress.toLocaleString()} / {roomController.progressTotal.toLocaleString()}</span>
                      <span>{Math.round((roomController.progress / roomController.progressTotal) * 100)}%</span>
                    </div>
                    <div className="obj-hp-wrap" style={{ height: 3 }}>
                      <div className="obj-hp-bar" style={{ width: `${Math.round((roomController.progress / roomController.progressTotal) * 100)}%`, background: '#a78bfa' }} />
                    </div>
                  </div>
                )}
              </>
            )}
            <div className="info-row"><span>tick</span><strong>{gameTime ?? '—'}</strong></div>
          </div>
        </aside>

        <main className="world-stage">
          <div className="world-stage-hud">
            <div className="hud-chip"><span>room</span><strong>{roomName}</strong></div>
            <div className="hud-chip"><span>world</span><strong>{worldStatusLabel(worldStatus)}</strong></div>
            <div className="hud-chip"><span>tick</span><strong>{gameTime ?? '—'}</strong></div>
            <div className={`hud-chip ${socketIndicator === 'live' ? 'is-live' : ''}`}><span>socket</span><strong>{socketState}</strong></div>
          </div>
          <div className="world-toolbar">
            <button className={`toolbar-btn ${toolMode === 'none' ? 'active' : ''}`} onClick={() => { setToolMode('none'); setShowConstructMenu(false); setShowFlagMenu(false); setShowCreepMenu(false) }}>Inspect</button>
            <button className={`toolbar-btn ${toolMode === 'spawn' ? 'active' : ''}`} onClick={() => { setShowConstructMenu(false); setShowFlagMenu(false); setShowCreepMenu(false); setToolMode('spawn') }} disabled={!token || busy || worldStatus === 'normal' || !!roomOwnerId}>Place Spawn</button>
            <div className="toolbar-group">
              <button
                className={`toolbar-btn ${toolMode === 'build' ? 'active' : ''} ${showConstructMenu ? 'open' : ''}`}
                onClick={() => {
                  setShowFlagMenu(false)
                  setShowCreepMenu(false)
                  setToolMode('build')
                  setShowConstructMenu((open) => !open)
                }}
              >
                Construct · {humanizeStructureType(buildStructureType)}
              </button>
              {showConstructMenu && (
                <div className="construct-menu">
                  {CONSTRUCTABLE_STRUCTURES.map((item) => {
                    const available = canConstructStructure(item.type, roomRcl)
                    const active = buildStructureType === item.type
                    return (
                      <button
                        key={item.type}
                        className={`construct-item ${available ? '' : 'is-disabled'} ${active ? 'active' : ''}`}
                        disabled={!available}
                        onClick={() => {
                          if (!available) return
                          setBuildStructureType(item.type)
                          setToolMode('build')
                          setShowConstructMenu(false)
                        }}
                      >
                        <span className="construct-label">{item.label}</span>
                        <span className="construct-meta">RCL {item.level}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="toolbar-group">
              <button
                className={`toolbar-btn ${toolMode === 'flag' ? 'active' : ''} ${showFlagMenu ? 'open' : ''}`}
                onClick={() => {
                  setShowConstructMenu(false)
                  setShowCreepMenu(false)
                  setToolMode((mode) => (mode === 'flag' ? 'none' : 'flag'))
                  setShowFlagMenu((open) => !open)
                }}
              >
                Flag
              </button>
              {showFlagMenu && (
                <div className="construct-menu">
                  <div className="stack">
                    <input value={flagDraft.name} onChange={(e) => setFlagDraft((draft) => ({ ...draft, name: e.target.value }))} placeholder="Flag name" />
                    <div style={{ display: 'flex', gap: 4 }}>
                      <select className="server-select" style={{ flex: 1, width: 'auto' }} value={flagDraft.color} onChange={(e) => setFlagDraft((draft) => ({ ...draft, color: Number(e.target.value) }))}>
                        {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>Primary {value}</option>)}
                      </select>
                      <select className="server-select" style={{ flex: 1, width: 'auto' }} value={flagDraft.secondaryColor} onChange={(e) => setFlagDraft((draft) => ({ ...draft, secondaryColor: Number(e.target.value) }))}>
                        {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>Secondary {value}</option>)}
                      </select>
                    </div>
                    <div className="muted">Click a tile to place a flag.</div>
                  </div>
                </div>
              )}
            </div>
            <div className="toolbar-group">
              <button
                className={`toolbar-btn ${toolMode === 'creep' ? 'active' : ''} ${showCreepMenu ? 'open' : ''}`}
                onClick={() => {
                  setShowConstructMenu(false)
                  setShowFlagMenu(false)
                  setToolMode((mode) => (mode === 'creep' ? 'none' : 'creep'))
                  setShowCreepMenu((open) => !open)
                }}
              >
                Creep Planner
              </button>
              {showCreepMenu && (
                <div className="construct-menu">
                  <SpawnCalculator />
                </div>
              )}
            </div>
            <button className="toolbar-btn" onClick={() => { setShowConstructMenu(false); setShowFlagMenu(false); setShowCreepMenu(false); setShowWorldMap(true) }}>World Map</button>
          </div>
          {spawnConfirm && <SpawnConfirmDialog x={spawnConfirm.x} y={spawnConfirm.y} defaultName={spawnName} onConfirm={(n) => { setSpawnName(n); setSpawnConfirm(null); setBusy(true); apiFetch<{ name: string }>('/api/game/gen-unique-object-name', { method: 'POST', body: JSON.stringify({ type: 'spawn' }) }).then(gen => apiFetch('/api/game/place-spawn', { method: 'POST', body: JSON.stringify({ room: roomName, x: spawnConfirm.x, y: spawnConfirm.y, name: n.trim() || gen.name }) })).then(() => { fetchRoomSnapshot(roomName); refreshProfile() }).finally(() => setBusy(false)) }} onCancel={() => setSpawnConfirm(null)} />}
          <RoomRenderer terrain={terrain} objects={objects} roomUsers={roomUsers} roomName={roomName} userId={user?._id} tickDuration={tickDuration ?? 1000} selectedObjectId={selectedObject?._id} onTileClick={(x, y) => {
            if (toolMode === 'spawn') {
              setToolMode('none'); setSpawnConfirm({ x, y })
            } else if (toolMode === 'build') {
              if (!canConstructStructure(buildStructureType, roomRcl)) return
              if (!busy) { setBusy(true); void handleCreateConstruction(x, y).finally(() => setBusy(false)) }
            } else if (toolMode === 'flag') {
              if (!busy) { setBusy(true); void handleCreateFlag(x, y).finally(() => setBusy(false)) }
            } else if (!!token && !busy && worldStatus !== 'normal' && !roomOwnerId) setSpawnConfirm({ x, y }); else setSelectedObject(pickObjectAtTile(objects, x, y, selectedObject?._id))
          }} />
        </main>

        <aside className="world-right-rail">
          <div className="rail-resize-handle rail-resize-left" onMouseDown={(e) => { isDraggingRight.current = true; dragStartX.current = e.clientX; dragStartWidth.current = rightWidth; e.preventDefault() }} />
          <div className="flat-panel"><div className="flat-title">Server</div><div className="info-row"><span>ws</span><strong style={{ color: socketIndicator === 'live' ? '#7dc97d' : '#e0bf63' }}>{socketState}</strong></div>
            <div className="info-row"><span>world</span><strong>{worldStatusLabel(worldStatus)}</strong></div>
            {(worldStatus === 'normal' || worldStatus === 'lost') && (
              <button className="btn-ghost compact" style={{ marginTop: 6, width: '100%' }} onClick={() => void handleRespawn()}>
                Respawn
              </button>
            )}
          </div>
          <div className="flat-panel"><div className="flat-title">Terrain</div>
            <div className="info-row"><span>plain</span><strong>{terrainStats.plain}</strong></div>
            <div className="info-row"><span>swamp</span><strong>{terrainStats.swamp}</strong></div>
            <div className="info-row"><span>walls</span><strong>{terrainStats.wall}</strong></div>
          </div>
          {selectedObject && <div className="flat-panel"><div className="flat-title">{humanizeObjectType(selectedObject.type)}{selectedObject.name ? ` · ${selectedObject.name}` : ''} <span onClick={() => setSelectedObject(null)} style={{ float: 'right', cursor: 'pointer' }}>✕</span></div>
            <details className="inspect-drop inspect-drop-large" open>
              <summary className="inspect-drop-summary">Details</summary>
              <div className="inspect-drop-body">
                <div className="info-row"><span>type</span><strong>{selectedObject.type}</strong></div>
                {selectedObject.name && <div className="info-row"><span>name</span><strong>{selectedObject.name}</strong></div>}
                {selectedObject.level != null && <div className="info-row"><span>level</span><strong>{selectedObject.level}</strong></div>}
                {selectedObject.hits != null && selectedObject.hitsMax != null && <div className="info-row"><span>hits</span><strong>{selectedObject.hits}/{selectedObject.hitsMax}</strong></div>}
                {selectedObject.store && Object.keys(selectedObject.store).length > 0 && <div className="info-row"><span>store</span><strong>{Object.entries(selectedObject.store).map(([k, v]) => `${k}: ${v}`).join(', ')}</strong></div>}
                <div className="info-row"><span>id</span><strong>{selectedObject._id}</strong></div>
                <div className="info-row"><span>owner</span><strong>{roomUsers[selectedObject.user ?? '']?.username ?? selectedObject.user ?? 'unknown'}</strong></div>
                <div className="info-row"><span>position</span><strong>{selectedObject.x ?? '—'}, {selectedObject.y ?? '—'}</strong></div>
                {selectedObject.structureType && <div className="info-row"><span>structure</span><strong>{selectedObject.structureType}</strong></div>}
                {selectedObject.type === 'controller' && (() => {
                  const lvl = selectedObject.level ?? 0
                  const total = CONTROLLER_LEVELS[lvl]
                  const prog = selectedObject.progress ?? 0
                  if (lvl === 8) return <div className="info-row"><span>upgrade</span><strong style={{ color: '#bfdc82' }}>max level</strong></div>
                  if (!total) return null
                  const pct = Math.round((prog / total) * 100)
                  return (
                    <div style={{ padding: '3px 0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', marginBottom: 2 }}>
                        <span className="muted">{prog.toLocaleString()} / {total.toLocaleString()}</span>
                        <span>{pct}%</span>
                      </div>
                      <div className="obj-hp-wrap" style={{ height: 3 }}>
                        <div className="obj-hp-bar" style={{ width: `${pct}%`, background: '#a78bfa' }} />
                      </div>
                    </div>
                  )
                })()}
                {selectedObject.type === 'controller' && selectedObject.downgradeTime != null && gameTime != null && (
                  <div className="info-row"><span>downgrade in</span><strong style={{ color: selectedObject.downgradeTime - gameTime < 5000 ? '#e0bf63' : undefined }}>{(selectedObject.downgradeTime - gameTime).toLocaleString()} ticks</strong></div>
                )}
                {selectedObject.type === 'controller' && selectedObject.safeMode != null && selectedObject.safeMode > 0 && (
                  <div className="info-row"><span>safe mode</span><strong style={{ color: '#7dc97d' }}>{selectedObject.safeMode.toLocaleString()} ticks</strong></div>
                )}
                {selectedObject.type === 'controller' && selectedObject.safeModeAvailable != null && (
                  <div className="info-row"><span>safe modes</span><strong>{selectedObject.safeModeAvailable}</strong></div>
                )}
                {selectedObject.type === 'constructionSite' && (
                  <div className="info-row"><span>process</span><strong>{selectedObject.progress != null && selectedObject.progressTotal != null ? `${selectedObject.progress}/${selectedObject.progressTotal}` : 'pending'}</strong></div>
                )}
                {selectedObject.type === 'constructionSite' && selectedObject.progress != null && selectedObject.progressTotal != null && selectedObject.progressTotal > 0 && (
                  <div style={{ padding: '3px 0 6px' }}>
                    <div className="obj-hp-wrap" style={{ height: 3 }}>
                      <div className="obj-hp-bar" style={{ width: `${Math.round((selectedObject.progress / selectedObject.progressTotal) * 100)}%`, background: '#7fb3f0' }} />
                    </div>
                  </div>
                )}
                {selectedObject.type === 'flag' && (
                  <>
                    <button className="btn-ghost compact" style={{ marginTop: 6, width: '100%' }} onClick={() => void handleChangeFlagColor(selectedObject)}>Apply Tool Colors</button>
                    <button className="btn-ghost compact" style={{ marginTop: 4, width: '100%' }} onClick={() => void handleRemoveFlag(selectedObject)}>Remove Flag</button>
                  </>
                )}
                {selectedObject.type !== 'flag' && (
                  <button className="btn-ghost compact" style={{ marginTop: 4, width: '100%', color: 'var(--accent-danger)' }} onClick={() => void handleRemoveObject(selectedObject)}>
                    {selectedObject.type === 'constructionSite' ? 'Remove Site' : 'Remove Object'}
                  </button>
                )}
                <button className="btn-ghost compact" style={{ marginTop: 6, width: '100%' }} onClick={() => { setInspectedObjectData(selectedObject); setMemoryNavigatePath(getMemoryPath(selectedObject)); setDockTab('memory') }}>Memory</button>
              </div>
            </details>
          </div>}
          {cpuHistory.length > 0 && <div className="flat-panel"><div className="flat-title">CPU</div><CpuChart data={cpuHistory} cpuLimit={user?.cpu} /></div>}
        </aside>
      </div>

      {showBadgeEditor && <BadgeEditor onSave={async (b) => { await apiFetch('/api/user/badge', { method: 'POST', body: JSON.stringify({ badge: b }) }); await refreshProfile() }} onClose={() => setShowBadgeEditor(false)} />}
      {showWorldMap && worldSize && <WorldMapModal worldSize={worldSize} userId={user?._id} currentRoom={roomName} apiFetch={apiFetch} onNavigate={r => void loadRoom(r)} onClose={() => setShowWorldMap(false)} />}

      <div className="code-dock">
        <div className="dock-resize-handle" onMouseDown={handleDockResizeStart} />
        <div className="dock-tabs">
          {(['script', 'console', 'memory', 'market', 'craft', 'power', 'messages', 'leaderboard'] as DockTab[]).map(t => <button key={t} className={`dock-tab ${dockTab === t ? 'active' : ''}`} onClick={() => setDockTab(t)}>{dockTabLabel(t)}</button>)}
          {selectedBranch && <div className="dock-branch">{selectedBranch.branch} · {branchRoleLabel(selectedBranch)}</div>}
        </div>
        <div className="dock-content">
          {dockTab === 'script' && (
            <div className="script-pane">
              <div className="pane-header">
                <span className="panel-title">Code Workspace</span>
                <div className="script-header-controls">
                  <label className="script-select-wrap">
                    <span>Branch</span>
                    <select value={editingBranch} onChange={(e) => handleBranchChange(e.target.value)}>
                      {branches.map((branch) => (
                        <option key={branch.branch} value={branch.branch}>{branch.branch}</option>
                      ))}
                    </select>
                  </label>
                  <div className="script-clone-controls">
                    <label className="script-select-wrap">
                      <span>Clone From</span>
                      <select value={cloneSourceBranch} onChange={(e) => setCloneSourceBranch(e.target.value)}>
                        {branches.map((branch) => (
                          <option key={branch.branch} value={branch.branch}>{branch.branch}</option>
                        ))}
                      </select>
                    </label>
                    <input
                      className="script-clone-input"
                      value={newBranchName}
                      onChange={(e) => setNewBranchName(e.target.value)}
                      placeholder="New branch name…"
                    />
                    <button className="btn-ghost compact" onClick={() => void handleCloneBranch()} disabled={!newBranchName.trim()}>
                      Clone Branch
                    </button>
                  </div>
                  <div className="script-module-pill">{activeModule}.js</div>
                  <button className="btn-ghost compact" onClick={() => void handleSetActiveBranch('activeWorld')} disabled={selectedBranch?.activeWorld}>Set World</button>
                  <button className="btn-ghost compact" onClick={() => void handleSetActiveBranch('activeSim')} disabled={selectedBranch?.activeSim}>Set Sim</button>
                  <button className="btn-ghost compact" onClick={() => void handleDeleteBranch(editingBranch)} disabled={selectedBranch?.activeWorld || selectedBranch?.activeSim || editingBranch === 'default'}>Delete</button>
                  <button className="btn-primary compact" onClick={handleSaveCode} disabled={busy}>Deploy</button>
                </div>
              </div>
              <div className="dock-body">
                <div className="module-list">
                  <div className="flat-title">Modules</div>
                  {moduleNames.map((moduleName) => (
                    <button key={moduleName} className={`module-item ${activeModule === moduleName ? 'active' : ''}`} onClick={() => setActiveModule(moduleName)}>
                      {moduleName}
                    </button>
                  ))}
                  <div className="module-add-input">
                    <input
                      value={newModuleName}
                      onChange={(e) => setNewModuleName(e.target.value)}
                      placeholder="New file name…"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateModule()
                      }}
                    />
                    <button className="btn-ghost compact" style={{ marginTop: 6, width: '100%' }} onClick={handleCreateModule} disabled={!newModuleName.trim()}>
                      New File
                    </button>
                  </div>
                </div>
                <div className="script-editor">
                  <Editor
                    height="100%"
                    defaultLanguage="javascript"
                    language="javascript"
                    theme="vs-dark"
                    value={modules[activeModule] ?? ''}
                    onChange={(value) => setModules((p) => ({ ...p, [activeModule]: value ?? '' }))}
                    beforeMount={(monacoInstance: Monaco) => {
                      monacoInstance.languages.typescript.javascriptDefaults.addExtraLib(
                        screepsTypes,
                        'file:///node_modules/@types/screeps/index.d.ts'
                      )
                      monacoInstance.languages.typescript.javascriptDefaults.setCompilerOptions({
                        target: monacoInstance.languages.typescript.ScriptTarget.ES2020,
                        allowNonTsExtensions: true,
                        checkJs: true,
                      })
                    }}
                    options={{
                      automaticLayout: true,
                      minimap: { enabled: false },
                      fontSize: 13,
                      lineNumbers: 'on',
                      roundedSelection: false,
                      scrollBeyondLastLine: false,
                      wordWrap: 'on',
                      tabSize: 2,
                    }}
                  />
                </div>
              </div>
            </div>
          )}
          {dockTab === 'console' && <ConsolePane logs={logs} onCommand={handleConsoleExpression} onClear={() => setLogs([])} />}
          {dockTab === 'memory' && <MemoryPane onFetch={handleMemoryFetch} onSave={handleMemorySave} onWatch={handleMemoryWatch} onUnwatch={handleMemoryUnwatch} watchedPath={memoryWatchPath} watchedValue={memoryLiveValue} onFetchSegment={handleMemoryFetchSegment} onSaveSegment={handleMemorySaveSegment} navigatePath={memoryNavigatePath} onNavigateConsumed={() => setMemoryNavigatePath(null)} inspectedObject={inspectedObjectData} onClearInspected={() => setInspectedObjectData(null)} />}
          {dockTab === 'market' && <MarketPane apiFetch={apiFetch} />}
          {dockTab === 'craft' && <CraftPane />}
          {dockTab === 'power' && <PowerCreepsPane apiFetch={apiFetch} />}
          {dockTab === 'messages' && <MessagesPane apiFetch={apiFetch} userId={user?._id} />}
          {dockTab === 'leaderboard' && <LeaderboardPane apiFetch={apiFetch} />}
        </div>
      </div>
    </div>
  )
}

function getMemoryPath(obj: RoomObject): string | null {
  if (obj.type === 'creep' && obj.name) return `creeps.${obj.name}`
  if (obj.type === 'spawn' && obj.name) return `spawns.${obj.name}`
  if (obj.type === 'flag' && obj.name) return `flags.${obj.name}`
  if (obj.type === 'powerCreep' && obj.name) return `powerCreeps.${obj.name}`
  return null
}
