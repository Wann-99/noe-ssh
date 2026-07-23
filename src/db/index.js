const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { hashPassword } = require('./password');

let db = null;
let authMode = 'none'; // 'users' | 'token' | 'none'

function envFirst(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v) return v;
  }
  return '';
}

function dataDir() {
  const configured = envFirst('NOE_SSH_DATA_DIR', 'SUPER_SSH_DATA_DIR');
  if (configured) return path.resolve(configured);

  // Desktop/AppImage/.deb install trees under /opt are not user-writable.
  const mode = envFirst('NOE_SSH_MODE', 'SUPER_SSH_MODE');
  if (mode === 'desktop' || mode === 'portable') {
    const base = process.env.XDG_DATA_HOME
      || (process.platform === 'win32'
        ? path.join(os.homedir(), 'AppData', 'Roaming')
        : process.platform === 'darwin'
          ? path.join(os.homedir(), 'Library', 'Application Support')
          : path.join(os.homedir(), '.local', 'share'));
    return path.join(base, 'noe-ssh');
  }

  return path.resolve(process.cwd(), 'data');
}

function getAuthMode() {
  return authMode;
}

function getDb() {
  return db;
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      session_id TEXT,
      target_host TEXT,
      target_user TEXT,
      target_port INTEGER,
      path TEXT,
      detail_json TEXT,
      client_ip TEXT,
      user_agent TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_events(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_events(username);
    CREATE INDEX IF NOT EXISTS idx_audit_host ON audit_events(target_host);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_events(action);
  `);
}

async function bootstrapAdmin(database) {
  const count = database.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;

  const username = envFirst('NOE_SSH_ADMIN_USER', 'SUPER_SSH_ADMIN_USER') || 'admin';
  const password = envFirst('NOE_SSH_ADMIN_PASSWORD', 'SUPER_SSH_ADMIN_PASSWORD');
  if (!password) {
    throw new Error(
      '账号模式首次启动需要设置 NOE_SSH_ADMIN_PASSWORD 以创建管理员账户',
    );
  }
  const now = Date.now();
  const passwordHash = await hashPassword(password);
  database.prepare(`
    INSERT INTO users (username, password_hash, role, disabled, created_at, updated_at)
    VALUES (?, ?, 'admin', 0, ?, ?)
  `).run(username, passwordHash, now, now);
  console.log(`Noe-SSH: bootstrapped admin user "${username}"`);
}

/**
 * Decide auth mode:
 * - users: NOE_SSH_ADMIN_PASSWORD set, or DB already has users
 * - token: legacy NOE_SSH_ACCESS_TOKEN only
 * - none: no auth (desktop/portable always; server default when unset)
 */
async function initDb() {
  const appMode = envFirst('NOE_SSH_MODE', 'SUPER_SSH_MODE');
  // Desktop / portable: local-only UI — never require app login.
  if (appMode === 'desktop' || appMode === 'portable') {
    authMode = 'none';
    return { authMode, dbPath: null };
  }

  const accessToken = envFirst('NOE_SSH_ACCESS_TOKEN', 'SUPER_SSH_ACCESS_TOKEN');
  const adminPassword = envFirst('NOE_SSH_ADMIN_PASSWORD', 'SUPER_SSH_ADMIN_PASSWORD');
  const forceUsers = envFirst('NOE_SSH_AUTH_MODE') === 'users';

  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'noe-ssh.db');

  // Open DB if users mode is requested or an existing DB with users may exist
  const dbExists = fs.existsSync(dbPath);
  if (forceUsers || adminPassword || dbExists) {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);

    const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    if (userCount === 0) {
      if (adminPassword || forceUsers) {
        await bootstrapAdmin(db);
        authMode = 'users';
      } else if (accessToken) {
        authMode = 'token';
      } else {
        authMode = 'none';
      }
    } else {
      authMode = 'users';
    }
  } else if (accessToken) {
    authMode = 'token';
  } else {
    authMode = 'none';
  }

  return { authMode, dbPath: db ? dbPath : null };
}

function listUsers() {
  return db.prepare(`
    SELECT id, username, role, disabled, created_at, updated_at
    FROM users
    ORDER BY id ASC
  `).all().map((row) => ({
    ...row,
    disabled: Boolean(row.disabled),
  }));
}

function getUserById(id) {
  const row = db.prepare(`
    SELECT id, username, role, disabled, created_at, updated_at, password_hash
    FROM users WHERE id = ?
  `).get(id);
  return row || null;
}

function getUserByUsername(username) {
  const row = db.prepare(`
    SELECT id, username, role, disabled, created_at, updated_at, password_hash
    FROM users WHERE username = ? COLLATE NOCASE
  `).get(username);
  return row || null;
}

async function createUser({ username, password, role = 'user' }) {
  const name = String(username || '').trim();
  if (!name || name.length < 2) throw new Error('用户名至少 2 个字符');
  if (!password || String(password).length < 6) throw new Error('密码至少 6 个字符');
  if (!['admin', 'user'].includes(role)) throw new Error('无效角色');
  const now = Date.now();
  const passwordHash = await hashPassword(password);
  try {
    const info = db.prepare(`
      INSERT INTO users (username, password_hash, role, disabled, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?)
    `).run(name, passwordHash, role, now, now);
    return publicUser(getUserById(info.lastInsertRowid));
  } catch (err) {
    if (/UNIQUE/i.test(err.message)) throw new Error('用户名已存在');
    throw err;
  }
}

async function updateUser(id, patch) {
  const user = getUserById(id);
  if (!user) throw new Error('用户不存在');
  const now = Date.now();
  let role = user.role;
  let disabled = user.disabled;
  let passwordHash = user.password_hash;

  if (patch.role !== undefined) {
    if (!['admin', 'user'].includes(patch.role)) throw new Error('无效角色');
    role = patch.role;
  }
  if (patch.disabled !== undefined) {
    disabled = patch.disabled ? 1 : 0;
  }
  if (patch.password !== undefined && patch.password !== '') {
    if (String(patch.password).length < 6) throw new Error('密码至少 6 个字符');
    passwordHash = await hashPassword(patch.password);
  }

  // Prevent locking out the last admin
  if (user.role === 'admin' && (role !== 'admin' || disabled)) {
    const admins = db.prepare(`
      SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id != ?
    `).get(id).n;
    if (admins === 0) throw new Error('不能禁用或降级最后一个管理员');
  }

  db.prepare(`
    UPDATE users
    SET role = ?, disabled = ?, password_hash = ?, updated_at = ?
    WHERE id = ?
  `).run(role, disabled ? 1 : 0, passwordHash, now, id);

  const updated = getUserById(id);
  delete updated.password_hash;
  return { ...updated, disabled: Boolean(updated.disabled) };
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    disabled: Boolean(row.disabled),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

module.exports = {
  initDb,
  getDb,
  getAuthMode,
  dataDir,
  listUsers,
  getUserById,
  getUserByUsername,
  createUser,
  updateUser,
  publicUser,
};
