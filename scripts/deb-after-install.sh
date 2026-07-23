#!/bin/bash
# Ensure Electron chrome-sandbox works and desktop icon appears in menus.
set -e
SANDBOX='/opt/Noe-SSH/chrome-sandbox'
if [ -f "$SANDBOX" ]; then
  chown root:root "$SANDBOX" || true
  chmod 4755 "$SANDBOX" || true
fi

# Install multi-size icons (many DEs ignore lone 1024x1024).
ICON_SRC_DIR='/opt/Noe-SSH'
HICOLOR='/usr/share/icons/hicolor'
for size in 16 32 48 64 128 256 512; do
  src="${ICON_SRC_DIR}/${size}x${size}.png"
  # electron-builder may place icons under usr/share already; also check resources
  if [ ! -f "$src" ]; then
    src="/usr/share/icons/hicolor/${size}x${size}/apps/noe-ssh.png"
  fi
  if [ -f "/opt/Noe-SSH/resources/app/dist/client/favicon.png" ] && [ ! -f "$src" ]; then
    :
  fi
done

# Prefer packaged sized PNGs from buildResources if electron-builder copied them beside binary
APP_DIR='/opt/Noe-SSH'
for size in 16 32 48 64 128 256 512; do
  dest="${HICOLOR}/${size}x${size}/apps"
  mkdir -p "$dest"
  if [ -f "${APP_DIR}/${size}x${size}.png" ]; then
    cp -f "${APP_DIR}/${size}x${size}.png" "${dest}/noe-ssh.png" || true
  elif [ -f "${HICOLOR}/1024x1024/apps/noe-ssh.png" ] && command -v convert >/dev/null 2>&1; then
    convert "${HICOLOR}/1024x1024/apps/noe-ssh.png" -resize "${size}x${size}" "${dest}/noe-ssh.png" || true
  fi
done

# Fallback: if only 1024 exists, symlink common sizes to it (better than missing)
if [ -f "${HICOLOR}/1024x1024/apps/noe-ssh.png" ]; then
  for size in 48 64 128 256; do
    dest="${HICOLOR}/${size}x${size}/apps/noe-ssh.png"
    if [ ! -f "$dest" ]; then
      mkdir -p "$(dirname "$dest")"
      cp -f "${HICOLOR}/1024x1024/apps/noe-ssh.png" "$dest" || true
    fi
  done
fi

if hash gtk-update-icon-cache 2>/dev/null; then
  gtk-update-icon-cache -f -t "$HICOLOR" 2>/dev/null || true
fi
if hash update-icon-caches 2>/dev/null; then
  update-icon-caches "$HICOLOR" 2>/dev/null || true
fi
if hash update-desktop-database 2>/dev/null; then
  update-desktop-database /usr/share/applications || true
fi
