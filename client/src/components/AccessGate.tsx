import { useState } from 'react';
import { useAppStore } from '../store/appStore';

export function AccessGate() {
  const authMode = useAppStore((s) => s.authMode);
  const login = useAppStore((s) => s.login);
  const loginAccess = useAppStore((s) => s.loginAccess);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const ok = authMode === 'users'
      ? await login(username.trim(), password)
      : await loginAccess(token.trim());
    setLoading(false);
    if (!ok) {
      setError(authMode === 'users' ? '用户名或密码错误' : '访问口令无效');
    }
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-brand">Noe-SSH</div>
        <p className="gate-desc">
          {authMode === 'users'
            ? '此实例已启用账号登录，请使用分配的用户名与密码进入。'
            : '此实例已启用访问保护，请输入部署口令后继续。'}
        </p>
        <form onSubmit={submit}>
          {authMode === 'users' ? (
            <>
              <input
                type="text"
                className="input"
                placeholder="用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
              />
              <input
                type="password"
                className="input"
                placeholder="密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                style={{ marginTop: 10 }}
              />
            </>
          ) : (
            <input
              type="password"
              className="input"
              placeholder="访问口令"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoFocus
            />
          )}
          {error && <div className="gate-error">{error}</div>}
          <button type="submit" className="btn btn-primary gate-btn" disabled={loading}>
            {loading ? '验证中…' : '进入'}
          </button>
        </form>
      </div>
    </div>
  );
}
