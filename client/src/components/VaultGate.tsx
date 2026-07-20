import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { hasVault } from '../lib/crypto';

export function VaultGate({
  mode,
  onDone,
  onCancel,
}: {
  mode: 'unlock' | 'setup';
  onDone: () => void;
  onCancel?: () => void;
}) {
  const setupMaster = useAppStore((s) => s.setupMaster);
  const unlockMaster = useAppStore((s) => s.unlockMaster);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const isSetup = mode === 'setup' || !hasVault();

  useEffect(() => {
    if (!onCancel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (isSetup) {
        if (password.length < 6) {
          setError('主密码至少 6 位');
          return;
        }
        if (password !== confirm) {
          setError('两次输入不一致');
          return;
        }
        await setupMaster(password);
      } else {
        await unlockMaster(password);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : '失败');
    }
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-brand">凭据保险库</div>
        <p className="gate-desc">
          {isSetup
            ? '设置主密码后，保存的密码与私钥将以 AES-GCM 加密存储在本机。'
            : '输入主密码以解锁已保存的连接凭据。'}
        </p>
        <form onSubmit={submit}>
          <input
            type="password"
            className="input"
            placeholder="主密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          {isSetup && (
            <input
              type="password"
              className="input"
              placeholder="确认主密码"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              style={{ marginTop: 10 }}
            />
          )}
          {error && <div className="gate-error">{error}</div>}
          <button type="submit" className="btn btn-primary gate-btn">
            {isSetup ? '创建保险库' : '解锁'}
          </button>
          {onCancel && (
            <button type="button" className="btn btn-ghost gate-btn gate-cancel" onClick={onCancel}>
              返回
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
