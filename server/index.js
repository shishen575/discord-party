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

// 管理者(Discord ユーザーID。カンマ区切り)。サーバー側でトークンを検証して判定する
const ADMIN_IDS = new Set((process.env.ADMIN_IDS || '').split(',').map((x) => x.trim()).filter(Boolean));
const DISCORD_API = process.env.DISCORD_API_BASE || 'https://discord.com/api';

// アクセストークンから本物のユーザー情報を取得(クライアント申告のIDは信用しない)
async function verifyDiscordUser(token) {
  try {
    const r = await fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? String(u.id) : null;
  } catch {
    return null;
  }
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
      isAdmin: !!p.isAdmin,
      hostId: room.hostId,
      players,
      games: gameList(),
      gameId: room.gameId,
      playing: room.playing,
      game: room.playing && game ? game.view(room, room.state, p.id) : null,
    });
  }
}

const HOST_GRACE_MS = Number(process.env.HOST_GRACE_MS) || 60_000; // 主催者が切断しても、この間は主催者の座を保つ

function electHost(room) {
  const cur = room.players.get(room.hostId);
  if (cur?.connected) return;
  // 一時的な切断(再読み込み・回線の揺れ)では主催者を替えない
  if (cur && cur.graceUntil && cur.graceUntil > Date.now()) return;
  const next = [...room.players.values()].find((p) => p.connected);
  room.hostId = next?.id ?? null;
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let room = null;
  let pid = null;

  // 検証(非同期)が絡むので、メッセージは到着順に直列で処理する
  let chain = Promise.resolve();
  ws.on('message', (raw) => {
    chain = chain.then(() => handle(raw)).catch((e) => console.error(e));
  });

  async function handle(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      let isAdmin = false;
      let userId = String(msg.user.id);
      if (msg.token) {
        const verified = await verifyDiscordUser(msg.token);
        if (verified) {
          userId = verified; // 検証できたら本物のIDを使う
          isAdmin = ADMIN_IDS.has(verified);
        }
      }
      // 未検証の接続が管理者IDを名乗って本人の接続を乗っ取れないようにする
      if (!isAdmin && ADMIN_IDS.has(userId)) userId = `unverified-${userId}`;
      room = getRoom(String(msg.room).slice(0, 64));
      pid = userId;
      const existing = room.players.get(pid);
      if (existing?.ws && existing.ws !== ws) existing.ws.close();
      room.players.set(pid, {
        id: pid,
        name: String(msg.user.name).slice(0, 32),
        avatar: msg.user.avatar || null,
        connected: true,
        isAdmin,
        graceUntil: 0,
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
      // ---- 管理者専用 ----
      case 'adminTakeHost':
        if (room.players.get(pid)?.isAdmin) room.hostId = pid;
        break;
      case 'adminForceEnd':
        if (room.players.get(pid)?.isAdmin) { room.playing = false; room.state = null; }
        break;
      case 'backToLobby':
        if (pid === room.hostId) { room.playing = false; room.state = null; }
        break;
      case 'action':
        if (room.playing) games[room.gameId].onAction(room, room.state, pid, msg.action ?? {});
        break;
    }
    broadcast(room);
  }

  ws.on('close', () => {
    if (!room || !pid) return;
    const p = room.players.get(pid);
    if (!p || p.ws !== ws) return;
    p.connected = false;
    p.ws = null;
    if (room.hostId === pid) {
      // 主催者は猶予時間のあいだ座を保持。戻ってこなければ交代する
      p.graceUntil = Date.now() + HOST_GRACE_MS;
      const r = room;
      setTimeout(() => {
        if (!rooms.has(r.id)) return;
        electHost(r);
        broadcast(r);
      }, HOST_GRACE_MS + 500);
    }
    electHost(room);
    if (room.playing) games[room.gameId].onPlayerChange?.(room, room.state);
    if (![...room.players.values()].some((x) => x.connected)) rooms.delete(room.id);
    else broadcast(room);
  });
});

// 生存確認: 無通信での切断(Cloudflare は約100秒で切る)を防ぎ、死んだ接続は破棄する
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 25_000);

// Pterodactyl は割り当てポートを SERVER_PORT で渡す
const port = process.env.SERVER_PORT || process.env.PORT || 3001;
server.listen(port, '0.0.0.0', () => console.log(`server: listening on 0.0.0.0:${port}`));
