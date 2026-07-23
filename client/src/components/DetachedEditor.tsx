import { useEffect, useMemo, useState } from 'react';
import { EditorFloat } from './EditorFloat';
import {
  getDesktopApi,
  getDetachedEditorId,
  type DesktopEditorState,
} from '../lib/desktop';
import type { EditorFile } from '../store/appStore';

function toEditorFile(state: DesktopEditorState): EditorFile {
  return {
    id: state.id,
    sessionId: state.sessionId,
    path: state.path,
    content: state.content,
    original: state.original,
    size: state.size,
    mtime: state.mtime,
    saving: state.saving,
    writeId: null,
    savingContent: null,
    dirty: state.dirty,
    minimized: false,
    zIndex: state.zIndex || 1,
  };
}

export function DetachedEditor() {
  const editorId = getDetachedEditorId() || '';
  const api = getDesktopApi();
  const [state, setState] = useState<DesktopEditorState | null>(null);
  const [pendingClose, setPendingClose] = useState(false);

  useEffect(() => {
    document.title = state?.path
      ? `${state.path.split('/').pop() || 'Editor'} — Noe-SSH`
      : 'Noe-SSH Editor';
  }, [state?.path]);

  useEffect(() => {
    if (!api || !editorId) return undefined;
    const offState = api.editor.onState((next) => {
      if (!next || next.id !== editorId) return;
      setState((prev) => {
        // Keep local typing buffer unless server-side save metadata advanced.
        if (
          prev
          && prev.content !== next.content
          && prev.dirty
          && next.saving === prev.saving
          && next.original === prev.original
        ) {
          return {
            ...next,
            content: prev.content,
            dirty: prev.content !== next.original,
            size: new Blob([prev.content]).size,
          };
        }
        return next;
      });
    });
    const offClose = api.editor.onRequestClose(() => {
      setState((prev) => {
        if (prev?.dirty) {
          setPendingClose(true);
          return prev;
        }
        api.editor.send({ type: 'close', id: editorId, force: true });
        void api.editor.destroy({ id: editorId });
        return prev;
      });
    });
    api.editor.send({ type: 'ready', id: editorId });
    return () => {
      offState();
      offClose();
    };
  }, [api, editorId]);

  const editor = useMemo(() => (state ? toEditorFile(state) : null), [state]);

  if (!api || !editorId) {
    return <div className="detached-editor-empty">无法打开桌面编辑窗口</div>;
  }

  if (!editor) {
    return (
      <div className="detached-editor-empty">
        <span className="loader" />
        正在加载编辑器…
      </div>
    );
  }

  return (
    <div className="detached-editor-root">
      <EditorFloat
        editor={editor}
        offset={0}
        absorbing={false}
        restoring={false}
        absorbTarget={null}
        fillWindow
        onFocus={() => api.editor.send({ type: 'focus', id: editorId })}
        onMinimize={() => {
          api.editor.send({ type: 'minimize', id: editorId });
          void api.editor.destroy({ id: editorId });
        }}
        onClose={() => {
          if (editor.dirty) {
            setPendingClose(true);
            return;
          }
          api.editor.send({ type: 'close', id: editorId, force: true });
          void api.editor.destroy({ id: editorId });
        }}
        onChange={(content) => {
          setState((prev) => (prev
            ? {
                ...prev,
                content,
                size: new Blob([content]).size,
                dirty: content !== prev.original,
              }
            : prev));
          api.editor.send({ type: 'change', id: editorId, content });
        }}
        onSave={() => api.editor.send({
          type: 'save',
          id: editorId,
          content: state?.content,
        })}
      />

      {pendingClose && (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog-card" role="dialog" aria-modal="true">
            <h2>文件尚未保存</h2>
            <p>关闭后将丢失当前修改。</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setPendingClose(false)}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  setPendingClose(false);
                  api.editor.send({ type: 'close', id: editorId, force: true });
                  void api.editor.destroy({ id: editorId });
                }}
              >
                丢弃并关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
