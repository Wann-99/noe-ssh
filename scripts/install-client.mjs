import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(args) {
  return spawnSync(npmBin, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
}

// Prefer lockfile-accurate install; fall back to install for fresh checkouts.
let result = run(['--prefix', 'client', 'ci', '--no-fund', '--no-audit']);
if ((result.status ?? 1) !== 0) {
  result = run(['--prefix', 'client', 'install', '--no-fund', '--no-audit']);
}
process.exit(result.status ?? 1);
