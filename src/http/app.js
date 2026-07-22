const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const pkg = require('../../package.json');
const {
  getAuthMode,
  getUserByUsername,
  getUserById,
  listUsers,
  createUser,
  updateUser,
  publicUser,
} = require('../db');
const { verifyPassword } = require('../db/password');
const { record, queryAudit, auditSummary } = require('../audit/logger');

function envFirst(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v) return v;
  }
  return '';
}

const APP_MODE = envFirst('NOE_SSH_MODE', 'SUPER_SSH_MODE');
const ACCESS_TOKEN = envFirst('NOE_SSH_ACCESS_TOKEN', 'SUPER_SSH_ACCESS_TOKEN');
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** @type {Map<string, { userId: number|null, username: string|null, role: string|null, createdAt: number, expiresAt: number }>} */
const sessions = new Map();

function authRequired() {
  const mode = getAuthMode();
  return mode === 'users' || mode === 'token';
}

function createSession({ userId = null, username = null, role = null } = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const createdAt = Date.now();
  sessions.set(token, {
    userId,
    username,
    role,
    createdAt,
    expiresAt: createdAt + SESSION_TTL_MS,
  });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const mode = getAuthMode();
  if (mode === 'none') {
    return { userId: null, username: null, role: null, createdAt: Date.now(), expiresAt: Infinity };
  }
  // Legacy token mode: allow raw ACCESS_TOKEN as a one-shot identity, but prefer issued sessions.
  // Users mode: never accept the shared ACCESS_TOKEN as a long-lived WS/API token.
  if (mode === 'token' && ACCESS_TOKEN && token === ACCESS_TOKEN) {
    return {
      userId: null,
      username: 'token',
      role: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
  }
  const sess = sessions.get(token);
  if (!sess) return null;
  if (sess.expiresAt && Date.now() > sess.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return sess;
}

function isValidSession(token) {
  if (!authRequired()) return true;
  return Boolean(getSession(token));
}

function revokeSession(token) {
  if (token) sessions.delete(token);
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

function clientMeta(req) {
  const xf = req.headers['x-forwarded-for'];
  const clientIp = (typeof xf === 'string' && xf.split(',')[0].trim())
    || req.socket?.remoteAddress
    || null;
  const userAgent = req.headers['user-agent'] || null;
  return { clientIp, userAgent };
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `noe_ssh_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    'noe_ssh_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
  );
}

function resolveStaticDir() {
  const distClient = path.join(__dirname, '..', '..', 'dist', 'client');
  if (fs.existsSync(path.join(distClient, 'index.html'))) {
    return distClient;
  }
  const publicDir = path.join(__dirname, '..', '..', 'public');
  return publicDir;
}

function requireSession(req, res) {
  const token = extractBearer(req);
  const session = getSession(token);
  if (!session) {
    res.status(401).json({ ok: false, error: '未登录或会话已过期' });
    return null;
  }
  return { token, session };
}

function requireAdmin(req, res) {
  if (getAuthMode() !== 'users') {
    res.status(403).json({ ok: false, error: '管理功能仅在账号模式下可用' });
    return null;
  }
  const auth = requireSession(req, res);
  if (!auth) return null;
  if (auth.session.role !== 'admin') {
    res.status(403).json({ ok: false, error: '需要管理员权限' });
    return null;
  }
  return auth;
}

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    const mode = getAuthMode();
    res.json({
      ok: true,
      version: pkg.version,
      mode: APP_MODE || 'server',
      authMode: mode,
      authRequired: authRequired(),
    });
  });

  app.get('/api/auth/status', (req, res) => {
    const token = extractBearer(req);
    const session = getSession(token);
    res.json({
      authMode: getAuthMode(),
      authRequired: authRequired(),
      authenticated: Boolean(session) || !authRequired(),
      user: session && session.userId
        ? { id: session.userId, username: session.username, role: session.role }
        : null,
    });
  });

  app.get('/api/auth/me', (req, res) => {
    if (!authRequired()) {
      res.json({ ok: true, authMode: 'none', user: null });
      return;
    }
    const auth = requireSession(req, res);
    if (!auth) return;
    const { session } = auth;
    let user = null;
    if (session.userId) {
      const row = getUserById(session.userId);
      if (!row || row.disabled) {
        revokeSession(auth.token);
        res.status(401).json({ ok: false, error: '用户已禁用或已删除' });
        return;
      }
      user = { id: row.id, username: row.username, role: row.role };
    }
    res.json({
      ok: true,
      authMode: getAuthMode(),
      user,
    });
  });

  app.post('/api/auth/login', async (req, res) => {
    const mode = getAuthMode();
    const { clientIp, userAgent } = clientMeta(req);

    if (mode === 'none') {
      res.json({ ok: true, token: '', authRequired: false, authMode: 'none', user: null });
      return;
    }

    if (mode === 'token') {
      const provided = (req.body && req.body.token) || '';
      if (!ACCESS_TOKEN || provided !== ACCESS_TOKEN) {
        record({
          action: 'auth.login_fail',
          username: 'token',
          clientIp,
          userAgent,
        });
        res.status(401).json({ ok: false, error: '访问口令无效' });
        return;
      }
      const sessionToken = createSession({ username: 'token', role: null });
      setSessionCookie(res, sessionToken);
      record({
        action: 'auth.login',
        username: 'token',
        clientIp,
        userAgent,
      });
      res.json({
        ok: true,
        token: sessionToken,
        authRequired: true,
        authMode: 'token',
        user: null,
      });
      return;
    }

    // users mode
    const username = String((req.body && req.body.username) || '').trim();
    const password = (req.body && req.body.password) || '';
    if (!username || !password) {
      res.status(400).json({ ok: false, error: '请输入用户名和密码' });
      return;
    }

    const row = getUserByUsername(username);
    if (!row || row.disabled) {
      record({
        action: 'auth.login_fail',
        username,
        clientIp,
        userAgent,
      });
      res.status(401).json({ ok: false, error: '用户名或密码错误' });
      return;
    }

    const ok = await verifyPassword(password, row.password_hash);
    if (!ok) {
      record({
        action: 'auth.login_fail',
        username: row.username,
        userId: row.id,
        clientIp,
        userAgent,
      });
      res.status(401).json({ ok: false, error: '用户名或密码错误' });
      return;
    }

    const sessionToken = createSession({
      userId: row.id,
      username: row.username,
      role: row.role,
    });
    setSessionCookie(res, sessionToken);
    record({
      action: 'auth.login',
      userId: row.id,
      username: row.username,
      clientIp,
      userAgent,
    });
    res.json({
      ok: true,
      token: sessionToken,
      authRequired: true,
      authMode: 'users',
      user: { id: row.id, username: row.username, role: row.role },
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = extractBearer(req);
    const session = getSession(token);
    if (session) {
      record({
        action: 'auth.logout',
        userId: session.userId,
        username: session.username,
        ...clientMeta(req),
      });
    }
    revokeSession(token);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // ---- Admin APIs ----
  app.get('/api/admin/users', (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json({ ok: true, users: listUsers() });
  });

  app.post('/api/admin/users', async (req, res) => {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    try {
      const user = await createUser({
        username: req.body?.username,
        password: req.body?.password,
        role: req.body?.role || 'user',
      });
      record({
        action: 'admin.user_create',
        userId: auth.session.userId,
        username: auth.session.username,
        detail: { targetUsername: user.username, role: user.role },
        ...clientMeta(req),
      });
      res.json({ ok: true, user });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.patch('/api/admin/users/:id', async (req, res) => {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    try {
      const id = Number(req.params.id);
      const user = await updateUser(id, {
        role: req.body?.role,
        disabled: req.body?.disabled,
        password: req.body?.password,
      });
      record({
        action: 'admin.user_update',
        userId: auth.session.userId,
        username: auth.session.username,
        detail: {
          targetId: id,
          role: user.role,
          disabled: user.disabled,
          passwordReset: Boolean(req.body?.password),
        },
        ...clientMeta(req),
      });
      res.json({ ok: true, user });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/admin/audit', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const result = queryAudit({
      user: req.query.user || '',
      host: req.query.host || '',
      action: req.query.action || '',
      from: req.query.from || '',
      to: req.query.to || '',
      page: req.query.page || 1,
      pageSize: req.query.pageSize || 50,
    });
    res.json({ ok: true, ...result });
  });

  app.get('/api/admin/audit/summary', (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json({ ok: true, ...auditSummary() });
  });

  const staticDir = resolveStaticDir();
  app.use(express.static(staticDir));

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
  authRequired,
  isValidSession,
  getSession,
  extractBearer,
  createSession,
  revokeSession,
};
