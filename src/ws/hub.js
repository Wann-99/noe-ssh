const WebSocket = require('ws');
const { MSG } = require('../../shared/protocol');
const { openSshConnection, execCommand } = require('../ssh/client');
const { attachX11Forwarding } = require('../ssh/x11');
const sftp = require('../sftp/handlers');
const { ACCESS_TOKEN, isValidSession } = require('../http/app');

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function parseQueryToken(reqUrl) {
  try {
    const u = new URL(reqUrl, 'http://localhost');
    return u.searchParams.get('token') || '';
  } catch (_) {
    return '';
  }
}

function attachWsHub(server) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws, req) => {
    let authenticated = !ACCESS_TOKEN;
    const urlToken = parseQueryToken(req.url || '');
    if (ACCESS_TOKEN && isValidSession(urlToken)) {
      authenticated = true;
    }

    /** @type {Map<string, any>} */
    const sessions = new Map();

    if (ACCESS_TOKEN && !authenticated) {
      send(ws, { type: MSG.AUTH_REQUIRED });
    } else if (ACCESS_TOKEN) {
      send(ws, { type: MSG.AUTH_OK });
    }

    const getSession = (sessionId) => sessions.get(sessionId);

    const destroySession = (sessionId, reason) => {
      const sess = sessions.get(sessionId);
      if (!sess) return;
      for (const [, up] of sess.uploads) {
        try { up.writeStream.destroy(); } catch (_) { /* ignore */ }
      }
      sess.uploads.clear();
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
      sessions.delete(sessionId);
      send(ws, { type: MSG.DISCONNECTED, sessionId, data: reason || 'Session closed' });
    };

    const destroyAll = () => {
      for (const id of [...sessions.keys()]) {
        destroySession(id, 'Connection closed');
      }
    };

    ws.on('message', async (raw, isBinary) => {
      // Binary frames reserved for future; currently all control is JSON
      if (isBinary) return;

      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (_) {
        return;
      }

      if (msg.type === MSG.AUTH) {
        if (!ACCESS_TOKEN || isValidSession(msg.token)) {
          authenticated = true;
          send(ws, { type: MSG.AUTH_OK });
        } else {
          send(ws, { type: MSG.AUTH_FAIL, data: 'Invalid access token' });
        }
        return;
      }

      if (ACCESS_TOKEN && !authenticated) {
        send(ws, { type: MSG.AUTH_REQUIRED, data: 'Authentication required' });
        return;
      }

      const sessionId = msg.sessionId || 'default';

      if (msg.type === MSG.CONNECT) {
        if (sessions.has(sessionId)) {
          destroySession(sessionId, 'Reconnecting');
        }

        try {
          const { client, jumpClient } = await openSshConnection(msg);
          const sess = {
            client,
            jumpClient,
            stream: null,
            sftp: null,
            _sftpPending: null,
            uploads: new Map(),
            downloads: new Set(),
            x11: false,
          };
          sessions.set(sessionId, sess);

          client.on('error', (err) => {
            send(ws, { type: MSG.ERROR, sessionId, data: `SSH Error: ${err.message}` });
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
                send(ws, { type: MSG.DATA, sessionId, data: chunk.toString('utf-8') });
              });
              stream.stderr.on('data', (chunk) => {
                send(ws, { type: MSG.DATA, sessionId, data: chunk.toString('utf-8') });
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
          if (x11Note) {
            send(ws, { type: MSG.DATA, sessionId, data: x11Note });
          }

          try {
            const sftpSession = await sftp.ensureSftp(sess);
            const home = await sftp.realpath(sftpSession, '.');
            send(ws, { type: MSG.HOME_DIR, sessionId, path: home || '/' });
          } catch (_) {
            send(ws, { type: MSG.HOME_DIR, sessionId, path: '/' });
          }
        } catch (err) {
          send(ws, { type: MSG.ERROR, sessionId, data: err.message || String(err) });
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
          send(ws, { type: MSG.SFTP_MKDIR_RESULT, sessionId, path: msg.path, error: 'Not connected' });
          return;
        }
        try {
          const sftpSession = await sftp.ensureSftp(sess);
          await sftp.mkdir(sftpSession, msg.path);
          send(ws, { type: MSG.SFTP_MKDIR_RESULT, sessionId, path: msg.path, error: null });
        } catch (err) {
          send(ws, { type: MSG.SFTP_MKDIR_RESULT, sessionId, path: msg.path, error: err.message });
        }
        return;
      }

      if (msg.type === MSG.SFTP_RENAME) {
        if (!sess || !sess.client) {
          send(ws, { type: MSG.SFTP_RENAME_RESULT, sessionId, error: 'Not connected' });
          return;
        }
        try {
          const sftpSession = await sftp.ensureSftp(sess);
          await sftp.rename(sftpSession, msg.from, msg.to);
          send(ws, { type: MSG.SFTP_RENAME_RESULT, sessionId, from: msg.from, to: msg.to, error: null });
        } catch (err) {
          send(ws, { type: MSG.SFTP_RENAME_RESULT, sessionId, from: msg.from, to: msg.to, error: err.message });
        }
        return;
      }

      if (msg.type === MSG.SFTP_RM) {
        if (!sess || !sess.client) {
          send(ws, { type: MSG.SFTP_RM_RESULT, sessionId, error: 'Not connected' });
          return;
        }
        try {
          const sftpSession = await sftp.ensureSftp(sess);
          await sftp.remove(sftpSession, msg.path);
          send(ws, { type: MSG.SFTP_RM_RESULT, sessionId, path: msg.path, error: null });
        } catch (err) {
          send(ws, { type: MSG.SFTP_RM_RESULT, sessionId, path: msg.path, error: err.message });
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
          const result = await sftp.writeFile(sftpSession, msg.path, msg.content || '');
          send(ws, {
            type: MSG.SFTP_WRITE_RESULT,
            sessionId,
            id: msg.id,
            path: result.path,
            size: result.size,
            done: true,
          });
        } catch (err) {
          send(ws, { type: MSG.SFTP_WRITE_RESULT, sessionId, id: msg.id, error: err.message });
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
          };
          sess.uploads.set(msg.id, transfer);
          writeStream.on('error', (err) => {
            send(ws, { type: MSG.SFTP_UPLOAD_RESULT, sessionId, id: msg.id, error: err.message });
            sess.uploads.delete(msg.id);
          });
          send(ws, {
            type: MSG.SFTP_UPLOAD_PROGRESS,
            sessionId,
            id: msg.id,
            written: 0,
            total: transfer.total,
          });
        } catch (err) {
          send(ws, { type: MSG.SFTP_UPLOAD_RESULT, sessionId, id: msg.id, error: err.message });
        }
        return;
      }

      if (msg.type === MSG.SFTP_UPLOAD_CHUNK) {
        if (!sess) return;
        const transfer = sess.uploads.get(msg.id);
        if (!transfer) {
          send(ws, { type: MSG.SFTP_UPLOAD_RESULT, sessionId, id: msg.id, error: 'Unknown upload' });
          return;
        }
        try {
          const buf = Buffer.from(msg.data, 'base64');
          const ok = transfer.writeStream.write(buf);
          transfer.written += buf.length;
          send(ws, {
            type: MSG.SFTP_UPLOAD_PROGRESS,
            sessionId,
            id: msg.id,
            written: transfer.written,
            total: transfer.total,
          });
          if (!ok) {
            await new Promise((r) => transfer.writeStream.once('drain', r));
          }
        } catch (err) {
          send(ws, { type: MSG.SFTP_UPLOAD_RESULT, sessionId, id: msg.id, error: err.message });
          sess.uploads.delete(msg.id);
        }
        return;
      }

      if (msg.type === MSG.SFTP_UPLOAD_END) {
        if (!sess) return;
        const transfer = sess.uploads.get(msg.id);
        if (!transfer) {
          send(ws, { type: MSG.SFTP_UPLOAD_RESULT, sessionId, id: msg.id, error: 'Unknown upload' });
          return;
        }
        transfer.writeStream.end(() => {
          send(ws, {
            type: MSG.SFTP_UPLOAD_RESULT,
            sessionId,
            id: msg.id,
            path: transfer.remoteFile,
            done: true,
          });
          sess.uploads.delete(msg.id);
        });
        return;
      }

      // ---- Streaming download ----
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
          sess.downloads.add(msg.id);
          send(ws, {
            type: MSG.SFTP_DOWNLOAD_META,
            sessionId,
            id: msg.id,
            filename,
            size,
          });
          let sent = 0;
          readStream.on('data', (chunk) => {
            if (!sess.downloads.has(msg.id)) {
              readStream.destroy();
              return;
            }
            sent += chunk.length;
            send(ws, {
              type: MSG.SFTP_DOWNLOAD_CHUNK,
              sessionId,
              id: msg.id,
              data: chunk.toString('base64'),
              written: sent,
              total: size,
            });
          });
          readStream.on('error', (err) => {
            send(ws, { type: MSG.SFTP_DOWNLOAD_RESULT, sessionId, id: msg.id, error: err.message });
            sess.downloads.delete(msg.id);
          });
          readStream.on('end', () => {
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
        if (sess) sess.downloads.delete(msg.id);
      }
    });

    ws.on('close', () => {
      destroyAll();
    });
  });

  return wss;
}

module.exports = { attachWsHub };
