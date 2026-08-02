import { useMemo, useState } from 'react';
import { Plus, Server } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { HostDrawer } from '../HostDrawer';
import { matchSavedConnection, parseQuickTarget } from '../../lib/quickTarget';

/**
 * Landing shown inside a fresh (never-connected) session tab: a prominent
 * quick-connect search plus the most recently used hosts, Tabby-style.
 */
export function NewTabPage() {
  const saved = useAppStore((s) => s.savedConnections);
  const setForm = useAppStore((s) => s.setForm);
  const resetForm = useAppStore((s) => s.resetForm);
  const setEditingConnection = useAppStore((s) => s.setEditingConnection);
  const connectSaved = useAppStore((s) => s.connectSaved);
  const [query, setQuery] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const recent = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...saved].sort(
      (a, b) => Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0),
    );
    const filtered = q
      ? sorted.filter((c) => (
          `${String(c.name || '')} ${String(c.host)} ${String(c.username)}`
            .toLowerCase()
            .includes(q)
        ))
      : sorted;
    return filtered.slice(0, 8);
  }, [saved, query]);

  const openDrawer = (prefill: boolean) => {
    const target = prefill ? parseQuickTarget(query) : null;
    setEditingConnection(null);
    resetForm();
    if (target) {
      setForm({
        host: target.host,
        port: target.port || 22,
        ...(target.username ? { username: target.username } : {}),
      });
    }
    setDrawerOpen(true);
  };

  const submit = () => {
    const target = parseQuickTarget(query);
    if (!target) return;
    const match = matchSavedConnection(useAppStore.getState().savedConnections, target);
    if (match) {
      void connectSaved(match.id as number);
      return;
    }
    openDrawer(true);
  };

  return (
    <div className="page newtab-page">
      <div className="newtab-inner">
        <input
          className="input newtab-search"
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="搜索主机，或输入 user@hostname 快速连接…"
          aria-label="快速连接"
        />

        <div className="newtab-section-head">
          <span>最近连接</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => openDrawer(false)}
          >
            <Plus size={14} />
            新建主机
          </button>
        </div>

        {recent.length === 0 ? (
          <div className="newtab-empty">
            {saved.length === 0
              ? '还没有已保存的主机，输入 user@host 后回车快速连接'
              : '没有匹配的主机，回车将打开表单补全凭据'}
          </div>
        ) : (
          <div className="newtab-list">
            {recent.map((c) => {
              const id = c.id as number;
              const name = String(c.name || c.host);
              const meta = `${String(c.username)}@${String(c.host)}:${String(c.port || 22)}`;
              return (
                <button
                  key={String(id)}
                  type="button"
                  className="newtab-item"
                  title={`连接 ${meta}`}
                  onClick={() => void connectSaved(id)}
                >
                  <span className="host-card-avatar" aria-hidden>
                    <Server size={16} />
                  </span>
                  <span className="newtab-item-name">{name}</span>
                  <span className="newtab-item-meta">{meta}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {drawerOpen && (
        <HostDrawer
          title="新建主机"
          onClose={() => {
            setEditingConnection(null);
            setDrawerOpen(false);
          }}
        />
      )}
    </div>
  );
}
