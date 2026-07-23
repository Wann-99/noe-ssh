import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react';
import { Minus, Save, X } from 'lucide-react';
import type { EditorFile } from '../store/appStore';
import { languageLabelForPath } from '../lib/editorLanguage';

const CodeEditor = lazy(() => import('./CodeEditor').then((module) => ({
  default: module.CodeEditor,
})));

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  editor: EditorFile;
  offset: number;
  absorbing: boolean;
  restoring: boolean;
  absorbTarget: { x: number; y: number } | null;
  onFocus: () => void;
  onMinimize: (origin: DOMRect) => void;
  onClose: () => void;
  onChange: (content: string) => void;
  onSave: () => void;
};

export function EditorFloat({
  editor,
  offset,
  absorbing,
  restoring,
  absorbTarget,
  onFocus,
  onMinimize,
  onClose,
  onChange,
  onSave,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const openedOnce = useRef(false);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [pos, setPos] = useState({ x: 72 + offset * 28, y: 56 + offset * 24 });
  const dragRef = useRef<{ ox: number; oy: number; sx: number; sy: number } | null>(null);
  const name = editor.path.split('/').pop() || editor.path;
  const language = languageLabelForPath(editor.path);
  const stashed = editor.minimized && !absorbing && !restoring;
  const animating = absorbing || restoring;

  if (!editor.minimized) openedOnce.current = true;

  useLayoutEffect(() => {
    if (!animating || !absorbTarget || !shellRef.current) return;
    const el = shellRef.current;
    const layer = el.offsetParent as HTMLElement | null;
    const layerRect = layer?.getBoundingClientRect();
    const w = el.offsetWidth || 820;
    const h = el.offsetHeight || 560;
    // Stash button center → layer-local top-left for a scaled window centered on it.
    const originX = absorbTarget.x - (layerRect?.left ?? 0) - w / 2;
    const originY = absorbTarget.y - (layerRect?.top ?? 0) - h / 2;
    el.style.setProperty('--float-x', `${pos.x}px`);
    el.style.setProperty('--float-y', `${pos.y}px`);
    el.style.setProperty('--absorb-x', `${originX}px`);
    el.style.setProperty('--absorb-y', `${originY}px`);
  }, [animating, absorbTarget, pos.x, pos.y]);

  return (
    <div
      ref={shellRef}
      className={[
        'editor-float',
        absorbing ? 'is-absorbing' : '',
        restoring ? 'is-restoring' : '',
        stashed ? 'is-stashed' : '',
        !openedOnce.current && !stashed && !animating ? 'is-entering' : '',
      ].filter(Boolean).join(' ')}
      style={{
        zIndex: editor.zIndex,
        transform: animating || stashed ? undefined : `translate(${pos.x}px, ${pos.y}px)`,
      }}
      aria-hidden={stashed}
      onMouseDown={stashed || animating ? undefined : onFocus}
    >
      <div
        className="editor-float-titlebar"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          onFocus();
          dragRef.current = {
            ox: pos.x,
            oy: pos.y,
            sx: event.clientX,
            sy: event.clientY,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          setPos({
            x: Math.max(8, drag.ox + event.clientX - drag.sx),
            y: Math.max(8, drag.oy + event.clientY - drag.sy),
          });
        }}
        onPointerUp={(event) => {
          dragRef.current = null;
          try {
            event.currentTarget.releasePointerCapture(event.pointerId);
          } catch {
            /* ignore */
          }
        }}
      >
        <span className="editor-float-title" title={editor.path}>
          {name}
          {editor.dirty ? ' •' : ''}
        </span>
        <div className="editor-float-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!editor.dirty || editor.saving}
            onClick={onSave}
          >
            <Save size={13} />
            {editor.saving ? '保存中…' : '保存'}
          </button>
          <button
            type="button"
            className="icon-button"
            title="最小化到收纳"
            aria-label="最小化到收纳"
            onClick={() => {
              const rect = shellRef.current?.getBoundingClientRect();
              if (rect) onMinimize(rect);
            }}
          >
            <Minus size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="关闭"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="editor-float-path" title={editor.path}>{editor.path}</div>
      <div className="editor-float-body">
        <Suspense fallback={<div className="editor-loading"><span className="loader" />正在加载编辑器…</div>}>
          <CodeEditor
            key={editor.id}
            editor={editor}
            onChange={onChange}
            onSave={onSave}
            onCursorChange={(line, column) => setCursor({ line, column })}
          />
        </Suspense>
      </div>
      <div className="editor-float-status">
        <span>{editor.dirty ? '已修改' : '已保存'}</span>
        <span>{language}</span>
        <span>{formatSize(editor.size)}</span>
        <span>行 {cursor.line}，列 {cursor.column}</span>
      </div>
    </div>
  );
}
