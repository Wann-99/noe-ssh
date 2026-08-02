import { useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import { useAppStore } from '../store/appStore';

export function SessionTabs() {
  // Only re-render when tab identity/label/status changes — not on every file list tick.
  const tabsKey = useAppStore((s) =>
    s.sessions
      .filter((session) => !session.hidden)
      .map((session) => `${session.id}\0${session.label}\0${session.status}`)
      .join('|'));
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setActivePage = useAppStore((s) => s.setActivePage);
  const createSession = useAppStore((s) => s.createSession);
  const closeSession = useAppStore((s) => s.closeSession);
  const sessions = useMemo(
    // Files-only sessions live outside the tab strip.
    () => useAppStore.getState().sessions.filter((session) => !session.hidden).map((session) => ({
      id: session.id,
      label: session.label,
      status: session.status,
    })),
    [tabsKey],
  );

  return (
    <div className="session-tabs">
      {sessions.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`session-tab ${s.id === activeSessionId ? 'active' : ''} status-${s.status}`}
          onClick={() => {
            setActiveSession(s.id);
            // Session tabs are the terminal windows — always reveal them.
            setActivePage('terminal');
          }}
        >
          <span className="session-status-dot" />
          <span className="tab-label">{s.label}</span>
          <span
            className="tab-close"
            role="button"
            tabIndex={0}
            aria-label="关闭会话"
            onClick={(e) => {
              e.stopPropagation();
              closeSession(s.id);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                closeSession(s.id);
              }
            }}
          >
            <X size={13} />
          </span>
        </button>
      ))}
      <button type="button" className="session-tab add" onClick={() => createSession()} title="新建会话" aria-label="新建会话">
        <Plus size={15} />
      </button>
    </div>
  );
}
