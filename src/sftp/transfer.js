/**
 * Cross-endpoint copy engine for the dual-pane files page.
 *
 * Both panes are normalized to a small endpoint adapter interface, so
 * local <-> remote and remote <-> remote copies stream directly inside the
 * Noe-SSH server process (no browser relay). Copies are refuse-first:
 * an existing destination or a directory copied into itself is rejected
 * before any byte moves.
 */
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const fsp = require('fs/promises');
const sftp = require('./handlers');
const localfs = require('../localfs/handlers');
const { TRANSFER_CHUNK_SIZE, PROGRESS_THROTTLE_MS } = require('../../shared/wsBinary');

const ABORTED_MESSAGE = '已取消';

function bestEffortChmod(channel, path, mode) {
  if (!mode || typeof channel.chmod !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    channel.chmod(path, mode & 0o777, () => resolve());
  });
}

/** Adapter over the server-local filesystem. */
function localEndpoint() {
  return {
    key: 'local',
    join: (...parts) => localfs.resolveLocalPath(parts.join('/')),
    isSameOrDescendant: (a, b) => localfs.isSameOrDescendant(a, b),
    async stat(p) {
      const st = await localfs.stat(p);
      return { size: st.size, isDir: st.isDirectory(), mode: st.mode };
    },
    exists: (p) => localfs.pathExists(p),
    list: async (p) => (await localfs.listDir(p)).files,
    async mkdir(p, mode) {
      await localfs.mkdir(p);
      if (mode) {
        try {
          await fsp.chmod(localfs.resolveLocalPath(p), mode & 0o777);
        } catch (_) { /* ignore chmod failures */ }
      }
    },
    createReadStream: (p) => localfs.createReadStream(p),
    createWriteStream: (p) => localfs.createWriteStream(p),
  };
}

/** Adapter over an established session's SFTP channel. */
function remoteEndpoint(sess, channel) {
  return {
    key: `session:${sess.id}`,
    join: (...parts) => sftp.joinRemotePath(...parts),
    isSameOrDescendant: (a, b) => sftp.isSameOrDescendant(a, b),
    async stat(p) {
      const attrs = await sftp.stat(channel, p);
      return { size: attrs.size, isDir: (attrs.mode & 0o040000) === 0o040000, mode: attrs.mode };
    },
    exists: (p) => sftp.pathExists(channel, p),
    list: (p) => sftp.listDir(channel, p),
    async mkdir(p, mode) {
      await sftp.mkdir(channel, p);
      await bestEffortChmod(channel, p, mode);
    },
    createReadStream: (p) => channel.createReadStream(p, { highWaterMark: TRANSFER_CHUNK_SIZE }),
    createWriteStream: (p) => channel.createWriteStream(p, { highWaterMark: TRANSFER_CHUNK_SIZE }),
  };
}

/**
 * Resolve a transfer endpoint spec ({ sessionId, path }) to an adapter plus
 * a normalized absolute path. `sessionId: null` selects the local filesystem.
 */
async function resolveEndpoint(spec, sessions) {
  if (!spec || typeof spec.path !== 'string' || !spec.path.trim()) {
    throw new Error('无效的传输端点');
  }
  if (spec.sessionId == null || spec.sessionId === '') {
    return { adapter: localEndpoint(), path: localfs.resolveLocalPath(spec.path) };
  }
  const sess = typeof sessions.get === 'function' ? sessions.get(spec.sessionId) : null;
  if (!sess || !sess.client) throw new Error('远程会话未连接');
  const channel = await sftp.ensureSftp(sess);
  return { adapter: remoteEndpoint(sess, channel), path: sftp.normalizeRemotePath(spec.path) };
}

async function prescanTotal(ctx, p) {
  const st = await ctx.src.adapter.stat(p);
  if (!st.isDir) return st.size;
  let total = 0;
  const entries = await ctx.src.adapter.list(p);
  for (const entry of entries) {
    total += await prescanTotal(ctx, ctx.src.adapter.join(p, entry.filename));
  }
  return total;
}

function report(ctx, force) {
  const now = Date.now();
  if (!force && now - ctx.lastReportAt < PROGRESS_THROTTLE_MS) return;
  ctx.lastReportAt = now;
  ctx.onProgress({
    written: ctx.written,
    total: ctx.total,
    file: ctx.currentFile || null,
  });
}

async function pipeFile(ctx, srcPath, dstPath) {
  const reader = ctx.src.adapter.createReadStream(srcPath);
  const writer = ctx.dst.adapter.createWriteStream(dstPath);
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      ctx.written += chunk.length;
      report(ctx, false);
      cb(null, chunk);
    },
  });
  ctx.streams.add(reader);
  ctx.streams.add(counter);
  ctx.streams.add(writer);
  try {
    await pipeline(reader, counter, writer);
  } finally {
    ctx.streams.delete(reader);
    ctx.streams.delete(counter);
    ctx.streams.delete(writer);
  }
}

async function copyEntry(ctx, srcPath, dstPath) {
  if (ctx.aborted) throw new Error(ABORTED_MESSAGE);
  const st = await ctx.src.adapter.stat(srcPath);
  if (st.isDir) {
    await ctx.dst.adapter.mkdir(dstPath, st.mode);
    const entries = await ctx.src.adapter.list(srcPath);
    for (const entry of entries) {
      await copyEntry(
        ctx,
        ctx.src.adapter.join(srcPath, entry.filename),
        ctx.dst.adapter.join(dstPath, entry.filename),
      );
    }
    return;
  }
  ctx.currentFile = srcPath;
  report(ctx, true);
  await pipeFile(ctx, srcPath, dstPath);
}

/**
 * Start a copy from src to dst. Returns a handle { id, promise, abort }.
 * promise resolves { bytes } or rejects with a user-facing message.
 */
function startTransfer({ id, src, dst, onProgress }) {
  const ctx = {
    src,
    dst,
    onProgress: typeof onProgress === 'function' ? onProgress : () => {},
    written: 0,
    total: 0,
    currentFile: null,
    lastReportAt: 0,
    aborted: false,
    streams: new Set(),
  };

  const promise = (async () => {
    if (src.adapter.key === dst.adapter.key && src.adapter.isSameOrDescendant(src.path, dst.path)) {
      throw new Error('不能将目录复制到其自身或子目录中');
    }
    if (await dst.adapter.exists(dst.path)) {
      throw new Error('目标已存在');
    }
    const st = await src.adapter.stat(src.path);
    ctx.total = st.isDir ? await prescanTotal(ctx, src.path).catch(() => 0) : st.size;
    report(ctx, true);
    await copyEntry(ctx, src.path, dst.path);
    report(ctx, true);
    return { bytes: ctx.written };
  })().catch((err) => {
    if (ctx.aborted) throw new Error(ABORTED_MESSAGE);
    throw err;
  });

  return {
    id,
    promise,
    abort() {
      ctx.aborted = true;
      for (const stream of [...ctx.streams]) {
        try { stream.destroy(); } catch (_) { /* ignore */ }
      }
    },
  };
}

module.exports = {
  ABORTED_MESSAGE,
  localEndpoint,
  remoteEndpoint,
  resolveEndpoint,
  startTransfer,
};
