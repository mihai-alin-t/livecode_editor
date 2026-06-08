import { basicSetup } from 'codemirror';
import { EditorView, Decoration, WidgetType } from '@codemirror/view';
import { EditorState, StateField, StateEffect, Annotation, Compartment } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';

// ── Room ID ───────────────────────────────────────────────────────────────────

function getRoomId() {
  const p = new URLSearchParams(location.search);
  if (!p.has('room')) {
    p.set('room', Math.random().toString(36).slice(2, 8));
    history.replaceState(null, '', `?${p}`);
  }
  return p.get('room');
}

const roomId = getRoomId();
document.getElementById('room-label').textContent = `/ ${roomId}`;
document.title = `livecode / ${roomId}`;

// ── Username modal ────────────────────────────────────────────────────────────

const nameInput = document.getElementById('name-input');
nameInput.value = localStorage.getItem('livecode_name') || '';
nameInput.select();

function startSession() {
  const name = nameInput.value.trim() || 'Anonymous';
  localStorage.setItem('livecode_name', name);
  document.getElementById('name-modal').remove();
  connect(name);
}

document.getElementById('name-submit').addEventListener('click', startSession);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') startSession(); });

// ── Remote annotation ─────────────────────────────────────────────────────────

const Remote = Annotation.define();

// ── Remote cursors ────────────────────────────────────────────────────────────

class CursorWidget extends WidgetType {
  constructor(color) { super(); this.color = color; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'remote-cursor';
    el.style.borderLeftColor = this.color;
    el.style.color = this.color;
    return el;
  }
  eq(other) { return this.color === other.color; }
  ignoreEvent() { return true; }
}

const setCursorEffect    = StateEffect.define();
const removeCursorEffect = StateEffect.define();

const remoteCursorsField = StateField.define({
  create: () => [],
  update(cursors, tr) {
    let next = tr.docChanged
      ? cursors.map(c => ({ ...c, pos: tr.changes.mapPos(c.pos) }))
      : cursors;
    for (const e of tr.effects) {
      if (e.is(setCursorEffect))    next = [...next.filter(c => c.userId !== e.value.userId), e.value];
      if (e.is(removeCursorEffect)) next = next.filter(c => c.userId !== e.value);
    }
    return next;
  },
  provide: f => EditorView.decorations.from(f, cursors =>
    Decoration.set(
      cursors
        .map(({ pos, color }) => Decoration.widget({ widget: new CursorWidget(color), side: 1 }).range(pos))
        .sort((a, b) => a.from - b.from),
      true,
    )
  ),
});

// ── Language compartment ──────────────────────────────────────────────────────

const langCompartment = new Compartment();

const LANGS = {
  javascript: () => javascript(),
  typescript: () => javascript({ typescript: true }),
  html:       () => html(),
  css:        () => css(),
};

function setLang(lang) {
  if (!view) return;
  view.dispatch({ effects: langCompartment.reconfigure((LANGS[lang] ?? LANGS.javascript)()) });
}

// ── Dark theme ────────────────────────────────────────────────────────────────

const darkTheme = EditorView.theme({
  '&':                               { height: '100%', background: '#1e1e2e' },
  '.cm-content':                     { caretColor: '#cdd6f4', color: '#cdd6f4' },
  '.cm-cursor, .cm-dropCursor':      { borderLeftColor: '#cdd6f4' },
  '.cm-gutters':                     { background: '#181825', borderRight: '1px solid #313244', color: '#6c7086' },
  '.cm-activeLineGutter':            { background: '#25253a' },
  '.cm-activeLine':                  { background: '#25253a' },
  '.cm-selectionBackground':         { background: '#45475a' },
  '&.cm-focused .cm-selectionBackground': { background: '#45475a' },
  '.cm-selectionMatch':              { background: '#3d3d5c' },
  '.cm-matchingBracket, .cm-nonmatchingBracket': { background: '#3d3d5c' },
  '.cm-foldPlaceholder':             { background: '#313244', border: 'none', color: '#cdd6f4' },
}, { dark: true });

// ── Editor + WebSocket state ──────────────────────────────────────────────────

let myUserId = null;
let view     = null;
let clientRevision = 0;
const typingTimers = new Map();

// ── Typing indicators ─────────────────────────────────────────────────────────

function markTyping(userId) {
  const el = document.querySelector(`.avatar[data-id="${userId}"]`);
  if (el) el.classList.add('typing');
  clearTimeout(typingTimers.get(userId));
  typingTimers.set(userId, setTimeout(() => {
    document.querySelector(`.avatar[data-id="${userId}"]`)?.classList.remove('typing');
  }, 2000));
}

// ── Connect ───────────────────────────────────────────────────────────────────

function connect(name) {
  const ws = new WebSocket(`ws://${location.host}?room=${roomId}`);

  // Op queue — only one op in-flight at a time so the server never sees two
  // ops from us with the same rev, which would cause it to incorrectly
  // transform the second one against the first (they're sequential, not concurrent).
  const opQueue = [];
  let inflightOp = false;

  function sendOp(delta) {
    opQueue.push(delta);
    flushOpQueue();
  }

  function flushOpQueue() {
    if (inflightOp || !opQueue.length || ws.readyState !== WebSocket.OPEN) return;
    inflightOp = true;
    ws.send(JSON.stringify({ type: 'op', delta: opQueue.shift(), rev: clientRevision }));
  }

  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);

    switch (msg.type) {
      case 'init':
        myUserId = msg.userId;
        clientRevision = msg.revision;
        initEditor(msg.content, ws, sendOp);
        ws.send(JSON.stringify({ type: 'set_name', name }));
        loadChatHistory(msg.chatHistory);
        break;

      case 'op':
        clientRevision = msg.rev ?? clientRevision;
        if (msg.userId === myUserId) {
          // Own op echoed back — unblock the queue
          inflightOp = false;
          flushOpQueue();
          break;
        }
        if (view) applyRemoteOp(msg.delta);
        if (msg.userId) markTyping(msg.userId);
        break;

      case 'cursor':
        if (view) {
          const pos = Math.min(Math.max(0, msg.pos), view.state.doc.length);
          view.dispatch({ effects: setCursorEffect.of({ userId: msg.userId, pos, color: msg.color }) });
        }
        break;

      case 'presence':
        renderPresence(msg.users);
        break;

      case 'chat':
        appendChatMessage(msg);
        clearChatTyping(msg.userId);
        break;

      case 'typing':
        msg.isTyping ? setChatTyping(msg) : clearChatTyping(msg.userId);
        break;

      case 'reset':
        hideResetBanner();
        setResetBtn('idle');
        clientRevision = 0;
        if (view) view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: msg.content },
          annotations: Remote.of(true),
        });
        break;

      case 'lang':
        setLang(msg.lang);
        document.getElementById('lang-select').value = msg.lang;
        break;

      case 'reset_request':   showResetBanner(msg.userId, ws); break;
      case 'reset_denied':    hideResetBanner(); if (msg.requesterId === myUserId) setResetBtn('denied'); break;
      case 'reset_cancelled':
      case 'reset_expired':   hideResetBanner(); break;
    }
  };

  ws.onclose = () => {
    document.querySelector('.logo').textContent = 'livecode (disconnected)';
  };
}

function applyRemoteOp({ from, to, insert }) {
  const len = view.state.doc.length;
  view.dispatch({
    changes: { from: Math.min(from, len), to: Math.min(Math.max(from, to), len), insert },
    annotations: Remote.of(true),
  });
}

// ── Editor init ───────────────────────────────────────────────────────────────

function initEditor(initialContent, ws, sendOp) {
  function send(msg) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  // Language selector — sync change to all peers
  document.getElementById('lang-select').addEventListener('change', e => {
    const lang = e.target.value;
    setLang(lang);
    send({ type: 'lang', lang });
  });

  // Undo button
  const undoBtn = document.getElementById('undo-btn');
  undoBtn.disabled = false;
  undoBtn.addEventListener('click', () => send({ type: 'undo' }));

  // Reset button
  document.getElementById('reset-btn').addEventListener('click', () => {
    send({ type: 'reset_request' });
    setResetBtn('waiting');
  });
  setResetBtn('idle');

  // Chat toggle
  document.getElementById('chat-toggle').addEventListener('click', () => {
    document.getElementById('chat-panel').classList.toggle('hidden');
  });

  // Chat send + typing events
  const chatInput = document.getElementById('chat-input');
  let chatTypingTimer = null;

  chatInput.addEventListener('input', () => {
    send({ type: 'typing', isTyping: true });
    clearTimeout(chatTypingTimer);
    chatTypingTimer = setTimeout(() => send({ type: 'typing', isTyping: false }), 2000);
  });

  function sendChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    clearTimeout(chatTypingTimer);
    send({ type: 'typing', isTyping: false });
    send({ type: 'chat', text });
    chatInput.value = '';
  }
  document.getElementById('chat-send').addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

  view = new EditorView({
    state: EditorState.create({
      doc: initialContent,
      extensions: [
        basicSetup,
        langCompartment.of(javascript()),
        darkTheme,
        remoteCursorsField,
        EditorView.updateListener.of(update => {
          const hasLocal = update.transactions.some(tr => !tr.annotation(Remote));
          if (!hasLocal) return;
          for (const tr of update.transactions) {
            if (tr.annotation(Remote) || !tr.docChanged) continue;
            tr.changes.iterChanges((fromA, toA, _fB, _tB, inserted) => {
              sendOp({ from: fromA, to: toA, insert: inserted.toString() });
            });
          }
          if (update.selectionSet) {
            send({ type: 'cursor', pos: update.state.selection.main.head });
          }
        }),
      ],
    }),
    parent: document.getElementById('editor'),
  });
}

// ── Presence ──────────────────────────────────────────────────────────────────

function renderPresence(users) {
  const bar = document.getElementById('presence');
  bar.innerHTML = '';
  for (const user of users) {
    const dot = document.createElement('div');
    dot.className = 'avatar';
    dot.dataset.id = user.id;
    dot.style.background = user.color;
    dot.textContent = (user.name || user.id).slice(0, 2).toUpperCase();
    dot.title = user.name || user.id;
    if (user.id === myUserId) dot.style.outline = '2px solid rgba(255,255,255,0.6)';
    bar.appendChild(dot);
  }
}

// ── Chat ──────────────────────────────────────────────────────────────────────

function loadChatHistory(history) {
  history.forEach(appendChatMessage);
}

function appendChatMessage({ userId, name, color, text, ts }) {
  const messages = document.getElementById('chat-messages');
  const el = document.createElement('div');
  const own = userId === myUserId;
  el.className = `chat-msg ${own ? 'chat-own' : 'chat-other'}`;
  const time = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  el.innerHTML = own
    ? `<span class="chat-time">${time}</span><div class="chat-bubble">${esc(text)}</div>`
    : `<div class="chat-header"><span class="chat-name" style="color:${color}">${esc(name)}</span><span class="chat-time">${time}</span></div><div class="chat-bubble">${esc(text)}</div>`;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
}

// ── Chat typing indicator ─────────────────────────────────────────────────────

const chatTypingUsers = new Map(); // userId -> { name, color, timer }

function setChatTyping({ userId, name, color }) {
  clearTimeout(chatTypingUsers.get(userId)?.timer);
  chatTypingUsers.set(userId, {
    name, color,
    // Auto-clear if stop message never arrives
    timer: setTimeout(() => { chatTypingUsers.delete(userId); renderChatTyping(); }, 3000),
  });
  renderChatTyping();
}

function clearChatTyping(userId) {
  if (!chatTypingUsers.has(userId)) return;
  clearTimeout(chatTypingUsers.get(userId).timer);
  chatTypingUsers.delete(userId);
  renderChatTyping();
}

function renderChatTyping() {
  const el = document.getElementById('chat-typing');
  const typers = [...chatTypingUsers.values()];
  if (!typers.length) { el.innerHTML = ''; return; }

  let who;
  if (typers.length === 1)      who = `<span style="color:${typers[0].color}">${esc(typers[0].name)}</span> is`;
  else if (typers.length === 2) who = `<span style="color:${typers[0].color}">${esc(typers[0].name)}</span> and <span style="color:${typers[1].color}">${esc(typers[1].name)}</span> are`;
  else                          who = `${typers.length} people are`;

  el.innerHTML = `${who} typing<span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>`;
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Reset UI ──────────────────────────────────────────────────────────────────

function setResetBtn(state) {
  const btn = document.getElementById('reset-btn');
  if (!btn) return;
  btn.textContent = { idle: '↺ Reset', waiting: 'Waiting…', denied: '✗ Denied' }[state] ?? '↺ Reset';
  btn.disabled = state !== 'idle';
  btn.dataset.state = state;
  if (state === 'denied') setTimeout(() => setResetBtn('idle'), 3000);
}

function showResetBanner(requesterId, ws) {
  function send(msg) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }
  hideResetBanner();
  const name = document.querySelector(`.avatar[data-id="${requesterId}"]`)?.title
    || requesterId.slice(0, 4).toUpperCase();
  const banner = document.createElement('div');
  banner.id = 'reset-banner';
  banner.innerHTML = `<span><strong>${esc(name)}</strong> wants to reset the buffer</span><div><button class="banner-confirm">Confirm</button><button class="banner-deny">Deny</button></div>`;
  banner.querySelector('.banner-confirm').onclick = () => { send({ type: 'reset_confirm' }); hideResetBanner(); };
  banner.querySelector('.banner-deny').onclick    = () => { send({ type: 'reset_deny'    }); hideResetBanner(); };
  document.getElementById('editor').prepend(banner);
}

function hideResetBanner() {
  document.getElementById('reset-banner')?.remove();
}
