import { useAppStore } from '../../store/appStore';
import { Workspace } from '../Workspace';
import { NewTabPage } from './NewTabPage';

export function TerminalPage({ visible = true }: { visible?: boolean }) {
  // A tab that never connected shows the New Tab landing instead of a dead terminal.
  const fresh = useAppStore((s) => {
    const sess = s.sessions.find((item) => item.id === s.activeSessionId);
    return !sess || (sess.status === 'idle' && !sess.host);
  });
  if (fresh) return <NewTabPage />;
  return <Workspace visible={visible} />;
}
