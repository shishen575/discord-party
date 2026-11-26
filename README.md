# Discord パーティーゲーム (Activity)

現在のゲーム: **全会一致ゲーム**(ホストがお題を自由入力 → 全員が回答 → 公開 → ホストが一致を判定)

## セットアップ
1. Discord Developer Portal でアプリを作成し、Activities を有効化
2. `.env.example` を `.env` にコピーして CLIENT_ID / CLIENT_SECRET を設定
3. OAuth2 の Redirects に任意のURL(例: `https://127.0.0.1`)を追加
4. `npm install && npm run dev`
5. 別ターミナルで `scripts/tunnel.sh dev`(= `cloudflared tunnel --url http://localhost:5173`)を実行。
   表示された `xxxx.trycloudflare.com` を Developer Portal の Activities > URL Mappings で `/` → そのホスト名 に設定。
   トンネル越しにHMRも使うなら `npm run dev:tunnel` で起動
6. Discordのボイスチャンネルでアクティビティを起動

ブラウザ単体の確認: `http://localhost:5173/?room=a&name=太郎` を複数タブで開く(タブごとに別ユーザー)。

## ゲームの追加方法
- `server/games/<id>.js` … `init / onAction / view / onPlayerChange` を実装し `server/games/index.js` に登録
- `src/games/<id>.js` … `render(el, ctx)` を実装し `src/games/index.js` に登録

## Pterodactyl パネルで動かす
Node.js 用の Egg(Generic Node.js など)で動きます。

1. このプロジェクト一式(`node_modules` と `.env` 以外)をサーバーの File Manager / SFTP / git でアップロード
2. パネルの **Startup** で環境変数を設定(`.env` をアップロードしても可)
   - `VITE_DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`
   - ポートは Pterodactyl が渡す `SERVER_PORT` を自動で使います
3. 初回のみ Console で `npm run setup`(依存インストール+フロントのビルド。Client ID はビルド時に埋め込まれるので、変更したら再ビルド)
   - Egg のスタートアップコマンドを `npm run setup && npm start` にしてもOK
4. 通常の起動コマンドは `npm start`
5. **HTTPS が必須**です。Discord は https のURLしか受け付けません。割り当てられた `IP:ポート` を、nginx / Caddy / Cloudflare Tunnel などで `https://ドメイン` にして、Developer Portal の URL Mappings(`/` → そのドメイン)に設定してください。WebSocket(`/ws`)も通す設定が必要です。
6. 死活確認用に `/healthz` があります。

## Cloudflare Tunnel
- cloudflared は HTTP / WebSocket(`/ws`)をそのまま中継するので追加設定は不要です。URLは自動で https になります。
- **一時URL**: `scripts/tunnel.sh dev`(開発) / `scripts/tunnel.sh prod`(本番ビルドを `npm start` で動かしている時)。再起動するとURLが変わるので、その都度 URL Mappings を更新します。
- **固定ドメイン**: `cloudflared/config.example.yml` を `config.yml` にコピーして編集し、`cloudflared tunnel --config cloudflared/config.yml run discord-party`。
- **Pterodactyl と併用**: 同じサーバー(または同じホスト)で cloudflared を動かし、`service: http://localhost:<割り当てポート>` を指定すれば、nginx 不要で https 化できます。

### Egg(JSON)でインポートする
`egg-discord-party.json` を Pterodactyl の Admin → Nests → Import Egg で読み込むと、変数(Client ID / Secret / Git URL など)付きでサーバーを作れます。
git リポジトリにこのプロジェクトを置いて `GIT_ADDRESS` を指定するか、作成後に File Manager へアップロードしてください。

### Cloudflare トンネルトークン(Egg変数)
Egg の変数 `CLOUDFLARE_TUNNEL_TOKEN` にトークンを入れると、インストール時に取得した `cloudflared` が起動時に自動で動きます(空ならトンネルなし)。
Cloudflare Zero Trust の Tunnels で、Public Hostname の Service を `http://localhost:<サーバーのポート>` にし、そのドメインを Discord の URL Mappings に設定してください。

## 管理者
環境変数 `ADMIN_IDS`(DiscordユーザーID、カンマ区切り)に入れたユーザーは、画面に「🛡 管理者」パネルが出て、
**強制終了**(ロビーに戻す)と**主催者の奪取**ができます。IDはサーバー側で Discord のトークンを使って検証するので、画面からの偽装はできません。
(ブラウザ単体のゲストモードでは検証できないため、管理者にはなれません)

## みんなで動画(YouTube)
主催者だけが再生・停止・シーク・次の動画を操作でき、全員の画面に同期されます。プレイリストには誰でもURLを追加できます(他人が追加した分を消せるのは主催者だけ)。

**Discord Developer Portal → Activities → URL Mappings に次を追加してください**(`src/discord.js` の `YOUTUBE_MAPPINGS` と同じ prefix にします)

| PREFIX | TARGET |
|---|---|
| `/youtube` | `www.youtube.com` |
| `/youtube-nocookie` | `www.youtube-nocookie.com` |
| `/ytimg` | `i.ytimg.com` |

- Discord内で再生できないときは、開発者ツールのコンソールに「ブロックされたホスト」が出ます。そのホストを URL Mappings と `YOUTUBE_MAPPINGS` の両方に足してください。
- 埋め込みが禁止されている動画(音楽の公式動画など)は再生できません。
- 視聴者は最初に「タップして視聴に参加」を押す必要があります(ブラウザの自動再生制限のため)。
