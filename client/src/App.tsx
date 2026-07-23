import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from './store/appStore';
import { hasVault } from './lib/crypto';
import { Header } from './components/Header';
import { SessionTabs } from './components/SessionTabs';
import { Sidebar } from './components/Sidebar';
import { Workspace } from './components/Workspace';
import { FilePanel } from './components/FilePanel';
import { AccessGate } from './components/AccessGate';
import { AdminPanel } from './components/AdminPanel';
import { VaultGate } from './components/VaultGate';
import { BgModal } from './components/BgModal';
import { ShortcutsModal } from './components/ShortcutsModal';
import { UpdateModal } from './components/UpdateModal';
import { DetachedEditor } from './components/DetachedEditor';
import { Splitter } from './components/Splitter';
import { ToastHost } from './components/ToastHost';
import { getDesktopApi, getDetachedEditorId } from './lib/desktop';

const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 300;
const FILE_MIN = 260;
const FILE_MAX = 560;
const FILE_DEFAULT = 360;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function loadWidth(key: string, fallback: number, min: number, max: number) {
  const raw = parseInt(localStorage.getItem(key) || '', 10);
  if (!Number.isFinite(raw)) return fallback;
  return clamp(raw, min, max);
}

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
  const filePanelOpen = useAppStore((s) => s.filePanelOpen);
  const connectActive = useAppStore((s) => s.connectActive);
  const disconnectActive = useAppStore((s) => s.disconnectActive);
  const [bgOpen, setBgOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [vaultGate, setVaultGate] = useState<'unlock' | 'setup' | null>(hasVault() ? 'unlock' : null);
  const [sidebarW, setSidebarW] = useState(() =>
    loadWidth('ssh_sidebar_w', SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX));
  const [filePanelW, setFilePanelW] = useState(() =>
    loadWidth('ssh_file_panel_w', FILE_DEFAULT, FILE_MIN, FILE_MAX));
  const sidebarWRef = useRef(sidebarW);
  const filePanelWRef = useRef(filePanelW);
  sidebarWRef.current = sidebarW;
  filePanelWRef.current = filePanelW;

  const onSidebarDrag = useCallback((delta: number) => {
    setSidebarW((prev) => clamp(prev + delta, SIDEBAR_MIN, SIDEBAR_MAX));
  }, []);

  const onFilePanelDrag = useCallback((delta: number) => {
    setFilePanelW((prev) => clamp(prev + delta, FILE_MIN, FILE_MAX));
  }, []);

  const persistSidebar = useCallback(() => {
    localStorage.setItem('ssh_sidebar_w', String(sidebarWRef.current));
  }, []);

  const persistFilePanel = useCallback(() => {
    localStorage.setItem('ssh_file_panel_w', String(filePanelWRef.current));
  }, []);

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
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new CustomEvent('ssh-layout-resize'));
  }, [filePanelOpen, sidebarW, filePanelW]);

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
      <Header
        onOpenBg={() => setBgOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onSetupVault={() => setVaultGate('setup')}
        onUnlockVault={() => setVaultGate('unlock')}
        onOpenUpdate={() => {
          setUpdateOpen(true);
          void getDesktopApi()?.updater.check();
        }}
      />
      <SessionTabs />
      <div className="workspace">
        <aside className="sidebar-shell" style={{ width: sidebarW }}>
          <Sidebar />
        </aside>
        <Splitter
          orientation="vertical"
          onDrag={onSidebarDrag}
          onDragEnd={persistSidebar}
        />
        <div className="main-stage">
          <div className="workbench-pane">
            <Workspace />
          </div>
          {filePanelOpen && (
            <>
              <Splitter
                orientation="vertical"
                reverse
                onDrag={onFilePanelDrag}
                onDragEnd={persistFilePanel}
              />
              <div className="file-pane" style={{ width: filePanelW }}>
                <FilePanel />
              </div>
            </>
          )}
        </div>
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
