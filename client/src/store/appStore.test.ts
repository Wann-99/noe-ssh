import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function storageMock(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

describe('session connection state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', storageMock());
    vi.stubGlobal('window', {
      setTimeout,
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('invalidates every live SSH session when WebSocket closes', async () => {
    const { useAppStore } = await import('./appStore');
    const sessionId = useAppStore.getState().createSession();
    useAppStore.setState({
      sessions: useAppStore.getState().sessions.map((session) => (
        session.id === sessionId
          ? {
              ...session,
              status: 'ready',
              sftpStatus: 'ready',
              startedAt: Date.now(),
            }
          : session
      )),
    });

    useAppStore.getState().handleWsMessage({ type: 'socket-closed' });
    const session = useAppStore.getState().sessions.find((item) => item.id === sessionId);

    expect(session?.status).toBe('error');
    expect(session?.sftpStatus).toBe('idle');
    expect(session?.startedAt).toBeNull();
    expect(session?.error).toBe('控制连接已断开');
  });
});
