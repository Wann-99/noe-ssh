import {
  Code2,
  FolderOpen,
  History,
  LayoutGrid,
  Server,
  Settings,
} from 'lucide-react';
import { useAppStore, type PageId } from '../store/appStore';

// The terminal view is reached via session tabs, so it has no nav entry.
const NAV_ITEMS: Array<{ id: PageId; label: string; icon: typeof LayoutGrid }> = [
  { id: 'hosts', label: '主机', icon: LayoutGrid },
  { id: 'files', label: '文件', icon: FolderOpen },
  { id: 'snippets', label: '片段', icon: Code2 },
  { id: 'server', label: '服务器', icon: Server },
  { id: 'logs', label: '日志', icon: History },
  { id: 'settings', label: '设置', icon: Settings },
];

export function NavRail() {
  const activePage = useAppStore((s) => s.activePage);
  const setActivePage = useAppStore((s) => s.setActivePage);
  const refreshServerInfo = useAppStore((s) => s.refreshServerInfo);
  const serverReady = useAppStore(
    (s) => s.sessions.find((item) => item.id === s.activeSessionId)?.status === 'ready',
  );

  return (
    <nav className="nav-rail" aria-label="主导航">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`nav-item ${activePage === item.id ? 'active' : ''}`}
          aria-current={activePage === item.id ? 'page' : undefined}
          onClick={() => {
            setActivePage(item.id);
            if (item.id === 'server' && serverReady) refreshServerInfo();
          }}
        >
          <item.icon size={17} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
