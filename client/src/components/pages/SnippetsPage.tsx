import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/appStore';

export function SnippetsPage() {
  const snippets = useAppStore((s) => s.snippets);
  const setSnippets = useAppStore((s) => s.setSnippets);
  const sendInput = useAppStore((s) => s.sendInput);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftCmd, setDraftCmd] = useState('');
  const addNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!addOpen) return;
    setDraftName('');
    setDraftCmd('');
    const id = requestAnimationFrame(() => addNameRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [addOpen]);

  const reorderSnippets = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= snippets.length || to >= snippets.length) return;
    const next = [...snippets];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setSnippets(next);
  };

  return (
    <div className="page snippets-page">
      <div className="panel panel-snippets">
        {snippets.length === 0 ? (
          <div className="empty">暂无片段，可添加常用命令</div>
        ) : (
          <p className="hint snip-hint">拖拽左侧 ⋮⋮ 可调整顺序，点击「发送」在当前终端执行</p>
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
          onClick={() => setAddOpen(true)}
        >
          添加片段
        </button>
        {addOpen && (
          <div className="dialog-backdrop" role="presentation" onClick={() => setAddOpen(false)}>
            <form
              className="dialog-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-snippet-title"
              onClick={(event) => event.stopPropagation()}
              onSubmit={(event) => {
                event.preventDefault();
                const name = draftName.trim();
                const cmd = draftCmd.trim();
                if (!name || !cmd) return;
                setSnippets([...snippets, { name, cmd }]);
                setAddOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setAddOpen(false);
                }
              }}
            >
              <h2 id="add-snippet-title">添加片段</h2>
              <label className="field">
                <span>名称</span>
                <input
                  ref={addNameRef}
                  className="input"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  placeholder="例如：查看磁盘"
                />
              </label>
              <label className="field">
                <span>命令</span>
                <input
                  className="input"
                  value={draftCmd}
                  onChange={(event) => setDraftCmd(event.target.value)}
                  placeholder="例如：df -h"
                />
              </label>
              <div className="dialog-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setAddOpen(false)}>
                  取消
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!draftName.trim() || !draftCmd.trim()}
                >
                  添加
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
