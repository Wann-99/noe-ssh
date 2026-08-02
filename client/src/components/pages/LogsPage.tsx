import { useAppStore } from '../../store/appStore';

export function LogsPage() {
  const cmdLog = useAppStore(
    (s) => s.sessions.find((item) => item.id === s.activeSessionId)?.cmdLog,
  );

  return (
    <div className="page logs-page">
      <div className="panel">
        {!cmdLog?.length ? (
          <div className="empty">操作将生成可学习的 SSH 命令</div>
        ) : (
          cmdLog.map((item) => (
            <div
              key={item.id}
              className={`card cmd-item cmd-${item.type}`}
              onClick={() => navigator.clipboard.writeText(item.cmd)}
              title="点击复制"
            >
              <div className="cmd-time">{item.time} · {item.desc}</div>
              <code>{item.cmd}</code>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
