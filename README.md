# Screeps Web Client

React + TypeScript + Vite web client for a local/private Screeps server.

## Features

- Room rendering with live socket updates
- Console, code editor, memory, market, messages, leaderboard
- Local auth flow for private server:
  - `POST /api/auth/signin`
  - `POST /api/auth/register`
- World map with terrain, ownership overlay, and room resource markers

## Repo Layout

- Client repo: `/home/shino/screeps-web-client`
- Server repo: `/home/shino/repos/screeps`
- Server world data: `/home/shino/repos/screeps/world`

## Requirements

- Node.js 20+ for the web client
- Node.js 22 for the Screeps server

The private Screeps server in this workspace requires Node 22 for engine compatibility.

## Run The Server

Use Node 22 explicitly:

```bash
cd /home/shino/repos/screeps/world
/home/shino/.nvm/versions/node/v22.21.1/bin/node /home/shino/repos/screeps/bin/screeps.js start
```

Server endpoints:

- Game/API: `http://127.0.0.1:21025`
- CLI: `127.0.0.1:21026`

## Run The Client

```bash
cd /home/shino/screeps-web-client
npm install
npm run dev
```

Default Vite dev server:

- `http://127.0.0.1:4173`

The dev server proxies these paths to Screeps:

- `/api`
- `/socket`
- `/room-history`

See [vite.config.ts](./vite.config.ts).

## Login

This client is configured for local auth on the patched private server.

Routes used:

- `POST /api/auth/signin`
- `POST /api/auth/register`
- `GET /api/auth/me`

Example test account used during local verification:

- username: `test1`
- password: `12345`

## World Map Notes

The world map uses the real room list from:

- `GET /api/game/rooms`

It does not assume a symmetric public Screeps world layout. This matters for custom/private worlds whose room names do not include both `E/W` and `N/S` halves.

Resource markers shown on the world map are fetched from:

- `GET /api/game/room-objects?room=<ROOM>`

Markers currently rendered:

- `source`
- `mineral`
- `deposit`

## Build

```bash
npm run build
```

Production output:

- `dist/`

## Current Local Server Patches

The server in this workspace includes local patches for:

- Steamless/local auth
- `signin` / `register` auth routes
- `GET /api/game/room-objects`
- `GET /api/game/rooms`

Patch source:

- `/home/shino/repos/screeps/scripts/patch-steamless.js`

If server dependencies are reinstalled, make sure that patch is still applied.
