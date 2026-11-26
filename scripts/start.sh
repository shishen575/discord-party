#!/usr/bin/env bash
# Pterodactyl / 本番用の起動スクリプト
#  - cloudflared が無ければ自動で取得 (再インストール不要)
#  - CLOUDFLARE_TUNNEL_TOKEN があればトンネルを起動 (ログはコンソールに表示)
#  - 依存インストール → (必要なら)ビルド → サーバー起動
cd "$(dirname "$0")/.."

if [ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then
  if [ ! -f bin/cloudflared ]; then
    case "$(uname -m)" in
      x86_64) A=amd64 ;; aarch64|arm64) A=arm64 ;; *) A="" ;;
    esac
    URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${A}"
    mkdir -p bin
    echo "[tunnel] cloudflared を取得します: $URL"
    if command -v curl >/dev/null; then curl -fsSL -o bin/cloudflared "$URL"
    elif command -v wget >/dev/null; then wget -q -O bin/cloudflared "$URL"
    else node -e "fetch('$URL').then(r=>r.arrayBuffer()).then(b=>require('fs').writeFileSync('bin/cloudflared',Buffer.from(b)))"; fi
    chmod +x bin/cloudflared 2>/dev/null
  fi
  if [ -f bin/cloudflared ]; then
    echo "[tunnel] cloudflared を起動します (http2)"
    # コンテナ内ではUDP(QUIC)が通らないことが多いので http2 を指定
    ./bin/cloudflared tunnel --no-autoupdate --protocol http2 run --token "${CLOUDFLARE_TUNNEL_TOKEN}" 2>&1 | sed -u 's/^/[tunnel] /' &
  else
    echo "[tunnel] cloudflared を用意できませんでした。トンネルなしで続行します"
  fi
else
  echo "[tunnel] CLOUDFLARE_TUNNEL_TOKEN が未設定のためトンネルは起動しません"
fi

# フロントのソース(と Client ID)が変わっていたら自動で再ビルドする
SIG=$( { cat package-lock.json index.html vite.config.js 2>/dev/null; find src -type f | sort | xargs cat; echo "${VITE_DISCORD_CLIENT_ID:-}"; } | sha1sum | cut -d' ' -f1 )
if [ ! -d node_modules ] || [ "$(cat dist/.sig-deps 2>/dev/null)" != "$(sha1sum < package-lock.json | cut -d' ' -f1)" ]; then
  npm install --include=dev
fi
if [ ! -f dist/index.html ] || [ "$(cat dist/.sig 2>/dev/null)" != "$SIG" ] || [ "${REBUILD:-0}" = "1" ]; then
  echo "[build] フロントをビルドします"
  npm run build && echo "$SIG" > dist/.sig && sha1sum < package-lock.json | cut -d' ' -f1 > dist/.sig-deps
else
  echo "[build] フロントは最新です"
fi
exec npm start
