import { useState } from 'react';
import { useAppStore } from '../store/appStore';

export function AccessGate() {
  const loginAccess = useAppStore((s) => s.loginAccess);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const ok = await loginAccess(token.trim());
    setLoading(false);
    if (!ok) setError('访问口令无效');
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-brand">Noe-SSH</div>
        <p className="gate-desc">此实例已启用访问保护，请输入部署口令后继续。</p>
        <form onSubmit={submit}>
          <input
            type="password"
            className="input"
            placeholder="访问口令"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoFocus
          />
          {error && <div className="gate-error">{error}</div>}
          <button type="submit" className="btn btn-primary gate-btn" disabled={loading}>
            {loading ? '验证中…' : '进入'}
          </button>
        </form>
      </div>
    </div>
  );
}
