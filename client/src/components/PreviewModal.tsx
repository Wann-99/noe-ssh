import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export function PreviewModal() {
  const preview = useAppStore((s) => s.preview);
  const setPreviewContent = useAppStore((s) => s.setPreviewContent);
  const savePreviewFile = useAppStore((s) => s.savePreviewFile);
  const closePreview = useAppStore((s) => s.closePreview);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (preview.dirty && !preview.saving) savePreviewFile();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closePreview();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview, savePreviewFile, closePreview]);

  useEffect(() => {
    if (preview && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [preview?.path]);

  if (!preview) return null;

  const name = preview.path.split('/').pop() || preview.path;

  return (
    <div className="modal-overlay" onClick={closePreview}>
      <div className="modal modal-lg editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="editor-title">
            <span className="editor-name">
              {name}
              {preview.dirty ? ' *' : ''}
            </span>
            <span className="editor-path" title={preview.path}>
              {preview.path} · {formatSize(preview.size)}
            </span>
          </div>
          <div className="editor-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!preview.dirty || preview.saving}
              onClick={() => savePreviewFile()}
            >
              {preview.saving ? '保存中…' : '保存'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={closePreview}>
              关闭
            </button>
          </div>
        </div>
        <textarea
          ref={textareaRef}
          className="editor-textarea"
          spellCheck={false}
          value={preview.content}
          onChange={(e) => setPreviewContent(e.target.value)}
        />
        <div className="editor-footer">
          <span>{preview.dirty ? '已修改' : '未修改'}</span>
          <span>Ctrl+S 保存 · Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}
