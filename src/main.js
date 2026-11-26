import './style.css';
import { setup, wsUrl } from './discord.js';
import { games } from './games/index.js';
import { esc, avatarHtml } from './util.js';

const app = document.getElementById('app');
app.innerHTML = '<div class="center">読み込み中…</div>';

let ws, state = null, identity;
let hostMenuOpen = false;

function send(msg) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
}

function connect() {
  ws = new WebSocket(wsUrl);
  ws.onopen = () => send({ type: 'join', room: identity.room, user: identity.user, token: identity.token });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'state') {
      state = m;
      render();
    }
  };
  ws.onclose = () => setTimeout(connect, 1500); // 自動再接続
}

// 再描画しても入力中の文字とフォーカスを保つ
function render() {
  const active = document.activeElement;
  const keep = active?.id && active.tagName === 'INPUT' ? { id: active.id, v: active.value, s: active.selectionStart } : null;

  const players = new Map(state.players.map((p) => [p.id, p]));
  const isHost = state.me === state.hostId;
  const game = state.playing ? games[state.gameId] : null;

  app.innerHTML = '<main id="screen"></main>';
  const screen = document.getElementById('screen');

  if (game) {
    screen.innerHTML = `<header><span>${esc(state.games.find((g) => g.id === state.gameId)?.name)}</span>
      ${isHost ? '<button class="btn ghost small" id="back">ロビーへ</button>' : ''}</header><section id="game"></section>${hostMenuHtml(isHost)}${adminHtml()}`;
    bindHostMenu(screen);
    bindAdmin(screen);
    document.getElementById('back')?.addEventListener('click', () => send({ type: 'backToLobby' }));
    game.render(document.getElementById('game'), { g: state.game, players, me: state.me, isHost, send: (action) => send({ type: 'action', action }) });
  } else {
    renderLobby(screen, players, isHost);
  }

  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) {
      el.value = keep.v;
      el.focus();
      el.setSelectionRange(keep.s, keep.s);
    }
  } else {
    app.querySelector('input')?.focus();
  }
}

// 管理者だけに表示するパネル
function adminHtml() {
  if (!state.isAdmin) return '';
  return `<div class="adminbar"><b>🛡 管理者</b>
    ${state.me !== state.hostId ? '<button class="btn small" data-adm="adminTakeHost">主催者になる</button>' : ''}
    ${state.playing ? '<button class="btn ng small" data-adm="adminForceEnd">強制終了</button>' : ''}</div>`;
}

function bindAdmin(root) {
  root.querySelectorAll('[data-adm]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.adm === 'adminForceEnd' && !confirm('ゲームを強制終了してロビーに戻しますか?')) return;
      send({ type: b.dataset.adm });
    }),
  );
}

// 主催者だけに表示する「主催者を変更」メニュー
function hostMenuHtml(isHost) {
  if (!isHost) return '';
  const others = state.players.filter((p) => p.connected && p.id !== state.me);
  if (!others.length) return '';
  return `<details class="hostmenu" ${hostMenuOpen ? 'open' : ''}><summary>👑 主催者を変更</summary>
    <div class="hostlist">${others
      .map((p) => `<button class="btn ghost small" data-host="${esc(p.id)}">${avatarHtml(p)} ${esc(p.name)}</button>`)
      .join('')}</div></details>`;
}

function bindHostMenu(root) {
  const d = root.querySelector('.hostmenu');
  if (!d) return;
  d.addEventListener('toggle', () => { hostMenuOpen = d.open; });
  d.querySelectorAll('[data-host]').forEach((b) =>
    b.addEventListener('click', () => {
      hostMenuOpen = false;
      send({ type: 'setHost', playerId: b.dataset.host });
    }),
  );
}

function renderLobby(screen, players, isHost) {
  const sel = state.games.find((g) => g.id === state.gameId);
  const online = state.players.filter((p) => p.connected);
  const canStart = isHost && sel && online.length >= sel.minPlayers;
  screen.innerHTML = `
    <h1>🎉 パーティーゲーム</h1>
    <h3>参加者 (${online.length}人)</h3>
    <div class="chips">${online
      .map((p) => `<div class="chip">${avatarHtml(p)}<span>${esc(p.name)}</span>${p.id === state.hostId ? '<em>👑</em>' : ''}</div>`)
      .join('')}</div>
    <h3>ゲームを選ぶ${isHost ? '' : '(ホストが選びます)'}</h3>
    <div class="cards">${state.games
      .map(
        (g) => `<button class="card ${g.id === state.gameId ? 'sel' : ''}" data-g="${g.id}" ${isHost ? '' : 'disabled'}>
          <b>${esc(g.name)}</b><small>${esc(g.description)}</small><small>${g.minPlayers}〜${g.maxPlayers}人</small></button>`,
      )
      .join('')}</div>
    ${isHost ? `<button class="btn primary big" id="start" ${canStart ? '' : 'disabled'}>${
      !sel ? 'ゲームを選んでください' : online.length < sel.minPlayers ? `あと${sel.minPlayers - online.length}人必要です` : 'スタート!'
    }</button>` : '<p class="hint">ホストの開始を待っています…</p>'}
    ${hostMenuHtml(isHost)}${adminHtml()}`;
  bindHostMenu(screen);
  bindAdmin(screen);
  screen.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => send({ type: 'selectGame', gameId: b.dataset.g })));
  document.getElementById('start')?.addEventListener('click', () => send({ type: 'start' }));
}

(async () => {
  try {
    identity = await setup();
    connect();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="center">接続に失敗しました<br><small>${esc(e.message ?? e)}</small></div>`;
  }
})();
