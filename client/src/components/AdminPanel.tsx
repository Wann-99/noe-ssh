import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, Shield } from 'lucide-react';
import { useAppStore } from '../store/appStore';

type AdminUser = {
  id: number;
  username: string;
  role: 'admin' | 'user';
  disabled: boolean;
  created_at: number;
  updated_at: number;
};

type AuditItem = {
  id: number;
  ts: number;
  username: string | null;
  action: string;
  session_id: string | null;
  target_host: string | null;
  target_user: string | null;
  target_port: number | null;
  path: string | null;
  detail: Record<string, unknown> | null;
  client_ip: string | null;
};

type Summary = {
  byUser: Array<{
    username: string;
    total_events: number;
    connect_count: number;
    last_ts: number;
  }>;
  byHost: Array<{
    target_host: string;
    target_port: number | null;
    username: string;
    connect_count: number;
    last_ts: number;
  }>;
};

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function fmtTime(ts: number | null | undefined) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

function actionLabel(action: string) {
  const map: Record<string, string> = {
    'auth.login': '登录',
    'auth.login_fail': '登录失败',
    'auth.logout': '退出',
    'ssh.connect': 'SSH 连接',
    'ssh.disconnect': 'SSH 断开',
    'sftp.mkdir': '新建目录',
    'sftp.rename': '重命名',
    'sftp.rm': '删除',
    'sftp.upload': '上传',
    'sftp.download': '下载',
    'sftp.preview': '打开编辑',
    'sftp.write': '保存文件',
    'admin.user_create': '创建用户',
    'admin.user_update': '更新用户',
  };
  return map[action] || action;
}

export function AdminPanel() {
  const accessToken = useAppStore((s) => s.accessToken);
  const setShowAdmin = useAppStore((s) => s.setShowAdmin);
  const [tab, setTab] = useState<'users' | 'audit' | 'summary'>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [filterUser, setFilterUser] = useState('');
  const [filterHost, setFilterHost] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [page, setPage] = useState(1);

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');

  const loadUsers = useCallback(async () => {
    const res = await fetch('/api/admin/users', {
      headers: authHeaders(accessToken),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '加载用户失败');
    setUsers(data.users || []);
  }, [accessToken]);

  const loadAudit = useCallback(async () => {
    const qs = new URLSearchParams({
      page: String(page),
      pageSize: '40',
    });
    if (filterUser) qs.set('user', filterUser);
    if (filterHost) qs.set('host', filterHost);
    if (filterAction) qs.set('action', filterAction);
    const res = await fetch(`/api/admin/audit?${qs}`, {
      headers: authHeaders(accessToken),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '加载审计失败');
    setAudit(data.items || []);
    setAuditTotal(data.total || 0);
  }, [accessToken, filterUser, filterHost, filterAction, page]);

  const loadSummary = useCallback(async () => {
    const res = await fetch('/api/admin/audit/summary', {
      headers: authHeaders(accessToken),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '加载概览失败');
    setSummary({ byUser: data.byUser || [], byHost: data.byHost || [] });
  }, [accessToken]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (tab === 'users') await loadUsers();
      else if (tab === 'audit') await loadAudit();
      else await loadSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [tab, loadUsers, loadAudit, loadSummary]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        username: newUsername.trim(),
        password: newPassword,
        role: newRole,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || '创建失败');
      return;
    }
    setNewUsername('');
    setNewPassword('');
    setNewRole('user');
    await loadUsers();
  };

  const patchUser = async (id: number, patch: Record<string, unknown>) => {
    setError('');
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: authHeaders(accessToken),
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || '更新失败');
      return;
    }
    await loadUsers();
  };

  const resetPassword = async (id: number, username: string) => {
    const password = window.prompt(`为用户 ${username} 设置新密码（至少 6 位）`);
    if (!password) return;
    await patchUser(id, { password });
  };

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAdmin(false)}>
          <ArrowLeft size={14} />返回工作台
        </button>
        <div className="admin-title">
          <Shield size={18} />
          <h2>管理后台</h2>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={refresh} disabled={loading}>
          <RefreshCw size={14} />刷新
        </button>
      </div>

      <div className="admin-tabs">
        <button type="button" className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>
          用户管理
        </button>
        <button type="button" className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>
          审计日志
        </button>
        <button type="button" className={tab === 'summary' ? 'active' : ''} onClick={() => setTab('summary')}>
          连接概览
        </button>
      </div>

      {error && <div className="admin-error">{error}</div>}

      {tab === 'users' && (
        <div className="admin-section">
          <form className="admin-create" onSubmit={createUser}>
            <input
              className="input"
              placeholder="新用户名"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              required
            />
            <input
              className="input"
              type="password"
              placeholder="初始密码"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
            />
            <select
              className="input"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as 'user' | 'admin')}
            >
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
            <button type="submit" className="btn btn-primary btn-sm">创建</button>
          </form>

          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>用户名</th>
                <th>角色</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.id}</td>
                  <td>{u.username}</td>
                  <td>{u.role === 'admin' ? '管理员' : '用户'}</td>
                  <td>{u.disabled ? '已禁用' : '正常'}</td>
                  <td>{fmtTime(u.created_at)}</td>
                  <td className="admin-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => patchUser(u.id, { disabled: !u.disabled })}
                    >
                      {u.disabled ? '启用' : '禁用'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => resetPassword(u.id, u.username)}
                    >
                      重置密码
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => patchUser(u.id, { role: u.role === 'admin' ? 'user' : 'admin' })}
                    >
                      {u.role === 'admin' ? '降为用户' : '升为管理员'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'audit' && (
        <div className="admin-section">
          <div className="admin-filters">
            <input
              className="input"
              placeholder="用户"
              value={filterUser}
              onChange={(e) => { setPage(1); setFilterUser(e.target.value); }}
            />
            <input
              className="input"
              placeholder="主机"
              value={filterHost}
              onChange={(e) => { setPage(1); setFilterHost(e.target.value); }}
            />
            <select
              className="input"
              value={filterAction}
              onChange={(e) => { setPage(1); setFilterAction(e.target.value); }}
            >
              <option value="">全部动作</option>
              <option value="auth.login">登录</option>
              <option value="auth.login_fail">登录失败</option>
              <option value="ssh.connect">SSH 连接</option>
              <option value="ssh.disconnect">SSH 断开</option>
              <option value="sftp.mkdir">新建目录</option>
              <option value="sftp.rename">重命名</option>
              <option value="sftp.rm">删除</option>
              <option value="sftp.upload">上传</option>
              <option value="sftp.download">下载</option>
              <option value="sftp.preview">打开编辑</option>
              <option value="sftp.write">保存文件</option>
            </select>
          </div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>用户</th>
                <th>动作</th>
                <th>目标</th>
                <th>路径</th>
                <th>来源 IP</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((row) => (
                <tr key={row.id}>
                  <td>{fmtTime(row.ts)}</td>
                  <td>{row.username || '—'}</td>
                  <td>{actionLabel(row.action)}</td>
                  <td>
                    {row.target_host
                      ? `${row.target_user || '?'}@${row.target_host}:${row.target_port || 22}`
                      : '—'}
                  </td>
                  <td className="admin-path" title={row.path || ''}>
                    {row.path || (row.detail?.from ? `${row.detail.from} → ${row.detail.to}` : '—')}
                  </td>
                  <td>{row.client_ip || '—'}</td>
                </tr>
              ))}
              {audit.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">暂无审计记录</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="admin-pager">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </button>
            <span>
              第 {page} 页 · 共 {auditTotal} 条
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={page * 40 >= auditTotal}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </button>
          </div>
        </div>
      )}

      {tab === 'summary' && summary && (
        <div className="admin-section admin-summary">
          <div>
            <h3>按用户</h3>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>连接次数</th>
                  <th>事件总数</th>
                  <th>最近活动</th>
                </tr>
              </thead>
              <tbody>
                {summary.byUser.map((row) => (
                  <tr key={row.username}>
                    <td>{row.username}</td>
                    <td>{row.connect_count}</td>
                    <td>{row.total_events}</td>
                    <td>{fmtTime(row.last_ts)}</td>
                  </tr>
                ))}
                {summary.byUser.length === 0 && (
                  <tr><td colSpan={4} className="empty">暂无数据</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div>
            <h3>按主机（谁连了哪台）</h3>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>主机</th>
                  <th>连接次数</th>
                  <th>最近连接</th>
                </tr>
              </thead>
              <tbody>
                {summary.byHost.map((row, i) => (
                  <tr key={`${row.username}-${row.target_host}-${row.target_port}-${i}`}>
                    <td>{row.username}</td>
                    <td>{row.target_host}:{row.target_port || 22}</td>
                    <td>{row.connect_count}</td>
                    <td>{fmtTime(row.last_ts)}</td>
                  </tr>
                ))}
                {summary.byHost.length === 0 && (
                  <tr><td colSpan={4} className="empty">暂无数据</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
