import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Save, Search, X } from 'lucide-react';
import type { EditorFile } from '../store/appStore';
import { languageLabelForPath } from '../lib/editorLanguage';
import type { CodeEditorHandle } from './CodeEditor';

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
  /** When true, fill the current window (Electron detached editor). */
  fillWindow?: boolean;
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
  fillWindow = false,
  onFocus,
  onMinimize,
  onClose,
  onChange,
  onSave,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<CodeEditorHandle | null>(null);
  const openedOnce = useRef(false);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [pos, setPos] = useState({ x: 72 + offset * 28, y: 56 + offset * 24 });
  const [size, setSize] = useState({ w: 820, h: 560 });
  const dragRef = useRef<{ ox: number; oy: number; sx: number; sy: number } | null>(null);
  const resizeRef = useRef<{
    ow: number;
    oh: number;
    ox: number;
    oy: number;
    sx: number;
    sy: number;
    edges: { l: boolean; r: boolean; t: boolean; b: boolean };
  } | null>(null);
  const name = editor.path.split('/').pop() || editor.path;
  const language = languageLabelForPath(editor.path);
  const stashed = editor.minimized && !absorbing && !restoring;
  const animating = absorbing || restoring;

  if (!editor.minimized) openedOnce.current = true;

  useLayoutEffect(() => {
    if (!animating || !absorbTarget || !shellRef.current) return;
    const el = shellRef.current;
    const w = el.offsetWidth || size.w;
    const h = el.offsetHeight || size.h;
    const originX = absorbTarget.x - w / 2;
    const originY = absorbTarget.y - h / 2;
    el.style.setProperty('--float-x', `${pos.x}px`);
    el.style.setProperty('--float-y', `${pos.y}px`);
    el.style.setProperty('--absorb-x', `${originX}px`);
    el.style.setProperty('--absorb-y', `${originY}px`);
  }, [animating, absorbTarget, pos.x, pos.y, size.w, size.h]);

  const startResize = (
    event: React.PointerEvent,
    edges: { l?: boolean; r?: boolean; t?: boolean; b?: boolean },
  ) => {
    if (fillWindow) return;
    event.preventDefault();
    event.stopPropagation();
    onFocus();
    resizeRef.current = {
      ow: size.w,
      oh: size.h,
      ox: pos.x,
      oy: pos.y,
      sx: event.clientX,
      sy: event.clientY,
      edges: {
        l: Boolean(edges.l),
        r: Boolean(edges.r),
        t: Boolean(edges.t),
        b: Boolean(edges.b),
      },
    };
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onResizeMove = (event: React.PointerEvent) => {
    const drag = resizeRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.sx;
    const dy = event.clientY - drag.sy;
    let nextW = drag.ow;
    let nextH = drag.oh;
    let nextX = drag.ox;
    let nextY = drag.oy;
    const minW = 420;
    const minH = 280;
    if (drag.edges.r) nextW = Math.max(minW, drag.ow + dx);
    if (drag.edges.b) nextH = Math.max(minH, drag.oh + dy);
    if (drag.edges.l) {
      nextW = Math.max(minW, drag.ow - dx);
      nextX = drag.ox + (drag.ow - nextW);
    }
    if (drag.edges.t) {
      nextH = Math.max(minH, drag.oh - dy);
      nextY = drag.oy + (drag.oh - nextH);
    }
    setSize({ w: nextW, h: nextH });
    setPos({ x: Math.max(0, nextX), y: Math.max(0, nextY) });
  };

  const endResize = (event: React.PointerEvent) => {
    resizeRef.current = null;
    try {
      (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  };

  const node = (
    <div
      ref={shellRef}
      className={[
        'editor-float',
        fillWindow ? 'is-fill-window' : 'is-viewport',
        absorbing ? 'is-absorbing' : '',
        restoring ? 'is-restoring' : '',
        stashed ? 'is-stashed' : '',
        !openedOnce.current && !stashed && !animating ? 'is-entering' : '',
      ].filter(Boolean).join(' ')}
      style={fillWindow || animating || stashed
        ? { zIndex: editor.zIndex }
        : {
            zIndex: 2000 + editor.zIndex,
            width: size.w,
            height: size.h,
            transform: `translate(${pos.x}px, ${pos.y}px)`,
          }}
      aria-hidden={stashed}
      onMouseDown={stashed || animating ? undefined : onFocus}
    >
      <div
        className="editor-float-titlebar"
        onPointerDown={(event) => {
          if (fillWindow) return;
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
          const maxX = Math.max(0, window.innerWidth - 80);
          const maxY = Math.max(0, window.innerHeight - 48);
          setPos({
            x: Math.min(maxX, Math.max(0, drag.ox + event.clientX - drag.sx)),
            y: Math.min(maxY, Math.max(0, drag.oy + event.clientY - drag.sy)),
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
            className="icon-button"
            title="搜索 (Ctrl/⌘+F)"
            aria-label="搜索"
            onClick={() => editorRef.current?.openSearch()}
          >
            <Search size={15} />
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!editor.dirty || editor.saving}
            onClick={onSave}
          >
            <Save size={13} />
            {editor.saving ? '保存中…' : '保存'}
          </button>
          {!fillWindow && (
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
          )}
          {fillWindow && (
            <button
              type="button"
              className="icon-button"
              title="最小化到收纳"
              aria-label="最小化到收纳"
              onClick={() => onMinimize(new DOMRect())}
            >
              <Minus size={15} />
            </button>
          )}
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
            ref={editorRef}
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
        <span className="editor-float-hint">Ctrl/⌘+F 搜索</span>
      </div>
      {!fillWindow && !stashed && !animating && (
        <>
          <div className="editor-resize-edge edge-n" onPointerDown={(e) => startResize(e, { t: true })} onPointerMove={onResizeMove} onPointerUp={endResize} />
          <div className="editor-resize-edge edge-s" onPointerDown={(e) => startResize(e, { b: true })} onPointerMove={onResizeMove} onPointerUp={endResize} />
          <div className="editor-resize-edge edge-e" onPointerDown={(e) => startResize(e, { r: true })} onPointerMove={onResizeMove} onPointerUp={endResize} />
          <div className="editor-resize-edge edge-w" onPointerDown={(e) => startResize(e, { l: true })} onPointerMove={onResizeMove} onPointerUp={endResize} />
          <div className="editor-resize-corner corner-se" onPointerDown={(e) => startResize(e, { r: true, b: true })} onPointerMove={onResizeMove} onPointerUp={endResize} />
          <div className="editor-resize-corner corner-sw" onPointerDown={(e) => startResize(e, { l: true, b: true })} onPointerMove={onResizeMove} onPointerUp={endResize} />
          <div className="editor-resize-corner corner-ne" onPointerDown={(e) => startResize(e, { r: true, t: true })} onPointerMove={onResizeMove} onPointerUp={endResize} />
          <div className="editor-resize-corner corner-nw" onPointerDown={(e) => startResize(e, { l: true, t: true })} onPointerMove={onResizeMove} onPointerUp={endResize} />
        </>
      )}
    </div>
  );

  if (fillWindow || typeof document === 'undefined') return node;
  return createPortal(node, document.body);
}
