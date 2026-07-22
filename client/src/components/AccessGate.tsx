import { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Lock, User } from 'lucide-react';
import { useAppStore } from '../store/appStore';

/** Legacy key that previously stored plaintext credentials — always cleared. */
const LEGACY_REMEMBER_KEY = 'noe-ssh-login-remember';

export function AccessGate() {
  const authMode = useAppStore((s) => s.authMode);
  const login = useAppStore((s) => s.login);
  const loginAccess = useAppStore((s) => s.loginAccess);
  const notify = useAppStore((s) => s.notify);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_REMEMBER_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const user = username.trim();
    const secret = authMode === 'users' ? password : token.trim();
    const ok = authMode === 'users'
      ? await login(user, secret)
      : await loginAccess(secret);
    setLoading(false);
    if (!ok) {
      setError(authMode === 'users' ? '用户名或密码错误' : '访问口令无效');
      return;
    }
    // Do not keep secrets in React state after a successful login.
    setPassword('');
    setToken('');
    setShowSecret(false);
  };

  return (
    <div className="gate access-gate">
      <div className="access-gate-bg" aria-hidden>
        <div className="access-gate-orb" />
        <div className="access-gate-servers" />
      </div>

      <div className="gate-card access-gate-card">
        <h1 className="access-gate-brand">Noe-SSH</h1>
        <div className="access-gate-subtitle">
          <span className="access-gate-subtitle-line" />
          <span className="access-gate-subtitle-text">安全的 SSH 连接工具</span>
          <span className="access-gate-subtitle-line" />
        </div>

        <form className="access-gate-form" onSubmit={submit} autoComplete="off">
          {authMode === 'users' ? (
            <>
              <label className="gate-field">
                <User size={17} className="gate-field-icon" aria-hidden />
                <input
                  type="text"
                  className="gate-input"
                  name="noe-ssh-user"
                  placeholder="用户名"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  autoFocus
                />
              </label>
              <label className="gate-field">
                <Lock size={17} className="gate-field-icon" aria-hidden />
                <input
                  type={showSecret ? 'text' : 'password'}
                  className="gate-input"
                  name="noe-ssh-pass"
                  placeholder="密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="gate-field-toggle"
                  onClick={() => setShowSecret((open) => !open)}
                  aria-label={showSecret ? '隐藏密码' : '显示密码'}
                  tabIndex={-1}
                >
                  {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </label>
              <div className="access-gate-options access-gate-options-end">
                <button
                  type="button"
                  className="access-gate-forgot"
                  onClick={() => notify('info', '忘记密码', '请联系管理员重置密码')}
                >
                  忘记密码?
                </button>
              </div>
            </>
          ) : (
            <label className="gate-field">
              <KeyRound size={17} className="gate-field-icon" aria-hidden />
              <input
                type={showSecret ? 'text' : 'password'}
                className="gate-input"
                name="noe-ssh-token"
                placeholder="访问口令"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="new-password"
                autoFocus
              />
              <button
                type="button"
                className="gate-field-toggle"
                onClick={() => setShowSecret((open) => !open)}
                aria-label={showSecret ? '隐藏口令' : '显示口令'}
                tabIndex={-1}
              >
                {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </label>
          )}

          {error && <div className="gate-error">{error}</div>}

          <button type="submit" className="btn btn-primary gate-btn access-gate-btn" disabled={loading}>
            {loading ? '验证中…' : '登录'}
          </button>
        </form>

        <p className="access-gate-copy">© 2024 Noe-SSH. All rights reserved.</p>
      </div>
    </div>
  );
}
