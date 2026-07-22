const WebSocket = require('ws');
const { MSG } = require('../../shared/protocol');
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

    const flushTermOut = (sessionId) => {
      const buf = termOutBuffers.get(sessionId);
      if (!buf || buf.chunks.length === 0) return;
      if (buf.timer) {
        clearTimeout(buf.timer);
        buf.timer = null;
      }
      const payload = Buffer.concat(buf.chunks);
      buf.chunks = [];
      buf.bytes = 0;
      sendBinary(ws, WS_BIN_KIND.TERM_OUT, sessionId, '', payload);
    };

    const enqueueTermOut = (sessionId, chunk) => {
      let buf = termOutBuffers.get(sessionId);
      if (!buf) {
        buf = { chunks: [], bytes: 0, timer: null };
        termOutBuffers.set(sessionId, buf);
      }
      const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      buf.chunks.push(piece);
      buf.bytes += piece.length;
      if (buf.bytes >= TERM_COALESCE_BYTES) {
        flushTermOut(sessionId);
        return;
      }
      if (!buf.timer) {
        buf.timer = setTimeout(() => flushTermOut(sessionId), TERM_COALESCE_MS);
      }
    };

    const clearTermOut = (sessionId) => {
      const buf = termOutBuffers.get(sessionId);
      if (!buf) return;
      if (buf.timer) clearTimeout(buf.timer);
      termOutBuffers.delete(sessionId);
    };

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
      flushTermOut(sessionId);
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
      for (const id of [...termOutBuffers.keys()]) clearTermOut(id);
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
          const sess = {
            client,
            jumpClient,
            stream: null,
            sftp: null,
            _sftpPending: null,
            uploads: new Map(),
            downloads: new Map(),
            x11: false,
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

          const shellOpts = {
            term: 'xterm-256color',
            cols: msg.cols || 120,
            rows: msg.rows || 36,
          };

          let x11Note = '';
          if (msg.x11Forward) {
            const x11 = attachX11Forwarding(client, {
              trusted: Boolean(msg.x11Trusted),
              display: msg.x11Display || undefined,
            });
            if (x11.ok) {
              shellOpts.x11 = x11.x11Option;
              sess.x11 = true;
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

          // Open shell first, then one shared SFTP (avoid racing many channels).
          await new Promise((resolve, reject) => {
            client.shell(shellOpts, (err, stream) => {
              if (err) {
                reject(err);
                return;
              }
              sess.stream = stream;
              stream.on('data', (chunk) => {
                enqueueTermOut(sessionId, chunk);
              });
              stream.stderr.on('data', (chunk) => {
                enqueueTermOut(sessionId, chunk);
              });
              stream.on('close', () => {
                destroySession(sessionId, 'Shell session closed');
              });
              resolve();
            });
          });

          send(ws, {
            type: MSG.CONNECTED,
            sessionId,
            data: 'SSH connection established',
            x11: Boolean(shellOpts.x11),
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
              x11: Boolean(shellOpts.x11),
            },
          });
          if (x11Note) {
            send(ws, { type: MSG.DATA, sessionId, data: x11Note });
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
        if (sess && sess.stream) sess.stream.write(msg.data);
        return;
      }

      if (msg.type === MSG.RESIZE) {
        if (sess && sess.stream) {
          sess.stream.setWindow(msg.rows, msg.cols, msg.height || 480, msg.width || 640);
        }
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
        const script = [
          'echo "===HOST==="',
          'hostname 2>/dev/null || uname -n',
          'echo "===OS==="',
          'uname -sr 2>/dev/null',
          'echo "===UPTIME==="',
          'uptime 2>/dev/null || cat /proc/uptime 2>/dev/null',
          'echo "===CPU==="',
          'nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo ?',
          'echo "===MEM==="',
          'free -h 2>/dev/null | awk \'NR==1||NR==2{print}\'',
          'echo "===DISK==="',
          'df -h / 2>/dev/null | tail -1',
          'echo "===LOAD==="',
          'cat /proc/loadavg 2>/dev/null || uptime 2>/dev/null',
        ].join('; ');
        try {
          const raw = await execCommand(sess.client, script);
          const sections = {};
          let current = null;
          raw.split('\n').forEach((line) => {
            const m = line.match(/^===(\w+)===$/);
            if (m) {
              current = m[1].toLowerCase();
              sections[current] = [];
              return;
            }
            if (current) sections[current].push(line);
          });
          const info = {
            host: (sections.host || []).join('\n').trim(),
            os: (sections.os || []).join('\n').trim(),
            uptime: (sections.uptime || []).join('\n').trim(),
            cpu: (sections.cpu || []).join('\n').trim(),
            mem: (sections.mem || []).join('\n').trim(),
            disk: (sections.disk || []).join('\n').trim(),
            load: (sections.load || []).join('\n').trim(),
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
