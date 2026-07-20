import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';

export function ConnectForm() {
  const form = useAppStore((s) => s.form);
  const setForm = useAppStore((s) => s.setForm);
  const connectActive = useAppStore((s) => s.connectActive);
  const disconnectActive = useAppStore((s) => s.disconnectActive);
  const saveCurrentConnection = useAppStore((s) => s.saveCurrentConnection);
  const applySavedConnection = useAppStore((s) => s.applySavedConnection);
  const saved = useAppStore((s) => s.savedConnections);
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sess = sessions.find((s) => s.id === activeSessionId);
  const connected = Boolean(sess?.connected);
  const connecting = Boolean(sess?.connecting);

  const [hostOpen, setHostOpen] = useState(false);
  const hostWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!hostWrapRef.current?.contains(e.target as Node)) setHostOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHostOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [hostOpen]);

  const pickSaved = async (id: number) => {
    setHostOpen(false);
    await applySavedConnection(id);
  };

  return (
    <div className="panel connect-form">
      <div className="form-row">
        <label className="field grow">
          <span>主机</span>
          <div className="host-combo" ref={hostWrapRef}>
            <input
              className="input host-combo-input"
              value={form.host}
              onChange={(e) => setForm({ host: e.target.value })}
              placeholder="192.168.1.100"
              autoComplete="off"
            />
            <button
              type="button"
              className={`host-combo-btn ${hostOpen ? 'open' : ''}`}
              title="选择已保存主机"
              aria-label="选择已保存主机"
              aria-expanded={hostOpen}
              disabled={saved.length === 0}
              onClick={() => setHostOpen((v) => !v)}
            >
              ▾
            </button>
            {hostOpen && (
              <div className="host-combo-menu" role="listbox">
                {saved.length === 0 ? (
                  <div className="host-combo-empty">暂无已保存主机</div>
                ) : (
                  saved.map((c) => (
                    <button
                      key={String(c.id)}
                      type="button"
                      className="host-combo-item"
                      role="option"
                      onClick={() => pickSaved(c.id as number)}
                    >
                      <span className="hci-name">{String(c.name || c.host)}</span>
                      <span className="hci-meta">
                        {String(c.username)}@{String(c.host)}:{String(c.port || 22)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </label>
        <label className="field sm">
          <span>端口</span>
          <input className="input" type="number" value={form.port} onChange={(e) => setForm({ port: Number(e.target.value) || 22 })} />
        </label>
      </div>
      <label className="field">
        <span>用户名</span>
        <input className="input" value={form.username} onChange={(e) => setForm({ username: e.target.value })} placeholder="root" />
      </label>

      {form.authMode === 'password' ? (
        <label className="field">
          <span>密码</span>
          <input className="input" type="password" value={form.password} onChange={(e) => setForm({ password: e.target.value })} />
        </label>
      ) : (
        <>
          <label className="field">
            <span>私钥 (PEM)</span>
            <textarea className="input textarea" rows={4} value={form.privateKey} onChange={(e) => setForm({ privateKey: e.target.value })} />
          </label>
          <label className="field">
            <span>密钥口令</span>
            <input className="input" type="password" value={form.passphrase} onChange={(e) => setForm({ passphrase: e.target.value })} />
          </label>
        </>
      )}

      <div className="auth-switch" role="group" aria-label="认证方式">
        <button
          type="button"
          className={form.authMode === 'password' ? 'active' : ''}
          onClick={() => setForm({ authMode: 'password' })}
        >
          密码
        </button>
        <button
          type="button"
          className={form.authMode === 'key' ? 'active' : ''}
          onClick={() => setForm({ authMode: 'key' })}
        >
          密钥
        </button>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={form.x11Forward}
          onChange={(e) => setForm({ x11Forward: e.target.checked })}
        />
        X11 转发（ssh -X）
      </label>
      {form.x11Forward && (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={form.x11Trusted}
              onChange={(e) => setForm({ x11Trusted: e.target.checked })}
            />
            信任 X11（ssh -Y）
          </label>
          <p className="hint">
            远程 GUI 显示在运行 Noe-SSH 的本机显示器上，需本机已设置 DISPLAY。
          </p>
        </>
      )}

      <details className="advanced">
        <summary>代理 / ProxyJump</summary>
        <label className="field">
          <span>代理类型</span>
          <select className="input" value={form.proxyType} onChange={(e) => setForm({ proxyType: e.target.value })}>
            <option value="">无</option>
            <option value="http">HTTP</option>
            <option value="socks5">SOCKS5</option>
          </select>
        </label>
        {form.proxyType && (
          <div className="form-row">
            <label className="field grow">
              <span>代理主机</span>
              <input className="input" value={form.proxyHost} onChange={(e) => setForm({ proxyHost: e.target.value })} />
            </label>
            <label className="field sm">
              <span>端口</span>
              <input className="input" type="number" value={form.proxyPort || ''} onChange={(e) => setForm({ proxyPort: Number(e.target.value) || 0 })} />
            </label>
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={form.useJump} onChange={(e) => setForm({ useJump: e.target.checked })} />
          使用 ProxyJump（一级跳板）
        </label>
        {form.useJump && (
          <>
            <div className="form-row">
              <label className="field grow">
                <span>跳板主机</span>
                <input className="input" value={form.jumpHost} onChange={(e) => setForm({ jumpHost: e.target.value })} />
              </label>
              <label className="field sm">
                <span>端口</span>
                <input className="input" type="number" value={form.jumpPort} onChange={(e) => setForm({ jumpPort: Number(e.target.value) || 22 })} />
              </label>
            </div>
            <label className="field">
              <span>跳板用户</span>
              <input className="input" value={form.jumpUsername} onChange={(e) => setForm({ jumpUsername: e.target.value })} />
            </label>
            <label className="field">
              <span>跳板密码</span>
              <input className="input" type="password" value={form.jumpPassword} onChange={(e) => setForm({ jumpPassword: e.target.value })} />
            </label>
            <label className="field">
              <span>跳板私钥</span>
              <textarea className="input textarea" rows={3} value={form.jumpPrivateKey} onChange={(e) => setForm({ jumpPrivateKey: e.target.value })} />
            </label>
            <p className="hint">启用 Jump 时，代理仅用于连接跳板主机。</p>
          </>
        )}
      </details>

      <div className="form-actions">
        {!connected ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={connecting}
            onClick={() => connectActive()}
          >
            {connecting ? '连接中…' : '连接'}
          </button>
        ) : (
          <button type="button" className="btn btn-danger" onClick={() => disconnectActive()}>断开</button>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            const name = prompt('连接名称', `${form.username}@${form.host}`);
            if (name) saveCurrentConnection(name);
          }}
        >
          保存
        </button>
      </div>
    </div>
  );
}
