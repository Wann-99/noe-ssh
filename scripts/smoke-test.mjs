/**
 * Smoke test: token mode + users mode (login, disable, audit query).
 * Does not require a real SSH host.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'smoke-secret-token';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin-pass-123';

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function startServer(env) {
  return spawn(process.execPath, ['src/index.js'], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitReady(port, predicate) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const { data } = await fetchJson(`http://127.0.0.1:${port}/api/health`);
      if (data.ok && predicate(data)) return data;
    } catch {
      /* retry */
    }
    await wait(120);
  }
  throw new Error(`Server on :${port} failed to become ready`);
}

async function kill(child) {
  try { child.kill('SIGTERM'); } catch { /* ignore */ }
  await wait(200);
  try { child.kill('SIGKILL'); } catch { /* ignore */ }
}

async function testTokenMode() {
  const port = 3099;
  const child = startServer({
    PORT: String(port),
    HOST: '127.0.0.1',
    NOE_SSH_ACCESS_TOKEN: TOKEN,
    NOE_SSH_MODE: 'portable',
    NOE_SSH_DATA_DIR: path.join(os.tmpdir(), `noe-ssh-smoke-token-${Date.now()}`),
  });

  try {
    await waitReady(port, (d) => d.authMode === 'token' && d.authRequired);

    const badLogin = await fetchJson(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'wrong' }),
    });
    if (badLogin.status !== 401) throw new Error('token mode: expected 401 for bad token');

    const goodLogin = await fetchJson(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    });
    if (!goodLogin.data.ok || !goodLogin.data.token) throw new Error('token mode: login failed');

    const sessionToken = goodLogin.data.token;
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${sessionToken}`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('token mode: WS timeout'));
      }, 5000);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token: sessionToken }));
      });

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'auth-ok' || msg.type === 'auth-required') {
          ws.send(JSON.stringify({
            type: 'connect',
            sessionId: 's-smoke-1',
            host: '127.0.0.1',
            port: 1,
            username: 'nobody',
            password: 'x',
          }));
        }
        if (msg.type === 'error' && msg.sessionId === 's-smoke-1') {
          if (!msg.fatal) {
            clearTimeout(timer);
            ws.close();
            reject(new Error('token mode: expected fatal connect error'));
            return;
          }
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      });

      ws.on('error', reject);
    });

    console.log('smoke-test: token mode OK');
  } finally {
    await kill(child);
  }
}

async function testUsersMode() {
  const port = 3101;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noe-ssh-smoke-users-'));
  const child = startServer({
    PORT: String(port),
    HOST: '127.0.0.1',
    NOE_SSH_MODE: 'portable',
    NOE_SSH_DATA_DIR: dataDir,
    NOE_SSH_ADMIN_USER: ADMIN_USER,
    NOE_SSH_ADMIN_PASSWORD: ADMIN_PASS,
  });

  try {
    await waitReady(port, (d) => d.authMode === 'users' && d.authRequired);

    const badLogin = await fetchJson(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: 'wrong' }),
    });
    if (badLogin.status !== 401) throw new Error('users mode: expected 401 for bad password');

    const adminLogin = await fetchJson(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    });
    if (!adminLogin.data.ok || !adminLogin.data.token || adminLogin.data.user?.role !== 'admin') {
      throw new Error('users mode: admin login failed');
    }
    const adminToken = adminLogin.data.token;
    const headers = {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    };

    const created = await fetchJson(`http://127.0.0.1:${port}/api/admin/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ username: 'alice', password: 'alice-pass', role: 'user' }),
    });
    if (!created.data.ok || !created.data.user?.id) throw new Error('users mode: create user failed');
    const aliceId = created.data.user.id;

    const aliceLogin = await fetchJson(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'alice-pass' }),
    });
    if (!aliceLogin.data.ok || !aliceLogin.data.token) throw new Error('users mode: alice login failed');

    const disabled = await fetchJson(`http://127.0.0.1:${port}/api/admin/users/${aliceId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ disabled: true }),
    });
    if (!disabled.data.ok || !disabled.data.user?.disabled) {
      throw new Error('users mode: disable user failed');
    }

    const aliceBlocked = await fetchJson(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'alice-pass' }),
    });
    if (aliceBlocked.status !== 401) throw new Error('users mode: disabled user should not login');

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${adminToken}`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('users mode: WS timeout'));
      }, 5000);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token: adminToken }));
      });

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'auth-ok') {
          ws.send(JSON.stringify({
            type: 'connect',
            sessionId: 's-smoke-admin',
            host: '203.0.113.10',
            port: 22,
            username: 'ops',
            password: 'x',
          }));
        }
        if (msg.type === 'error' && msg.sessionId === 's-smoke-admin') {
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      });

      ws.on('error', reject);
    });

    // Failed connect before shell should not emit ssh.connect; insert is only on success.
    // Verify login audits + admin list/query work.
    const audit = await fetchJson(
      `http://127.0.0.1:${port}/api/admin/audit?user=admin&action=auth.login`,
      { headers },
    );
    if (!audit.data.ok || !Array.isArray(audit.data.items) || audit.data.items.length < 1) {
      throw new Error('users mode: expected auth.login audit events');
    }

    const failAudit = await fetchJson(
      `http://127.0.0.1:${port}/api/admin/audit?action=auth.login_fail`,
      { headers },
    );
    if (!failAudit.data.ok || failAudit.data.total < 1) {
      throw new Error('users mode: expected login_fail audit');
    }

    // Manually record a connect-like event through a second successful login check on summary API.
    const summary = await fetchJson(`http://127.0.0.1:${port}/api/admin/audit/summary`, { headers });
    if (!summary.data.ok || !Array.isArray(summary.data.byUser)) {
      throw new Error('users mode: summary failed');
    }

    // Inject connect audit by reusing logger via a tiny inline require in a child eval is heavy;
    // instead verify admin can query and users list includes alice.
    const users = await fetchJson(`http://127.0.0.1:${port}/api/admin/users`, { headers });
    if (!users.data.users?.some((u) => u.username === 'alice' && u.disabled)) {
      throw new Error('users mode: alice missing or not disabled');
    }

    // Directly write a connect audit row using the same DB module the server uses is hard across processes.
    // Spawn a one-shot script against the same data dir.
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    process.env.NOE_SSH_DATA_DIR = dataDir;
    const { initDb } = require('../src/db');
    const { record, queryAudit } = require('../src/audit/logger');
    await initDb();
    record({
      action: 'ssh.connect',
      userId: 1,
      username: ADMIN_USER,
      sessionId: 's-smoke-admin',
      targetHost: '203.0.113.10',
      targetUser: 'ops',
      targetPort: 22,
    });
    const q = queryAudit({ action: 'ssh.connect', host: '203.0.113.10' });
    if (q.total < 1) throw new Error('users mode: connect audit write/query failed');

    console.log('smoke-test: users mode OK');
  } finally {
    await kill(child);
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function testBinaryFrames() {
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const {
    encodeFrame,
    decodeFrame,
    WS_BIN_KIND,
    TRANSFER_CHUNK_SIZE,
  } = require('../shared/wsBinary.js');

  const payload = Buffer.alloc(1024, 0xab);
  const encoded = encodeFrame(WS_BIN_KIND.UPLOAD_CHUNK, 's-smoke', 'up-1', payload);
  const decoded = decodeFrame(encoded);
  if (!decoded
    || decoded.kind !== WS_BIN_KIND.UPLOAD_CHUNK
    || decoded.sessionId !== 's-smoke'
    || decoded.transferId !== 'up-1'
    || decoded.payload.length !== 1024) {
    throw new Error('binary frame round-trip failed');
  }
  if (TRANSFER_CHUNK_SIZE < 256 * 1024) {
    throw new Error('expected TRANSFER_CHUNK_SIZE >= 256KiB');
  }

  // Live WS: auth + send a binary upload chunk against unknown transfer (expect JSON error result)
  const port = 3102;
  const child = startServer({
    PORT: String(port),
    HOST: '127.0.0.1',
    NOE_SSH_MODE: 'portable',
    NOE_SSH_ACCESS_TOKEN: TOKEN,
    NOE_SSH_DATA_DIR: path.join(os.tmpdir(), `noe-ssh-smoke-bin-${Date.now()}`),
  });

  try {
    await waitReady(port, (d) => d.authRequired);
    const login = await fetchJson(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    });
    const sessionToken = login.data.token;
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${sessionToken}`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('binary WS timeout'));
      }, 5000);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token: sessionToken }));
        const frame = encodeFrame(
          WS_BIN_KIND.UPLOAD_CHUNK,
          's-bin',
          'missing-upload',
          Buffer.from('x'),
        );
        ws.send(frame, { binary: true });
      });
      ws.on('message', (raw, isBinary) => {
        if (isBinary) return;
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'sftp-upload-result' && msg.id === 'missing-upload') {
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      });
      ws.on('error', reject);
    });
    console.log('smoke-test: binary frames OK');
  } finally {
    await kill(child);
  }
}

async function main() {
  await testTokenMode();
  await testUsersMode();
  await testBinaryFrames();
  console.log('smoke-test: OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('smoke-test: FAIL', err);
  process.exit(1);
});
