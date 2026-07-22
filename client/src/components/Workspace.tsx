import { lazy, Suspense, useMemo, useState } from 'react';
import { FileCode2, Files, Plus, Save, Search, TerminalSquare, Trash2, X } from 'lucide-react';
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
  const setActiveEditor = useAppStore((state) => state.setActiveEditor);
  const setEditorContent = useAppStore((state) => state.setEditorContent);
  const saveEditor = useAppStore((state) => state.saveEditor);
  const closeEditor = useAppStore((state) => state.closeEditor);
  const setActiveTerminal = useAppStore((state) => state.setActiveTerminal);
  const openTerminal = useAppStore((state) => state.openTerminal);
  const closeTerminal = useAppStore((state) => state.closeTerminal);
  const toggleFilePanel = useAppStore((state) => state.toggleFilePanel);
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
  const language = activeEditor ? languageLabelForPath(activeEditor.path) : 'Plain';
  const terminals = session?.terminals || [];
  const activeTerminalId = session?.activeTerminalId;

  const requestClose = (id: string) => {
    if (!closeEditor(id)) setPendingClose(id);
  };

  return (
    <section className="workbench">
      <div className="workbench-tabs" role="tablist" aria-label="工作区">
        {terminals.map((pane) => {
          const active = !editorVisible && pane.id === activeTerminalId;
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

        {!editorVisible && (
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
          </div>
        )}
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
