import { esc } from '../util.js';
import { inDiscord } from '../discord.js';

// ---- YouTube IFrame API ----
let apiPromise = null;
function loadApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve();
    const t = setTimeout(() => reject(new Error('YouTube の読み込みがタイムアウトしました')), 15000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(t); resolve(); };
    const s = document.createElement('script');
    // Discord内では patchUrlMappings により /youtube 経由に書き換わる
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { clearTimeout(t); reject(new Error('YouTube を読み込めませんでした')); };
    document.head.appendChild(s);
  });
  return apiPromise;
}

const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
const fmt = (sec) => {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

// モジュール内の状態 (プレイヤーは画面更新をまたいで使い回す)
let ctx = null;          // 最新の ctx
let player = null;
let ready = false;
let joined = false;      // 「タップして参加」を押したか (自動再生の制限対策)
let loadedItemId = null; // プレイヤーに読み込んでいる曲
let timer = null;
let hostLastPos = 0;
let hostSeekGuard = 0;

// サーバー時刻で計算した「今あるべき再生位置」
function targetPos() {
  const g = ctx.g;
  if (!g.playing) return g.pos;
  const serverNow = Date.now() + ctx.serverOffset;
  return g.pos + (serverNow - g.at) / 1000;
}

const current = () => ctx.g.queue.find((q) => q.id === ctx.g.currentId) ?? null;

function applyState() {
  if (!ready || !player || !ctx) return;
  const cur = current();
  const host = ctx.isHost;

  if (!cur) {
    if (loadedItemId !== null) { player.stopVideo?.(); loadedItemId = null; }
    return;
  }

  // 曲が替わったら読み込み (主催者の場合も)
  if (loadedItemId !== cur.id) {
    loadedItemId = cur.id;
    const start = Math.max(0, targetPos());
    if (joined && ctx.g.playing) player.loadVideoById({ videoId: cur.videoId, startSeconds: start });
    else player.cueVideoById({ videoId: cur.videoId, startSeconds: start });
    hostLastPos = start;
    return;
  }

  if (host) return; // 主催者のプレイヤーが基準。サーバーの状態では上書きしない

  // 視聴者: サーバーの状態に合わせる
  if (!joined) return;
  const st = player.getPlayerState?.();
  const want = targetPos();
  if (ctx.g.playing) {
    if (st !== YT_STATE.PLAYING && st !== YT_STATE.BUFFERING) {
      player.seekTo(want, true);
      player.playVideo();
    } else if (Math.abs(player.getCurrentTime() - want) > 1.2) {
      player.seekTo(want, true);
    }
  } else {
    if (st === YT_STATE.PLAYING || st === YT_STATE.BUFFERING) player.pauseVideo();
    if (Math.abs(player.getCurrentTime() - ctx.g.pos) > 0.5) player.seekTo(ctx.g.pos, true);
  }
}

function startTimer(el) {
  clearInterval(timer);
  timer = setInterval(() => {
    if (!document.body.contains(el)) { clearInterval(timer); return; } // 画面が閉じたら停止
    if (!ready || !player || !ctx) return;
    // 視聴者: 定期的にずれを補正
    if (!ctx.isHost) applyState();
    // 主催者: シーク操作を検出して全員に伝える
    else if (loadedItemId !== null && Date.now() > hostSeekGuard) {
      const st = player.getPlayerState?.();
      const t = player.getCurrentTime?.() ?? 0;
      if (st === YT_STATE.PLAYING && Math.abs(t - hostLastPos) > 2.5) ctx.send({ type: 'seek', pos: t });
      hostLastPos = st === YT_STATE.PLAYING ? t + 1 : t; // 次回の目安 (1秒ごとに1秒進む想定)
    }
    const posEl = el.querySelector('#wPos');
    if (posEl && player.getCurrentTime) posEl.textContent = `${fmt(player.getCurrentTime())} / ${fmt(player.getDuration?.() || 0)}`;
  }, 1000);
}

function showError(el, msg) {
  const box = el.querySelector('#wErr');
  if (box) { box.hidden = false; box.textContent = msg; }
}

async function setupPlayer(el) {
  try {
    await loadApi();
  } catch (e) {
    return showError(el, `${e.message}${inDiscord ? '(Discord の URL Mappings に YouTube が設定されているか確認してください)' : ''}`);
  }
  player = new window.YT.Player('wPlayer', {
    width: '100%',
    height: '100%',
    playerVars: {
      controls: ctx.isHost ? 1 : 0,
      disablekb: ctx.isHost ? 0 : 1,
      rel: 0,
      playsinline: 1,
      origin: location.origin,
    },
    events: {
      onReady: () => { ready = true; applyState(); },
      onError: (e) => {
        const reasons = { 2: 'URLが正しくありません', 5: '再生できない動画です', 100: '動画が見つかりません(非公開・削除)', 101: '埋め込みが禁止されている動画です', 150: '埋め込みが禁止されている動画です', 153: '埋め込みの設定エラーです' };
        showError(el, `再生エラー: ${reasons[e.data] ?? e.data}`);
      },
      onStateChange: (e) => {
        if (!ctx?.isHost) return;
        const t = player.getCurrentTime?.() ?? 0;
        if (e.data === YT_STATE.PLAYING && !ctx.g.playing) ctx.send({ type: 'play', pos: t });
        else if (e.data === YT_STATE.PAUSED && ctx.g.playing) ctx.send({ type: 'pause', pos: t });
        else if (e.data === YT_STATE.PLAYING) { hostSeekGuard = Date.now() + 1500; ctx.send({ type: 'seek', pos: t }); }
        else if (e.data === YT_STATE.ENDED) ctx.send({ type: 'ended', itemId: loadedItemId });
      },
    },
  });
  startTimer(el);
}

function listHtml() {
  const { g, players, me, isHost } = ctx;
  if (!g.queue.length) return '<li class="empty">まだ動画がありません。URLを追加してください。</li>';
  return g.queue
    .map((q) => {
      const isCur = q.id === g.currentId;
      const by = players.get(q.addedBy)?.name ?? '';
      const canRemove = isHost || q.addedBy === me;
      return `<li class="${isCur ? 'cur' : ''}">
        <div class="t"><b>${isCur ? '▶ ' : ''}${esc(q.title ?? q.videoId)}</b><small>${esc(by)}</small></div>
        ${isHost && !isCur ? `<button class="btn small" data-w="select" data-id="${q.id}">再生</button>` : ''}
        ${canRemove ? `<button class="btn ghost small" data-w="remove" data-id="${q.id}">✕</button>` : ''}</li>`;
    })
    .join('');
}

export default {
  id: 'watch',

  render(el, c) {
    const first = !el.dataset.init;
    ctx = c;

    if (first) {
      el.dataset.init = '1';
      ready = false; player = null; joined = false; loadedItemId = null;
      el.innerHTML = `<div class="watch">
        <div class="stage"><div id="wPlayer"></div>
          <div class="shield" id="wShield"></div>
          <button class="join" id="wJoin">▶ タップして視聴に参加</button>
          <div class="err" id="wErr" hidden></div></div>
        <div class="np"><span id="wNow"></span><span id="wPos" class="pos"></span></div>
        <div class="row" id="wCtl"></div>
        <form id="wAdd" class="row"><input id="wUrl" placeholder="YouTubeのURLを追加" autocomplete="off" /><button class="btn primary">追加</button></form>
        <ul id="wList" class="plist"></ul></div>`;
      el.querySelector('#wJoin').addEventListener('click', () => {
        joined = true;
        el.querySelector('#wJoin').hidden = true;
        loadedItemId = null; // 参加時に再読み込みして今の位置から再生
        applyState();
      });
      el.querySelector('#wAdd').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = el.querySelector('#wUrl');
        if (input.value.trim()) ctx.send({ type: 'add', url: input.value.trim() });
        input.value = '';
      });
      el.querySelector('#wList').addEventListener('click', (e) => {
        const b = e.target.closest('[data-w]');
        if (b) ctx.send({ type: b.dataset.w, itemId: Number(b.dataset.id) });
      });
      el.querySelector('#wCtl').addEventListener('click', (e) => {
        if (e.target.closest('[data-w="next"]')) ctx.send({ type: 'next' });
      });
      setupPlayer(el);
    }

    // 主催者以外は動画の上に透明な膜を置いて、直接操作できないようにする
    el.querySelector('#wShield').hidden = ctx.isHost;
    el.querySelector('#wCtl').innerHTML = ctx.isHost
      ? '<button class="btn ghost small" data-w="next">⏭ 次の動画</button><span class="hint">再生・停止・シークは動画のコントロールで操作します</span>'
      : '<span class="hint">再生は主催者が操作します</span>';
    const cur = current();
    el.querySelector('#wNow').textContent = cur ? (cur.title ?? cur.videoId) : '動画を追加してください';
    el.querySelector('#wList').innerHTML = listHtml();

    applyState();
  },
};
