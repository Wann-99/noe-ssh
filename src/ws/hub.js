const WebSocket = require('ws');
const {
  MSG,
  DEFAULT_TERMINAL_ID,
  MAX_TERMINALS_PER_SESSION,
} = require('../../shared/protocol');
const {
  WS_BIN_KIND,
  WS_BUFFER_HIGH,
  WS_BUFFER_LOW,
  TERM_COALESCE_MS,
  TERM_COALESCE_BYTES,
  PROGRESS_THROTTLE_MS,
  encodeFrame,
  decodeFrame,
} = require('../../shared/wsBinary');
const { openSshConnection, execCommand } = require('../ssh/client');
const { attachX11Forwarding } = require('../ssh/x11');
const sftp = require('../sftp/handlers');
const { authRequired, getSession: getAuthSession } = require('../http/app');
const { record } = require('../audit/logger');

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendBinary(ws, kind, sessionId, transferId, payload) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(encodeFrame(kind, sessionId, transferId, payload), { binary: true });
}

function parseQueryToken(reqUrl) {
  try {
    const u = new URL(reqUrl, 'http://localhost');
    return u.searchParams.get('token') || '';
  } catch (_) {
    return '';
  }
}

function clientIpFromReq(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

function attachWsHub(server) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws, req) => {
    const needsAuth = authRequired();
    let authCtx = null;
    const urlToken = parseQueryToken(req.url || '');
    const urlSession = getAuthSession(urlToken);
    if (!needsAuth) {
      authCtx = { userId: null, username: null, role: null };
    } else if (urlSession) {
      authCtx = {
        userId: urlSession.userId,
        username: urlSession.username,
        role: urlSession.role,
      };
    }

    const clientIp = clientIpFromReq(req);
    const userAgent = req.headers['user-agent'] || null;

    /** @type {Map<string, any>} */
    const sessions = new Map();
    /** @type {Map<string, { chunks: Buffer[], bytes: number, timer: NodeJS.Timeout|null }>} */
    const termOutBuffers = new Map();
    /** Serialize inbound handlers so upload chunks stay ordered. */
    let inboundChain = Promise.resolve();

    if (needsAuth && !authCtx) {
      send(ws, { type: MSG.AUTH_REQUIRED });
    } else if (needsAuth) {
      send(ws, { type: MSG.AUTH_OK });
    }

    const auditBase = () => ({
      userId: authCtx?.userId ?? null,
      username: authCtx?.username ?? null,
      clientIp,
      userAgent,
    });

    const getSession = (sessionId) => sessions.get(sessionId);

    const termOutKey = (sessionId, terminalId) => `${sessionId}\0${terminalId || DEFAULT_TERMINAL_ID}`;

    const flushTermOut = (sessionId, terminalId) => {
      const tid = terminalId || DEFAULT_TERMINAL_ID;
      const key = termOutKey(sessionId, tid);
      const buf = termOutBuffers.get(key);
      if (!buf || buf.chunks.length === 0) return;
      if (buf.timer) {
        clearTimeout(buf.timer);
        buf.timer = null;
      }
      const payload = Buffer.concat(buf.chunks);
      buf.chunks = [];
      buf.bytes = 0;
      sendBinary(ws, WS_BIN_KIND.TERM_OUT, sessionId, tid, payload);
    };

    const enqueueTermOut = (sessionId, terminalId, chunk) => {
      const tid = terminalId || DEFAULT_TERMINAL_ID;
      const key = termOutKey(sessionId, tid);
      let buf = termOutBuffers.get(key);
      if (!buf) {
        buf = { chunks: [], bytes: 0, timer: null };
        termOutBuffers.set(key, buf);
      }
      const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      buf.chunks.push(piece);
      buf.bytes += piece.length;
      if (buf.bytes >= TERM_COALESCE_BYTES) {
        flushTermOut(sessionId, tid);
        return;
      }
      if (!buf.timer) {
        buf.timer = setTimeout(() => flushTermOut(sessionId, tid), TERM_COALESCE_MS);
      }
    };

    const clearTermOut = (sessionId, terminalId) => {
      if (terminalId) {
        const key = termOutKey(sessionId, terminalId);
        const buf = termOutBuffers.get(key);
        if (!buf) return;
        if (buf.timer) clearTimeout(buf.timer);
        termOutBuffers.delete(key);
        return;
      }
      const prefix = `${sessionId}\0`;
      for (const key of [...termOutBuffers.keys()]) {
        if (!key.startsWith(prefix) && key !== sessionId) continue;
        const buf = termOutBuffers.get(key);
        if (buf?.timer) clearTimeout(buf.timer);
        termOutBuffers.delete(key);
      }
    };

    const ensureShells = (sess) => {
      if (!sess) return null;
      if (!(sess.shells instanceof Map)) sess.shells = new Map();
      // Migrate legacy single-stream sessions created before multi-shell support.
      if (sess.stream && sess.shells.size === 0) {
        sess.shells.set(DEFAULT_TERMINAL_ID, sess.stream);
      }
      return sess.shells;
    };

    const resolveShell = (sess, terminalId) => {
      const shells = ensureShells(sess);
      if (!shells) return null;
      const tid = terminalId || DEFAULT_TERMINAL_ID;
      // Never fall back to another shell — that routes keystrokes to the wrong terminal.
      return shells.get(tid) || null;
    };

    const attachShellStream = (sess, sessionId, terminalId, stream) => {
      sess.shells.set(terminalId, stream);
      stream.on('data', (chunk) => {
        enqueueTermOut(sessionId, terminalId, chunk);
      });
      stream.stderr.on('data', (chunk) => {
        enqueueTermOut(sessionId, terminalId, chunk);
      });
      stream.on('close', () => {
        if (sess.shells.get(terminalId) !== stream) return;
        sess.shells.delete(terminalId);
        flushTermOut(sessionId, terminalId);
        clearTermOut(sessionId, terminalId);
        if (!sess.destroying) {
          send(ws, {
            type: MSG.SHELL_CLOSED,
            sessionId,
            terminalId,
            data: 'Shell closed',
          });
        }
      });
    };

    const openShell = (sess, sessionId, terminalId, cols, rows, shellExtra = {}) => (
      new Promise((resolve, reject) => {
        if (!sess?.client) {
          reject(new Error('Not connected'));
          return;
        }
        const shells = ensureShells(sess);
        if (shells.has(terminalId)) {
          reject(new Error('Terminal already open'));
          return;
        }
        if (shells.size >= MAX_TERMINALS_PER_SESSION) {
          reject(new Error(`最多 ${MAX_TERMINALS_PER_SESSION} 个终端`));
          return;
        }
        const shellOpts = {
          term: 'xterm-256color',
          cols: cols || 120,
          rows: rows || 36,
          ...shellExtra,
        };
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error('打开 shell 超时'));
        }, 12_000);
        sess.client.shell(shellOpts, (err, stream) => {
          if (settled) {
            try { stream?.close(); } catch (_) { /* ignore */ }
            return;
          }
          settled = true;
          clearTimeout(timer);
          if (err) {
            reject(err);
            return;
          }
          attachShellStream(sess, sessionId, terminalId, stream);
          resolve(stream);
        });
      })
    );

    const emitUploadProgress = (sessionId, transfer, id, force = false) => {
      const now = Date.now();
      if (!force && transfer.lastProgressAt && now - transfer.lastProgressAt < PROGRESS_THROTTLE_MS) {
        return;
      }
      transfer.lastProgressAt = now;
      send(ws, {
        type: MSG.SFTP_UPLOAD_PROGRESS,
        sessionId,
        id,
        written: transfer.written,
        total: transfer.total,
      });
    };

    const writeUploadChunk = async (sessionId, transferId, payload) => {
      const sess = getSession(sessionId);
      if (!sess) {
        send(ws, {
          type: MSG.SFTP_UPLOAD_RESULT,
          sessionId,
          id: transferId,
          error: 'Not connected',
        });
        return;
      }
      const transfer = sess.uploads.get(transferId);
      if (!transfer) {
        send(ws, {
          type: MSG.SFTP_UPLOAD_RESULT,
          sessionId,
          id: transferId,
          error: 'Unknown upload',
        });
        return;
      }
      try {
        const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
        const ok = transfer.writeStream.write(buf);
        transfer.written += buf.length;
        emitUploadProgress(sessionId, transfer, transferId, false);
        if (!ok) {
          await new Promise((r) => transfer.writeStream.once('drain', r));
        }
      } catch (err) {
        send(ws, {
          type: MSG.SFTP_UPLOAD_RESULT,
          sessionId,
          id: transferId,
          error: err.message,
        });
        sess.uploads.delete(transferId);
      }
    };

    const destroySession = (sessionId, reason) => {
      const sess = sessions.get(sessionId);
      if (!sess || sess.destroying) return;
      sess.destroying = true;
      sessions.delete(sessionId);
      const shellIds = [...(sess.shells?.keys() || [])];
      for (const tid of shellIds) flushTermOut(sessionId, tid);
      clearTermOut(sessionId);
      if (sess.connected) {
        record({
          ...auditBase(),
          action: 'ssh.disconnect',
          sessionId,
          targetHost: sess.targetHost || null,
          targetUser: sess.targetUser || null,
          targetPort: sess.targetPort || null,
          detail: { reason: reason || 'Session closed' },
        });
      }
      for (const [, up] of sess.uploads) {
        try { up.writeStream.destroy(); } catch (_) { /* ignore */ }
      }
      sess.uploads.clear();
      for (const [, dl] of sess.downloads) {
        try { dl.readStream?.destroy(); } catch (_) { /* ignore */ }
        if (dl.resumeTimer) clearInterval(dl.resumeTimer);
      }
      sess.downloads.clear();
      sftp.endSftp(sess);
      if (sess.shells) {
        for (const [, stream] of sess.shells) {
          try { stream.close(); } catch (_) { /* ignore */ }
        }
        sess.shells.clear();
      }
      try {
        if (sess.stream) sess.stream.close();
      } catch (_) { /* ignore */ }
      try {
        if (sess.client) sess.client.end();
      } catch (_) { /* ignore */ }
      try {
        if (sess.jumpClient) sess.jumpClient.end();
      } catch (_) { /* ignore */ }
      send(ws, { type: MSG.DISCONNECTED, sessionId, data: reason || 'Session closed' });
    };

    const destroyAll = () => {
      for (const id of [...sessions.keys()]) {
        destroySession(id, 'Connection closed');
      }
      for (const key of [...termOutBuffers.keys()]) {
        const buf = termOutBuffers.get(key);
        if (buf?.timer) clearTimeout(buf.timer);
        termOutBuffers.delete(key);
      }
    };

    const handleBinaryMessage = async (raw) => {
      const frame = decodeFrame(raw);
      if (!frame) return;
      if (needsAuth && !authCtx) {
        send(ws, { type: MSG.AUTH_REQUIRED, data: 'Authentication required' });
        return;
      }
      if (frame.kind === WS_BIN_KIND.UPLOAD_CHUNK) {
        await writeUploadChunk(frame.sessionId, frame.transferId, frame.payload);
      }
    };

    ws.on('message', (raw, isBinary) => {
      inboundChain = inboundChain
        .then(async () => {
          if (isBinary) {
            await handleBinaryMessage(raw);
            return;
          }

          let msg;
          try {
            msg = JSON.parse(raw.toString());
          } catch (_) {
            return;
          }
          await handleJsonMessage(msg);
        })
        .catch((err) => {
          console.error('ws message handler error:', err.message || err);
        });
    });

    async function handleJsonMessage(msg) {

      if (msg.type === MSG.AUTH) {
        const session = getAuthSession(msg.token);
        if (!needsAuth || session) {
          authCtx = session
            ? {
              userId: session.userId,
              username: session.username,
              role: session.role,
            }
            : { userId: null, username: null, role: null };
          send(ws, { type: MSG.AUTH_OK });
        } else {
          send(ws, { type: MSG.AUTH_FAIL, data: 'Invalid access token' });
        }
        return;
      }

      if (needsAuth && !authCtx) {
        send(ws, { type: MSG.AUTH_REQUIRED, data: 'Authentication required' });
        return;
      }

      const sessionId = msg.sessionId || 'default';

      if (msg.type === MSG.CONNECT) {
        if (sessions.has(sessionId)) {
          destroySession(sessionId, 'Reconnecting');
        }

        const targetHost = String(msg.host || '');
        const targetUser = String(msg.username || '');
        const targetPort = Number(msg.port) || 22;

        try {
          const { client, jumpClient } = await openSshConnection(msg);
          const primaryTerminalId = String(msg.terminalId || DEFAULT_TERMINAL_ID).slice(0, 64);
          const sess = {
            client,
            jumpClient,
            stream: null,
            shells: new Map(),
            sftp: null,
            _sftpPending: null,
            uploads: new Map(),
            downloads: new Map(),
            x11: false,
            x11Option: null,
            destroying: false,
            connected: false,
            targetHost,
            targetUser,
            targetPort,
          };
          sessions.set(sessionId, sess);

          client.on('error', (err) => {
            send(ws, {
              type: MSG.ERROR,
              sessionId,
              data: `SSH Error: ${err.message}`,
              fatal: true,
            });
          });
          client.on('close', () => {
            if (sessions.get(sessionId) === sess) {
              destroySession(sessionId, 'Connection closed');
            }
          });

          const shellExtra = {};
          let x11Note = '';
          if (msg.x11Forward) {
            const x11 = attachX11Forwarding(client, {
              trusted: Boolean(msg.x11Trusted),
              display: msg.x11Display || undefined,
            });
            if (x11.ok) {
              shellExtra.x11 = x11.x11Option;
              sess.x11 = true;
              sess.x11Option = x11.x11Option;
              const ep = x11.endpoint;
              const where = ep.type === 'unix'
                ? ep.path
                : `${ep.host}:${ep.port}`;
              x11Note = `\r\n\x1b[32mX11 转发已启用 (${msg.x11Trusted ? 'ssh -Y' : 'ssh -X'} → ${where})\x1b[0m\r\n`;
            } else {
              x11Note = `\r\n\x1b[33mX11 转发未生效: ${x11.warning}\x1b[0m\r\n`
                + '\x1b[33m请在运行 Noe-SSH 的主机上设置 DISPLAY，或配置 NOE_SSH_X11_DISPLAY\x1b[0m\r\n';
            }
          }

          // Open primary shell first, then one shared SFTP (avoid racing many channels).
          const primaryStream = await openShell(
            sess,
            sessionId,
            primaryTerminalId,
            msg.cols || 120,
            msg.rows || 36,
            shellExtra,
          );
          sess.stream = primaryStream;

          send(ws, {
            type: MSG.CONNECTED,
            sessionId,
            terminalId: primaryTerminalId,
            data: 'SSH connection established',
            x11: Boolean(shellExtra.x11),
          });
          sess.connected = true;
          record({
            ...auditBase(),
            action: 'ssh.connect',
            sessionId,
            targetHost,
            targetUser,
            targetPort,
            detail: {
              useJump: Boolean(msg.useJump || msg.jumpHost),
              x11: Boolean(shellExtra.x11),
              terminalId: primaryTerminalId,
            },
          });
          if (x11Note) {
            send(ws, {
              type: MSG.DATA,
              sessionId,
              terminalId: primaryTerminalId,
              data: x11Note,
            });
          }

          try {
            const sftpSession = await sftp.ensureSftp(sess);
            const home = await sftp.realpath(sftpSession, '.');
            send(ws, { type: MSG.SFTP_READY, sessionId, path: home || '/' });
          } catch (err) {
            send(ws, {
              type: MSG.SFTP_ERROR,
              sessionId,
              error: err.message || String(err),
            });
          }
        } catch (err) {
          send(ws, {
            type: MSG.ERROR,
            sessionId,
            data: err.message || String(err),
            fatal: true,
          });
          destroySession(sessionId, 'Connect failed');
        }
        return;
      }

      const sess = getSession(sessionId);

      if (msg.type === MSG.INPUT) {
        const stream = resolveShell(sess, msg.terminalId);
        if (stream) stream.write(msg.data);
        return;
      }

      if (msg.type === MSG.RESIZE) {
        const stream = resolveShell(sess, msg.terminalId);
        if (stream) {
          stream.setWindow(msg.rows, msg.cols, msg.height || 480, msg.width || 640);
        }
        return;
      }

      if (msg.type === MSG.SHELL_OPEN || msg.type === 'shell-open') {
        if (!sess || !sess.client) {
          send(ws, {
            type: MSG.ERROR,
            sessionId,
            terminalId: msg.terminalId,
            data: 'Not connected',
          });
          return;
        }
        ensureShells(sess);
        const terminalId = String(msg.terminalId || '').slice(0, 64);
        if (!terminalId) {
          send(ws, {
            type: MSG.ERROR,
            sessionId,
            data: 'Missing terminalId',
          });
          return;
        }
        try {
          // Inherit X11 / trusted forwarding from the SSH session for every new shell.
          const shellExtra = (sess.x11 && sess.x11Option != null)
            ? { x11: sess.x11Option }
            : {};
          await openShell(
            sess,
            sessionId,
            terminalId,
            msg.cols || 120,
            msg.rows || 36,
            shellExtra,
          );
          send(ws, {
            type: MSG.SHELL_OPENED,
            sessionId,
            terminalId,
            x11: Boolean(shellExtra.x11),
          });
        } catch (err) {
          send(ws, {
            type: MSG.ERROR,
            sessionId,
            terminalId,
            data: err.message || String(err),
          });
        }
        return;
      }

      if (msg.type === MSG.SHELL_CLOSE || msg.type === 'shell-close') {
        if (!sess) return;
        ensureShells(sess);
        const terminalId = String(msg.terminalId || '').slice(0, 64);
        const stream = terminalId ? sess.shells?.get(terminalId) : null;
        if (!stream) return;
        // Keep SSH session alive even if this is the last shell.
        try {
          stream.close();
        } catch (_) { /* ignore */ }
        return;
      }

      if (msg.type === MSG.DISCONNECT) {
        destroySession(sessionId, 'Disconnected by user');
        return;
      }

      if (msg.type === MSG.EXEC) {
        if (!sess || !sess.client) {
          send(ws, { type: MSG.EXEC_RESULT, sessionId, id: msg.id, error: 'Not connected' });
          return;
        }
        try {
          const output = await execCommand(sess.client, msg.command, {
            x11: Boolean(sess.x11),
          });
          send(ws, { type: MSG.EXEC_RESULT, sessionId, id: msg.id, output });
        } catch (err) {
          send(ws, { type: MSG.EXEC_RESULT, sessionId, id: msg.id, error: err.message });
        }
        return;
      }

      if (msg.type === MSG.SERVER_INFO) {
        if (!sess || !sess.client) {
          send(ws, { type: MSG.SERVER_INFO_RESULT, sessionId, id: msg.id, error: 'Not connected' });
          return;
        }
        // Emit KEY=value lines so the client can render a clean layout
        // instead of dumping free/df tables into a narrow sidebar.
        const script = [
          'echo "HOST=$(hostname 2>/dev/null || uname -n)"',
          'echo "OS=$(uname -sr 2>/dev/null)"',
          'UP=$(uptime -p 2>/dev/null); if [ -z "$UP" ]; then UP=$(uptime 2>/dev/null | sed -n \'s/.*up \\([^,]*\\).*/up \\1/p\'); fi; echo "UPTIME=${UP:-—}"',
          'echo "CPU=$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo —)"',
          'free -h 2>/dev/null | awk \'/^Mem:/{printf "MEM_TOTAL=%s\\nMEM_USED=%s\\nMEM_FREE=%s\\nMEM_SHARED=%s\\nMEM_CACHE=%s\\nMEM_AVAILABLE=%s\\n",$2,$3,$4,$5,$6,$7}\'',
          'df -h / 2>/dev/null | awk \'NR==2{printf "DISK_FS=%s\\nDISK_SIZE=%s\\nDISK_USED=%s\\nDISK_AVAIL=%s\\nDISK_USE=%s\\nDISK_MOUNT=%s\\n",$1,$2,$3,$4,$5,$6}\'',
          'awk \'{printf "LOAD_1=%s\\nLOAD_5=%s\\nLOAD_15=%s\\n",$1,$2,$3}\' /proc/loadavg 2>/dev/null',
        ].join('; ');
        try {
          const raw = await execCommand(sess.client, script);
          const kv = {};
          String(raw || '').split('\n').forEach((line) => {
            const idx = line.indexOf('=');
            if (idx <= 0) return;
            const key = line.slice(0, idx).trim();
            const value = line.slice(idx + 1).trim();
            if (key) kv[key] = value;
          });
          const info = {
            host: kv.HOST || '—',
            os: kv.OS || '—',
            uptime: kv.UPTIME || '—',
            cpu: kv.CPU || '—',
            memTotal: kv.MEM_TOTAL || '—',
            memUsed: kv.MEM_USED || '—',
            memFree: kv.MEM_FREE || '—',
            memShared: kv.MEM_SHARED || '—',
            memCache: kv.MEM_CACHE || '—',
            memAvailable: kv.MEM_AVAILABLE || '—',
            diskFs: kv.DISK_FS || '—',
            diskSize: kv.DISK_SIZE || '—',
            diskUsed: kv.DISK_USED || '—',
            diskAvail: kv.DISK_AVAIL || '—',
            diskUse: kv.DISK_USE || '—',
            diskMount: kv.DISK_MOUNT || '—',
            load1: kv.LOAD_1 || '—',
            load5: kv.LOAD_5 || '—',
            load15: kv.LOAD_15 || '—',
          };
          send(ws, { type: MSG.SERVER_INFO_RESULT, sessionId, id: msg.id, info });
        } catch (err) {
          send(ws, { type: MSG.SERVER_INFO_RESULT, sessionId, id: msg.id, error: err.message });
        }
        return;
      }

      if (msg.type === MSG.SFTP_LIST) {
        if (!sess || !sess.client) {
          send(ws, { type: MSG.SFTP_LIST_RESULT, sessionId, id: msg.id, error: 'Not connected' });
          return;
        }
        try {
          const sftpSession = await sftp.ensureSftp(sess);
          const path = msg.path || '.';
          const files = await sftp.listDir(sftpSession, path);
          send(ws, { type: MSG.SFTP_LIST_RESULT, sessionId, id: msg.id, path, files });
        } catch (err) {
          send(ws, { type: MSG.SFTP_LIST_RESULT, sessionId, id: msg.id, error: err.message });
        }
        return;
      }

      if (msg.type === MSG.SFTP_MKDIR) {
        if (!sess || !sess.client) {
          send(ws, {
            type: MSG.SFTP_MKDIR_RESULT,
            sessionId,
            id: msg.id,
            path: msg.path,
            error: 'Not connected',
          });
          return;
        }
        try {
          const sftpSession = await sftp.ensureSftp(sess);
          await sftp.mkdir(sftpSession, msg.path);
          record({
            ...auditBase(),
            action: 'sftp.mkdir',
            sessionId,
            targetHost: sess.targetHost,
            targetUser: sess.targetUser,
            targetPort: sess.targetPort,
            path: msg.path,
          });
          send(ws, {
            type: MSG.SFTP_MKDIR_RESULT,
            sessionId,
            id: msg.id,
            path: msg.path,
            error: null,
          });
        } catch (err) {
          send(ws, {
            type: MSG.SFTP_MKDIR_RESULT,
            sessionId,
            id: msg.id,
            path: msg.path,
            error: err.message,
          });
        }
        return;
      }

      if (msg.type === MSG.SFTP_RENAME) {
        if (!sess || !sess.client) {
          send(ws, {
            type: MSG.SFTP_RENAME_RESULT,
            sessionId,
            id: msg.id,
            error: 'Not connected',
          });
          return;
        }
        try {
          const sftpSession = await sftp.ensureSftp(sess);
          await sftp.rename(sftpSession, msg.from, msg.to);
          record({
            ...auditBase(),
            action: 'sftp.rename',
            sessionId,
            targetHost: sess.targetHost,
            targetUser: sess.targetUser,
            targetPort: sess.targetPort,
            path: msg.to,
            detail: { from: msg.from, to: msg.to },
          });
          send(ws, {
            type: MSG.SFTP_RENAME_RESULT,
            sessionId,
            id: msg.id,
            from: msg.from,
            to: msg.to,
            error: null,
          });
        } catch (err) {
          send(ws, {
            type: MSG.SFTP_RENAME_RESULT,
            sessionId,
            id: msg.id,
            from: msg.from,
            to: msg.to,
            error: err.message,
          });
        }
        return;
      }

      if (msg.type === MSG.SFTP_RM) {
        if (!sess || !sess.client) {
          send(ws, {
            type: MSG.SFTP_RM_RESULT,
            sessionId,
            id: msg.id,
            error: 'Not connected',
          });
          return;
        }
        try {
          const sftpSession = await sftp.ensureSftp(sess);
          await sftp.remove(sftpSession, msg.path);
          record({
            ...auditBase(),
            action: 'sftp.rm',
            sessionId,
            targetHost: sess.targetHost,
            targetUser: sess.targetUser,
            targetPort: sess.targetPort,
            path: msg.path,
          });
          send(ws, {
            type: MSG.SFTP_RM_RESULT,
            sessionId,
            id: msg.id,
            path: msg.path,
            error: null,
          });
        } catch (err) {
          send(ws, {
            type: MSG.SFTP_RM_RESULT,
            sessionId,
            id: msg.id,
            path: msg.path,
            error: err.message,
          });
        }
        return;
      }

      if (msg.type === MSG.SFTP_PREVIEW) {
        if (!sess || !sess.client) {
          send(ws, { type: MSG.SFTP_PREVIEW_RESULT, sessionId, id: msg.id, error: 'Not connected' });
          return;
        }
        try {
          const sftpSession = await sftp.ensureSftp(sess);
          const result = await sftp.previewFile(sftpSession, msg.path);
          record({
            ...auditBase(),
            action: 'sftp.preview',
            sessionId,
            targetHost: sess.targetHost,
            targetUser: sess.targetUser,
            targetPort: sess.targetPort,
            path: msg.path,
            detail: { size: result.size },
          });
          send(ws, { type: MSG.SFTP_PREVIEW_RESULT, sessionId, id: msg.id, ...result, done: true });
        } catch (err) {
          send(ws, { type: MSG.SFTP_PREVIEW_RESULT, sessionId, id: msg.id, error: err.message });
        }
        return;
      }

      if (msg.type === MSG.SFTP_WRITE) {
        if (!sess || !sess.client) {
          send(ws, { type: MSG.SFTP_WRITE_RESULT, sessionId, id: msg.id, error: 'Not connected' });
          return;
        }
        try {
          const sftpSession = await sftp.ensureSftp(sess);
          const result = await sftp.writeFile(
            sftpSession,
            msg.path,
            msg.content || '',
            msg.expectedMtime,
            Boolean(msg.createOnly),
          );
          record({
            ...auditBase(),
            action: 'sftp.write',
            sessionId,
            targetHost: sess.targetHost,
            targetUser: sess.targetUser,
            targetPort: sess.targetPort,
            path: result.path,
            detail: { size: result.size, createOnly: Boolean(msg.createOnly) },
          });
          send(ws, {
            type: MSG.SFTP_WRITE_RESULT,
            sessionId,
            id: msg.id,
            path: result.path,
            size: result.size,
            mtime: result.mtime,
            done: true,
          });
        } catch (err) {
          send(ws, {
            type: MSG.SFTP_WRITE_RESULT,
            sessionId,
            id: msg.id,
            error: err.message,
            code: err.code,
          });
        }
        return;
      }

      // ---- Streaming upload ----
      if (msg.type === MSG.SFTP_UPLOAD_START) {
        if (!sess || !sess.client) {
          send(ws, { type: MSG.SFTP_UPLOAD_RESULT, sessionId, id: msg.id, error: 'Not connected' });
          return;
        }
        const remoteFile = `${msg.remotePath}/${msg.filename}`.replace(/\/+/g, '/');
        try {
          const sftpSession = await sftp.ensureSftp(sess);
          const writeStream = sftp.createUploadStream(sftpSession, remoteFile);
          const transfer = {
            writeStream,
            written: 0,
            total: msg.size || 0,
            remoteFile,
            lastProgressAt: 0,
          };
          sess.uploads.set(msg.id, transfer);
          writeStream.on('error', (err) => {
            send(ws, { type: MSG.SFTP_UPLOAD_RESULT, sessionId, id: msg.id, error: err.message });
            sess.uploads.delete(msg.id);
          });
          emitUploadProgress(sessionId, transfer, msg.id, true);
        } catch (err) {
          send(ws, { type: MSG.SFTP_UPLOAD_RESULT, sessionId, id: msg.id, error: err.message });
        }
        return;
      }

      // Legacy JSON base64 chunks (binary path preferred)
      if (msg.type === MSG.SFTP_UPLOAD_CHUNK) {
        if (!sess) return;
        const buf = Buffer.from(msg.data || '', 'base64');
        await writeUploadChunk(sessionId, msg.id, buf);
        return;
      }

      if (msg.type === MSG.SFTP_UPLOAD_END) {
        if (!sess) return;
        const transfer = sess.uploads.get(msg.id);
        if (!transfer) {
          send(ws, { type: MSG.SFTP_UPLOAD_RESULT, sessionId, id: msg.id, error: 'Unknown upload' });
          return;
        }
        await new Promise((resolve) => {
          transfer.writeStream.end(() => {
            emitUploadProgress(sessionId, transfer, msg.id, true);
            record({
              ...auditBase(),
              action: 'sftp.upload',
              sessionId,
              targetHost: sess.targetHost,
              targetUser: sess.targetUser,
              targetPort: sess.targetPort,
              path: transfer.remoteFile,
              detail: { size: transfer.written || transfer.total || 0 },
            });
            send(ws, {
              type: MSG.SFTP_UPLOAD_RESULT,
              sessionId,
              id: msg.id,
              path: transfer.remoteFile,
              done: true,
            });
            sess.uploads.delete(msg.id);
            resolve();
          });
        });
        return;
      }

      if (msg.type === MSG.SFTP_UPLOAD_ABORT) {
        if (!sess) return;
        const transfer = sess.uploads.get(msg.id);
        if (transfer) {
          try { transfer.writeStream.destroy(); } catch (_) { /* ignore */ }
          sess.uploads.delete(msg.id);
        }
        return;
      }

      // ---- Streaming download (binary chunks + backpressure) ----
      if (msg.type === MSG.SFTP_DOWNLOAD_START) {
        if (!sess || !sess.client) {
          send(ws, { type: MSG.SFTP_DOWNLOAD_RESULT, sessionId, id: msg.id, error: 'Not connected' });
          return;
        }
        try {
          const sftpSession = await sftp.ensureSftp(sess);
          const { readStream, size, filename } = await sftp.createDownloadStream(
            sftpSession,
            msg.remotePath,
          );
          const dl = {
            readStream,
            sent: 0,
            size,
            filename,
            lastProgressAt: 0,
            resumeTimer: null,
          };
          sess.downloads.set(msg.id, dl);
          send(ws, {
            type: MSG.SFTP_DOWNLOAD_META,
            sessionId,
            id: msg.id,
            filename,
            size,
          });

          const stopResumePoll = () => {
            if (dl.resumeTimer) {
              clearInterval(dl.resumeTimer);
              dl.resumeTimer = null;
            }
          };

          const maybePauseForWs = () => {
            if (ws.bufferedAmount <= WS_BUFFER_HIGH || readStream.isPaused()) return;
            readStream.pause();
            if (dl.resumeTimer) return;
            dl.resumeTimer = setInterval(() => {
              if (!sess.downloads.has(msg.id)) {
                stopResumePoll();
                return;
              }
              if (ws.bufferedAmount <= WS_BUFFER_LOW) {
                stopResumePoll();
                if (!readStream.destroyed) readStream.resume();
              }
            }, 16);
          };

          const emitDlProgress = (force = false) => {
            const now = Date.now();
            if (!force && dl.lastProgressAt && now - dl.lastProgressAt < PROGRESS_THROTTLE_MS) {
              return;
            }
            dl.lastProgressAt = now;
            send(ws, {
              type: MSG.SFTP_DOWNLOAD_CHUNK,
              sessionId,
              id: msg.id,
              written: dl.sent,
              total: size,
            });
          };

          readStream.on('data', (chunk) => {
            if (!sess.downloads.has(msg.id)) {
              readStream.destroy();
              return;
            }
            dl.sent += chunk.length;
            sendBinary(ws, WS_BIN_KIND.DOWNLOAD_CHUNK, sessionId, msg.id, chunk);
            emitDlProgress(false);
            maybePauseForWs();
          });
          readStream.on('error', (err) => {
            stopResumePoll();
            send(ws, { type: MSG.SFTP_DOWNLOAD_RESULT, sessionId, id: msg.id, error: err.message });
            sess.downloads.delete(msg.id);
          });
          readStream.on('end', () => {
            stopResumePoll();
            emitDlProgress(true);
            record({
              ...auditBase(),
              action: 'sftp.download',
              sessionId,
              targetHost: sess.targetHost,
              targetUser: sess.targetUser,
              targetPort: sess.targetPort,
              path: msg.remotePath,
              detail: { size, filename },
            });
            send(ws, {
              type: MSG.SFTP_DOWNLOAD_RESULT,
              sessionId,
              id: msg.id,
              filename,
              done: true,
            });
            sess.downloads.delete(msg.id);
          });
        } catch (err) {
          send(ws, { type: MSG.SFTP_DOWNLOAD_RESULT, sessionId, id: msg.id, error: err.message });
        }
        return;
      }

      if (msg.type === MSG.SFTP_DOWNLOAD_ABORT) {
        if (!sess) return;
        const dl = sess.downloads.get(msg.id);
        if (dl) {
          try { dl.readStream?.destroy(); } catch (_) { /* ignore */ }
          if (dl.resumeTimer) clearInterval(dl.resumeTimer);
          sess.downloads.delete(msg.id);
        }
      }
    }

    ws.on('close', () => {
      destroyAll();
    });
  });

  return wss;
}

module.exports = { attachWsHub };
