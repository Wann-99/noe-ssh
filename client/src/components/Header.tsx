import { useEffect, useState } from 'react';
import { Image, Keyboard, LockKeyhole, LogOut, Shield, ShieldCheck } from 'lucide-react';
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
  const user = useAppStore((s) => s.user);
  const authRequired = useAppStore((s) => s.authRequired);
  const logout = useAppStore((s) => s.logout);
  const setShowAdmin = useAppStore((s) => s.setShowAdmin);
  const sess = sessions.find((s) => s.id === activeSessionId);
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    if (sess?.status !== 'ready' || !sess.startedAt) {
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
  }, [sess?.status, sess?.startedAt]);

  const statusLabel = sess?.status === 'connecting'
    ? '连接中'
    : sess?.status === 'disconnecting'
      ? '断开中'
      : sess?.status === 'ready'
        ? '已连接'
        : sess?.status === 'error'
          ? '连接异常'
          : '未连接';

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" />
        <h1>Noe-SSH</h1>
      </div>
      <div className={`connection-pill status-${sess?.status || 'idle'}`} title={sess?.error || statusLabel}>
        <span className="status-dot" />
        <span>{statusLabel}</span>
      </div>
      {sess?.status === 'ready' && (
        <div className={`sftp-pill sftp-${sess.sftpStatus}`}>
          SFTP {sess.sftpStatus === 'ready' ? '就绪' : sess.sftpStatus === 'connecting' ? '连接中' : '不可用'}
        </div>
      )}
      {['ready', 'connecting', 'disconnecting'].includes(sess?.status || '') && sess?.host && (
        <span className="conn-meta">
          {sess.username}@{sess.host}:{sess.port}
          {elapsed && <span className="timer">{elapsed}</span>}
        </span>
      )}
      <div className="header-actions">
        {user && (
          <span className="header-user" title={user.role === 'admin' ? '管理员' : '用户'}>
            {user.username}
          </span>
        )}
        {user?.role === 'admin' && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAdmin(true)}>
            <Shield size={14} />管理后台
          </button>
        )}
        {hasVault() && vaultUnlocked && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={lockVault} title="锁定保险库">
            <LockKeyhole size={14} />锁定
          </button>
        )}
        {!hasVault() && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onSetupVault}>
            <ShieldCheck size={14} />保险库
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenShortcuts}>
          <Keyboard size={14} />快捷键
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenBg}>
          <Image size={14} />背景
        </button>
        {authRequired && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => logout()}>
            <LogOut size={14} />退出
          </button>
        )}
      </div>
    </header>
  );
}
