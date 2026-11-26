import { DiscordSDK, patchUrlMappings } from '@discord/embedded-app-sdk';

export const YOUTUBE_MAPPINGS = [
  { prefix: '/youtube', target: 'www.youtube.com' },
  { prefix: '/youtube-nocookie', target: 'www.youtube-nocookie.com' },
  { prefix: '/ytimg', target: 'i.ytimg.com' },
];

const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
export const inDiscord = new URLSearchParams(location.search).has('frame_id');

// Discord内ではプロキシ経由(/.proxy)でサーバーにアクセスする
const prefix = inDiscord ? '/.proxy' : '';
export const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${prefix}/ws`;

/** @returns {{room:string,user:{id:string,name:string,avatar:string|null}}} */
export async function setup() {
  if (!inDiscord) return guest();

  const sdk = new DiscordSDK(clientId);
  await sdk.ready();
  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify'],
  });
  const res = await fetch(`${prefix}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const { access_token } = await res.json();
  const auth = await sdk.commands.authenticate({ access_token });
  // YouTube 埋め込み用: Developer Portal の URL Mappings と同じ prefix にしておくこと
  patchUrlMappings(YOUTUBE_MAPPINGS, { patchFetch: true, patchXhr: true, patchSrcAttributes: true });
  const u = auth.user;
  return {
    token: access_token, // サーバー側で本人確認(管理者判定)に使う
    room: sdk.instanceId,
    user: {
      id: u.id,
      name: u.global_name || u.username,
      avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : null,
    },
  };
}

// ブラウザ単体での動作確認用 (?room=xxx&name=yyy)。タブごとに別ユーザー。
function guest() {
  const q = new URLSearchParams(location.search);
  let id = sessionStorage.getItem('guestId');
  if (!id) {
    id = 'guest-' + Math.random().toString(36).slice(2, 7);
    sessionStorage.setItem('guestId', id);
  }
  return { room: q.get('room') || 'dev', user: { id, name: q.get('name') || `ゲスト${id.slice(-3)}`, avatar: null } };
}
