#!/bin/zsh
# ダブルクリックで表示サーバーを起動し、ブラウザで開く（macOS 用）。
cd "${0:A:h}"
port=${AVATAR_STUDIO_PORT:-3210}
node_bin=${NODE:-$(command -v node)}
[[ -z "$node_bin" ]] && for c in /opt/homebrew/bin/node /usr/local/bin/node; do [[ -x "$c" ]] && node_bin=$c && break; done
if [[ -z "$node_bin" ]]; then
  echo "Node.js が見つかりません。Node.js 22 以上を入れてから、もう一度開いてください。"
  read -k1
  exit 1
fi
if curl -fsS --max-time 2 "http://127.0.0.1:$port/api/status" >/dev/null; then
  open "http://127.0.0.1:$port"
  exit 0
fi
"$node_bin" server.mjs &
local_server_pid=$!
trap 'kill "$local_server_pid" 2>/dev/null' EXIT INT TERM
for attempt in {1..30}; do
  if curl -fsS --max-time 1 "http://127.0.0.1:$port/" >/dev/null; then
    open "http://127.0.0.1:$port"
    break
  fi
  sleep 0.2
done
wait "$local_server_pid"
