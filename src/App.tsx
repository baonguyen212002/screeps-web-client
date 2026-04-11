import { startTransition, useEffect, useEffectEvent, useRef, useState } from 'react'
import SockJS from 'sockjs-client'
import Editor from '@monaco-editor/react'
import { Code, Map as MapIcon, User, Zap, Activity } from 'lucide-react'
import './App.css'
import RoomRenderer from './RoomRenderer'
import ConsolePane from './ConsolePane'
import type { LogEntry } from './ConsolePane'

type ScreepsUser = {
  _id: string
  username?: string
  cpu?: number
  gcl?: number
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
  hits?: number
  hitsMax?: number
  store?: Record<string, number>
  reservation?: { user?: string }
  sign?: { user?: string; text?: string }
  name?: string
  spawning?: unknown
}

type RoomEvent = {
  objects?: Record<string, RoomObject | null>
  users?: Record<string, { username?: string }>
  gameTime?: number
}

type Branch = {
  branch: string
  modules?: Record<string, string>
}

const TOKEN_KEY = 'screeps-web-client-token'
const SERVER_URL_KEY = 'screeps-web-client-server-url'
const USERNAME_HEADER = 'local-web-client'
const DEFAULT_ROOM = 'W3N5'
const ROOM_SIZE = 50
const LOCAL_TICKET = 'local-web-client'
const DEFAULT_SERVER_URL = window.location.origin

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
    if (value === null) {
      delete next[id]
      continue
    }
    next[id] = { ...(next[id] ?? {}), ...value }
  }
  return next
}

async function readResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as { ok?: number; error?: string } & T
  if (!response.ok || ('ok' in payload && payload.ok !== 1)) {
    throw new Error(payload.error || `Request failed with status ${response.status}`)
  }
  return payload
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '')
  const [serverUrl] = useState(() => localStorage.getItem(SERVER_URL_KEY) ?? DEFAULT_SERVER_URL)
  const [serverPassword] = useState('')
  const [user, setUser] = useState<ScreepsUser | null>(null)
  const [worldStatus, setWorldStatus] = useState('disconnected')
  const [roomName, setRoomName] = useState(DEFAULT_ROOM)
  const [roomInput, setRoomInput] = useState(DEFAULT_ROOM)
  const [terrain, setTerrain] = useState<TerrainCell[]>([])
  const [objects, setObjects] = useState<Record<string, RoomObject>>({})
  const [gameTime, setGameTime] = useState<number | null>(null)
  const [mainCode, setMainCode] = useState('// Your Screeps AI starts here.\nmodule.exports.loop = function () {\n  console.log("tick", Game.time)\n}\n')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [spawnName, setSpawnName] = useState('Spawn1')
  const [placingSpawn, setPlacingSpawn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [socketState, setSocketState] = useState('offline')
  const socketRef = useRef<{ close: () => void; send: (m: string) => void } | null>(null)
  const tokenRef = useRef(token)
  const userRef = useRef<ScreepsUser | null>(null)
  const hydratedProfileTokenRef = useRef('')

  function appendLog(message: string, type: LogEntry['type'] = 'log') {
    setLogs((prev) => [...prev, { timestamp: Date.now(), message, type }].slice(-100))
  }

  function storeToken(nextToken: string) {
    tokenRef.current = nextToken
    setToken(nextToken)
    if (!nextToken) hydratedProfileTokenRef.current = ''
    if (nextToken) localStorage.setItem(TOKEN_KEY, nextToken)
    else localStorage.removeItem(TOKEN_KEY)
  }

  function rotateToken(nextToken: string) {
    tokenRef.current = nextToken
    if (nextToken) localStorage.setItem(TOKEN_KEY, nextToken)
    else localStorage.removeItem(TOKEN_KEY)
  }

  useEffect(() => { tokenRef.current = token }, [token])
  useEffect(() => { userRef.current = user }, [user])

  const apiFetch = useEffectEvent(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers ?? {})
    headers.set('Content-Type', 'application/json')
    if (tokenRef.current) headers.set('X-Token', tokenRef.current)
    headers.set('X-Username', userRef.current?.username || USERNAME_HEADER)
    if (serverPassword) headers.set('X-Server-Password', serverPassword)
    const response = await fetch(`${serverUrl}${path}`, { ...init, headers })
    const renewedToken = response.headers.get('X-Token')
    if (renewedToken) rotateToken(renewedToken)
    return readResponse<T>(response)
  })

  const refreshProfile = useEffectEvent(async () => {
    const me = await apiFetch<ScreepsUser>('/api/auth/me')
    setUser(me)
    const world = await apiFetch<{ status: string }>('/api/user/world-status')
    setWorldStatus(world.status)
    const branchData = await apiFetch<{ list: Branch[] }>('/api/user/branches')
    const defaultBranch = branchData.list.find((b) => b.branch === 'default')
    if (defaultBranch?.modules?.main) setMainCode(defaultBranch.modules.main)
  })

  const loadRoom = useEffectEvent(async (nextRoom: string) => {
    const terrainData = await apiFetch<{ terrain: Array<{ terrain: string }> }> (
      `/api/game/room-terrain?room=${encodeURIComponent(nextRoom)}&encoded=1`,
    )
    const encoded = terrainData.terrain[0]?.terrain ?? ''
    setTerrain(decodeTerrain(encoded))
    setObjects({})
    setRoomName(nextRoom)
    setRoomInput(nextRoom)
  })

  const bootstrapSession = useEffectEvent(async () => {
    setBusy(true)
    try {
      const auth = await apiFetch<{ token: string }>('/api/auth/steam-ticket', {
        method: 'POST',
        body: JSON.stringify({ ticket: LOCAL_TICKET }),
      })
      storeToken(auth.token)
      await refreshProfile()
      const startRoom = await apiFetch<{ room: string[] }>('/api/user/world-start-room')
      await loadRoom(startRoom.room[0] ?? DEFAULT_ROOM)
    } catch (error) {
      console.error('Login failed', error)
    } finally {
      setBusy(false)
    }
  })

  useEffect(() => {
    if (!token || hydratedProfileTokenRef.current === token) return
    hydratedProfileTokenRef.current = token
    void refreshProfile()
  }, [token])

  useEffect(() => {
    if (!tokenRef.current || !roomName) return

    const socket = new SockJS('/socket', undefined, { transports: ['xhr-streaming', 'xhr-polling'] })
    socketRef.current = socket
    setSocketState('connecting')

    socket.onopen = () => {
      setSocketState('authenticating')
      socket.send(`auth ${tokenRef.current}`)
    }

    socket.onmessage = (event) => {
      const message = String(event.data)
      if (message.startsWith('auth ok ')) {
        const renewedToken = message.slice('auth ok '.length)
        rotateToken(renewedToken)
        setSocketState('live')
        socket.send(`subscribe room:${roomName}`)
        if (userRef.current) socket.send(`subscribe user:${userRef.current._id}/console`)
        return
      }
      if (message.startsWith('auth failed')) {
        storeToken('')
        setSocketState('auth failed')
        return
      }
      if (!message.startsWith('[')) return
      const parsed = JSON.parse(message) as [string, any]
      
      if (parsed[0] === `room:${roomName}`) {
        startTransition(() => {
          setObjects((current) => applyDiff(current, (parsed[1] as RoomEvent).objects))
          if ((parsed[1] as RoomEvent).gameTime !== undefined) {
            setGameTime((parsed[1] as RoomEvent).gameTime!)
          }
        })
      } else if (parsed[0].includes('/console')) {
        const consoleData = parsed[1]
        if (consoleData.messages?.log) {
          const newLogs: LogEntry[] = consoleData.messages.log.map((m: string) => ({
            timestamp: Date.now(),
            message: m,
            type: 'log'
          }))
          setLogs(prev => [...prev, ...newLogs].slice(-100))
        }
        if (consoleData.error) {
          setLogs(prev => [...prev, { timestamp: Date.now(), message: consoleData.error, type: 'error' as const }].slice(-100))
        }
      }
    }

    socket.onclose = () => setSocketState('offline')
    return () => { socket.close(); socketRef.current = null }
  }, [roomName, user?._id])

  async function handleSaveCode() {
    setBusy(true)
    try {
      await apiFetch('/api/user/code', {
        method: 'POST',
        body: JSON.stringify({ branch: 'default', modules: { main: mainCode } }),
      })
      appendLog('Code deployed to branch "default".')
    } catch (error) {
      console.error('Could not save code', error)
      appendLog(error instanceof Error ? `Deploy failed: ${error.message}` : 'Deploy failed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleTileClick(x: number, y: number) {
    if (!placingSpawn) return
    setBusy(true)
    try {
      const generated = await apiFetch<{ name: string }>('/api/game/gen-unique-object-name', {
        method: 'POST',
        body: JSON.stringify({ type: 'spawn' }),
      })
      await apiFetch('/api/game/place-spawn', {
        method: 'POST',
        body: JSON.stringify({ room: roomName, x, y, name: spawnName.trim() || generated.name }),
      })
      setPlacingSpawn(false)
      await loadRoom(roomName)
      await refreshProfile()
      appendLog(`Spawn placed in ${roomName} at ${x},${y}.`)
    } catch (error) {
      console.error('Could not place spawn', error)
      const message = error instanceof Error ? error.message : 'Place spawn failed.'
      appendLog(
        message === 'invalid room'
          ? `Place spawn failed: ${roomName} is not a valid start room. Try W3N5, W5N3, or W7N5.`
          : `Place spawn failed: ${message}`,
        'error',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="panel hero">
          <span className="eyebrow">Local Server</span>
          <h1>Screeps IDE</h1>
          <div className="btn-group" style={{ marginTop: '1rem' }}>
            <button className="btn-primary" disabled={busy} onClick={() => void bootstrapSession()}>
              {token ? 'Reconnect' : 'Connect'}
            </button>
            <button className="btn-ghost" disabled={!token} onClick={() => { socketRef.current?.close(); storeToken('') }}>
              Reset
            </button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <span className="panel-title"><Activity size={14} /> Network</span>
          </div>
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-label">Status</span>
              <span className="stat-value" style={{ color: socketState === 'live' ? 'var(--accent-primary)' : 'inherit' }}>
                {socketState}
              </span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Tick</span>
              <span className="stat-value">{gameTime ?? '--'}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">World</span>
              <span className="stat-value">{worldStatus}</span>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <span className="panel-title"><User size={14} /> Profile</span>
          </div>
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-label">User</span>
              <span className="stat-value">{user?.username ?? 'unset'}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">GCL</span>
              <span className="stat-value">{user?.gcl ?? 0}</span>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <span className="panel-title"><MapIcon size={14} /> Navigation</span>
          </div>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void loadRoom(roomInput) }}>
            <input value={roomInput} onChange={(e) => setRoomInput(e.target.value.toUpperCase())} />
            <button className="btn-ghost" type="submit" disabled={!token || busy}>Jump</button>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <span className="panel-title"><Zap size={14} /> Spawn</span>
          </div>
          <div className="stack">
            <input value={spawnName} onChange={(e) => setSpawnName(e.target.value)} placeholder="Spawn Name" />
            <button 
              className={placingSpawn ? "btn-primary" : "btn-ghost"}
              onClick={() => setPlacingSpawn(!placingSpawn)}
              disabled={!token || busy}
            >
              {placingSpawn ? 'Click on Map' : 'Place Spawn'}
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <RoomRenderer 
          terrain={terrain} 
          objects={objects} 
          roomName={roomName} 
          userId={user?._id}
          onTileClick={handleTileClick}
        />
      </main>

      <div className="right-pane">
        <div className="editor-pane">
          <div className="pane-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Code size={16} color="var(--accent-warn)" />
              <span className="panel-title">main.js</span>
            </div>
            <button className="btn-primary" style={{ padding: '0.3rem 0.8rem', fontSize: '0.75rem' }} onClick={() => void handleSaveCode()}>
              Deploy
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <Editor
              height="100%"
              defaultLanguage="javascript"
              theme="vs-dark"
              value={mainCode}
              onChange={(v) => setMainCode(v ?? '')}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                fontFamily: 'var(--font-mono)',
                padding: { top: 10 }
              }}
            />
          </div>
        </div>
        <ConsolePane logs={logs} />
      </div>
    </div>
  )
}
