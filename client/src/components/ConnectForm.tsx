import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Eye, EyeOff } from 'lucide-react';
import { useAppStore } from '../store/appStore';

function SecretInput({
  value,
  onChange,
  autoComplete = 'current-password',
  label,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  label: string;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={`secret-input${disabled ? ' is-locked' : ''}`}>
      <input
        className="input"
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        disabled={disabled}
        readOnly={disabled}
      />
      <button
        type="button"
        className="secret-toggle"
        onClick={() => setVisible((current) => !current)}
        aria-label={`${visible ? '隐藏' : '显示'}${label}`}
        title={`${visible ? '隐藏' : '显示'}${label}`}
        disabled={disabled}
      >
        {visible ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

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
  const connected = sess?.status === 'ready';
  const connecting = sess?.status === 'connecting';
  const disconnecting = sess?.status === 'disconnecting';
  const locked = connected || connecting || disconnecting;

  const [hostOpen, setHostOpen] = useState(false);
  const hostWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (locked) setHostOpen(false);
  }, [locked]);

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
    if (locked) return;
    setHostOpen(false);
    await applySavedConnection(id);
  };

  return (
    <div className={`panel connect-form${locked ? ' is-locked' : ''}`}>
      <div className="form-row">
        <label className="field grow">
          <span>主机</span>
          <div className="host-combo" ref={hostWrapRef}>
            <input
              className="input host-combo-input"
              value={form.host}
              onChange={(e) => setForm({ host: e.target.value })}
              placeholder=""
              autoComplete="off"
              disabled={locked}
              readOnly={locked}
            />
            <button
              type="button"
              className={`host-combo-btn ${hostOpen ? 'open' : ''}`}
              title="选择已保存主机"
              aria-label="选择已保存主机"
              aria-expanded={hostOpen}
              disabled={locked || saved.length === 0}
              onClick={() => setHostOpen((v) => !v)}
            >
              <ChevronDown size={15} />
            </button>
            {hostOpen && !locked && (
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
          <input
            className="input"
            type="number"
            value={form.port}
            onChange={(e) => setForm({ port: Number(e.target.value) || 22 })}
            disabled={locked}
            readOnly={locked}
          />
        </label>
      </div>
      <label className="field">
        <span>用户名</span>
        <input
          className="input"
          value={form.username}
          onChange={(e) => setForm({ username: e.target.value })}
          placeholder=""
          disabled={locked}
          readOnly={locked}
        />
      </label>

      {form.authMode === 'password' ? (
        <label className="field">
          <span>密码</span>
          <SecretInput
            label="密码"
            value={form.password}
            onChange={(password) => setForm({ password })}
            disabled={locked}
          />
        </label>
      ) : (
        <>
          <label className="field">
            <span>私钥 (PEM)</span>
            <textarea
              className="input textarea"
              rows={4}
              value={form.privateKey}
              onChange={(e) => setForm({ privateKey: e.target.value })}
              disabled={locked}
              readOnly={locked}
            />
          </label>
          <label className="field">
            <span>密钥口令</span>
            <SecretInput
              label="密钥口令"
              value={form.passphrase}
              onChange={(passphrase) => setForm({ passphrase })}
              autoComplete="off"
              disabled={locked}
            />
          </label>
        </>
      )}

      <div className="auth-switch" role="group" aria-label="认证方式">
        <button
          type="button"
          className={form.authMode === 'password' ? 'active' : ''}
          onClick={() => setForm({ authMode: 'password' })}
          disabled={locked}
        >
          密码
        </button>
        <button
          type="button"
          className={form.authMode === 'key' ? 'active' : ''}
          onClick={() => setForm({ authMode: 'key' })}
          disabled={locked}
        >
          密钥
        </button>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={form.x11Forward}
          onChange={(e) => setForm({ x11Forward: e.target.checked })}
          disabled={locked}
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
              disabled={locked}
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
          <select
            className="input"
            value={form.proxyType}
            onChange={(e) => setForm({ proxyType: e.target.value })}
            disabled={locked}
          >
            <option value="">无</option>
            <option value="http">HTTP</option>
            <option value="socks5">SOCKS5</option>
          </select>
        </label>
        {form.proxyType && (
          <div className="form-row">
            <label className="field grow">
              <span>代理主机</span>
              <input
                className="input"
                value={form.proxyHost}
                onChange={(e) => setForm({ proxyHost: e.target.value })}
                disabled={locked}
                readOnly={locked}
              />
            </label>
            <label className="field sm">
              <span>端口</span>
              <input
                className="input"
                type="number"
                value={form.proxyPort || ''}
                onChange={(e) => setForm({ proxyPort: Number(e.target.value) || 0 })}
                disabled={locked}
                readOnly={locked}
              />
            </label>
          </div>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={form.useJump}
            onChange={(e) => setForm({ useJump: e.target.checked })}
            disabled={locked}
          />
          使用 ProxyJump（一级跳板）
        </label>
        {form.useJump && (
          <>
            <div className="form-row">
              <label className="field grow">
                <span>跳板主机</span>
                <input
                  className="input"
                  value={form.jumpHost}
                  onChange={(e) => setForm({ jumpHost: e.target.value })}
                  disabled={locked}
                  readOnly={locked}
                />
              </label>
              <label className="field sm">
                <span>端口</span>
                <input
                  className="input"
                  type="number"
                  value={form.jumpPort}
                  onChange={(e) => setForm({ jumpPort: Number(e.target.value) || 22 })}
                  disabled={locked}
                  readOnly={locked}
                />
              </label>
            </div>
            <label className="field">
              <span>跳板用户</span>
              <input
                className="input"
                value={form.jumpUsername}
                onChange={(e) => setForm({ jumpUsername: e.target.value })}
                disabled={locked}
                readOnly={locked}
              />
            </label>
            <label className="field">
              <span>跳板密码</span>
              <SecretInput
                label="跳板密码"
                value={form.jumpPassword}
                onChange={(jumpPassword) => setForm({ jumpPassword })}
                disabled={locked}
              />
            </label>
            <label className="field">
              <span>跳板私钥</span>
              <textarea
                className="input textarea"
                rows={3}
                value={form.jumpPrivateKey}
                onChange={(e) => setForm({ jumpPrivateKey: e.target.value })}
                disabled={locked}
                readOnly={locked}
              />
            </label>
            <label className="field">
              <span>跳板密钥口令</span>
              <SecretInput
                label="跳板密钥口令"
                value={form.jumpPassphrase}
                onChange={(jumpPassphrase) => setForm({ jumpPassphrase })}
                autoComplete="off"
                disabled={locked}
              />
            </label>
            <p className="hint">启用 Jump 时，代理仅用于连接跳板主机。</p>
          </>
        )}
      </details>

      <div className="form-actions">
        {!connected && !disconnecting ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={connecting}
            onClick={() => connectActive()}
          >
            {connecting ? '连接中…' : '连接'}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-danger"
            disabled={disconnecting}
            onClick={() => disconnectActive()}
          >
            {disconnecting ? '断开中…' : '断开'}
          </button>
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
