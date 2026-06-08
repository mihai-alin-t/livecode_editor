# livecode

A real-time collaborative code editor built with raw WebSockets and CodeMirror 6. Multiple users can edit the same file simultaneously, see each other's cursors, and chat — all in the browser, no framework required.

## Features

- **Live collaborative editing** — multiple users share a single buffer with basic OT to handle concurrent edits
- **Multi-room** — each `?room=` URL is an isolated session; rooms are created on demand and cleaned up when empty
- **Syntax highlighting** — JavaScript, TypeScript, HTML, CSS (CodeMirror 6); language changes sync to all peers
- **Remote cursors** — colored carets show every connected user's position in real time
- **Presence bar** — avatar for each connected user with a typing pulse animation
- **Chat panel** — in-room chat with typing indicators; own messages align right, others align left; history replays on join
- **Shared undo** — server-side undo stack; any user can undo the last operation
- **Buffer reset** — request a reset with confirmation from other users before it applies
- **Reconnection handling** — client detects disconnect and shows a status label

## Stack

| Layer | Technology |
|---|---|
| Server | Node.js + [`ws`](https://github.com/websockets/ws) (raw WebSockets) |
| Editor | [CodeMirror 6](https://codemirror.net/) |
| Bundler | [esbuild](https://esbuild.github.io/) |
| Frontend | Vanilla JS — no framework |

## Getting Started

**Prerequisites:** Node.js 18+

```bash
git clone <repo-url>
cd livecode_editor
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). To test collaboration, open the same URL in a second tab or browser window — the `?room=` query param is shared automatically.

`npm start` runs `esbuild` (bundles `public/client.js` → `public/bundle.js`) then starts the server. Run `npm run build` separately if you only want to rebuild the client.

## Project Structure

```
├── server.js          # WebSocket server + HTTP static file serving
├── public/
│   ├── index.html     # Editor UI shell
│   ├── client.js      # WebSocket client + CodeMirror setup (source)
│   ├── bundle.js      # esbuild output — do not edit directly
│   └── style.css      # Catppuccin Mocha dark theme
├── data/              # Per-room buffer persistence (plain .txt files)
├── docs/
│   ├── brainstorms/   # Design exploration documents
│   └── plans/         # Implementation plans
├── package.json
└── CLAUDE.md          # AI assistant context and project conventions
```

## WebSocket Protocol

All messages are JSON with a `type` field.

### Client → Server

| Type | Payload | Description |
|---|---|---|
| `op` | `{ delta: { from, to, insert }, rev }` | Text change |
| `cursor` | `{ pos }` | Cursor position update |
| `lang` | `{ lang }` | Language switch |
| `set_name` | `{ name }` | Set display name |
| `chat` | `{ text }` | Send chat message |
| `typing` | `{ isTyping }` | Chat typing indicator |
| `undo` | — | Trigger shared undo |
| `reset_request` | — | Request buffer reset |
| `reset_confirm` | — | Confirm a pending reset |
| `reset_deny` | — | Deny a pending reset |

### Server → Client

| Type | Payload | Description |
|---|---|---|
| `init` | `{ content, userId, revision, chatHistory }` | Initial state on connect |
| `op` | `{ delta, userId, rev }` | Forwarded text change |
| `cursor` | `{ userId, pos, color }` | Remote cursor update |
| `presence` | `{ users: [{ id, name, color }] }` | Connected users list |
| `chat` | `{ userId, name, color, text, ts }` | Chat message |
| `typing` | `{ userId, name, color, isTyping }` | Chat typing state |
| `lang` | `{ lang }` | Language sync |
| `reset` | `{ content }` | Buffer was reset |
| `reset_request` | `{ userId }` | A user requested a reset |
| `reset_denied` | `{ requesterId }` | Reset was denied |
| `reset_cancelled` | — | Requester disconnected |
| `reset_expired` | — | No response within timeout |

## Conflict Strategy

Uses **last-write-wins** with basic positional OT on the server:

1. Server holds the canonical buffer string in memory (persisted to `data/<roomId>.txt`)
2. Each `op` carries the client's known revision (`rev`)
3. The server transforms the op against any concurrent ops since that revision, applies it, increments revision, and broadcasts
4. Clients maintain a send queue — only one op is in-flight at a time to prevent same-client rev collisions

> **TODO:** Replace positional OT with a proper OT library or CRDT (e.g. Yjs) for production-grade consistency.

## Roadmap

See [TODO.md](TODO.md) for the planned pivot to a collaborative learning platform:

- Auth (email + password, sessions)
- Daily AI-generated coding challenges (Claude)
- Agentic chat (hints on demand, code review on submit)
- Leaderboard (time bonus + quality score)
- Code preview pane for HTML/CSS/JS challenges

Full plan: [docs/plans/2026-06-08-feat-learning-platform-pivot-plan.md](docs/plans/2026-06-08-feat-learning-platform-pivot-plan.md)
