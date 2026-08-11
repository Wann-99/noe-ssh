import type { ReactNode } from 'react';
import {
  ChevronRight,
  Keyboard,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Shield,
  ShieldCheck,
} from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { hasVault } from '../../lib/crypto';
import { getDesktopApi } from '../../lib/desktop';

function SettingsItem({
  icon,
  title,
  desc,
  onClick,
  danger = false,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`settings-item${danger ? ' danger' : ''}`}
      onClick={onClick}
    >
      <span className="settings-item-icon" aria-hidden>{icon}</span>
      <span className="settings-item-main">
        <span className="settings-item-title">{title}</span>
        <span className="settings-item-desc">{desc}</span>
      </span>
      <ChevronRight size={15} className="settings-item-caret" aria-hidden />
    </button>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-group">
      <h3 className="settings-group-title">{title}</h3>
      <div className="settings-group-body">{children}</div>
    </section>
  );
}

export function SettingsPage({
  onOpenShortcuts,
  onSetupVault,
  onUnlockVault,
  onOpenUpdate,
}: {
  onOpenShortcuts: () => void;
  onSetupVault: () => void;
  onUnlockVault: () => void;
  onOpenUpdate: () => void;
}) {
  const isDesktop = Boolean(getDesktopApi());
  const user = useAppStore((s) => s.user);
  const authRequired = useAppStore((s) => s.authRequired);
  const vaultUnlocked = useAppStore((s) => s.vaultUnlocked);
  const lockVault = useAppStore((s) => s.lockVault);
  const setShowAdmin = useAppStore((s) => s.setShowAdmin);
  const logout = useAppStore((s) => s.logout);

  return (
    <div className="page settings-page">
      <SettingsGroup title="通用">
        <SettingsItem
          icon={<Keyboard size={16} />}
          title="快捷键"
          desc="查看可用的键盘快捷键"
          onClick={onOpenShortcuts}
        />
        {isDesktop && (
          <SettingsItem
            icon={<RefreshCw size={16} />}
            title="检查更新"
            desc="检查并安装新版本"
            onClick={onOpenUpdate}
          />
        )}
      </SettingsGroup>

      <SettingsGroup title="安全">
        {!hasVault() && (
          <SettingsItem
            icon={<ShieldCheck size={16} />}
            title="设置密码库"
            desc="设置主密码，加密保存连接凭据"
            onClick={onSetupVault}
          />
        )}
        {hasVault() && vaultUnlocked && (
          <SettingsItem
            icon={<LockKeyhole size={16} />}
            title="锁定密码库"
            desc="锁定后保存的连接凭据将无法读取"
            onClick={lockVault}
          />
        )}
        {hasVault() && !vaultUnlocked && (
          <SettingsItem
            icon={<LockKeyhole size={16} />}
            title="解锁密码库"
            desc="输入主密码以读取加密的连接凭据"
            onClick={onUnlockVault}
          />
        )}
      </SettingsGroup>

      {(user?.role === 'admin' || authRequired) && (
        <SettingsGroup title="账户">
          {user?.role === 'admin' && (
            <SettingsItem
              icon={<Shield size={16} />}
              title="管理后台"
              desc="用户与审计日志管理"
              onClick={() => setShowAdmin(true)}
            />
          )}
          {authRequired && (
            <SettingsItem
              icon={<LogOut size={16} />}
              title="退出登录"
              desc={user ? `当前用户：${user.username}` : '退出当前账户'}
              onClick={() => void logout()}
              danger
            />
          )}
        </SettingsGroup>
      )}
    </div>
  );
}
