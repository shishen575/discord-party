#!/usr/bin/env bash
# 使い方:
#   scripts/tunnel.sh dev   … 開発用 (Vite 5173) の一時URLを発行
#   scripts/tunnel.sh prod  … 本番用 (Node 3001) の一時URLを発行
# 固定ドメインは cloudflared/config.example.yml を参照
set -euo pipefail
command -v cloudflared >/dev/null || { echo "cloudflared が見つかりません: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"; exit 1; }
case "${1:-dev}" in
  dev)  PORT=5173 ;;
  prod) PORT="${SERVER_PORT:-${PORT:-3001}}" ;;
  *) echo "dev か prod を指定してください"; exit 1 ;;
esac
echo "表示された https://*.trycloudflare.com を Discord Developer Portal の URL Mappings (/ ) に設定してください"
exec cloudflared tunnel --no-autoupdate --url "http://localhost:${PORT}"
