import { lazy, Suspense, useMemo, useState } from 'react';
import { FileCode2, Save, TerminalSquare, X } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { languageLabelForPath } from '../lib/editorLanguage';
import { TerminalView } from './TerminalView';

const CodeEditor = lazy(() => import('./CodeEditor').then((module) => ({
  default: module.CodeEditor,
})));

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Workspace() {
  const sessions = useAppStore((state) => state.sessions);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const editors = useAppStore((state) => state.editors);
  const showTerminal = useAppStore((state) => state.showTerminal);
  const setActiveEditor = useAppStore((state) => state.setActiveEditor);
  const setEditorContent = useAppStore((state) => state.setEditorContent);
  const saveEditor = useAppStore((state) => state.saveEditor);
  const closeEditor = useAppStore((state) => state.closeEditor);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [pendingClose, setPendingClose] = useState<string | null>(null);

  const session = sessions.find((item) => item.id === activeSessionId);
  const sessionEditors = useMemo(
    () => editors.filter((editor) => editor.sessionId === activeSessionId),
    [editors, activeSessionId],
  );
  const activeEditor = sessionEditors.find((editor) => editor.id === session?.activeEditorId)
    || sessionEditors[0];
  const editorVisible = session?.workspaceMode === 'editor' && Boolean(activeEditor);
  const language = activeEditor ? languageLabelForPath(activeEditor.path) : 'Plain Text';

  const requestClose = (id: string) => {
    if (!closeEditor(id)) setPendingClose(id);
  };

  return (
    <section className="workbench">
      <div className="workbench-tabs" role="tablist" aria-label="工作区">
        <button
          type="button"
          className={`workbench-tab terminal-tab ${!editorVisible ? 'active' : ''}`}
          onClick={showTerminal}
          role="tab"
          aria-selected={!editorVisible}
        >
          <TerminalSquare size={15} />
          终端
        </button>
        {sessionEditors.map((editor) => {
          const name = editor.path.split('/').pop() || editor.path;
          const active = editorVisible && activeEditor?.id === editor.id;
          return (
            <div
              className={`workbench-tab editor-tab ${active ? 'active' : ''}`}
              key={editor.id}
              role="tab"
              aria-selected={active}
              tabIndex={0}
              onClick={() => setActiveEditor(editor.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') setActiveEditor(editor.id);
              }}
              title={editor.path}
            >
              <FileCode2 size={14} />
              <span>{name}</span>
              {editor.dirty && <span className="dirty-dot" aria-label="未保存" />}
              <button
                type="button"
                className="tab-close-button"
                aria-label={`关闭 ${name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  requestClose(editor.id);
                }}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="workbench-surface">
        <div className={`terminal-layer ${editorVisible ? 'is-hidden' : ''}`}>
          <TerminalView visible={!editorVisible} />
        </div>
        {editorVisible && activeEditor && (
          <div className="editor-layer">
            <div className="editor-breadcrumb">
              <span className="editor-full-path" title={activeEditor.path}>{activeEditor.path}</span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!activeEditor.dirty || activeEditor.saving}
                onClick={() => saveEditor(activeEditor.id)}
              >
                <Save size={14} />
                {activeEditor.saving ? '保存中…' : '保存'}
              </button>
            </div>
            <div className="editor-canvas">
              <Suspense fallback={<div className="editor-loading"><span className="loader" />正在加载编辑器…</div>}>
                <CodeEditor
                  key={activeEditor.id}
                  editor={activeEditor}
                  onChange={(content) => setEditorContent(activeEditor.id, content)}
                  onSave={() => saveEditor(activeEditor.id)}
                  onCursorChange={(line, column) => setCursor({ line, column })}
                />
              </Suspense>
            </div>
            <div className="editor-statusbar">
              <span>{activeEditor.dirty ? '已修改' : '已保存'}</span>
              <span>{language}</span>
              <span>UTF-8</span>
              <span>{formatSize(activeEditor.size)}</span>
              <span>行 {cursor.line}，列 {cursor.column}</span>
            </div>
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
