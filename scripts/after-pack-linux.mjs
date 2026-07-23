/**
 * After electron-builder packs Linux targets:
 * - keep real binary as noe-ssh.bin
 * - install wrapper `noe-ssh` that falls back to --no-sandbox
 *   when chrome-sandbox is not setuid (menu click otherwise dies silently).
 */
import fs from 'fs';
import path from 'path';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;

  const appOutDir = context.appOutDir;
  const candidates = ['noe-ssh', 'Noe-SSH'];
  const binName = candidates.find((name) => {
    const p = path.join(appOutDir, name);
    return fs.existsSync(p) && fs.statSync(p).isFile();
  });
  if (!binName) return;

  const binPath = path.join(appOutDir, binName);
  const realPath = path.join(appOutDir, `${binName}.bin`);
  if (fs.existsSync(realPath)) return;

  // Don't wrap twice if somehow already a script
  const head = fs.readFileSync(binPath).subarray(0, 2).toString('utf8');
  if (head === '#!') return;

  fs.renameSync(binPath, realPath);

  const wrapper = `#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
BIN="$DIR/${binName}.bin"
SANDBOX="$DIR/chrome-sandbox"

if [ -u "$SANDBOX" ] && [ -x "$SANDBOX" ]; then
  exec "$BIN" "$@"
fi

exec "$BIN" --no-sandbox "$@"
`;
  fs.writeFileSync(binPath, wrapper, { mode: 0o755 });
  console.log(`[after-pack-linux] wrapped ${binName} -> ${binName}.bin (sandbox fallback)`);
}
