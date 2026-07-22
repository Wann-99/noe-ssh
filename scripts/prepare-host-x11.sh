#!/usr/bin/env bash
# Prepare host DISPLAY for Docker Noe-SSH X11 forwarding.
# Safe to source multiple times; no-op on headless hosts without an X socket.

prepare_host_x11() {
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

  # Allow local Docker clients to connect to the host X server without
  # requiring each user to edit compose / export vars by hand.
  if [[ -n "${DISPLAY:-}" ]] && command -v xhost >/dev/null 2>&1; then
    xhost +local: >/dev/null 2>&1 || true
  fi
}
