# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start dev server (Vite, proxies to localhost:21025)
npm run build     # Type-check + production build
npm run lint      # ESLint
npm run preview   # Preview production build
```

No test runner is configured.

## Architecture

This is a real-time Screeps game client built with React + TypeScript + Vite.

**Component tree:**
```
App.tsx  (all state + logic)
├── RoomRenderer.tsx   (canvas-based room visualization)
├── ConsolePane.tsx    (game console log display)
└── Monaco Editor      (in-browser code editor)
```

**App.tsx** is the single source of truth — it owns all state (auth, room data, WebSocket, logs) and contains all API/socket logic. There is no external state management library.

**Data flow:**
1. Auth: `POST /api/auth/signin` (or `/register`) → token stored in `localStorage`; all API calls send `X-Token` + `X-Username: local-web-client` headers
2. Bootstrap: fetch user profile, world status, code branches, terrain via REST
3. Live updates: SockJS WebSocket at `/socket`, subscribes to `room:{roomName}` and `user:{userId}/console`
4. Room diffs: incoming `room:` messages contain partial diffs applied via `applyDiff()` + `indexObjects()`

**Key functions in App.tsx:**
- `apiFetch()` — authenticated HTTP helper
- `bootstrapSession()` — full auth + data init sequence
- `decodeTerrain()` — decodes packed terrain string to tile array
- `applyDiff()` / `indexObjects()` — incremental room object updates from WebSocket diffs

**RoomRenderer.tsx** receives `terrain[]`, `objects`, `roomUsers`, `roomName`, `userId` as props and renders a canvas. Entity drawing uses `@screeps/renderer`. Click/hover events bubble up via `onTileClick`.

## Proxy / Backend

The Vite dev server proxies:
- `/api` → `http://127.0.0.1:21025`
- `/socket` → `http://127.0.0.1:21025` (WebSocket)
- `/room-history` → `http://127.0.0.1:21025`

A local Screeps private server must be running on port 21025.

## TypeScript

`tsconfig.app.json` enables strict mode with `noUnusedLocals` and `noUnusedParameters`. The build (`tsc -b`) will fail on unused variables.
