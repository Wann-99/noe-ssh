#!/bin/bash
# Ensure Electron chrome-sandbox works after .deb install.
# Without root ownership + setuid, menu launch aborts silently.
set -e
SANDBOX='/opt/Noe-SSH/chrome-sandbox'
if [ -f "$SANDBOX" ]; then
  chown root:root "$SANDBOX" || true
  chmod 4755 "$SANDBOX" || true
fi
