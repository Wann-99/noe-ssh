import { useAppStore } from '../store/appStore';

export function SessionTabs() {
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const createSession = useAppStore((s) => s.createSession);
  const closeSession = useAppStore((s) => s.closeSession);

  return (
    <div className="session-tabs">
      {sessions.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`session-tab ${s.id === activeSessionId ? 'active' : ''} ${s.connected ? 'live' : ''}`}
          onClick={() => setActiveSession(s.id)}
        >
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
            ×
          </span>
        </button>
      ))}
      <button type="button" className="session-tab add" onClick={() => createSession()} title="新建会话" aria-label="新建会话">
        +
      </button>
    </div>
  );
}
