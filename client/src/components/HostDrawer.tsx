import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ConnectForm } from './ConnectForm';

export function HostDrawer({ title, onClose }: { title: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Portal to body: ancestor backdrop-filter (glass theme on .page) would
  // otherwise trap the fixed backdrop inside the page area.
  return createPortal(
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <div
        className="host-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="host-drawer-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="host-drawer-head">
          <h2 id="host-drawer-title">{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="host-drawer-body">
          <ConnectForm />
        </div>
      </div>
    </div>,
    document.body,
  );
}
