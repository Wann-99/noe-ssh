import assert from 'assert';
import { createRequire } from 'module';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const require = createRequire(import.meta.url);
const localfs = require('./handlers.js');

const root = mkdtempSync(join(tmpdir(), 'noe-localfs-'));
try {
  // listDir + resolveLocalPath
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'hello.txt'), 'hello local\n');
  const listed = await localfs.listDir(root);
  assert.equal(listed.path, root);
  const names = listed.files.map((f) => f.filename).sort();
  assert.deepEqual(names, ['docs', 'hello.txt']);
  const dirEntry = listed.files.find((f) => f.filename === 'docs');
  const fileEntry = listed.files.find((f) => f.filename === 'hello.txt');
  assert.equal(dirEntry.isDir, true);
  assert.equal(fileEntry.isDir, false);
  assert.equal(fileEntry.size, 12);
  assert.ok(fileEntry.perm.startsWith('-'));
  assert.ok(dirEntry.perm.includes('rwx'));
  assert.ok(localfs.resolveLocalPath('').length > 0, 'empty resolves to home');
  assert.ok(localfs.resolveLocalPath('~').length > 0);

  // mkdir / rename / stat / pathExists
  await localfs.mkdir(join(root, 'made', 'nested'));
  assert.equal(await localfs.pathExists(join(root, 'made', 'nested')), true);
  await localfs.rename(join(root, 'hello.txt'), join(root, 'renamed.txt'));
  assert.equal(await localfs.pathExists(join(root, 'hello.txt')), false);
  assert.equal(await localfs.pathExists(join(root, 'renamed.txt')), true);
  const st = await localfs.stat(join(root, 'renamed.txt'));
  assert.equal(st.size, 12);

  // touch: exclusive empty-file create, conflict rejected
  await localfs.touch(join(root, 'touched.txt'));
  assert.equal(readFileSync(join(root, 'touched.txt'), 'utf8'), '');
  await assert.rejects(
    () => localfs.touch(join(root, 'touched.txt')),
    /同名文件已存在/,
  );

  // copyPath: recursive, mode preserved, guards
  const copy = await localfs.copyPath(join(root, 'docs'), join(root, 'docs-copy'));
  assert.equal(copy.isDir, true);
  assert.equal(await localfs.pathExists(join(root, 'docs-copy')), true);
  await assert.rejects(
    () => localfs.copyPath(join(root, 'docs'), join(root, 'docs-copy')),
    /目标已存在/,
  );
  await assert.rejects(
    () => localfs.copyPath(join(root, 'docs'), join(root, 'docs', 'inner')),
    /自身或子目录/,
  );
  assert.equal(localfs.isSameOrDescendant(join(root, 'docs'), join(root, 'docs', 'x')), true);
  assert.equal(localfs.isSameOrDescendant(join(root, 'docs'), join(root, 'docs-copy')), false);

  // read/write streams (transfer engine uses these)
  const ws = localfs.createWriteStream(join(root, 'streamed.bin'));
  const rs = localfs.createReadStream(join(root, 'renamed.txt'));
  await new Promise((resolve, reject) => {
    ws.on('error', reject);
    rs.on('error', reject);
    ws.on('close', resolve);
    rs.pipe(ws);
  });
  assert.equal(readFileSync(join(root, 'streamed.bin'), 'utf8'), 'hello local\n');

  // remove: recursive + force
  await localfs.remove(join(root, 'made'));
  assert.equal(existsSync(join(root, 'made')), false);
  await localfs.remove(join(root, 'never-existed'));

  console.log('localfs handlers.test: OK');
} finally {
  rmSync(root, { recursive: true, force: true });
}
