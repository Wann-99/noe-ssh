#!/bin/bash
# electron-builder template-expands dollar-brace tokens in this file.
# Keep only plain $var / quoted concat — never dollar-brace forms.
set -e
SANDBOX='/opt/Noe-SSH/chrome-sandbox'
if [ -f "$SANDBOX" ]; then
  chown root:root "$SANDBOX" || true
  chmod 4755 "$SANDBOX" || true
fi

HICOLOR='/usr/share/icons/hicolor'
APP_DIR='/opt/Noe-SSH'

for size in 16 32 48 64 128 256 512; do
  dest_dir="$HICOLOR"/"$size"x"$size"/apps
  mkdir -p "$dest_dir"
  src="$APP_DIR"/"$size"x"$size".png
  if [ -f "$src" ]; then
    cp -f "$src" "$dest_dir"/noe-ssh.png || true
  fi
done

# Fallback when only 1024x1024 was installed by the packager
if [ -f "$HICOLOR"/1024x1024/apps/noe-ssh.png ]; then
  for size in 48 64 128 256; do
    dest="$HICOLOR"/"$size"x"$size"/apps/noe-ssh.png
    if [ ! -f "$dest" ]; then
      mkdir -p "$(dirname "$dest")"
      cp -f "$HICOLOR"/1024x1024/apps/noe-ssh.png "$dest" || true
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
