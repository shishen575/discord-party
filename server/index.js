import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { games, gameList } from './games/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// Discord OAuth2 コード → アクセストークン
app.post('/api/token', async (req, res) => {
  try {
    const r = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.VITE_DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: req.body.code,
      }),
    });
    const { access_token } = await r.json();
    res.json({ access_token });
  } catch (e) {
    res.status(500).json({ error: 'token exchange failed' });
  }
});

app.get('/healthz', (_, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, '../dist')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

/** @type {Map<string, any>} */
const rooms = new Map();

function getRoom(id) {
  if (!rooms.has(id)) {
    rooms.set(id, { id, players: new Map(), hostId: null, gameId: null, state: null, playing: false });
  }
  return rooms.get(id);
}

const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));

function broadcast(room) {
  const players = [...room.players.values()].map((p) => ({
    id: p.id, name: p.name, avatar: p.avatar, connected: p.connected,
  }));
  for (const p of room.players.values()) {
    if (!p.ws) continue;
    const game = room.gameId ? games[room.gameId] : null;
    send(p.ws, {
      type: 'state',
      me: p.id,
      hostId: room.hostId,
      players,
      games: gameList(),
      gameId: room.gameId,
      playing: room.playing,
      game: room.playing && game ? game.view(room, room.state, p.id) : null,
    });
  }
}

function electHost(room) {
  const cur = room.players.get(room.hostId);
  if (cur?.connected) return;
  const next = [...room.players.values()].find((p) => p.connected);
  room.hostId = next?.id ?? null;
}

wss.on('connection', (ws) => {
  let room = null;
  let pid = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      room = getRoom(String(msg.room).slice(0, 64));
      pid = String(msg.user.id);
      const existing = room.players.get(pid);
      if (existing?.ws && existing.ws !== ws) existing.ws.close();
      room.players.set(pid, {
        id: pid,
        name: String(msg.user.name).slice(0, 32),
        avatar: msg.user.avatar || null,
        connected: true,
        ws,
      });
      electHost(room);
      if (room.playing) games[room.gameId].onPlayerChange?.(room, room.state);
      return broadcast(room);
    }
    if (!room || !pid) return;

    switch (msg.type) {
      case 'selectGame':
        if (pid === room.hostId && !room.playing && games[msg.gameId]) room.gameId = msg.gameId;
        break;
      case 'start': {
        const g = games[room.gameId];
        const n = [...room.players.values()].filter((p) => p.connected).length;
        if (pid !== room.hostId || room.playing || !g || n < g.minPlayers) break;
        room.state = g.init(room);
        g.start?.(room, room.state);
        room.playing = true;
        break;
      }
      case 'setHost': {
        // 主催者だけが、接続中の別の参加者に主催者を譲れる
        const target = room.players.get(String(msg.playerId));
        if (pid === room.hostId && target?.connected) room.hostId = target.id;
        break;
      }
      case 'backToLobby':
        if (pid === room.hostId) { room.playing = false; room.state = null; }
        break;
      case 'action':
        if (room.playing) games[room.gameId].onAction(room, room.state, pid, msg.action ?? {});
        break;
    }
    broadcast(room);
  });

  ws.on('close', () => {
    if (!room || !pid) return;
    const p = room.players.get(pid);
    if (!p || p.ws !== ws) return;
    p.connected = false;
    p.ws = null;
    electHost(room);
    if (room.playing) games[room.gameId].onPlayerChange?.(room, room.state);
    if (![...room.players.values()].some((x) => x.connected)) rooms.delete(room.id);
    else broadcast(room);
  });
});

// Pterodactyl は割り当てポートを SERVER_PORT で渡す
const port = process.env.SERVER_PORT || process.env.PORT || 3001;
server.listen(port, '0.0.0.0', () => console.log(`server: listening on 0.0.0.0:${port}`));
