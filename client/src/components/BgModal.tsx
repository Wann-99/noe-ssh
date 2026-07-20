import { useState } from 'react';
import { useAppStore } from '../store/appStore';

export function BgModal({ onClose }: { onClose: () => void }) {
  const bgUrl = useAppStore((s) => s.bgUrl);
  const bgOpacity = useAppStore((s) => s.bgOpacity);
  const setBg = useAppStore((s) => s.setBg);
  const clearBg = useAppStore((s) => s.clearBg);
  const [url, setUrl] = useState(bgUrl);
  const [opacity, setOpacity] = useState(bgOpacity);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>背景设置</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <label className="field">
            <span>图片 URL</span>
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <label className="field">
            <span>或上传</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const reader = new FileReader();
                reader.onload = () => setUrl(String(reader.result || ''));
                reader.readAsDataURL(f);
              }}
            />
          </label>
          <label className="field">
            <span>透明度 {opacity}%</span>
            <input type="range" min={0} max={100} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={() => { setBg(url, opacity); onClose(); }}>应用</button>
            <button type="button" className="btn btn-ghost" onClick={() => { clearBg(); onClose(); }}>清除</button>
          </div>
        </div>
      </div>
    </div>
  );
}
