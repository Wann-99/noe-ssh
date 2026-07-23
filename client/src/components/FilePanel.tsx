import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUp,
  Download,
  Eye,
  File,
  FileCode2,
  FileJson,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import type { RemoteFile } from '@shared/protocol';
import { useAppStore } from '../store/appStore';
import {
  COL_GAP,
  COL_MIN,
  DEFAULT_COLS,
  type PreferredCols,
  allocateColumns,
  clampRange,
  loadColumnView,
  maxExclusiveWidth,
  measureLongestNameWidth,
  saveColumnView,
  viewStorageKey,
} from '../lib/fileListColumns';

type ColKey = 'name' | 'size' | 'time';

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

/** year/mon/day，例如 2024/12/09 */
function formatDateYmd(ms: number) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
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

function fileIcon(file: RemoteFile) {
  if (file.isDir) return <Folder size={16} />;
  const ext = file.filename.toLowerCase().split('.').pop() || '';
  if (ext === 'json' || ext === 'jsonc') return <FileJson size={16} />;
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'sh', 'sql', 'html', 'css'].includes(ext)) {
    return <FileCode2 size={16} />;
  }
  if (['md', 'txt', 'log', 'yaml', 'yml', 'xml', 'ini', 'conf'].includes(ext)) {
    return <FileText size={16} />;
  }
  return <File size={16} />;
}

type DialogType = 'mkdir' | 'create' | 'rename' | 'delete';
type DialogState = {
  type: DialogType;
  file?: RemoteFile;
  value: string;
} | null;

export function FilePanel() {
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const listFiles = useAppStore((s) => s.listFiles);
  const mkdir = useAppStore((s) => s.mkdir);
  const createFile = useAppStore((s) => s.createFile);
  const rename = useAppStore((s) => s.rename);
  const removePath = useAppStore((s) => s.removePath);
  const previewFile = useAppStore((s) => s.previewFile);
  const uploadFiles = useAppStore((s) => s.uploadFiles);
  const downloadFile = useAppStore((s) => s.downloadFile);
  const sess = sessions.find((s) => s.id === activeSessionId);
  const [filter, setFilter] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [sort, setSort] = useState<'name' | 'size' | 'mtime'>('name');
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: RemoteFile } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [panelW, setPanelW] = useState(360);
  const [nameFont, setNameFont] = useState('13px sans-serif');
  const dragDepth = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const preferredRef = useRef<PreferredCols>({ ...DEFAULT_COLS });

  const remotePath = sess?.remotePath || '/';
  const colsKey = viewStorageKey(sess?.host, remotePath);
  const [preferred, setPreferred] = useState<PreferredCols>(() => loadColumnView(colsKey));
  preferredRef.current = preferred;

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

  const allocated = useMemo(
    () => allocateColumns(panelW, preferred),
    [panelW, preferred],
  );

  useEffect(() => {
    setPreferred(loadColumnView(colsKey));
  }, [colsKey]);

  const persistPreferred = useCallback((cols: PreferredCols) => {
    saveColumnView(colsKey, cols);
  }, [colsKey]);

  const onColResizeStart = useCallback((key: ColKey, event: React.PointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const list = listRef.current;
    if (!list) return;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('fp-col-resizing');
    // Freeze sibling widths for the whole drag so other dividers stay put.
    const frozen = { ...preferredRef.current };

    const onMove = (ev: PointerEvent) => {
      const header = list.querySelector('.fp-list-header') as HTMLElement | null;
      const rect = (header ?? list).getBoundingClientRect();
      const styles = header ? getComputedStyle(header) : null;
      const padLeft = styles ? Number.parseFloat(styles.paddingLeft) || 0 : 0;
      const contentW = header?.clientWidth ?? list.clientWidth;
      const fromLeft = Math.max(0, ev.clientX - rect.left - padLeft);
      if (contentW > 0) setPanelW(contentW);

      setPreferred(() => {
        // 只改当前列；其它列保持拖拽开始时的宽度
        const next: PreferredCols = { ...frozen };
        if (key === 'name') {
          next.name = clampRange(
            fromLeft,
            COL_MIN.name,
            maxExclusiveWidth(contentW, 'name', frozen),
          );
        } else if (key === 'size') {
          // 大小列左缘 = name + gap
          const size = fromLeft - frozen.name - COL_GAP;
          next.size = clampRange(
            size,
            COL_MIN.size,
            maxExclusiveWidth(contentW, 'size', frozen),
          );
        } else {
          // 时间列左缘 = name + gap + size + gap
          const time = fromLeft - frozen.name - COL_GAP - frozen.size - COL_GAP;
          next.time = clampRange(
            time,
            COL_MIN.time,
            maxExclusiveWidth(contentW, 'time', frozen),
          );
        }
        preferredRef.current = next;
        return next;
      });
    };

    const onUp = (ev: PointerEvent) => {
      try {
        handle.releasePointerCapture(ev.pointerId);
      } catch {
        /* already released */
      }
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('fp-col-resizing');
      persistPreferred(preferredRef.current);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }, [persistPreferred]);

  const autosizeNameColumn = useCallback(() => {
    const list = listRef.current;
    const header = list?.querySelector('.fp-list-header') as HTMLElement | null;
    const width = header?.clientWidth || list?.clientWidth || panelW;
    const longest = measureLongestNameWidth(files.map((f) => f.filename), nameFont);
    const next: PreferredCols = {
      ...preferredRef.current,
      name: clampRange(
        longest,
        COL_MIN.name,
        maxExclusiveWidth(width, 'name', preferredRef.current),
      ),
    };
    setPreferred(next);
    preferredRef.current = next;
    persistPreferred(next);
  }, [files, nameFont, panelW, persistPreferred]);

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
  const connected = sess?.status === 'ready';
  const ready = connected && sess?.sftpStatus === 'ready';

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const header = list.querySelector('.fp-list-header') as HTMLElement | null;
      const sample = list.querySelector('.fp-name') as HTMLElement | null;
      const width = header?.clientWidth || list.clientWidth;
      if (width > 0) setPanelW(width);
      if (sample) {
        const cs = getComputedStyle(sample);
        setNameFont(`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`);
      }
    };

    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(list);
    return () => ro.disconnect();
  }, [files.length, connected]);

  useEffect(() => {
    setSelected(null);
    setContextMenu(null);
  }, [remotePath, activeSessionId]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    // Defer so the opening click/pointerdown does not immediately dismiss the menu.
    const raf = requestAnimationFrame(() => {
      window.addEventListener('pointerdown', close);
    });
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  const openFile = (file: RemoteFile) => {
    const full = `${remotePath}/${file.filename}`.replace(/\/+/g, '/');
    if (file.isDir) listFiles(full);
    else previewFile(full);
  };

  const openDialog = (type: DialogType, file?: RemoteFile) => {
    setContextMenu(null);
    setDialog({ type, file, value: file?.filename || '' });
  };

  const submitDialog = () => {
    if (!dialog) return;
    const value = dialog.value.trim();
    if (dialog.type !== 'delete' && (!value || value.includes('/'))) return;
    const oldPath = dialog.file
      ? `${remotePath}/${dialog.file.filename}`.replace(/\/+/g, '/')
      : '';
    if (dialog.type === 'mkdir') mkdir(value);
    if (dialog.type === 'create') createFile(value);
    if (dialog.type === 'rename' && dialog.file && value !== dialog.file.filename) {
      rename(oldPath, `${remotePath}/${value}`.replace(/\/+/g, '/'));
    }
    if (dialog.type === 'delete' && dialog.file) removePath(oldPath);
    setDialog(null);
  };

  return (
    <div className="file-panel">
      <div className="fp-heading">
        <div>
          <strong>远程文件</strong>
          <span>{ready ? `${files.length} 项` : 'SFTP'}</span>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() => listFiles()}
          disabled={!ready || sess?.listLoading}
          title="刷新"
        >
          <RefreshCw size={15} className={sess?.listLoading ? 'spin' : ''} />
        </button>
      </div>
      <div className="fp-nav">
        <button
          type="button"
          className="icon-button fp-up"
          title="返回上级"
          disabled={!ready || atRoot}
          onClick={goUp}
        >
          <ArrowUp size={15} />
        </button>
        <div className="crumbs" title={remotePath}>
          <button
            type="button"
            className={`crumb ${atRoot ? 'current' : ''}`}
            onClick={() => listFiles('/')}
            disabled={!ready}
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
                  disabled={!ready}
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
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!ready || Boolean(sess?.fileOperation)}
            onClick={() => openDialog('create')}
          >
            <FilePlus2 size={14} /> 文件
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!ready || Boolean(sess?.fileOperation)}
            onClick={() => openDialog('mkdir')}
          >
            <FolderPlus size={14} /> 文件夹
          </button>
          <label className={`btn btn-ghost btn-sm ${!ready ? 'disabled' : ''}`}>
            <Upload size={14} /> 上传
            <input
              type="file"
              multiple
              hidden
              disabled={!ready}
              onChange={(e) => {
                if (e.target.files?.length) uploadFiles(e.target.files);
              }}
            />
          </label>
        </div>
        <div className="fp-filters">
          <div className="search-field">
            <Search size={14} />
            <input placeholder="筛选文件" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
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
        ref={listRef}
        className="fp-list"
        tabIndex={0}
        style={{
          ['--fp-col-name' as string]: `${allocated.name}px`,
          ['--fp-col-size' as string]: `${allocated.size}px`,
          ['--fp-col-time' as string]: `${allocated.time}px`,
        }}
        onKeyDown={(event) => {
          const file = files.find((item) => item.filename === selected);
          if (!file) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            openFile(file);
          }
          if (event.key === 'F2') {
            event.preventDefault();
            openDialog('rename', file);
          }
          if (event.key === 'Delete') {
            event.preventDefault();
            openDialog('delete', file);
          }
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          if (ready) setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) setDragging(false);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (ready && e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
        }}
      >
        {dragging && (
          <div className="drop-overlay">
            <Upload size={26} />
            <strong>释放以上传到当前目录</strong>
          </div>
        )}
        {!connected ? (
          <div className="empty-state">
            <Folder size={28} />
            <strong>尚未连接服务器</strong>
            <span>建立 SSH 连接后可浏览远程文件</span>
          </div>
        ) : sess?.sftpStatus === 'connecting' ? (
          <div className="empty-state"><span className="loader" />正在建立文件通道…</div>
        ) : sess?.sftpStatus === 'error' ? (
          <div className="empty-state error">
            <Folder size={28} />
            <strong>文件通道不可用</strong>
            <span>{sess.error || 'SFTP 初始化失败，请重新连接'}</span>
          </div>
        ) : sess?.listLoading && sess.files.length === 0 ? (
          <div className="empty-state"><span className="loader" />正在读取目录…</div>
        ) : files.length === 0 ? (
          <div className="empty-state">
            <Folder size={28} />
            <strong>{filter ? '没有匹配的文件' : '此目录为空'}</strong>
          </div>
        ) : (
          <>
            <div className="fp-list-header">
              <span className="fp-col-h fp-col-name">
                名称
                <span
                  className="fp-col-resizer"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="调整名称列宽"
                  title="拖动调整名称列（其它列不动）；双击按最长文件名自适应"
                  onPointerDown={(e) => onColResizeStart('name', e)}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    autosizeNameColumn();
                  }}
                />
              </span>
              <span className="fp-col-h fp-col-size">
                大小
                <span
                  className="fp-col-resizer"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="调整大小列宽"
                  title="拖动：只调整大小列"
                  onPointerDown={(e) => onColResizeStart('size', e)}
                />
              </span>
              <span className="fp-col-h fp-col-time">
                修改时间
                <span
                  className="fp-col-resizer"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="调整时间列宽"
                  title="拖动：调整时间列"
                  onPointerDown={(e) => onColResizeStart('time', e)}
                />
              </span>
              <span className="fp-col-spacer" aria-hidden />
              <span className="fp-col-menu-h" aria-hidden />
            </div>
            {files.map((f) => {
            return (
              <div
                key={f.filename}
                className={`fp-row ${f.isDir ? 'is-dir' : 'is-file'} ${selected === f.filename ? 'selected' : ''}`}
                onClick={() => setSelected(f.filename)}
                onDoubleClick={() => openFile(f)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setSelected(f.filename);
                  setContextMenu({
                    x: Math.max(6, Math.min(event.clientX, window.innerWidth - 190)),
                    y: Math.max(6, Math.min(event.clientY, window.innerHeight - 170)),
                    file: f,
                  });
                }}
              >
                <span
                  className="fp-name"
                  onMouseEnter={(event) => {
                    const text = event.currentTarget.querySelector('.fp-name-text') as HTMLElement | null;
                    if (text && text.scrollWidth > text.clientWidth + 1) {
                      event.currentTarget.title = f.filename;
                    } else {
                      event.currentTarget.removeAttribute('title');
                    }
                  }}
                >
                  <span className="fp-icon" aria-hidden>{fileIcon(f)}</span>
                  <span className="fp-name-text">{f.filename}</span>
                </span>
                <span className="fp-meta fp-meta-size">{f.isDir ? '—' : formatSize(f.size)}</span>
                <span className="fp-meta fp-meta-time" title={`${new Date(f.mtime).toLocaleString()} · ${f.perm}`}>
                  {formatDateYmd(f.mtime)}
                </span>
                <span className="fp-col-spacer" aria-hidden />
                <div className="fp-row-menu">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`打开 ${f.filename} 的操作菜单`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelected(f.filename);
                      const rect = event.currentTarget.getBoundingClientRect();
                      setContextMenu({
                        x: Math.max(6, Math.min(rect.right - 180, window.innerWidth - 190)),
                        y: Math.max(6, Math.min(rect.bottom + 4, window.innerHeight - 170)),
                        file: f,
                      });
                    }}
                  >
                    <MoreHorizontal size={15} />
                  </button>
                </div>
              </div>
            );
          })}
          </>
        )}
      </div>

      {contextMenu && createPortal(
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              const file = contextMenu.file;
              setContextMenu(null);
              openFile(file);
            }}
          >
            {contextMenu.file.isDir ? <Eye size={14} /> : <Pencil size={14} />}
            {contextMenu.file.isDir ? '打开' : '编辑'}
          </button>
          {!contextMenu.file.isDir && (
            <button
              type="button"
              onClick={() => {
                const full = `${remotePath}/${contextMenu.file.filename}`.replace(/\/+/g, '/');
                downloadFile(full);
                setContextMenu(null);
              }}
            >
              <Download size={14} />下载
            </button>
          )}
          <button type="button" onClick={() => openDialog('rename', contextMenu.file)}>
            <Pencil size={14} />重命名
          </button>
          <button type="button" className="danger" onClick={() => openDialog('delete', contextMenu.file)}>
            <Trash2 size={14} />删除
          </button>
        </div>,
        document.body,
      )}

      {dialog && (
        <div className="dialog-backdrop" onMouseDown={() => setDialog(null)}>
          <form
            className="dialog-card"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              submitDialog();
            }}
          >
            <h2>
              {dialog.type === 'create' && '新建文件'}
              {dialog.type === 'mkdir' && '新建文件夹'}
              {dialog.type === 'rename' && '重命名'}
              {dialog.type === 'delete' && '确认删除'}
            </h2>
            {dialog.type === 'delete' ? (
              <p>确定删除“{dialog.file?.filename}”吗？此操作无法撤销。</p>
            ) : (
              <label className="field">
                <span>名称</span>
                <input
                  autoFocus
                  className="input"
                  value={dialog.value}
                  onChange={(event) => setDialog({ ...dialog, value: event.target.value })}
                  onFocus={(event) => {
                    if (dialog.type === 'rename') {
                      const dot = event.currentTarget.value.lastIndexOf('.');
                      event.currentTarget.setSelectionRange(0, dot > 0 ? dot : event.currentTarget.value.length);
                    }
                  }}
                />
                {dialog.value.includes('/') && <small className="field-error">名称不能包含“/”</small>}
              </label>
            )}
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setDialog(null)}>取消</button>
              <button
                type="submit"
                className={`btn ${dialog.type === 'delete' ? 'btn-danger' : 'btn-primary'}`}
                disabled={dialog.type !== 'delete' && (!dialog.value.trim() || dialog.value.includes('/'))}
              >
                {dialog.type === 'delete' ? '删除' : '确认'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
