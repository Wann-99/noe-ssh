#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Inline host X11 prep (deploy bundle has no scripts/ tree).
if [[ -z "${DISPLAY:-}" ]]; then
  if [[ -S /tmp/.X11-unix/X0 ]]; then
    export DISPLAY=:0
  elif [[ -S /tmp/.X11-unix/X1 ]]; then
    export DISPLAY=:1
  fi
fi
if [[ -z "${NOE_SSH_X11_DISPLAY:-}" && -n "${DISPLAY:-}" ]]; then
  export NOE_SSH_X11_DISPLAY="$DISPLAY"
fi
if [[ -n "${DISPLAY:-}" ]] && command -v xhost >/dev/null 2>&1; then
  xhost +local: >/dev/null 2>&1 || true
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "已创建 .env，请编辑并填写 NOE_SSH_ADMIN_PASSWORD 后重新执行"
  exit 1
fi

docker compose up -d "$@"

echo ""
echo "Noe-SSH 已启动: http://localhost:${PORT:-3000}"
if [[ -n "${NOE_SSH_X11_DISPLAY:-}${DISPLAY:-}" ]]; then
  echo "X11 目标显示器: ${NOE_SSH_X11_DISPLAY:-$DISPLAY}"
else
  echo "提示: 本机未检测到 DISPLAY，X11 转发不可用（无头服务器可忽略）"
fi
