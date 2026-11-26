// みんなで動画: 主催者だけが再生を操作し、全員の画面で同期する。誰でもプレイリストに追加できる。
const ID_RE = /^[\w-]{11}$/;
const MAX_QUEUE = 100;

export function parseVideoId(input) {
  const t = String(input ?? '').trim();
  if (ID_RE.test(t)) return t;
  try {
    const u = new URL(t.includes('://') ? t : `https://${t}`);
    const h = u.hostname.replace(/^(www|m|music)\./, '');
    if (h === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      return ID_RE.test(id) ? id : null;
    }
    if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
      const v = u.searchParams.get('v');
      if (v && ID_RE.test(v)) return v;
      const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([\w-]{11})/);
      if (m) return m[2];
    }
  } catch { /* 不正なURL */ }
  return null;
}

const clampPos = (n) => Math.max(0, Math.min(Number(n) || 0, 60 * 60 * 24));

async function fetchTitle(videoId) {
  try {
    const r = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!r.ok) return null;
    return String((await r.json()).title ?? '').slice(0, 120) || null;
  } catch {
    return null;
  }
}

export default {
  id: 'watch',
  name: 'みんなで動画',
  description: 'YouTubeをみんなで同時に視聴。再生は主催者だけが操作、プレイリストには誰でも追加できます。',
  minPlayers: 1,
  maxPlayers: 100,

  init() {
    return { queue: [], seq: 1, currentId: null, playing: false, pos: 0, at: Date.now() };
  },

  start() {},

  select(s, id, playing) {
    s.currentId = id;
    s.pos = 0;
    s.playing = playing;
    s.at = Date.now();
  },

  onAction(room, s, pid, a, refresh) {
    const isHost = pid === room.hostId;
    const cur = s.queue.find((q) => q.id === s.currentId);

    switch (a.type) {
      case 'add': {
        const videoId = parseVideoId(a.url);
        if (!videoId || s.queue.length >= MAX_QUEUE) return;
        const item = { id: s.seq++, videoId, title: null, addedBy: pid };
        s.queue.push(item);
        if (!s.currentId) this.select(s, item.id, false); // 最初の1本は停止状態で待機
        fetchTitle(videoId).then((t) => {
          if (t) { item.title = t; refresh?.(); }
        });
        return;
      }
      case 'remove': {
        const i = s.queue.findIndex((q) => q.id === a.itemId);
        if (i < 0) return;
        if (!isHost && s.queue[i].addedBy !== pid) return; // 他人の追加分は主催者だけが消せる
        const wasCurrent = s.queue[i].id === s.currentId;
        s.queue.splice(i, 1);
        if (wasCurrent) {
          const next = s.queue[i] ?? s.queue[i - 1] ?? null;
          this.select(s, next?.id ?? null, false);
        }
        return;
      }
    }

    if (!isHost) return; // 以降は主催者専用
    switch (a.type) {
      case 'play':
        if (!cur) return;
        s.playing = true; s.pos = clampPos(a.pos); s.at = Date.now();
        return;
      case 'pause':
        if (!cur) return;
        s.playing = false; s.pos = clampPos(a.pos); s.at = Date.now();
        return;
      case 'seek':
        if (!cur) return;
        s.pos = clampPos(a.pos); s.at = Date.now();
        return;
      case 'select':
        if (s.queue.some((q) => q.id === a.itemId)) this.select(s, a.itemId, true);
        return;
      case 'next':
      case 'ended': {
        if (a.type === 'ended' && a.itemId !== s.currentId) return; // 古い通知は無視
        const i = s.queue.findIndex((q) => q.id === s.currentId);
        const next = s.queue[i + 1];
        if (next) this.select(s, next.id, true);
        else { s.playing = false; s.at = Date.now(); }
        return;
      }
    }
  },

  onPlayerChange() {},

  view(room, s) {
    return {
      queue: s.queue,
      currentId: s.currentId,
      playing: s.playing,
      pos: s.pos,
      at: s.at,
      now: Date.now(), // クライアントの時計合わせ用
    };
  },
};
