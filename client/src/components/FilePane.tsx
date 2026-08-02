import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUp,
  ChevronDown,
  Copy,
  Download,
  Eye,
  File,
  FileCode2,
  FileJson,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  Link2,
  Monitor,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Server,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { RemoteFile } from '@shared/protocol';
import { joinRemotePath } from '../lib/remoteFileOps';
import {
  paneCurrentPath,
  paneFiles,
  paneReady,
  useAppStore,
  type PaneSide,
} from '../store/appStore';
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

/** dataTransfer MIME for dragging a row into the opposite pane. */
const PANE_DRAG_MIME = 'application/x-noe-pane-file';

type ColKey = 'name' | 'size' | 'time';

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

function formatDateYmd(ms: number) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

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

type DialogType = 'touch' | 'mkdir' | 'rename' | 'delete';
type DialogState = {
  type: DialogType;
  file?: RemoteFile;
  value: string;
} | null;

/**
 * One side of the dual-pane files page. The target is either the server-local
 * filesystem ('local') or a (possibly hidden dedicated) SSH session.
 */
export function FilePane({ side }: { side: PaneSide }) {
  const otherSide: PaneSide = side === 'left' ? 'right' : 'left';
  const target = useAppStore((s) => s.filesPanes[side].target);
  const isLocal = target === 'local';
  const sess = useAppStore((s) => (
    !isLocal && target ? s.sessions.find((x) => x.id === target) : undefined
  ));
  const localPane = useAppStore((s) => s.localPanes[side]);
  const currentPath = useAppStore((s) => paneCurrentPath(s, side));
  const ready = useAppStore((s) => paneReady(s, side));
  const otherReady = useAppStore((s) => paneReady(s, otherSide));
  const filesRaw = useAppStore((s) => paneFiles(s, side));
  const transfer = useAppStore((s) => s.paneTransfers[side]);
  const savedConnections = useAppStore((s) => s.savedConnections);
  const listPane = useAppStore((s) => s.listPane);
  const setPaneTarget = useAppStore((s) => s.setPaneTarget);
  const openFilesHost = useAppStore((s) => s.openFilesHost);
  const closeFilesTarget = useAppStore((s) => s.closeFilesTarget);
  const connectActive = useAppStore((s) => s.connectActive);
  const paneTouch = useAppStore((s) => s.paneTouch);
  const paneMkdir = useAppStore((s) => s.paneMkdir);
  const paneRename = useAppStore((s) => s.paneRename);
  const paneRemove = useAppStore((s) => s.paneRemove);
  const transferToOtherPane = useAppStore((s) => s.transferToOtherPane);
  const abortPaneTransfer = useAppStore((s) => s.abortPaneTransfer);
  const previewFile = useAppStore((s) => s.previewFile);
  const downloadFile = useAppStore((s) => s.downloadFile);
  const uploadFiles = useAppStore((s) => s.uploadFiles);
  const notify = useAppStore((s) => s.notify);

  const [filter, setFilter] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [sort, setSort] = useState<'name' | 'size' | 'mtime'>('name');
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: RemoteFile } | null>(null);
  const [pickerPos, setPickerPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [panelW, setPanelW] = useState(360);
  const [nameFont, setNameFont] = useState('13px sans-serif');
  const dragDepth = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const preferredRef = useRef<PreferredCols>({ ...DEFAULT_COLS });

  const remotePath = currentPath || '/';
  const listLoading = isLocal ? localPane.listLoading : Boolean(sess?.listLoading);
  const colsKey = viewStorageKey(isLocal ? 'local' : sess?.host, remotePath);
  const [preferred, setPreferred] = useState<PreferredCols>(() => loadColumnView(colsKey));
  preferredRef.current = preferred;

  // Local panes load the server user's home on first show.
  useEffect(() => {
    if (isLocal && !localPane.path && !localPane.listLoading) listPane(side);
  }, [isLocal, localPane.path, localPane.listLoading, listPane, side]);

  const files = useMemo(() => {
    let list = [...filesRaw];
    if (!showHidden) list = list.filter((f) => !f.filename.startsWith('.'));
    if (filter) list = list.filter((f) => f.filename.toLowerCase().includes(filter.toLowerCase()));
    list.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      if (sort === 'size') return b.size - a.size;
      if (sort === 'mtime') return b.mtime - a.mtime;
      return a.filename.localeCompare(b.filename);
    });
    return list;
  }, [filesRaw, filter, showHidden, sort]);

  const allocated = useMemo(() => allocateColumns(panelW, preferred), [panelW, preferred]);

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
        const next: PreferredCols = { ...frozen };
        if (key === 'name') {
          next.name = clampRange(fromLeft, COL_MIN.name, maxExclusiveWidth(contentW, 'name', frozen));
        } else if (key === 'size') {
          const size = fromLeft - frozen.name - COL_GAP;
          next.size = clampRange(size, COL_MIN.size, maxExclusiveWidth(contentW, 'size', frozen));
        } else {
          const time = fromLeft - frozen.name - COL_GAP - frozen.size - COL_GAP;
          next.time = clampRange(time, COL_MIN.time, maxExclusiveWidth(contentW, 'time', frozen));
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
      name: clampRange(longest, COL_MIN.name, maxExclusiveWidth(width, 'name', preferredRef.current)),
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
    listPane(side, p);
  };

  const goUp = () => {
    if (atRoot) return;
    goPath(crumbs.slice(0, -1));
  };

  const openContextMenu = (x: number, y: number, file: RemoteFile) => {
    setContextMenu({
      x: Math.max(6, Math.min(x, window.innerWidth - 200)),
      y: Math.max(6, Math.min(y, window.innerHeight - 280)),
      file,
    });
  };

  const copyPath = (file: RemoteFile) => {
    const full = joinRemotePath(remotePath, file.filename);
    void navigator.clipboard.writeText(full)
      .then(() => notify('success', '已复制路径', full))
      .catch(() => notify('error', '复制路径失败'));
  };

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
  }, [files.length, ready]);

  useEffect(() => {
    setSelected(null);
    setContextMenu(null);
  }, [remotePath, target]);

  useEffect(() => {
    if (!contextMenu && !pickerPos) return undefined;
    const close = () => {
      setContextMenu(null);
      setPickerPos(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const raf = requestAnimationFrame(() => {
      window.addEventListener('pointerdown', close);
    });
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu, pickerPos]);

  const openFile = (file: RemoteFile) => {
    const full = joinRemotePath(remotePath, file.filename);
    if (file.isDir) {
      listPane(side, full);
      return;
    }
    if (isLocal) {
      notify('warning', '本地文件暂不支持在线编辑', '可复制到远程后编辑');
      return;
    }
    listRef.current?.blur();
    previewFile(full, target as string);
  };

  const openDialog = (type: DialogType, file?: RemoteFile) => {
    setContextMenu(null);
    setDialog({ type, file, value: file?.filename || '' });
  };

  const submitDialog = () => {
    if (!dialog) return;
    const value = dialog.value.trim();
    if (dialog.type !== 'delete' && (!value || value.includes('/'))) return;
    const oldPath = dialog.file ? joinRemotePath(remotePath, dialog.file.filename) : '';
    if (dialog.type === 'touch') paneTouch(side, value);
    if (dialog.type === 'mkdir') paneMkdir(side, value);
    if (dialog.type === 'rename' && dialog.file && value !== dialog.file.filename) {
      paneRename(side, oldPath, joinRemotePath(remotePath, value));
    }
    if (dialog.type === 'delete' && dialog.file) paneRemove(side, oldPath);
    setDialog(null);
  };

  const pickTarget = (picked: 'local' | number) => {
    setPickerPos(null);
    if (picked === 'local') setPaneTarget(side, 'local');
    else void openFilesHost(picked, side);
  };

  const targetLabel = isLocal
    ? '本机'
    : sess
      ? `${sess.username}@${sess.host}`
      : '选择目标';

  const hosts = useMemo(
    () => [...savedConnections].sort((a, b) => Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0)),
    [savedConnections],
  );

  const pickerList = (onPick: (picked: 'local' | number) => void) => (
    <>
      <button type="button" className="newtab-item" onClick={() => onPick('local')}>
        <Monitor size={15} aria-hidden />
        <span className="newtab-item-name">本机</span>
        <span className="newtab-item-meta">Noe-SSH 服务所在机器</span>
      </button>
      {hosts.map((c) => {
        const name = String(c.name || `${c.username}@${c.host}`);
        const meta = `${c.username}@${c.host}:${c.port || 22}`;
        return (
          <button
            key={String(c.id)}
            type="button"
            className="newtab-item"
            onClick={() => onPick(c.id as number)}
          >
            <Server size={15} aria-hidden />
            <span className="newtab-item-name">{name}</span>
            <span className="newtab-item-meta">{meta}</span>
          </button>
        );
      })}
    </>
  );

  // ---- No target yet: inline picker ----
  if (!target) {
    return (
      <div className="file-panel fp-pane">
        <div className="fp-pane-empty">
          <span className="files-empty-icon" aria-hidden>
            <HardDrive size={26} />
          </span>
          <strong>选择目标</strong>
          <span>浏览本机或远程主机的文件</span>
          <div className="fp-pane-picklist">{pickerList(pickTarget)}</div>
        </div>
      </div>
    );
  }

  // ---- Remote target that is not ready yet ----
  if (!isLocal && sess && !ready) {
    const connecting = sess.status === 'connecting' || sess.status === 'disconnecting';
    return (
      <div className="file-panel fp-pane">
        <div className="fp-pane-head">
          <span className="files-host-badge" title={`${sess.username}@${sess.host}:${sess.port || 22}`}>
            <HardDrive size={14} aria-hidden />
            {sess.username}@{sess.host}
          </span>
          <span className="spacer" />
          <button type="button" className="icon-button" title="切换目标" onClick={() => closeFilesTarget(side)}>
            <X size={15} />
          </button>
        </div>
        <div className="fp-pane-empty">
          {connecting ? (
            <>
              <span className="loader" />
              <span>正在连接…</span>
            </>
          ) : (
            <>
              <Folder size={26} />
              <strong>连接不可用</strong>
              <span>{sess.error || '文件连接已断开'}</span>
              {sess.hidden && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => { void connectActive(sess.id); }}>
                  重新连接
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="file-panel fp-pane">
      <div className="fp-pane-head">
        <button
          type="button"
          className="files-host-badge fp-target-badge"
          title={isLocal ? '本机（Noe-SSH 服务所在机器）' : `${sess?.username}@${sess?.host}:${sess?.port || 22}`}
          onClick={(event) => {
            event.stopPropagation();
            if (pickerPos) {
              setPickerPos(null);
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            setPickerPos({
              x: Math.max(6, Math.min(rect.left, window.innerWidth - 280)),
              y: rect.bottom + 4,
            });
          }}
        >
          {isLocal ? <Monitor size={14} aria-hidden /> : <HardDrive size={14} aria-hidden />}
          {targetLabel}
          <ChevronDown size={13} aria-hidden />
        </button>
        {sess?.hidden && <span className="files-host-mode">独立连接</span>}
        <span className="spacer" />
        <button
          type="button"
          className="icon-button"
          onClick={() => listPane(side)}
          disabled={!ready || listLoading}
          title="刷新"
        >
          <RefreshCw size={15} className={listLoading ? 'spin' : ''} />
        </button>
        <button type="button" className="icon-button" title="关闭目标" onClick={() => closeFilesTarget(side)}>
          <X size={15} />
        </button>
        {pickerPos && createPortal(
          <div
            className="context-menu fp-target-menu"
            style={{ left: pickerPos.x, top: pickerPos.y }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {pickerList(pickTarget)}
          </div>,
          document.body,
        )}
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
            onClick={() => listPane(side, '/')}
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
            disabled={!ready}
            onClick={() => openDialog('touch')}
          >
            <FilePlus size={14} /> 文件
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!ready}
            onClick={() => openDialog('mkdir')}
          >
            <FolderPlus size={14} /> 文件夹
          </button>
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

      {transfer && (
        <div className="transfer-bar">
          <div className="transfer-label">
            接收 {transfer.file ? `${transfer.file.split('/').pop()} ` : ''}
            {transfer.total > 0
              ? `${Math.min(100, Math.round((transfer.written / transfer.total) * 100))}%`
              : formatSize(transfer.written)}
          </div>
          <div className="transfer-track">
            <div
              className="transfer-fill"
              style={{
                width: transfer.total > 0
                  ? `${Math.min(100, (transfer.written / transfer.total) * 100)}%`
                  : '100%',
              }}
            />
          </div>
          <button
            type="button"
            className="icon-button transfer-abort"
            title="取消传输"
            onClick={() => abortPaneTransfer(side)}
          >
            <X size={13} />
          </button>
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
          const active = document.activeElement as HTMLElement | null;
          if (
            active?.closest('.cm-editor')
            || active?.closest('.editor-float')
            || active?.closest('input, textarea, select, [contenteditable="true"]')
          ) {
            return;
          }
          if (!listRef.current?.contains(active)) return;
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
        onDragOver={(event) => {
          event.preventDefault();
          const isPaneRow = event.dataTransfer.types.includes(PANE_DRAG_MIME);
          event.dataTransfer.dropEffect = isPaneRow || !isLocal ? 'copy' : 'none';
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (!ready) return;
          const payload = event.dataTransfer.getData(PANE_DRAG_MIME);
          if (payload) {
            try {
              const parsed = JSON.parse(payload) as { side: PaneSide; filename: string };
              if (parsed.side !== side) {
                const state = useAppStore.getState();
                const source = paneFiles(state, parsed.side).find((f) => f.filename === parsed.filename);
                if (source) transferToOtherPane(parsed.side, source);
              }
            } catch {
              /* malformed drag payload */
            }
            return;
          }
          // OS files can only drop into a remote pane (browser upload path).
          if (!isLocal && event.dataTransfer.files?.length) {
            void uploadFiles(event.dataTransfer.files, target as string);
          }
        }}
      >
        {dragging && (
          <div className="drop-overlay">
            <Upload size={26} />
            <strong>释放以复制到当前目录</strong>
          </div>
        )}
        {!ready ? (
          <div className="empty-state"><span className="loader" />正在读取目录…</div>
        ) : listLoading && files.length === 0 ? (
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
            {files.map((f) => (
              <div
                key={f.filename}
                className={`fp-row ${f.isDir ? 'is-dir' : 'is-file'} ${selected === f.filename ? 'selected' : ''}`}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(PANE_DRAG_MIME, JSON.stringify({ side, filename: f.filename }));
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => setSelected(f.filename)}
                onDoubleClick={() => openFile(f)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setSelected(f.filename);
                  openContextMenu(event.clientX, event.clientY, f);
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
                      openContextMenu(rect.right - 190, rect.bottom + 4, f);
                    }}
                  >
                    <MoreHorizontal size={15} />
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {contextMenu && createPortal(
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {contextMenu.file && (
            <>
              {!isLocal && (
                <button
                  type="button"
                  onClick={() => {
                    const file = contextMenu.file!;
                    setContextMenu(null);
                    openFile(file);
                  }}
                >
                  {contextMenu.file.isDir ? <Eye size={14} /> : <Pencil size={14} />}
                  {contextMenu.file.isDir ? '打开' : '编辑'}
                </button>
              )}
              {!isLocal && !contextMenu.file.isDir && (
                <button
                  type="button"
                  onClick={() => {
                    const full = joinRemotePath(remotePath, contextMenu.file!.filename);
                    downloadFile(full, target as string);
                    setContextMenu(null);
                  }}
                >
                  <Download size={14} />下载
                </button>
              )}
              <button
                type="button"
                disabled={!otherReady}
                title={otherReady ? '复制到另一侧当前目录' : '另一侧尚未就绪'}
                onClick={() => {
                  transferToOtherPane(side, contextMenu.file!);
                  setContextMenu(null);
                }}
              >
                <Copy size={14} />复制到另一侧
              </button>
              <button
                type="button"
                onClick={() => {
                  copyPath(contextMenu.file!);
                  setContextMenu(null);
                }}
              >
                <Link2 size={14} />复制路径
              </button>
              <button
                type="button"
                onClick={() => {
                  const file = contextMenu.file!;
                  setContextMenu(null);
                  openDialog('rename', file);
                }}
              >
                <Pencil size={14} />重命名
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  const file = contextMenu.file!;
                  setContextMenu(null);
                  openDialog('delete', file);
                }}
              >
                <Trash2 size={14} />删除
              </button>
            </>
          )}
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
              {dialog.type === 'touch' && '新建文件'}
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
