import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Replace } from 'lucide-react';
import { compressBgImage } from '../lib/bgImage';
import { useAppStore } from '../store/appStore';

export function BgModal({ onClose }: { onClose: () => void }) {
  const bgUrl = useAppStore((s) => s.bgUrl);
  const bgOpacity = useAppStore((s) => s.bgOpacity);
  const setBg = useAppStore((s) => s.setBg);
  const setBgOpacity = useAppStore((s) => s.setBgOpacity);
  const clearBg = useAppStore((s) => s.clearBg);
  const notify = useAppStore((s) => s.notify);
  const [preview, setPreview] = useState(bgUrl);
  const [opacity, setOpacity] = useState(bgOpacity);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState('');
  const [baseline] = useState({ opacity: bgOpacity });
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const dismiss = () => {
    setBgOpacity(baseline.opacity);
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      dismiss();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      notify('error', '请选择图片文件', file.name);
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await compressBgImage(file);
      setPreview(dataUrl);
      setFileName(file.name);
    } catch (err) {
      notify('error', '无法使用该图片', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const panelSeeThrough = Math.round((1 - (0.06 + ((100 - opacity) / 100) * 0.84)) * 100);

  return (
    <div className="modal-overlay" onClick={dismiss}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>背景设置</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss}>×</button>
        </div>
        <div className="modal-body">
          <div className="field">
            <span>上传背景图</span>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                void onPickFile(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className={`bg-dropzone${preview ? ' has-image' : ''}${dragOver ? ' drag-over' : ''}${busy ? ' busy' : ''}`}
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              onDragEnter={(e) => {
                e.preventDefault();
                dragDepth.current += 1;
                setDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                dragDepth.current -= 1;
                if (dragDepth.current <= 0) {
                  dragDepth.current = 0;
                  setDragOver(false);
                }
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                dragDepth.current = 0;
                setDragOver(false);
                void onPickFile(e.dataTransfer.files?.[0]);
              }}
            >
              {preview ? (
                <>
                  <div className="bg-dropzone-preview" style={{ backgroundImage: `url(${preview})` }} />
                  <span className="bg-dropzone-chip">
                    {busy ? <Loader2 size={12} className="spin" /> : <Replace size={12} />}
                    {busy ? '处理中' : '更换'}
                  </span>
                  <div className="bg-dropzone-overlay">
                    {busy ? <Loader2 size={18} className="spin" /> : <Replace size={16} />}
                    <span>{busy ? '处理中…' : '点击或拖入以更换'}</span>
                    {fileName ? <small>{fileName}</small> : null}
                  </div>
                </>
              ) : (
                <div className="bg-dropzone-empty">
                  {busy ? <Loader2 size={22} className="spin" /> : <ImagePlus size={22} />}
                  <strong>{busy ? '处理中…' : dragOver ? '释放以选用此图' : '点击选择或拖入图片'}</strong>
                  <span>支持 JPG / PNG / WebP</span>
                </div>
              )}
            </button>
          </div>

          <label className="field">
            <span>背景可见度 {opacity}%</span>
            <input
              type="range"
              min={0}
              max={100}
              value={opacity}
              onChange={(e) => {
                const next = Number(e.target.value);
                setOpacity(next);
                setBgOpacity(next);
              }}
            />
            <small className="field-hint">
              {opacity}% 表示壁纸透过界面的强度；板块约 {panelSeeThrough}% 通透（拖动可实时预览，点「应用」保存）
            </small>
          </label>
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !preview}
              onClick={() => {
                setBg(preview, opacity);
                onClose();
              }}
            >
              应用
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={dismiss}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => {
                clearBg();
                setPreview('');
                setFileName('');
                setOpacity(15);
                onClose();
              }}
            >
              清除
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
