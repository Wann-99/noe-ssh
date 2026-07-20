import { useMemo, useState } from 'react';
import { useAppStore } from '../store/appStore';

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

/** Collapse middle crumbs when path is deep: keep root, first, …, last 2 */
function visibleCrumbs(crumbs: string[]) {
  if (crumbs.length <= 4) {
    return crumbs.map((c, i) => ({ type: 'seg' as const, name: c, index: i }));
  }
  return [
    { type: 'seg' as const, name: crumbs[0], index: 0 },
    { type: 'ellipsis' as const, name: '…', index: -1 },
    { type: 'seg' as const, name: crumbs[crumbs.length - 2], index: crumbs.length - 2 },
    { type: 'seg' as const, name: crumbs[crumbs.length - 1], index: crumbs.length - 1 },
  ];
}

export function FilePanel() {
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const listFiles = useAppStore((s) => s.listFiles);
  const mkdir = useAppStore((s) => s.mkdir);
  const rename = useAppStore((s) => s.rename);
  const removePath = useAppStore((s) => s.removePath);
  const previewFile = useAppStore((s) => s.previewFile);
  const uploadFiles = useAppStore((s) => s.uploadFiles);
  const downloadFile = useAppStore((s) => s.downloadFile);
  const sess = sessions.find((s) => s.id === activeSessionId);
  const [filter, setFilter] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [sort, setSort] = useState<'name' | 'size' | 'mtime'>('name');

  const files = useMemo(() => {
    let list = [...(sess?.files || [])];
    if (!showHidden) list = list.filter((f) => !f.filename.startsWith('.'));
    if (filter) list = list.filter((f) => f.filename.toLowerCase().includes(filter.toLowerCase()));
    list.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      if (sort === 'size') return b.size - a.size;
      if (sort === 'mtime') return b.mtime - a.mtime;
      return a.filename.localeCompare(b.filename);
    });
    return list;
  }, [sess?.files, filter, showHidden, sort]);

  const remotePath = sess?.remotePath || '/';
  const crumbs = remotePath.split('/').filter(Boolean);
  const atRoot = crumbs.length === 0;
  const crumbItems = visibleCrumbs(crumbs);

  const goPath = (parts: string[]) => {
    const p = parts.length ? `/${parts.join('/')}` : '/';
    listFiles(p);
  };

  const goUp = () => {
    if (atRoot) return;
    goPath(crumbs.slice(0, -1));
  };

  const progress = sess?.transferProgress;

  return (
    <div className="file-panel">
      <div className="fp-nav">
        <button
          type="button"
          className="fp-up"
          title="返回上级"
          disabled={!sess?.connected || atRoot}
          onClick={goUp}
        >
          ← 上级
        </button>
        <div className="crumbs" title={remotePath}>
          <button
            type="button"
            className={`crumb ${atRoot ? 'current' : ''}`}
            onClick={() => listFiles('/')}
            disabled={!sess?.connected}
          >
            /
          </button>
          {crumbItems.map((item, i) => {
            if (item.type === 'ellipsis') {
              return <span key={`e-${i}`} className="crumb-sep">…</span>;
            }
            const isLast = item.index === crumbs.length - 1;
            return (
              <span key={`${item.name}-${item.index}`} className="crumb-wrap">
                <span className="crumb-sep">/</span>
                <button
                  type="button"
                  className={`crumb ${isLast ? 'current' : ''}`}
                  onClick={() => goPath(crumbs.slice(0, item.index + 1))}
                  disabled={!sess?.connected}
                >
                  {item.name}
                </button>
              </span>
            );
          })}
        </div>
      </div>

      <div className="fp-toolbar">
        <div className="fp-tools">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => listFiles()} disabled={!sess?.connected}>刷新</button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!sess?.connected}
            onClick={() => {
              const name = prompt('文件夹名称');
              if (name) mkdir(name);
            }}
          >
            新建
          </button>
          <label className={`btn btn-ghost btn-sm ${!sess?.connected ? 'disabled' : ''}`}>
            上传
            <input
              type="file"
              multiple
              hidden
              disabled={!sess?.connected}
              onChange={(e) => {
                if (e.target.files?.length) uploadFiles(e.target.files);
              }}
            />
          </label>
        </div>
        <div className="fp-filters">
          <input className="input fp-filter-input" placeholder="筛选文件…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <select className="input fp-sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="name">名称</option>
            <option value="size">大小</option>
            <option value="mtime">时间</option>
          </select>
          <label className="check fp-hidden">
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
            隐藏
          </label>
        </div>
      </div>

      {progress && (
        <div className="transfer-bar">
          <div className="transfer-label">
            {progress.kind === 'up' ? '上传' : '下载'} {Math.min(100, Math.round((progress.written / (progress.total || 1)) * 100))}%
          </div>
          <div className="transfer-track">
            <div
              className="transfer-fill"
              style={{ width: `${Math.min(100, (progress.written / (progress.total || 1)) * 100)}%` }}
            />
          </div>
        </div>
      )}
      <div
        className="fp-list"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
        }}
      >
        {!sess?.connected ? (
          <div className="empty">连接后浏览远程文件</div>
        ) : files.length === 0 ? (
          <div className="empty">空目录</div>
        ) : (
          files.map((f) => {
            const full = `${sess.remotePath}/${f.filename}`.replace(/\/+/g, '/');
            return (
              <div
                key={f.filename}
                className={`fp-row ${f.isDir ? 'is-dir' : 'is-file'}`}
                onDoubleClick={() => {
                  if (f.isDir) listFiles(full);
                  else previewFile(full);
                }}
              >
                <span className="fp-name" title={f.filename}>
                  <span className="fp-icon" aria-hidden>{f.isDir ? '📁' : '📄'}</span>
                  {f.filename}
                </span>
                <span className="fp-meta fp-meta-size">{f.isDir ? '—' : formatSize(f.size)}</span>
                <div className="fp-actions">
                  {!f.isDir && (
                    <>
                      <button type="button" onClick={() => previewFile(full)}>编辑</button>
                      <button type="button" onClick={() => downloadFile(full)}>下载</button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const name = prompt('新名称', f.filename);
                      if (name && name !== f.filename) {
                        rename(full, `${sess.remotePath}/${name}`.replace(/\/+/g, '/'));
                      }
                    }}
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`删除 ${f.filename}?`)) removePath(full);
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
