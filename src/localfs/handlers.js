/**
 * Server-local filesystem operations for the dual-pane files page.
 * Mirrors src/sftp/handlers.js so local and remote endpoints are
 * interchangeable for the cross-endpoint transfer engine.
 *
 * Paths are NOT rooted anywhere: the local pane intentionally exposes the
 * whole server host filesystem (permissions of the Noe-SSH process apply).
 * hub.js gates access behind authentication and the NOE_LOCAL_FS switch.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { formatMode } = require('../sftp/handlers');
const { TRANSFER_CHUNK_SIZE } = require('../../shared/wsBinary');

/** Resolve empty/'~' to the server user's home; normalize separators. */
function resolveLocalPath(input) {
  let p = typeof input === 'string' ? input.trim() : '';
  if (!p || p === '~' || p === '.') return os.homedir();
  if (p === '..' || p.startsWith('../')) return path.resolve(os.homedir(), p);
  if (p.startsWith('~/')) p = path.join(os.homedir(), p.slice(2));
  const resolved = path.resolve(p);
  return resolved;
}

function toRemoteFile(name, st) {
  return {
    filename: name,
    longname: `${formatMode(st.mode)} ${st.size} ${new Date(st.mtimeMs).toISOString()}`,
    isDir: st.isDirectory(),
    size: st.size,
    mtime: st.mtimeMs,
    mode: st.mode,
    perm: formatMode(st.mode),
  };
}

async function listDir(localPath) {
  const dir = resolveLocalPath(localPath);
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') continue;
    try {
      const st = await fsp.stat(path.join(dir, entry.name));
      files.push(toRemoteFile(entry.name, st));
    } catch (_) {
      // Skip entries we cannot stat (broken symlinks, permission gaps).
    }
  }
  return { path: dir, files };
}

async function mkdir(localPath) {
  await fsp.mkdir(resolveLocalPath(localPath), { recursive: true });
}

/** Create an empty file exclusively; mirrors sftp writeFile(createOnly). */
async function touch(localPath) {
  try {
    await fsp.writeFile(resolveLocalPath(localPath), '', { flag: 'wx' });
  } catch (err) {
    if (err && err.code === 'EEXIST') throw new Error('同名文件已存在');
    throw err;
  }
}

async function rename(from, to) {
  await fsp.rename(resolveLocalPath(from), resolveLocalPath(to));
}

async function remove(localPath) {
  await fsp.rm(resolveLocalPath(localPath), { recursive: true, force: true });
}

async function stat(localPath) {
  return fsp.stat(resolveLocalPath(localPath));
}

async function pathExists(localPath) {
  try {
    await fsp.stat(resolveLocalPath(localPath));
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
}

function isSameOrDescendant(ancestor, candidate) {
  const parent = resolveLocalPath(ancestor);
  const child = resolveLocalPath(candidate);
  if (child === parent) return true;
  const rel = path.relative(parent, child);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Recursively copy a local file or directory.
 * Destination must not exist; copying into itself is rejected.
 */
async function copyPath(from, to) {
  const fromPath = resolveLocalPath(from);
  const toPath = resolveLocalPath(to);
  if (isSameOrDescendant(fromPath, toPath)) {
    throw new Error('不能将目录复制到其自身或子目录中');
  }
  if (await pathExists(toPath)) {
    throw new Error('目标已存在');
  }
  const st = await fsp.stat(fromPath);
  if (st.isDirectory()) {
    await fsp.mkdir(toPath, { mode: st.mode & 0o777 });
    const entries = await fsp.readdir(fromPath);
    for (const name of entries) {
      await copyPath(path.join(fromPath, name), path.join(toPath, name));
    }
    return { from: fromPath, to: toPath, isDir: true };
  }
  await fsp.copyFile(fromPath, toPath, fs.constants.COPYFILE_EXCL);
  try {
    await fsp.chmod(toPath, st.mode & 0o777);
  } catch (_) { /* ignore chmod failures */ }
  return { from: fromPath, to: toPath, isDir: false };
}

function createReadStream(localPath) {
  return fs.createReadStream(resolveLocalPath(localPath), {
    highWaterMark: TRANSFER_CHUNK_SIZE,
  });
}

function createWriteStream(localPath) {
  return fs.createWriteStream(resolveLocalPath(localPath), {
    highWaterMark: TRANSFER_CHUNK_SIZE,
  });
}

module.exports = {
  resolveLocalPath,
  listDir,
  mkdir,
  touch,
  rename,
  remove,
  stat,
  pathExists,
  isSameOrDescendant,
  copyPath,
  createReadStream,
  createWriteStream,
};
