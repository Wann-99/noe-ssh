const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const pkg = require('../../package.json');

function envFirst(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v) return v;
  }
  return '';
}

const APP_MODE = envFirst('NOE_SSH_MODE', 'SUPER_SSH_MODE');
const ACCESS_TOKEN = envFirst('NOE_SSH_ACCESS_TOKEN', 'SUPER_SSH_ACCESS_TOKEN');

/** In-memory session tokens issued after successful auth (when ACCESS_TOKEN is set). */
const sessions = new Map();

function createSessionToken() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { createdAt: Date.now() });
  return token;
}

function isValidSession(token) {
  if (!ACCESS_TOKEN) return true;
  if (!token) return false;
  if (token === ACCESS_TOKEN) return true;
  return sessions.has(token);
}

function extractBearer(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  if (req.headers['x-access-token']) return String(req.headers['x-access-token']);
  if (req.query && req.query.token) return String(req.query.token);
  const cookie = req.headers.cookie || '';
  const cm = cookie.match(/(?:^|;\s*)(?:noe_ssh_token|super_ssh_token)=([^;]+)/);
  if (cm) return decodeURIComponent(cm[1]);
  return '';
}

function resolveStaticDir() {
  const distClient = path.join(__dirname, '..', '..', 'dist', 'client');
  if (fs.existsSync(path.join(distClient, 'index.html'))) {
    return distClient;
  }
  // Dev fallback: old public or empty placeholder
  const publicDir = path.join(__dirname, '..', '..', 'public');
  return publicDir;
}

function createApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      version: pkg.version,
      mode: APP_MODE || 'server',
      authRequired: Boolean(ACCESS_TOKEN),
    });
  });

  app.get('/api/auth/status', (req, res) => {
    const token = extractBearer(req);
    res.json({
      authRequired: Boolean(ACCESS_TOKEN),
      authenticated: isValidSession(token),
    });
  });

  app.post('/api/auth/login', (req, res) => {
    if (!ACCESS_TOKEN) {
      res.json({ ok: true, token: '', authRequired: false });
      return;
    }
    const provided = (req.body && req.body.token) || '';
    if (provided !== ACCESS_TOKEN) {
      res.status(401).json({ ok: false, error: 'Invalid access token' });
      return;
    }
    const sessionToken = createSessionToken();
    res.setHeader(
      'Set-Cookie',
      `noe_ssh_token=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Strict`,
    );
    res.json({ ok: true, token: sessionToken, authRequired: true });
  });

  const staticDir = resolveStaticDir();
  app.use(express.static(staticDir));

  // SPA fallback
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    const indexPath = path.join(staticDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
      return;
    }
    res.status(404).send('Client not built. Run: npm run build:client');
  });

  return app;
}

module.exports = {
  createApp,
  ACCESS_TOKEN,
  APP_MODE,
  isValidSession,
  extractBearer,
  createSessionToken,
};
