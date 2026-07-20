import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { hasVault } from '../lib/crypto';

export function Header({
  onOpenBg,
  onOpenShortcuts,
  onSetupVault,
}: {
  onOpenBg: () => void;
  onOpenShortcuts: () => void;
  onSetupVault: () => void;
}) {
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const lockVault = useAppStore((s) => s.lockVault);
  const vaultUnlocked = useAppStore((s) => s.vaultUnlocked);
  const sess = sessions.find((s) => s.id === activeSessionId);
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    if (!sess?.connected || !sess.startedAt) {
      setElapsed('');
      return;
    }
    const tick = () => {
      const sec = Math.floor((Date.now() - (sess.startedAt || 0)) / 1000);
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      setElapsed(
        h > 0
          ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
          : `${m}:${String(s).padStart(2, '0')}`,
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sess?.connected, sess?.startedAt]);

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" />
        <h1>Noe-SSH</h1>
      </div>
      <div className={`status-dot ${sess?.connected ? 'on' : ''} ${sess?.connecting ? 'pending' : ''}`} />
      <span className="status-text">
        {sess?.connecting ? '连接中…' : sess?.connected ? '已连接' : '未连接'}
      </span>
      {(sess?.connected || sess?.connecting) && sess?.host && (
        <span className="conn-meta">
          {sess.username}@{sess.host}:{sess.port}
          {elapsed && <span className="timer">{elapsed}</span>}
        </span>
      )}
      <div className="header-actions">
        {hasVault() && vaultUnlocked && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={lockVault} title="锁定保险库">
            锁定
          </button>
        )}
        {!hasVault() && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onSetupVault}>
            保险库
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenShortcuts}>
          快捷键
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenBg}>
          背景
        </button>
      </div>
    </header>
  );
}
