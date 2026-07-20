/**
 * Minimal smoke test: health + WS auth gate + multi-session message shape.
 * Does not require a real SSH host.
 */
import http from 'http';
import { spawn } from 'child_process';
import WebSocket from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3099;
const TOKEN = 'smoke-secret-token';

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json();
  return { status: res.status, data };
}

async function main() {
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      NOE_SSH_ACCESS_TOKEN: TOKEN,
      NOE_SSH_MODE: 'portable',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let ready = false;
  for (let i = 0; i < 40; i += 1) {
    try {
      const { data } = await fetchJson(`http://127.0.0.1:${PORT}/api/health`);
      if (data.ok && data.authRequired) {
        ready = true;
        break;
      }
    } catch {
      /* retry */
    }
    await wait(150);
  }

  if (!ready) {
    child.kill();
    throw new Error('Server failed to become ready');
  }

  const badLogin = await fetchJson(`http://127.0.0.1:${PORT}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'wrong' }),
  });
  if (badLogin.status !== 401) throw new Error('Expected 401 for bad token');

  const goodLogin = await fetchJson(`http://127.0.0.1:${PORT}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN }),
  });
  if (!goodLogin.data.ok || !goodLogin.data.token) throw new Error('Login failed');

  const sessionToken = goodLogin.data.token;

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}?token=${sessionToken}`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('WS timeout'));
    }, 5000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: sessionToken }));
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'auth-ok' || msg.type === 'auth-required') {
        // send a connect that will fail quickly (no host) — still validates multi-session field
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
        clearTimeout(timer);
        ws.close();
        resolve();
      }
    });

    ws.on('error', reject);
  });

  try { child.kill('SIGTERM'); } catch { /* ignore sandbox kill restrictions */ }
  console.log('smoke-test: OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('smoke-test: FAIL', err);
  process.exit(1);
});
