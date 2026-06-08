# Live Code Editor — WebSockets Project

## What We're Building
A real-time collaborative code editor where multiple users can edit the same file simultaneously in the browser, powered by WebSockets. Think stripped-down CodePen/CodeSandbox with live multiplayer editing.

## Core Features (Day 1 Scope)
- Multiple users editing a shared code buffer in real time
- Syntax highlighting (read-only, no execution needed)
- Live cursor positions for each connected user (colored carets)
- User presence bar showing who is currently connected
- Reconnection handling when a user drops off

## Out of Scope (for now)
- Code execution / sandboxing
- Auth / user accounts
- Persistence (in-memory only is fine)
- Multiple files or rooms (single shared buffer is enough to learn the protocol)

## Tech Stack
- **Server**: Node.js + `ws` library (raw WebSockets, no socket.io)
- **Frontend**: Vanilla JS + CodeMirror 6 (editor with WebSocket-friendly APIs)
- **No framework** — this is a protocol learning project, not a React project

## Project Structure
```
/
├── server.js          # WebSocket server + static file serving
├── public/
│   ├── index.html     # Editor UI
│   ├── client.js      # WebSocket client + CodeMirror setup
│   └── style.css      # Minimal styling
├── package.json
└── CLAUDE.md
```

## WebSocket Message Protocol
All messages are JSON with a `type` field.

### Client → Server
```json
{ "type": "op", "delta": { "from": 0, "to": 5, "insert": "hello" } }
```

### Server → Client
```json
{ "type": "op", "delta": { "from": 0, "to": 5, "insert": "hello" }, "userId": "abc123" }
{ "type": "cursor", "userId": "abc123", "pos": 42, "color": "#f97316" }
{ "type": "presence", "users": [{ "id": "abc123", "color": "#f97316" }] }
{ "type": "init", "content": "// start editing...", "userId": "abc123" }
```

## Key Concepts to Explore
- **Broadcast vs echo**: the server should forward ops to all clients *except* the sender
- **Last-write-wins**: simplest conflict strategy — good enough for day 1
- **Cursor sync**: send cursor position on every CodeMirror `selectionchange` event
- **Init on connect**: new clients receive the current buffer state immediately on connection

## Conflict Strategy (Keep It Simple)
Do NOT implement OT or CRDTs on day 1. Use last-write-wins:
- Server holds the canonical string in memory
- Each incoming `op` is applied to the server buffer, then broadcast
- Clients apply remote ops directly — accept divergence, it's fine for learning

Add a TODO comment where OT/CRDT would plug in so you remember the tradeoff.

## Getting Started
```bash
npm init -y
npm install ws
# CodeMirror loaded via CDN in index.html
node server.js
# Open http://localhost:3000 in two tabs
```

## What You'll Learn
- How to manage a WebSocket server with multiple concurrent connections
- Broadcasting messages to a subset of clients (all except sender)
- Keeping shared state in memory on the server
- Syncing ephemeral data (cursors) vs persistent data (buffer content)
- The difference between WebSockets and polling — you'll feel it immediately when two tabs sync in real time