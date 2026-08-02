import { useMemo, useRef, useState } from 'react';
import { FileCode2 } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { FilePane } from '../FilePane';
import { EditorFloat } from '../EditorFloat';

/**
 * Dual-pane files page: each side independently browses the server-local
 * filesystem or a remote host (dedicated hidden SFTP session / live session).
 * Copies between panes stream inside the Noe-SSH server.
 */
export function FilesPage() {
  const filesPanes = useAppStore((s) => s.filesPanes);
  const editors = useAppStore((s) => s.editors);
  const setActiveEditor = useAppStore((s) => s.setActiveEditor);
  const setEditorContent = useAppStore((s) => s.setEditorContent);
  const saveEditor = useAppStore((s) => s.saveEditor);
  const closeEditor = useAppStore((s) => s.closeEditor);
  const minimizeEditor = useAppStore((s) => s.minimizeEditor);
  const restoreEditor = useAppStore((s) => s.restoreEditor);
  const focusEditor = useAppStore((s) => s.focusEditor);

  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const [leftPct, setLeftPct] = useState(50);
  const dualRef = useRef<HTMLDivElement>(null);

  const remoteIds = useMemo(
    () => [filesPanes.left.target, filesPanes.right.target]
      .filter((t): t is string => Boolean(t) && t !== 'local'),
    [filesPanes],
  );

  const fileEditors = useMemo(
    () => editors
      .filter((editor) => remoteIds.includes(editor.sessionId))
      .sort((a, b) => a.zIndex - b.zIndex),
    [editors, remoteIds],
  );
  const stashed = fileEditors.filter((editor) => editor.minimized);

  const onDividerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    const container = dualRef.current;
    if (!container) return;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('fp-col-resizing');
    const onMove = (ev: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setLeftPct(Math.min(80, Math.max(20, pct)));
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
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };

  return (
    <div className="page files-page is-ready">
      <div className="files-dual" ref={dualRef}>
        <div className="files-pane-slot" style={{ flexBasis: `${leftPct}%` }}>
          <FilePane side="left" />
        </div>
        <div
          className="files-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整两侧宽度"
          onPointerDown={onDividerDown}
        />
        <div className="files-pane-slot" style={{ flexBasis: `${100 - leftPct}%` }}>
          <FilePane side="right" />
        </div>
      </div>

      <div className="editor-float-layer" aria-live="polite">
        {fileEditors.filter((editor) => !editor.minimized).map((editor, index) => (
          <EditorFloat
            key={editor.id}
            editor={editor}
            offset={index}
            absorbing={false}
            restoring={false}
            absorbTarget={null}
            onFocus={() => focusEditor(editor.id)}
            onMinimize={() => minimizeEditor(editor.id)}
            onClose={() => { if (!closeEditor(editor.id)) setPendingClose(editor.id); }}
            onChange={(content) => setEditorContent(editor.id, content)}
            onSave={() => saveEditor(editor.id)}
          />
        ))}
      </div>

      {stashed.length > 0 && (
        <div className="files-stash">
          {stashed.map((editor) => {
            const name = editor.path.split('/').pop() || editor.path;
            return (
              <button
                key={editor.id}
                type="button"
                className="files-stash-chip"
                title={editor.path}
                onClick={() => restoreEditor(editor.id)}
              >
                <FileCode2 size={13} aria-hidden />
                <span>{name}</span>
                {editor.dirty && <span className="dirty-dot" aria-label="未保存" />}
              </button>
            );
          })}
        </div>
      )}

      {pendingClose && (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="files-dirty-title">
            <h2 id="files-dirty-title">文件尚未保存</h2>
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
    </div>
  );
}
