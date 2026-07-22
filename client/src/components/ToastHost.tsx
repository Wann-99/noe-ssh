import { AlertTriangle, CheckCircle2, CircleAlert, Info, X } from 'lucide-react';
import { useAppStore, type ToastItem } from '../store/appStore';

const ICONS: Record<ToastItem['kind'], typeof Info> = {
  success: CheckCircle2,
  error: CircleAlert,
  warning: AlertTriangle,
  info: Info,
};

export function ToastHost() {
  const toasts = useAppStore((state) => state.toasts);
  const dismiss = useAppStore((state) => state.dismissToast);

  return (
    <div className="toast-host" role="region" aria-label="通知">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.kind];
        return (
          <div className={`toast toast-${toast.kind}`} key={toast.id} role="status">
            <Icon size={18} aria-hidden />
            <div className="toast-copy">
              <strong>{toast.title}</strong>
              {toast.message && <span>{toast.message}</span>}
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => dismiss(toast.id)}
              aria-label="关闭通知"
            >
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
