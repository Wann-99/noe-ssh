import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import archiver from 'archiver';
import { prepareAppBundle } from './prepare-app-bundle.mjs';
import { prepareNodeRuntime } from './prepare-node-runtime.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;

const platformMap = { darwin: 'macos', linux: 'linux', win32: 'win' };
const osName = platformMap[process.platform] || process.platform;
const arch = process.arch === 'x64' ? 'x64' : process.arch;

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyRecursive(from, to);
    else fs.copyFileSync(from, to);
  }
}

function copyBrandIcons(bundleDir) {
  const iconsDir = path.join(root, 'electron', 'icons');
  const png = path.join(iconsDir, 'icon.png');
  const ico = path.join(iconsDir, 'icon.ico');
  if (fs.existsSync(png)) fs.copyFileSync(png, path.join(bundleDir, 'Noe-SSH.png'));
  if (fs.existsSync(ico)) fs.copyFileSync(ico, path.join(bundleDir, 'Noe-SSH.ico'));
}

function createStartScript(bundleDir) {
  const isWin = process.platform === 'win32';
  if (isWin) {
    const bat = [
      '@echo off',
      'set NOE_SSH_MODE=portable',
      'set NOE_SSH_OPEN_BROWSER=1',
      'set HOST=127.0.0.1',
      'set PORT=3000',
      'cd /d "%~dp0"',
      'start "" "http://localhost:3000"',
      'runtime\\node.exe app\\src\\index.js',
      '',
    ].join('\r\n');
    fs.writeFileSync(path.join(bundleDir, 'Noe-SSH.bat'), bat);

    // .bat itself cannot carry a custom icon; ship a one-click shortcut installer.
    const shortcutBat = [
      '@echo off',
      'cd /d "%~dp0"',
      'powershell -NoProfile -ExecutionPolicy Bypass -Command ^',
      '  "$dir = (Resolve-Path \'.\').Path; ^',
      '   $desk = [Environment]::GetFolderPath(\'Desktop\'); ^',
      '   $ws = New-Object -ComObject WScript.Shell; ^',
      '   $sc = $ws.CreateShortcut((Join-Path $desk \'Noe-SSH.lnk\')); ^',
      '   $sc.TargetPath = (Join-Path $dir \'Noe-SSH.bat\'); ^',
      '   $sc.WorkingDirectory = $dir; ^',
      '   $sc.IconLocation = (Join-Path $dir \'Noe-SSH.ico\'); ^',
      '   $sc.Description = \'Noe-SSH\'; ^',
      '   $sc.Save(); ^',
      '   Write-Host \'Desktop shortcut created: Noe-SSH.lnk\'"',
      'echo.',
      'echo Desktop shortcut created with Noe-SSH logo.',
      'pause',
      '',
    ].join('\r\n');
    fs.writeFileSync(path.join(bundleDir, 'Create Desktop Shortcut.bat'), shortcutBat);
  } else {
    const sh = `#!/bin/bash
set -e
cd "$(dirname "$0")"
export NOE_SSH_MODE=portable
export NOE_SSH_OPEN_BROWSER=1
export HOST=127.0.0.1
export PORT=3000
(sleep 1 && (command -v open >/dev/null && open "http://localhost:3000" || xdg-open "http://localhost:3000" 2>/dev/null || true)) &
./runtime/node app/src/index.js
`;
    fs.writeFileSync(path.join(bundleDir, 'noe-ssh.sh'), sh, { mode: 0o755 });

    const installDesktop = `#!/bin/bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="\${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$APP_DIR"
cat > "$APP_DIR/noe-ssh-portable.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Noe-SSH
Comment=SSH Visual Interface
Exec="$DIR/noe-ssh.sh"
Icon=$DIR/Noe-SSH.png
Terminal=false
Categories=Network;Development;
EOF
chmod +x "$APP_DIR/noe-ssh-portable.desktop"
echo "Desktop entry installed: $APP_DIR/noe-ssh-portable.desktop"
`;
    fs.writeFileSync(path.join(bundleDir, 'install-desktop-entry.sh'), installDesktop, { mode: 0o755 });
  }
}

async function zipDirectory(sourceDir, outPath) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function tarDirectory(sourceDir, outPath) {
  execSync(`tar -czf "${outPath}" -C "${sourceDir}" .`, { stdio: 'inherit' });
}

async function main() {
  prepareAppBundle();
  const nodePath = await prepareNodeRuntime(path.join(root, 'build', 'portable-runtime'));

  const bundleDir = path.join(root, 'build', 'portable-bundle');
  if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
  fs.mkdirSync(bundleDir, { recursive: true });

  copyRecursive(path.join(root, 'build', 'app'), path.join(bundleDir, 'app'));
  fs.mkdirSync(path.join(bundleDir, 'runtime'), { recursive: true });
  fs.copyFileSync(nodePath, path.join(bundleDir, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'));
  copyBrandIcons(bundleDir);
  createStartScript(bundleDir);

  const outDir = path.join(root, 'dist', 'portable');
  fs.mkdirSync(outDir, { recursive: true });
  const baseName = `noe-ssh-${version}-${osName}-${arch}-portable`;

  if (process.platform === 'win32') {
    await zipDirectory(bundleDir, path.join(outDir, `${baseName}.zip`));
  } else {
    await tarDirectory(bundleDir, path.join(outDir, `${baseName}.tar.gz`));
  }

  console.log(`Portable package created in ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
