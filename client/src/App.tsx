import { useEffect, useState } from 'react';
import { useAppStore } from './store/appStore';
import { hasVault } from './lib/crypto';
import { Header } from './components/Header';
import { SessionTabs } from './components/SessionTabs';
import { NavRail } from './components/NavRail';
import { HostsPage } from './components/pages/HostsPage';
import { TerminalPage } from './components/pages/TerminalPage';
import { FilesPage } from './components/pages/FilesPage';
import { SnippetsPage } from './components/pages/SnippetsPage';
import { ServerPage } from './components/pages/ServerPage';
import { LogsPage } from './components/pages/LogsPage';
import { SettingsPage } from './components/pages/SettingsPage';
import { AccessGate } from './components/AccessGate';
import { AdminPanel } from './components/AdminPanel';
import { VaultGate } from './components/VaultGate';
import { BgModal } from './components/BgModal';
import { ShortcutsModal } from './components/ShortcutsModal';
import { UpdateModal } from './components/UpdateModal';
import { DetachedEditor } from './components/DetachedEditor';
import { ToastHost } from './components/ToastHost';
import { getDesktopApi, getDetachedEditorId } from './lib/desktop';

export default function App() {
  const detachedEditorId = getDetachedEditorId();
  const init = useAppStore((s) => s.init);
  const authenticated = useAppStore((s) => s.authenticated);
  const authRequired = useAppStore((s) => s.authRequired);
  const showAdmin = useAppStore((s) => s.showAdmin);
  const user = useAppStore((s) => s.user);
  const vaultUnlocked = useAppStore((s) => s.vaultUnlocked);
  const bgUrl = useAppStore((s) => s.bgUrl);
  const bgOpacity = useAppStore((s) => s.bgOpacity);
  const activePage = useAppStore((s) => s.activePage);
  const connectActive = useAppStore((s) => s.connectActive);
  const disconnectActive = useAppStore((s) => s.disconnectActive);
  const [bgOpen, setBgOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [vaultGate, setVaultGate] = useState<'unlock' | 'setup' | null>(hasVault() ? 'unlock' : null);

  useEffect(() => {
    if (detachedEditorId) return;
    init();
    if (hasVault()) setVaultGate('unlock');
  }, [init, detachedEditorId]);

  useEffect(() => {
    if (detachedEditorId) return undefined;
    const api = getDesktopApi();
    if (!api) return undefined;
    return api.updater.onOpen(() => {
      setUpdateOpen(true);
    });
  }, [detachedEditorId]);

  useEffect(() => {
    if (detachedEditorId) return undefined;
    const onPageHide = () => {
      useAppStore.getState().disconnectAll();
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);

    const api = getDesktopApi();
    const offClose = api?.lifecycle?.onWillClose?.(() => {
      // Sessions are dropped on tray hide; reopen lands on a fresh New Tab.
      useAppStore.getState().resetToFreshTab();
    });

    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
      offClose?.();
    };
  }, [detachedEditorId]);

  useEffect(() => {
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new CustomEvent('ssh-layout-resize'));
  }, [activePage]);

  useEffect(() => {
    if (hasVault() && !vaultUnlocked) setVaultGate('unlock');
  }, [vaultUnlocked]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        connectActive();
      }
      if (e.ctrlKey && e.key === 'd') {
        e.preventDefault();
        disconnectActive();
      }
      if (e.key === 'Escape') {
        setBgOpen(false);
        setShortcutsOpen(false);
        setUpdateOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [connectActive, disconnectActive]);

  if (detachedEditorId) {
    return <DetachedEditor />;
  }

  if (authRequired && !authenticated) {
    return (
      <>
        <AccessGate />
        <ToastHost />
      </>
    );
  }

  if (showAdmin && user?.role === 'admin') {
    return (
      <div className="app-shell">
        <AdminPanel />
        <ToastHost />
      </div>
    );
  }

  if (vaultGate === 'unlock' && !vaultUnlocked) {
    return (
      <VaultGate
        mode="unlock"
        onDone={() => setVaultGate(null)}
        onCancel={() => setVaultGate(null)}
      />
    );
  }

  if (vaultGate === 'setup') {
    return (
      <VaultGate
        mode="setup"
        onDone={() => setVaultGate(null)}
        onCancel={() => setVaultGate(null)}
      />
    );
  }

  // bgOpacity = wallpaper visibility through the UI (0–100).
  // Keep the global veil light so panels don't double-darken the photo;
  // panel alpha tracks (100 − opacity) so 80% really looks ~80% see-through.
  const visibility = Math.min(100, Math.max(0, bgOpacity)) / 100;
  const cover = 1 - visibility;
  const veil = Number((cover * 0.22).toFixed(3)); // 80%→0.044, 0%→0.22
  const panelAlpha = Number((0.06 + cover * 0.84).toFixed(3)); // 100%→0.06, 80%→0.228, 0%→0.90
  const chromeAlpha = Number(Math.min(0.92, panelAlpha + 0.04).toFixed(3));
  const glassBlur = Math.round(2 + cover * 14); // 100%→2px, 80%→5px, 0%→16px

  return (
    <div
      className={`app-shell${bgUrl ? ' has-bg' : ''}`}
      style={
        bgUrl
          ? {
              backgroundImage: `linear-gradient(rgba(8,12,16,${veil}), rgba(8,12,16,${veil})), url(${bgUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundAttachment: 'fixed',
              ['--bg-panel-alpha' as string]: String(panelAlpha),
              ['--bg-chrome-alpha' as string]: String(chromeAlpha),
              ['--glass-blur' as string]: `${glassBlur}px`,
            }
          : undefined
      }
    >
      <Header />
      <SessionTabs />
      <div className="app-body">
        <NavRail />
        <main className="page-area">
          {/* Terminal stays mounted (hidden) so xterm buffers survive page switches. */}
          <div className="page-slot" hidden={activePage !== 'terminal'}>
            <TerminalPage visible={activePage === 'terminal'} />
          </div>
          {activePage === 'hosts' && <HostsPage />}
          {activePage === 'files' && <FilesPage />}
          {activePage === 'snippets' && <SnippetsPage />}
          {activePage === 'server' && <ServerPage />}
          {activePage === 'logs' && <LogsPage />}
          {activePage === 'settings' && (
            <SettingsPage
              onOpenBg={() => setBgOpen(true)}
              onOpenShortcuts={() => setShortcutsOpen(true)}
              onSetupVault={() => setVaultGate('setup')}
              onUnlockVault={() => setVaultGate('unlock')}
              onOpenUpdate={() => {
                setUpdateOpen(true);
                void getDesktopApi()?.updater.check();
              }}
            />
          )}
        </main>
      </div>
      {bgOpen && <BgModal onClose={() => setBgOpen(false)} />}
      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
      <UpdateModal open={updateOpen} onClose={() => setUpdateOpen(false)} />
      {!hasVault() && (
        <VaultBanner onSetup={() => setVaultGate('setup')} />
      )}
      <ToastHost />
    </div>
  );
}

function VaultBanner({ onSetup }: { onSetup: () => void }) {
  const [hide, setHide] = useState(localStorage.getItem('ssh_vault_banner_hide') === '1');
  if (hide) return null;
  return (
    <div className="vault-banner">
      <span>建议设置主密码，加密保存的连接凭据</span>
      <button type="button" className="btn btn-primary btn-sm" onClick={onSetup}>设置</button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          localStorage.setItem('ssh_vault_banner_hide', '1');
          setHide(true);
        }}
      >
        稍后
      </button>
    </div>
  );
}
