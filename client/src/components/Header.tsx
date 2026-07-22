import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronRight,
  Image,
  Keyboard,
  LockKeyhole,
  LogOut,
  Fullscreen,
  Minimize2,
  Settings,
  Shield,
  ShieldCheck,
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { hasVault } from '../lib/crypto';

type MenuSection = 'settings' | 'security' | null;

function isDocumentFullscreen() {
  return Boolean(document.fullscreenElement);
}

async function toggleDocumentFullscreen() {
  if (isDocumentFullscreen()) {
    await document.exitFullscreen();
    return;
  }
  await document.documentElement.requestFullscreen();
}

export function Header({
  onOpenBg,
  onOpenShortcuts,
  onSetupVault,
  onUnlockVault,
}: {
  onOpenBg: () => void;
  onOpenShortcuts: () => void;
  onSetupVault: () => void;
  onUnlockVault: () => void;
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
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [menuSection, setMenuSection] = useState<MenuSection>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userBtnRef = useRef<HTMLButtonElement>(null);

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

  useEffect(() => {
    const sync = () => setFullscreen(isDocumentFullscreen());
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  useLayoutEffect(() => {
    if (!userMenuOpen || !userBtnRef.current) return;
    const place = () => {
      const rect = userBtnRef.current!.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 6,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [userMenuOpen, menuSection]);

  useEffect(() => {
    if (!userMenuOpen) {
      setMenuSection(null);
      return;
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (userMenuRef.current?.contains(target) || userBtnRef.current?.contains(target)) return;
      setUserMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setUserMenuOpen(false);
    };
    const raf = requestAnimationFrame(() => {
      window.addEventListener('pointerdown', onPointer);
    });
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [userMenuOpen]);

  const statusLabel = sess?.status === 'connecting'
    ? '连接中'
    : sess?.status === 'disconnecting'
      ? '断开中'
      : sess?.status === 'ready'
        ? '已连接'
        : sess?.status === 'error'
          ? '连接异常'
          : '未连接';

  const closeMenu = () => setUserMenuOpen(false);
  const toggleSection = (section: Exclude<MenuSection, null>) => {
    setMenuSection((cur) => (cur === section ? null : section));
  };

  const menu = userMenuOpen && createPortal(
    <div
      ref={userMenuRef}
      className="header-user-dropdown"
      role="menu"
      style={{ top: menuPos.top, right: menuPos.right }}
    >
      {user && (
        <div className="menu-user-card">
          <span className="header-user-avatar menu-user-avatar" aria-hidden>
            {user.username.slice(0, 1).toUpperCase()}
          </span>
          <div className="menu-user-meta">
            <div className="menu-user-name">{user.username}</div>
            <div className="menu-user-role">{user.role === 'admin' ? '管理员' : '用户'}</div>
          </div>
        </div>
      )}

      <button
        type="button"
        role="menuitem"
        className="menu-group-toggle"
        aria-expanded={menuSection === 'settings'}
        onClick={() => toggleSection('settings')}
      >
        <Settings size={14} />
        <span>设置</span>
        {menuSection === 'settings' ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {menuSection === 'settings' && (
        <div className="menu-sub">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu();
              onOpenShortcuts();
            }}
          >
            <Keyboard size={14} />快捷键
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu();
              onOpenBg();
            }}
          >
            <Image size={14} />背景
          </button>
        </div>
      )}

      <button
        type="button"
        role="menuitem"
        className="menu-group-toggle"
        aria-expanded={menuSection === 'security'}
        onClick={() => toggleSection('security')}
      >
        <ShieldCheck size={14} />
        <span>安全</span>
        {menuSection === 'security' ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {menuSection === 'security' && (
        <div className="menu-sub">
          {!hasVault() && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu();
                onSetupVault();
              }}
            >
              <ShieldCheck size={14} />密码库
            </button>
          )}
          {hasVault() && vaultUnlocked && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu();
                lockVault();
              }}
            >
              <LockKeyhole size={14} />锁定密码库
            </button>
          )}
          {hasVault() && !vaultUnlocked && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu();
                onUnlockVault();
              }}
            >
              <LockKeyhole size={14} />解锁密码库
            </button>
          )}
        </div>
      )}

      {user?.role === 'admin' && (
        <>
          <div className="menu-sep" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu();
              setShowAdmin(true);
            }}
          >
            <Shield size={14} />管理后台
          </button>
        </>
      )}
      {authRequired && (
        <>
          <div className="menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              closeMenu();
              void logout();
            }}
          >
            <LogOut size={14} />退出
          </button>
        </>
      )}
    </div>,
    document.body,
  );

  return (
    <header className="header">
      <div className="brand">
        <img src="/logo.png" alt="" className="brand-mark" width={28} height={28} />
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
        <button
          type="button"
          className="btn btn-ghost btn-sm header-icon-btn"
          title={fullscreen ? '退出全屏' : '进入全屏'}
          aria-label={fullscreen ? '退出全屏' : '进入全屏'}
          onClick={() => {
            void toggleDocumentFullscreen().catch(() => {
              /* browser may deny fullscreen without gesture / policy */
            });
          }}
        >
          {fullscreen ? <Minimize2 size={16} /> : <Fullscreen size={16} />}
        </button>

        <div className="header-user-menu">
          <button
            ref={userBtnRef}
            type="button"
            className={`header-user header-user-avatar-only ${userMenuOpen ? 'open' : ''}`}
            title={user ? user.username : '菜单'}
            aria-label={user ? `用户 ${user.username}` : '菜单'}
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            onClick={() => setUserMenuOpen((open) => !open)}
          >
            <span className="header-user-avatar" aria-hidden>
              {user ? user.username.slice(0, 1).toUpperCase() : '设'}
            </span>
            <ChevronDown size={14} className="header-user-caret" aria-hidden />
          </button>
          {menu}
        </div>
      </div>
    </header>
  );
}
