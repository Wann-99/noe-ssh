import type { ReactNode } from 'react';
import { useAppStore } from '../../store/appStore';

function InfoRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="server-info-row">
      <span className="server-info-label">{label}</span>
      <span className="server-info-value" title={value || '—'}>{value || '—'}</span>
    </div>
  );
}

function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="server-info-section">
      <h3 className="server-info-section-title">{title}</h3>
      <div className="server-info-grid">{children}</div>
    </section>
  );
}

function ServerInfoView({ info }: { info: Record<string, string> }) {
  // Backward compatible: old clients/servers may still send mem/disk/load blobs.
  if (info.mem || info.disk || info.load) {
    return (
      <dl className="server-info">
        {Object.entries(info).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v || '—'}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <div className="server-info-view">
      <InfoSection title="基本信息">
        <InfoRow label="主机" value={info.host} />
        <InfoRow label="系统" value={info.os} />
        <InfoRow label="运行时间" value={info.uptime} />
        <InfoRow label="CPU 核心" value={info.cpu} />
      </InfoSection>
      <InfoSection title="内存">
        <InfoRow label="总量" value={info.memTotal} />
        <InfoRow label="已用" value={info.memUsed} />
        <InfoRow label="空闲" value={info.memFree} />
        <InfoRow label="可用" value={info.memAvailable} />
        <InfoRow label="缓存" value={info.memCache} />
        <InfoRow label="共享" value={info.memShared} />
      </InfoSection>
      <InfoSection title="根分区">
        <InfoRow label="设备" value={info.diskFs} />
        <InfoRow label="容量" value={info.diskSize} />
        <InfoRow label="已用" value={info.diskUsed} />
        <InfoRow label="剩余" value={info.diskAvail} />
        <InfoRow label="使用率" value={info.diskUse} />
        <InfoRow label="挂载点" value={info.diskMount} />
      </InfoSection>
      <InfoSection title="负载">
        <InfoRow label="1 分钟" value={info.load1} />
        <InfoRow label="5 分钟" value={info.load5} />
        <InfoRow label="15 分钟" value={info.load15} />
      </InfoSection>
    </div>
  );
}

export function ServerPage() {
  const sess = useAppStore((s) => s.sessions.find((item) => item.id === s.activeSessionId));
  const refreshServerInfo = useAppStore((s) => s.refreshServerInfo);

  return (
    <div className="page server-page">
      <div className="panel">
        {sess?.status !== 'ready' ? (
          <div className="empty">连接后查看服务器信息</div>
        ) : !sess.serverInfo ? (
          <button type="button" className="btn btn-primary" onClick={refreshServerInfo}>刷新</button>
        ) : (
          <div className="card server-card">
            <div className="server-info-head">
              <span>服务器信息</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={refreshServerInfo}>刷新</button>
            </div>
            <ServerInfoView info={sess.serverInfo} />
          </div>
        )}
      </div>
    </div>
  );
}
