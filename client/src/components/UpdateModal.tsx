import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { getDesktopApi, type UpdaterEvent } from '../lib/desktop';

type Phase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'latest'
  | 'downloading'
  | 'downloaded'
  | 'error';

function formatBytes(n?: number) {
  if (!n || !Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function UpdateModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const api = getDesktopApi();
  const [phase, setPhase] = useState<Phase>('idle');
  const [version, setVersion] = useState('');
  const [detail, setDetail] = useState('');
  const [message, setMessage] = useState('');
  const [percent, setPercent] = useState(0);
  const [transferred, setTransferred] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!api) return undefined;
    return api.updater.onEvent((event: UpdaterEvent) => {
      switch (event.type) {
        case 'checking':
          setPhase('checking');
          setMessage('正在检查更新…');
          break;
        case 'available':
          setPhase('available');
          setVersion(event.version || '');
          setDetail(event.detail || '');
          setMessage(event.version ? `发现新版本 ${event.version}` : '发现新版本');
          break;
        case 'not-available':
          setPhase('latest');
          setVersion(event.version || '');
          setMessage(event.version ? `当前已是最新版本（${event.version}）` : '当前已是最新版本');
          break;
        case 'downloading':
          setPhase('downloading');
          setPercent(0);
          setMessage('正在下载更新…');
          break;
        case 'progress':
          setPhase('downloading');
          setPercent(Math.round(event.percent || 0));
          setTransferred(event.transferred || 0);
          setTotal(event.total || 0);
          setMessage(`正在下载更新… ${Math.round(event.percent || 0)}%`);
          break;
        case 'downloaded':
          setPhase('downloaded');
          if (event.version) setVersion(event.version);
          setPercent(100);
          setMessage(event.version ? `版本 ${event.version} 已下载完成` : '更新已下载完成');
          break;
        case 'error':
          setPhase('error');
          setMessage(event.message || '更新失败');
          break;
        default:
          break;
      }
    });
  }, [api]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (phase === 'downloading' || phase === 'checking') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose, phase]);

  if (!open || !api) return null;

  const busy = phase === 'checking' || phase === 'downloading';

  return (
    <div
      className="modal-overlay"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div className="modal update-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-header">
          <span>软件更新</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="update-status">{message || '点击下方按钮检查是否有新版本。'}</p>
          {detail && phase === 'available' && (
            <p className="update-detail">{detail}</p>
          )}
          {(phase === 'downloading' || phase === 'downloaded') && (
            <div className="update-progress">
              <div className="update-progress-track">
                <div className="update-progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <div className="update-progress-meta">
                <span>{percent}%</span>
                {(transferred > 0 || total > 0) && (
                  <span>
                    {formatBytes(transferred)}
                    {total > 0 ? ` / ${formatBytes(total)}` : ''}
                  </span>
                )}
              </div>
            </div>
          )}
          <div className="modal-actions">
            {(phase === 'idle' || phase === 'latest' || phase === 'error') && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => {
                  void api.updater.check();
                }}
              >
                <RefreshCw size={14} />
                检查更新
              </button>
            )}
            {phase === 'available' && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  void api.updater.download();
                }}
              >
                <Download size={14} />
                下载更新
              </button>
            )}
            {phase === 'downloaded' && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  void api.updater.install();
                }}
              >
                立即重启
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={onClose}
            >
              {phase === 'downloaded' ? '稍后' : '关闭'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
