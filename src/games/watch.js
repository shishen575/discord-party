import { esc } from '../util.js';

// ---- YouTube プレイヤー (iframe を直接開き、postMessage で操作する方式) ----
// Discord の中でも動くよう、IFrame API のスクリプトは使わず youtube-nocookie.com の埋め込みを直接開く。
const YT = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
const ERR = { 2: 'URLが正しくありません', 5: '再生できない動画です', 100: '動画が見つかりません(非公開・削除)', 101: '埋め込みが禁止されている動画です', 150: '埋め込みが禁止されている動画です', 153: '埋め込みの設定エラーです' };

const fmt = (sec) => {
  sec = Math.max(0, Math.floor(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

// モジュール内の状態 (プレイヤーは画面更新をまたいで使い回す)
let ctx = null;          // 最新の ctx
let root = null;         // ゲーム画面の要素
let iframe = null;
let ready = false;       // iframe から最初の応答があったか
let playerStarted = false;
let joined = false;      // 「タップして参加」を押したか (自動再生の制限対策)
let loadedItemId = null; // iframe に読み込んでいる曲
let timer = null;
let handshakeTimer = null;
let pState = -1, pTime = 0, pDur = 0;
let hostLastPos = 0;
let hostSeekGuard = 0;

const post = (obj) => iframe?.contentWindow?.postMessage(JSON.stringify(obj), '*');
const cmd = (func, args = []) => post({ event: 'command', func, args });

// applyState などが使う、IFrame API 風のプレイヤー操作
const player = {
  getPlayerState: () => pState,
  getCurrentTime: () => pTime,
  getDuration: () => pDur,
  playVideo: () => cmd('playVideo'),
  pauseVideo: () => cmd('pauseVideo'),
  stopVideo: () => cmd('stopVideo'),
  seekTo: (t) => cmd('seekTo', [t, true]),
  loadVideoById: ({ videoId, startSeconds }) => setSrc(videoId, startSeconds, true),
  cueVideoById: ({ videoId, startSeconds }) => setSrc(videoId, startSeconds, false),
};

function showError(msg) {
  const box = root?.querySelector('#wErr');
  if (box) { box.hidden = false; box.textContent = msg; }
}

function setSrc(videoId, start, autoplay) {
  ready = false;
  pState = -1;
  pTime = start || 0;
  const q = new URLSearchParams({
    autoplay: autoplay ? 1 : 0,
    rel: 0,
    playsinline: 1,
    enablejsapi: 1,
    modestbranding: 1,
    controls: ctx.isHost ? 1 : 0,
    disablekb: ctx.isHost ? 0 : 1,
    start: Math.floor(start || 0),
    origin: location.origin,
  });
  iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?${q}`;
  startHandshake();
}

// 埋め込み側に「こちらは待ち受けている」と知らせ続け、応答があるまで繰り返す
function startHandshake() {
  clearInterval(handshakeTimer);
  let n = 0;
  handshakeTimer = setInterval(() => {
    if (ready) return clearInterval(handshakeTimer);
    if (++n > 40) {
      clearInterval(handshakeTimer);
      return showError('YouTube プレイヤーから応答がありません(埋め込み禁止の動画、または読み込めませんでした)');
    }
    post({ event: 'listening', id: 1, channel: 'widget' });
  }, 500);
}

window.addEventListener('message', (e) => {
  if (!iframe || e.source !== iframe.contentWindow) return;
  let d;
  try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
  if (!d?.event) return;

  const info = d.info;
  let st = null;
  if (d.event === 'onStateChange' && typeof info === 'number') st = info;
  if (info && typeof info === 'object') {
    if (info.currentTime != null) pTime = info.currentTime;
    if (info.duration != null) pDur = info.duration;
    if (info.playerState != null) st = info.playerState;
  }
  if (d.event === 'onError') showError(`再生エラー: ${ERR[info] ?? info}`);

  if (!ready) {
    ready = true;
    clearInterval(handshakeTimer);
    root?.querySelector('#wErr')?.setAttribute('hidden', '');
    post({ event: 'command', func: 'addEventListener', args: ['onStateChange'] });
    applyState();
  }
  if (st !== null && st !== pState) {
    pState = st;
    onStateChange(st);
  }
});

// 主催者のプレイヤー操作を全員へ伝える
function onStateChange(st) {
  if (!ctx?.isHost) return;
  const t = pTime;
  if (st === YT.PLAYING && !ctx.g.playing) ctx.send({ type: 'play', pos: t });
  else if (st === YT.PAUSED && ctx.g.playing) ctx.send({ type: 'pause', pos: t });
  else if (st === YT.PLAYING) { hostSeekGuard = Date.now() + 1500; ctx.send({ type: 'seek', pos: t }); }
  else if (st === YT.ENDED) ctx.send({ type: 'ended', itemId: loadedItemId });
}

// サーバー時刻で計算した「今あるべき再生位置」
function targetPos() {
  const g = ctx.g;
  if (!g.playing) return g.pos;
  return g.pos + (Date.now() + ctx.serverOffset - g.at) / 1000;
}

const current = () => ctx.g.queue.find((q) => q.id === ctx.g.currentId) ?? null;

function applyState() {
  if (!ready || !iframe || !ctx) return;
  const cur = current();

  if (!cur) {
    if (loadedItemId !== null) { player.stopVideo(); loadedItemId = null; }
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

  if (ctx.isHost) return; // 主催者のプレイヤーが基準。サーバーの状態では上書きしない
  if (!joined) return;

  // 視聴者: サーバーの状態に合わせる
  const st = pState;
  const want = targetPos();
  if (ctx.g.playing) {
    if (st !== YT.PLAYING && st !== YT.BUFFERING) {
      player.seekTo(want);
      player.playVideo();
    } else if (Math.abs(pTime - want) > 1.2) {
      player.seekTo(want);
    }
  } else {
    if (st === YT.PLAYING || st === YT.BUFFERING) player.pauseVideo();
    if (Math.abs(pTime - ctx.g.pos) > 0.5) player.seekTo(ctx.g.pos);
  }
}

function startTimer(el) {
  clearInterval(timer);
  timer = setInterval(() => {
    if (!document.body.contains(el)) { clearInterval(timer); clearInterval(handshakeTimer); return; } // 画面が閉じたら停止
    if (!ready || !ctx) return;
    if (!ctx.isHost) applyState(); // 視聴者: 定期的にずれを補正
    else if (loadedItemId !== null && Date.now() > hostSeekGuard) {
      // 主催者: シーク操作を検出して全員に伝える
      if (pState === YT.PLAYING && Math.abs(pTime - hostLastPos) > 2.5) ctx.send({ type: 'seek', pos: pTime });
      hostLastPos = pState === YT.PLAYING ? pTime + 1 : pTime;
    }
    const posEl = el.querySelector('#wPos');
    if (posEl) posEl.textContent = `${fmt(pTime)} / ${fmt(pDur)}`;
  }, 1000);
}

function createIframe(el) {
  const first = current();
  if (!first) { playerStarted = false; return; }
  const holder = el.querySelector('#wPlayer');
  iframe = document.createElement('iframe');
  iframe.id = 'wFrame';
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  iframe.allowFullscreen = true;
  holder.appendChild(iframe);
  loadedItemId = first.id; // 作成時に読み込む(停止状態で待機)
  hostLastPos = Math.max(0, targetPos());
  setSrc(first.videoId, Math.max(0, targetPos()), false);
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
    root = el;

    if (first) {
      el.dataset.init = '1';
      iframe = null; ready = false; joined = false; loadedItemId = null; playerStarted = false;
      pState = -1; pTime = 0; pDur = 0;
      el.innerHTML = `<div class="watch">
        <div class="stage"><div id="wPlayer"></div>
          <div class="noVideo" id="wNoVideo">下の入力欄から YouTube の URL を追加してください</div>
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
    }

    // 主催者以外は動画の上に透明な膜を置いて、直接操作できないようにする
    el.querySelector('#wShield').hidden = ctx.isHost || !current();
    el.querySelector('#wNoVideo').hidden = !!current();
    el.querySelector('#wJoin').style.display = current() && !joined ? '' : 'none';
    el.querySelector('#wCtl').innerHTML = ctx.isHost
      ? '<button class="btn ghost small" data-w="next">⏭ 次の動画</button><span class="hint">再生・停止・シークは動画のコントロールで操作します</span>'
      : '<span class="hint">再生は主催者が操作します</span>';
    const cur = current();
    el.querySelector('#wNow').textContent = cur ? (cur.title ?? cur.videoId) : '動画を追加してください';
    el.querySelector('#wList').innerHTML = listHtml();

    if (!playerStarted && cur) {
      playerStarted = true;
      createIframe(el);
    }
    applyState();
  },
};
