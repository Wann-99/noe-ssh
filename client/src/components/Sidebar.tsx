import { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { ConnectForm } from './ConnectForm';

const TABS = [
  { id: 'connect', label: '连接' },
  { id: 'saved', label: '已保存' },
  { id: 'snippets', label: '片段' },
  { id: 'server', label: '服务器' },
  { id: 'log', label: '记录' },
];

export function Sidebar() {
  const tab = useAppStore((s) => s.sidebarTab);
  const setTab = useAppStore((s) => s.setSidebarTab);
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const saved = useAppStore((s) => s.savedConnections);
  const connectSaved = useAppStore((s) => s.connectSaved);
  const deleteSaved = useAppStore((s) => s.deleteSaved);
  const exportConnections = useAppStore((s) => s.exportConnections);
  const importConnections = useAppStore((s) => s.importConnections);
  const snippets = useAppStore((s) => s.snippets);
  const setSnippets = useAppStore((s) => s.setSnippets);
  const sendInput = useAppStore((s) => s.sendInput);
  const runExec = useAppStore((s) => s.runExec);
  const refreshServerInfo = useAppStore((s) => s.refreshServerInfo);
  const sess = sessions.find((s) => s.id === activeSessionId);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const reorderSnippets = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= snippets.length || to >= snippets.length) return;
    const next = [...snippets];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setSnippets(next);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`sidebar-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => {
              setTab(t.id);
              if (t.id === 'server' && sess?.connected) refreshServerInfo();
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="sidebar-body">
        {tab === 'connect' && <ConnectForm />}
        {tab === 'saved' && (
          <div className="panel">
            <div className="panel-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={exportConnections}>导出</button>
              <label className="btn btn-ghost btn-sm">
                导入
                <input
                  type="file"
                  accept="application/json"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importConnections(f);
                  }}
                />
              </label>
            </div>
            {saved.length === 0 ? (
              <div className="empty">暂无已保存连接</div>
            ) : (
              saved.map((c) => (
                <div key={String(c.id)} className="card saved-item" onClick={() => connectSaved(c.id as number)}>
                  <div className="si-name">{String(c.name)}</div>
                  <div className="si-info">{String(c.username)}@{String(c.host)}:{String(c.port)}</div>
                  <button
                    type="button"
                    className="si-del"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSaved(c.id as number);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        )}
        {tab === 'snippets' && (
          <div className="panel">
            {snippets.length === 0 ? (
              <div className="empty">暂无片段，可添加常用命令</div>
            ) : (
              <p className="hint snip-hint">拖拽左侧 ⋮⋮ 可调整顺序</p>
            )}
            {snippets.map((s, i) => (
              <div
                key={`${s.name}::${s.cmd}::${i}`}
                className={`card snippet-item${dragIndex === i ? ' dragging' : ''}${overIndex === i && dragIndex !== i ? ' drag-over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (overIndex !== i) setOverIndex(i);
                }}
                onDragLeave={() => {
                  if (overIndex === i) setOverIndex(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = Number(e.dataTransfer.getData('text/plain'));
                  reorderSnippets(Number.isFinite(from) ? from : (dragIndex ?? -1), i);
                  setDragIndex(null);
                  setOverIndex(null);
                }}
              >
                <div className="snip-head">
                  <span
                    className="snip-handle"
                    title="拖拽排序"
                    draggable
                    onDragStart={(e) => {
                      setDragIndex(i);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(i));
                      const card = (e.currentTarget as HTMLElement).closest('.snippet-item');
                      if (card instanceof HTMLElement) {
                        e.dataTransfer.setDragImage(card, 24, 16);
                      }
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setOverIndex(null);
                    }}
                  >
                    ⋮⋮
                  </span>
                  <div className="snip-name">{s.name}</div>
                </div>
                <code className="snip-cmd">{s.cmd}</code>
                <div className="snip-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => sendInput(`${s.cmd}\n`)}>发送</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => runExec(s.cmd, `snip-${i}`)}>执行</button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setSnippets(snippets.filter((_, j) => j !== i))}
                  >
                    删
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => {
                const name = prompt('片段名称');
                const cmd = prompt('命令');
                if (name && cmd) setSnippets([...snippets, { name, cmd }]);
              }}
            >
              添加片段
            </button>
          </div>
        )}
        {tab === 'server' && (
          <div className="panel">
            {!sess?.connected ? (
              <div className="empty">连接后查看服务器信息</div>
            ) : !sess.serverInfo ? (
              <button type="button" className="btn btn-primary" onClick={refreshServerInfo}>刷新</button>
            ) : (
              <div className="card server-card">
                <dl className="server-info">
                  {Object.entries(sess.serverInfo).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v || '—'}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        )}
        {tab === 'log' && (
          <div className="panel">
            {!sess?.cmdLog.length ? (
              <div className="empty">操作将生成可学习的 SSH 命令</div>
            ) : (
              sess.cmdLog.map((item) => (
                <div
                  key={item.id}
                  className={`card cmd-item cmd-${item.type}`}
                  onClick={() => navigator.clipboard.writeText(item.cmd)}
                  title="点击复制"
                >
                  <div className="cmd-time">{item.time} · {item.desc}</div>
                  <code>{item.cmd}</code>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
