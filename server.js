const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const INITIAL_CONTENT = '// start editing...\n';

fs.mkdirSync(DATA_DIR, { recursive: true });

const COLORS = [
  '#f97316', '#3b82f6', '#22c55e', '#a855f7',
  '#ec4899', '#14b8a6', '#eab308', '#ef4444',
];

// ── Room ──────────────────────────────────────────────────────────────────────

class Room {
  constructor(id) {
    this.id = id;
    this.buffer = this._load();
    this.users = new Map();      // userId -> { ws, color, name }
    this.colorIndex = 0;
    this.chatHistory = [];       // last 50 messages
    this.undoStack = [];         // inverse ops, last 50
    this.pendingReset = null;
    this.revision = 0;
    this.opLog = [];             // { delta, rev } for OT transforms, last 100
    this.cleanupTimer = null;
  }

  _load() {
    try { return fs.readFileSync(path.join(DATA_DIR, `${this.id}.txt`), 'utf8'); }
    catch { return INITIAL_CONTENT; }
  }

  _save() {
    fs.writeFile(path.join(DATA_DIR, `${this.id}.txt`), this.buffer, () => {});
  }

  // Transform delta against all server ops since clientRev (basic OT).
  // Shifts positions to account for concurrent insertions/deletions.
  _transform(delta, clientRev) {
    let { from, to, insert } = delta;
    for (const entry of this.opLog) {
      if (entry.rev <= clientRev) continue;
      const o = entry.delta;
      const netLen = o.insert.length - (o.to - o.from);
      if (o.to <= from) {
        from += netLen;
        to   += netLen;
      } else if (o.from < to) {
        // Overlap — clamp end to avoid corrupting the doc
        to = Math.max(from, to + netLen);
      }
    }
    const len = this.buffer.length;
    from = Math.max(0, Math.min(from, len));
    to   = Math.max(from, Math.min(to, len));
    return { from, to, insert };
  }

  applyOp(delta) {
    // Save inverse for shared undo
    this.undoStack.push({
      from: delta.from,
      to: delta.from + delta.insert.length,
      insert: this.buffer.slice(delta.from, delta.to),
    });
    if (this.undoStack.length > 50) this.undoStack.shift();

    this.buffer = this.buffer.slice(0, delta.from) + delta.insert + this.buffer.slice(delta.to);
    this.revision++;
    this.opLog.push({ delta, rev: this.revision });
    if (this.opLog.length > 100) this.opLog.shift();
    this._save();
    return delta;
  }

  receiveOp(rawDelta, clientRev) {
    const delta = this._transform(rawDelta, clientRev);
    this.applyOp(delta);
    return delta;
  }

  doUndo() {
    if (!this.undoStack.length) return;
    const inv = this.undoStack.pop();
    this.buffer = this.buffer.slice(0, inv.from) + inv.insert + this.buffer.slice(inv.to);
    this.revision++;
    this._save();
    this.broadcastAll({ type: 'op', delta: inv, userId: null, rev: this.revision });
  }

  doReset() {
    this.buffer = INITIAL_CONTENT;
    this.undoStack = [];
    this.opLog = [];
    this.revision = 0;
    this._save();
    this.broadcastAll({ type: 'reset', content: this.buffer });
  }

  broadcast(data, excludeId) {
    const msg = JSON.stringify(data);
    for (const [id, u] of this.users) {
      if (id !== excludeId && u.ws.readyState === 1) u.ws.send(msg);
    }
  }

  broadcastAll(data) {
    const msg = JSON.stringify(data);
    for (const u of this.users.values()) {
      if (u.ws.readyState === 1) u.ws.send(msg);
    }
  }

  broadcastPresence() {
    const payload = JSON.stringify({
      type: 'presence',
      users: [...this.users.entries()].map(([id, u]) => ({
        id, color: u.color, name: u.name || id.slice(0, 4).toUpperCase(),
      })),
    });
    for (const u of this.users.values()) {
      if (u.ws.readyState === 1) u.ws.send(payload);
    }
  }
}

const rooms = new Map();

function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, new Room(id));
  const room = rooms.get(id);
  clearTimeout(room.cleanupTimer);
  room.cleanupTimer = null;
  return room;
}

function releaseRoom(room) {
  if (room.users.size > 0) return;
  // Keep room in memory for 2 min after last user leaves (buffer stays on disk)
  room.cleanupTimer = setTimeout(() => {
    if (room.users.size === 0) rooms.delete(room.id);
  }, 120_000);
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 8); }

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const ext = path.extname(urlPath);

  // Static assets (js/css)
  if (MIME[ext]) {
    const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
    if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[ext] });
      res.end(data);
    });
    return;
  }

  // Everything else → index.html (SPA routing)
  fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err, data) => {
    if (err) { res.writeHead(500); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

// ── WebSocket ─────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const qs = new URL(req.url, 'http://x').searchParams;
  const roomId = (qs.get('room') || 'default').replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'default';
  const room = getRoom(roomId);

  const userId = uid();
  const color  = COLORS[room.colorIndex++ % COLORS.length];
  room.users.set(userId, { ws, color, name: null });

  ws.send(JSON.stringify({
    type: 'init',
    content: room.buffer,
    userId,
    color,
    roomId,
    revision: room.revision,
    chatHistory: room.chatHistory,
  }));
  room.broadcastPresence();

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const user = room.users.get(userId);
    if (!user) return;

    switch (msg.type) {

      case 'set_name':
        user.name = String(msg.name || '').trim().slice(0, 24) || null;
        room.broadcastPresence();
        break;

      case 'op': {
        // TODO: for production replace this with a proper OT/CRDT library
        const delta = room.receiveOp(msg.delta, msg.rev ?? room.revision);
        room.broadcastAll({ type: 'op', delta, userId, rev: room.revision });
        break;
      }

      case 'cursor':
        room.broadcast({ type: 'cursor', userId, pos: msg.pos, color }, userId);
        break;

      case 'lang':
        room.broadcast({ type: 'lang', lang: msg.lang }, userId);
        break;

      case 'typing':
        room.broadcast({
          type: 'typing',
          userId,
          name: user.name || userId.slice(0, 4).toUpperCase(),
          color,
          isTyping: !!msg.isTyping,
        }, userId);
        break;

      case 'chat': {
        const text = String(msg.text || '').trim().slice(0, 500);
        if (!text) break;
        const entry = {
          userId, color,
          name: user.name || userId.slice(0, 4).toUpperCase(),
          text,
          ts: Date.now(),
        };
        room.chatHistory.push(entry);
        if (room.chatHistory.length > 50) room.chatHistory.shift();
        room.broadcastAll({ type: 'chat', ...entry });
        break;
      }

      case 'undo':
        room.doUndo();
        break;

      case 'reset_request':
        if (room.pendingReset) break;
        if (room.users.size === 1) { room.doReset(); break; }
        room.pendingReset = {
          requesterId: userId,
          timeout: setTimeout(() => {
            room.pendingReset = null;
            room.broadcastAll({ type: 'reset_expired' });
          }, 30_000),
        };
        room.broadcast({ type: 'reset_request', userId }, userId);
        break;

      case 'reset_confirm':
        if (!room.pendingReset) break;
        clearTimeout(room.pendingReset.timeout);
        room.pendingReset = null;
        room.doReset();
        break;

      case 'reset_deny': {
        if (!room.pendingReset) break;
        clearTimeout(room.pendingReset.timeout);
        const { requesterId } = room.pendingReset;
        room.pendingReset = null;
        room.broadcastAll({ type: 'reset_denied', requesterId });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (room.pendingReset?.requesterId === userId) {
      clearTimeout(room.pendingReset.timeout);
      room.pendingReset = null;
      room.broadcast({ type: 'reset_cancelled' }, userId);
    }
    room.users.delete(userId);
    room.broadcastPresence();
    releaseRoom(room);
  });
});

server.listen(PORT, () => console.log(`Live editor → http://localhost:${PORT}`));
