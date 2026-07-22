#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# shellcheck source=scripts/prepare-host-x11.sh
source ./scripts/prepare-host-x11.sh
prepare_host_x11

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "已创建 .env（使用国内镜像源），可按需修改"
fi

docker compose up -d --build "$@"

echo ""
echo "Noe-SSH 已启动: http://localhost:${PORT:-3000}"
if [[ -n "${NOE_SSH_X11_DISPLAY:-}${DISPLAY:-}" ]]; then
  echo "X11 目标显示器: ${NOE_SSH_X11_DISPLAY:-$DISPLAY}"
else
  echo "提示: 本机未检测到 DISPLAY，X11 转发不可用（无头服务器可忽略）"
fi
