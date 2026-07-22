const { getDb } = require('../db');

/**
 * Persist an audit event. Never throws to callers — failures are logged only.
 * Never pass passwords or private keys in detail.
 */
function record(event = {}) {
  try {
    const db = getDb();
    if (!db) return;

    const ts = event.ts || Date.now();
    const detailJson = event.detail != null
      ? JSON.stringify(event.detail)
      : (event.detail_json || null);

    db.prepare(`
      INSERT INTO audit_events (
        ts, user_id, username, action, session_id,
        target_host, target_user, target_port, path,
        detail_json, client_ip, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ts,
      event.userId ?? event.user_id ?? null,
      event.username ?? null,
      String(event.action || 'unknown'),
      event.sessionId ?? event.session_id ?? null,
      event.targetHost ?? event.target_host ?? null,
      event.targetUser ?? event.target_user ?? null,
      event.targetPort ?? event.target_port ?? null,
      event.path ?? null,
      detailJson,
      event.clientIp ?? event.client_ip ?? null,
      event.userAgent ?? event.user_agent ?? null,
    );
  } catch (err) {
    console.error('audit.record failed:', err.message);
  }
}

function queryAudit({
  user,
  host,
  action,
  from,
  to,
  page = 1,
  pageSize = 50,
} = {}) {
  const db = getDb();
  if (!db) return { total: 0, items: [], page: 1, pageSize };

  const clauses = [];
  const params = [];

  if (user) {
    clauses.push('username LIKE ?');
    params.push(`%${user}%`);
  }
  if (host) {
    clauses.push('target_host LIKE ?');
    params.push(`%${host}%`);
  }
  if (action) {
    clauses.push('action = ?');
    params.push(action);
  }
  if (from) {
    clauses.push('ts >= ?');
    params.push(Number(from));
  }
  if (to) {
    clauses.push('ts <= ?');
    params.push(Number(to));
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_events ${where}`).get(...params).n;
  const size = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const p = Math.max(Number(page) || 1, 1);
  const offset = (p - 1) * size;

  const items = db.prepare(`
    SELECT id, ts, user_id, username, action, session_id,
           target_host, target_user, target_port, path,
           detail_json, client_ip, user_agent
    FROM audit_events
    ${where}
    ORDER BY ts DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...params, size, offset);

  return {
    total,
    page: p,
    pageSize: size,
    items: items.map((row) => ({
      ...row,
      detail: row.detail_json ? safeParse(row.detail_json) : null,
    })),
  };
}

function auditSummary() {
  const db = getDb();
  if (!db) return { byUser: [], byHost: [] };

  const byUser = db.prepare(`
    SELECT username,
           COUNT(*) AS total_events,
           SUM(CASE WHEN action = 'ssh.connect' THEN 1 ELSE 0 END) AS connect_count,
           MAX(ts) AS last_ts
    FROM audit_events
    WHERE username IS NOT NULL
    GROUP BY username
    ORDER BY last_ts DESC
  `).all();

  const byHost = db.prepare(`
    SELECT target_host,
           target_port,
           username,
           COUNT(*) AS connect_count,
           MAX(ts) AS last_ts
    FROM audit_events
    WHERE action = 'ssh.connect' AND target_host IS NOT NULL
    GROUP BY target_host, target_port, username
    ORDER BY last_ts DESC
    LIMIT 200
  `).all();

  return { byUser, byHost };
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

module.exports = {
  record,
  queryAudit,
  auditSummary,
};
