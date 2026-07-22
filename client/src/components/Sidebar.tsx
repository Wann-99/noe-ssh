import { useState, type ReactNode } from 'react';
import { Bookmark, Code2, History, Plug, Server } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { ConnectForm } from './ConnectForm';

const TABS = [
  { id: 'connect', label: '连接', icon: Plug },
  { id: 'saved', label: '已保存', icon: Bookmark },
  { id: 'snippets', label: '片段', icon: Code2 },
  { id: 'server', label: '服务器', icon: Server },
  { id: 'log', label: '记录', icon: History },
];

function InfoRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="server-info-row">
      <span className="server-info-label">{label}</span>
      <span className="server-info-value" title={value || '—'}>{value || '—'}</span>
    </div>
  );
}

function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="server-info-section">
      <h3 className="server-info-section-title">{title}</h3>
      <div className="server-info-grid">{children}</div>
    </section>
  );
}

function ServerInfoView({ info }: { info: Record<string, string> }) {
  // Backward compatible: old clients/servers may still send mem/disk/load blobs.
  if (info.mem || info.disk || info.load) {
    return (
      <dl className="server-info">
        {Object.entries(info).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v || '—'}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <div className="server-info-view">
      <InfoSection title="基本信息">
        <InfoRow label="主机" value={info.host} />
        <InfoRow label="系统" value={info.os} />
        <InfoRow label="运行时间" value={info.uptime} />
        <InfoRow label="CPU 核心" value={info.cpu} />
      </InfoSection>
      <InfoSection title="内存">
        <InfoRow label="总量" value={info.memTotal} />
        <InfoRow label="已用" value={info.memUsed} />
        <InfoRow label="空闲" value={info.memFree} />
        <InfoRow label="可用" value={info.memAvailable} />
        <InfoRow label="缓存" value={info.memCache} />
        <InfoRow label="共享" value={info.memShared} />
      </InfoSection>
      <InfoSection title="根分区">
        <InfoRow label="设备" value={info.diskFs} />
        <InfoRow label="容量" value={info.diskSize} />
        <InfoRow label="已用" value={info.diskUsed} />
        <InfoRow label="剩余" value={info.diskAvail} />
        <InfoRow label="使用率" value={info.diskUse} />
        <InfoRow label="挂载点" value={info.diskMount} />
      </InfoSection>
      <InfoSection title="负载">
        <InfoRow label="1 分钟" value={info.load1} />
        <InfoRow label="5 分钟" value={info.load5} />
        <InfoRow label="15 分钟" value={info.load15} />
      </InfoSection>
    </div>
  );
}

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
              if (t.id === 'server' && sess?.status === 'ready') refreshServerInfo();
            }}
          >
            <t.icon size={14} />
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
          <div className="panel panel-snippets">
            {snippets.length === 0 ? (
              <div className="empty">暂无片段，可添加常用命令</div>
            ) : (
              <p className="hint snip-hint">拖拽左侧 ⋮⋮ 可调整顺序</p>
            )}
            <div className="snip-list">
              {snippets.map((s, i) => (
                <div
                  key={`${s.name}::${s.cmd}::${i}`}
                  className={`snippet-item${dragIndex === i ? ' dragging' : ''}${overIndex === i && dragIndex !== i ? ' drag-over' : ''}`}
                  title={s.cmd}
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
                  <span
                    className="snip-handle"
                    title="拖拽排序"
                    draggable
                    onDragStart={(e) => {
                      setDragIndex(i);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(i));
                      const row = (e.currentTarget as HTMLElement).closest('.snippet-item');
                      if (row instanceof HTMLElement) {
                        e.dataTransfer.setDragImage(row, 16, 12);
                      }
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setOverIndex(null);
                    }}
                  >
                    ⋮⋮
                  </span>
                  <div className="snip-main">
                    <div className="snip-name">{s.name}</div>
                    <code className="snip-cmd">{s.cmd}</code>
                  </div>
                  <div className="snip-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => sendInput(`${s.cmd}\n`)}
                      title="发送到终端"
                    >
                      发送
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs snip-del"
                      onClick={() => setSnippets(snippets.filter((_, j) => j !== i))}
                      title="删除"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
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
            {sess?.status !== 'ready' ? (
              <div className="empty">连接后查看服务器信息</div>
            ) : !sess.serverInfo ? (
              <button type="button" className="btn btn-primary" onClick={refreshServerInfo}>刷新</button>
            ) : (
              <div className="card server-card">
                <div className="server-info-head">
                  <span>服务器信息</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={refreshServerInfo}>刷新</button>
                </div>
                <ServerInfoView info={sess.serverInfo} />
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
