import { useEffect, useRef, useState } from 'react';
import { Download, Pencil, Plus, Server, Upload, X } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { HostDrawer } from '../HostDrawer';
import { matchSavedConnection, parseQuickTarget } from '../../lib/quickTarget';

export function HostsPage() {
  const saved = useAppStore((s) => s.savedConnections);
  const setForm = useAppStore((s) => s.setForm);
  const connectSaved = useAppStore((s) => s.connectSaved);
  const applySavedConnection = useAppStore((s) => s.applySavedConnection);
  const setEditingConnection = useAppStore((s) => s.setEditingConnection);
  const resetForm = useAppStore((s) => s.resetForm);
  const deleteSaved = useAppStore((s) => s.deleteSaved);
  const exportConnections = useAppStore((s) => s.exportConnections);
  const importConnections = useAppStore((s) => s.importConnections);
  const setActivePage = useAppStore((s) => s.setActivePage);
  const activeStatus = useAppStore(
    (s) => s.sessions.find((item) => item.id === s.activeSessionId)?.status,
  );

  const [quick, setQuick] = useState('');
  const [modal, setModal] = useState<{ mode: 'new' | 'edit' } | null>(null);
  const prevStatus = useRef(activeStatus);

  // A connection that reaches ready from this page hands off to the terminal.
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = activeStatus;
    if (activeStatus === 'ready' && prev && prev !== 'ready') {
      setActivePage('terminal');
    }
  }, [activeStatus, setActivePage]);

  const quickConnect = () => {
    const target = parseQuickTarget(quick);
    if (!target) return;
    const st = useAppStore.getState();
    // A saved host matching the target carries credentials — connect directly.
    const match = matchSavedConnection(st.savedConnections, target);
    if (match) {
      void connectSaved(match.id as number);
      return;
    }
    // No stored credentials: prefill the drawer so the user can supply them.
    setEditingConnection(null);
    resetForm();
    setForm({
      host: target.host,
      port: target.port || 22,
      ...(target.username ? { username: target.username } : {}),
    });
    setModal({ mode: 'new' });
  };

  const openNew = () => {
    setEditingConnection(null);
    resetForm();
    setModal({ mode: 'new' });
  };

  const editSaved = async (id: number) => {
    const ok = await applySavedConnection(id);
    if (ok) {
      setEditingConnection(id);
      setModal({ mode: 'edit' });
    }
  };

  const closeDrawer = () => {
    setEditingConnection(null);
    setModal(null);
  };

  return (
    <div className="page hosts-page">
      <div className="hosts-quick-bar">
        <input
          className="input hosts-quick-input"
          value={quick}
          onChange={(event) => setQuick(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              quickConnect();
            }
          }}
          placeholder="查找主机，或输入 user@hostname 快速连接…"
          aria-label="快速连接"
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!quick.trim()}
          onClick={quickConnect}
        >
          连接
        </button>
      </div>

      <div className="hosts-toolbar">
        <button type="button" className="btn btn-primary btn-sm" onClick={openNew}>
          <Plus size={14} />
          新建主机
        </button>
        <div className="hosts-toolbar-side">
          <button type="button" className="btn btn-ghost btn-sm" onClick={exportConnections}>
            <Download size={14} />
            导出
          </button>
          <label className="btn btn-ghost btn-sm">
            <Upload size={14} />
            导入
            <input
              type="file"
              accept="application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importConnections(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </div>

      {saved.length === 0 ? (
        <div className="hosts-empty">
          <Server size={40} />
          <h2>还没有已保存的主机</h2>
          <p>使用上方快速连接，或点击「新建主机」保存常用连接。</p>
        </div>
      ) : (
        <div className="host-grid">
          {saved.map((c) => {
            const id = c.id as number;
            const name = String(c.name || c.host);
            const meta = `${String(c.username)}@${String(c.host)}:${String(c.port || 22)}`;
            const tags: string[] = [];
            if (c.privateKey) tags.push('密钥');
            if (c.encrypted) tags.push('加密');
            if (c.proxyType) tags.push(String(c.proxyType).toUpperCase());
            if (c.jumpHost && (c.jumpHost as { host?: string }).host) tags.push('跳板');
            if (c.x11Forward) tags.push('X11');
            return (
              <div
                key={String(id)}
                className="host-card"
                role="button"
                tabIndex={0}
                title={`连接 ${meta}`}
                onClick={() => void connectSaved(id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    void connectSaved(id);
                  }
                }}
              >
                <span className="host-card-avatar" aria-hidden>
                  <Server size={20} />
                </span>
                <div className="host-card-main">
                  <div className="host-card-name">{name}</div>
                  <div className="host-card-meta">{meta}</div>
                  {tags.length > 0 && (
                    <div className="host-card-tags">
                      {tags.map((tag) => (
                        <span key={tag} className="host-card-tag">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="host-card-actions">
                  <button
                    type="button"
                    className="icon-button"
                    title="编辑"
                    aria-label={`编辑 ${name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void editSaved(id);
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button danger"
                    title="删除"
                    aria-label={`删除 ${name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteSaved(id);
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <HostDrawer
          title={modal.mode === 'new' ? '新建主机' : '编辑主机'}
          onClose={closeDrawer}
        />
      )}
    </div>
  );
}
