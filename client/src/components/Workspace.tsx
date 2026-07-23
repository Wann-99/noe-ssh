import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, FileCode2, Files, Plus, Search, TerminalSquare, Trash2, X } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { EditorFloat } from './EditorFloat';
import { TerminalView } from './TerminalView';
import { isDesktopEditorHost, useDesktopEditorWindows } from '../hooks/useDesktopEditorWindows';

export function Workspace() {
  const sessions = useAppStore((state) => state.sessions);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const editors = useAppStore((state) => state.editors);
  const setActiveEditor = useAppStore((state) => state.setActiveEditor);
  const setEditorContent = useAppStore((state) => state.setEditorContent);
  const saveEditor = useAppStore((state) => state.saveEditor);
  const closeEditor = useAppStore((state) => state.closeEditor);
  const minimizeEditor = useAppStore((state) => state.minimizeEditor);
  const restoreEditor = useAppStore((state) => state.restoreEditor);
  const focusEditor = useAppStore((state) => state.focusEditor);
  const setActiveTerminal = useAppStore((state) => state.setActiveTerminal);
  const openTerminal = useAppStore((state) => state.openTerminal);
  const closeTerminal = useAppStore((state) => state.closeTerminal);
  const toggleFilePanel = useAppStore((state) => state.toggleFilePanel);

  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const [stashOpen, setStashOpen] = useState(false);
  const [absorbingId, setAbsorbingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [absorbTarget, setAbsorbTarget] = useState<{ x: number; y: number } | null>(null);
  const [stashPos, setStashPos] = useState<{ top: number; right: number } | null>(null);
  const stashBtnRef = useRef<HTMLButtonElement>(null);
  const stashPanelRef = useRef<HTMLDivElement>(null);

  const session = sessions.find((item) => item.id === activeSessionId);
  const sessionEditors = useMemo(
    () => editors.filter((editor) => editor.sessionId === activeSessionId),
    [editors, activeSessionId],
  );
  /** Keep floats mounted while stashed to avoid remount flash on restore. */
  const floatEditors = useMemo(
    () => [...sessionEditors].sort((a, b) => a.zIndex - b.zIndex),
    [sessionEditors],
  );
  const stashed = useMemo(
    () => sessionEditors.filter((editor) => editor.minimized),
    [sessionEditors],
  );
  const terminals = session?.terminals || [];
  const activeTerminalId = session?.activeTerminalId;

  useLayoutEffect(() => {
    if (!stashOpen || !stashBtnRef.current) {
      setStashPos(null);
      return;
    }
    const place = () => {
      const rect = stashBtnRef.current?.getBoundingClientRect();
      if (!rect) return;
      setStashPos({
        top: rect.bottom + 8,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [stashOpen, stashed.length]);

  useEffect(() => {
    if (!stashOpen) return;
    const onDoc = (event: MouseEvent) => {
      const t = event.target as Node;
      if (stashBtnRef.current?.contains(t) || stashPanelRef.current?.contains(t)) return;
      setStashOpen(false);
    };
    // Use click (not mousedown) so item onClick can fire first.
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [stashOpen]);

  const desktopHost = isDesktopEditorHost();

  const requestClose = useCallback((id: string) => {
    if (!closeEditor(id)) setPendingClose(id);
  }, [closeEditor]);

  useDesktopEditorWindows({ onRequestClose: requestClose });

  const runMinimize = (id: string, _origin: DOMRect) => {
    if (desktopHost) {
      minimizeEditor(id);
      stashBtnRef.current?.classList.add('is-pulse');
      window.setTimeout(() => stashBtnRef.current?.classList.remove('is-pulse'), 420);
      return;
    }
    const btn = stashBtnRef.current?.getBoundingClientRect();
    if (btn) {
      setAbsorbTarget({ x: btn.left + btn.width / 2, y: btn.top + btn.height / 2 });
    }
    setAbsorbingId(id);
    window.setTimeout(() => {
      minimizeEditor(id);
      setAbsorbingId(null);
      setAbsorbTarget(null);
      stashBtnRef.current?.classList.add('is-pulse');
      window.setTimeout(() => stashBtnRef.current?.classList.remove('is-pulse'), 420);
    }, 320);
  };

  const runRestore = (id: string) => {
    if (desktopHost) {
      restoreEditor(id);
      setStashOpen(false);
      stashBtnRef.current?.classList.add('is-pulse');
      window.setTimeout(() => stashBtnRef.current?.classList.remove('is-pulse'), 420);
      return;
    }
    const btn = stashBtnRef.current?.getBoundingClientRect();
    if (btn) {
      setAbsorbTarget({ x: btn.left + btn.width / 2, y: btn.top + btn.height / 2 });
    }
    setRestoringId(id);
    restoreEditor(id);
    setStashOpen(false);
    stashBtnRef.current?.classList.add('is-pulse');
    window.setTimeout(() => stashBtnRef.current?.classList.remove('is-pulse'), 420);
    window.setTimeout(() => {
      setRestoringId(null);
      setAbsorbTarget(null);
    }, 340);
  };

  return (
    <section className="workbench">
      <div className="workbench-tabs" role="tablist" aria-label="工作区">
        {terminals.map((pane) => {
          const active = pane.id === activeTerminalId;
          const label = terminals.length === 1 ? '终端' : pane.title;
          return (
            <div
              key={pane.id}
              className={`workbench-tab terminal-tab ${active ? 'active' : ''}`}
              role="tab"
              aria-selected={active}
              tabIndex={0}
              onClick={() => {
                if (activeSessionId) setActiveTerminal(pane.id, activeSessionId);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  if (activeSessionId) setActiveTerminal(pane.id, activeSessionId);
                }
              }}
            >
              <TerminalSquare size={15} />
              <span>{label}</span>
              {terminals.length > 1 && (
                <button
                  type="button"
                  className="tab-close-button"
                  aria-label={`关闭 ${label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (activeSessionId) closeTerminal(pane.id, activeSessionId);
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className="workbench-tab-add"
          title="新建终端"
          aria-label="新建终端"
          disabled={!session || session.status !== 'ready'}
          onClick={() => openTerminal(activeSessionId || undefined)}
        >
          <Plus size={15} />
        </button>

        <div className="workbench-tabs-actions">
          <button
            type="button"
            className="icon-button"
            title="搜索终端 (Ctrl+F)"
            aria-label="搜索终端"
            onClick={() => window.dispatchEvent(new Event('ssh-term-toggle-search'))}
          >
            <Search size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="清屏"
            aria-label="清屏"
            onClick={() => window.dispatchEvent(new Event('ssh-term-clear'))}
          >
            <Trash2 size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="切换文件面板"
            aria-label="切换文件面板"
            onClick={toggleFilePanel}
          >
            <Files size={15} />
          </button>
          <div className="editor-stash-wrap">
            <button
              ref={stashBtnRef}
              type="button"
              className={`icon-button editor-stash-btn ${stashed.length ? 'has-items' : ''}`}
              title={stashed.length ? `收纳的文件（${stashed.length}）` : '收纳的文件'}
              aria-label="收纳的文件"
              aria-expanded={stashOpen}
              onClick={() => setStashOpen((open) => !open)}
            >
              <Archive size={15} />
              {stashed.length > 0 && <span className="editor-stash-badge">{stashed.length}</span>}
            </button>
          </div>
        </div>
      </div>

      {stashOpen && stashPos && createPortal(
        <div
          ref={stashPanelRef}
          className="editor-stash-panel"
          role="menu"
          style={{ top: stashPos.top, right: stashPos.right }}
        >
          <div className="editor-stash-heading">收纳的文件</div>
          {stashed.length === 0 ? (
            <div className="editor-stash-empty">暂无收纳的文件</div>
          ) : (
            stashed.map((editor) => {
              const name = editor.path.split('/').pop() || editor.path;
              return (
                <div
                  key={editor.id}
                  className="editor-stash-item"
                  role="menuitem"
                  tabIndex={0}
                  title={editor.path}
                  onClick={() => runRestore(editor.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      runRestore(editor.id);
                    }
                  }}
                >
                  <FileCode2 size={14} />
                  <span className="editor-stash-name">{name}</span>
                  {editor.dirty && <span className="dirty-dot" aria-label="未保存" />}
                  <button
                    type="button"
                    className="editor-stash-close"
                    aria-label={`关闭 ${name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      requestClose(editor.id);
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })
          )}
        </div>,
        document.body,
      )}

      <div className="workbench-surface">
        <div className="terminal-layer">
          <TerminalView visible />
        </div>

        {!desktopHost && (
          <div className="editor-float-layer" aria-live="polite">
            {floatEditors.map((editor, index) => (
              <EditorFloat
                key={editor.id}
                editor={editor}
                offset={index}
                absorbing={absorbingId === editor.id}
                restoring={restoringId === editor.id}
                absorbTarget={absorbTarget}
                onFocus={() => focusEditor(editor.id)}
                onMinimize={(rect) => runMinimize(editor.id, rect)}
                onClose={() => requestClose(editor.id)}
                onChange={(content) => setEditorContent(editor.id, content)}
                onSave={() => saveEditor(editor.id)}
              />
            ))}
          </div>
        )}
      </div>

      {pendingClose && (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dirty-title">
            <h2 id="dirty-title">文件尚未保存</h2>
            <p>关闭后将丢失当前修改。你也可以先返回编辑器保存。</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setPendingClose(null)}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  closeEditor(pendingClose, true);
                  setPendingClose(null);
                }}
              >
                放弃更改
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  saveEditor(pendingClose);
                  setPendingClose(null);
                  setActiveEditor(pendingClose);
                }}
              >
                保存文件
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
