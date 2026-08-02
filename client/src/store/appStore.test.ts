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

  it('drops a tab whose initial connect fails with a fatal SSH error', async () => {
    const { useAppStore } = await import('./appStore');
    const sessionId = useAppStore.getState().createSession();
    useAppStore.setState({
      sessions: useAppStore.getState().sessions.map((session) => (
        session.id === sessionId ? { ...session, status: 'connecting' } : session
      )),
    });

    useAppStore.getState().handleWsMessage({
      type: 'error',
      sessionId,
      data: 'All configured authentication methods failed',
      fatal: true,
    });

    const state = useAppStore.getState();
    expect(state.sessions.some((item) => item.id === sessionId)).toBe(false);
    // The closed tab is replaced by a fresh idle one.
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].status).toBe('idle');
  });

  it('keeps a ready-session tab after a fatal SSH error', async () => {
    const { useAppStore } = await import('./appStore');
    const sessionId = useAppStore.getState().createSession();
    useAppStore.setState({
      sessions: useAppStore.getState().sessions.map((session) => (
        session.id === sessionId
          ? { ...session, status: 'ready', sftpStatus: 'ready', startedAt: Date.now() }
          : session
      )),
    });

    useAppStore.getState().handleWsMessage({
      type: 'error',
      sessionId,
      data: 'Connection reset by peer',
      fatal: true,
    });

    const session = useAppStore.getState().sessions.find((item) => item.id === sessionId);
    expect(session).toBeDefined();
    expect(session?.status).toBe('error');
  });

  it('drops still-connecting tabs when the WebSocket closes', async () => {
    const { useAppStore } = await import('./appStore');
    const sessionId = useAppStore.getState().createSession();
    useAppStore.setState({
      sessions: useAppStore.getState().sessions.map((session) => (
        session.id === sessionId ? { ...session, status: 'connecting' } : session
      )),
    });

    useAppStore.getState().handleWsMessage({ type: 'socket-closed' });

    const state = useAppStore.getState();
    expect(state.sessions.some((item) => item.id === sessionId)).toBe(false);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].status).toBe('idle');
  });
});

describe('saved connection upsert', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', storageMock());
    vi.stubGlobal('window', {
      setTimeout,
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('updates the edited entry in place instead of appending a duplicate', async () => {
    const { useAppStore } = await import('./appStore');
    useAppStore.setState({
      savedConnections: [
        { id: 1, name: 'prod', host: 'h1', port: 22, username: 'u1', encrypted: false },
      ],
      editingConnectionId: 1,
    });
    useAppStore.getState().setForm({ host: 'h2', port: 2222, username: 'u1', password: 'pw' });

    await useAppStore.getState().saveCurrentConnection('prod-renamed');

    const list = useAppStore.getState().savedConnections;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: 1,
      name: 'prod-renamed',
      host: 'h2',
      port: 2222,
      username: 'u1',
      password: 'pw',
    });
    expect(useAppStore.getState().editingConnectionId).toBeNull();
  });

  it('dedupes by host+port+username and keeps the custom name when preserveName is set', async () => {
    const { useAppStore } = await import('./appStore');
    useAppStore.setState({
      savedConnections: [
        { id: 7, name: 'my-server', host: 'h1', port: 22, username: 'u1', encrypted: false },
      ],
    });
    useAppStore.getState().setForm({ host: 'h1', port: 22, username: 'u1', password: 'newpass' });

    await useAppStore.getState().saveCurrentConnection('u1@h1', { silent: true, preserveName: true });

    const list = useAppStore.getState().savedConnections;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 7, name: 'my-server', password: 'newpass' });
  });

  it('keeps the recorded lastUsedAt when re-saving an entry manually', async () => {
    const { useAppStore } = await import('./appStore');
    useAppStore.setState({
      savedConnections: [
        { id: 3, name: 'nv', host: 'h1', port: 22, username: 'u1', encrypted: false, lastUsedAt: 12345 },
      ],
    });
    useAppStore.getState().setForm({ host: 'h1', port: 22, username: 'u1', password: 'pw2' });

    await useAppStore.getState().saveCurrentConnection('nv');

    const list = useAppStore.getState().savedConnections;
    expect(list).toHaveLength(1);
    expect(list[0].lastUsedAt).toBe(12345);
  });

  it('appends a new entry when nothing matches', async () => {
    const { useAppStore } = await import('./appStore');
    useAppStore.setState({
      savedConnections: [
        { id: 1, name: 'prod', host: 'h1', port: 22, username: 'u1', encrypted: false },
      ],
    });
    useAppStore.getState().setForm({ host: 'h9', port: 22, username: 'u9' });

    await useAppStore.getState().saveCurrentConnection('u9@h9', { silent: true, preserveName: true });

    const list = useAppStore.getState().savedConnections;
    expect(list).toHaveLength(2);
    expect(list[1]).toMatchObject({ name: 'u9@h9', host: 'h9', username: 'u9' });
  });
});

describe('connectSaved session reuse', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', storageMock());
    vi.stubGlobal('window', {
      setTimeout,
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('switches to an existing live session for the same host instead of duplicating it', async () => {
    const { useAppStore } = await import('./appStore');
    const connectActive = vi.fn();
    useAppStore.setState({
      connectActive,
      savedConnections: [
        { id: 1, name: 'nv', host: 'h1', port: 22, username: 'u1', password: 'pw', encrypted: false },
      ],
    });
    const sessionId = useAppStore.getState().createSession();
    useAppStore.setState({
      activePage: 'hosts',
      sessions: useAppStore.getState().sessions.map((session) => (
        session.id === sessionId
          ? { ...session, status: 'ready', host: 'h1', port: 22, username: 'u1' }
          : session
      )),
    });

    await useAppStore.getState().connectSaved(1);

    const state = useAppStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.activeSessionId).toBe(sessionId);
    expect(state.activePage).toBe('terminal');
    expect(connectActive).not.toHaveBeenCalled();
  });

  it('opens a new tab when the live session belongs to a different host', async () => {
    const { useAppStore } = await import('./appStore');
    const connectActive = vi.fn();
    useAppStore.setState({
      connectActive,
      savedConnections: [
        { id: 1, name: 'other', host: 'h2', port: 22, username: 'u2', password: 'pw', encrypted: false },
      ],
    });
    useAppStore.getState().createSession();
    useAppStore.setState({
      sessions: useAppStore.getState().sessions.map((session) => ({
        ...session,
        status: 'ready',
        host: 'h1',
        port: 22,
        username: 'u1',
      })),
    });

    await useAppStore.getState().connectSaved(1);

    const state = useAppStore.getState();
    expect(state.sessions).toHaveLength(2);
    expect(connectActive).toHaveBeenCalledTimes(1);
    expect(state.form.host).toBe('h2');
  });

  it('openFilesHost creates a dedicated hidden session without touching the tabs', async () => {
    const { useAppStore } = await import('./appStore');
    const connectActive = vi.fn();
    useAppStore.setState({
      connectActive,
      savedConnections: [
        { id: 7, name: 'ops', host: 'h9', port: 22, username: 'u9', password: 'pw', encrypted: false },
      ],
    });
    const activeBefore = useAppStore.getState().activeSessionId;
    const visibleBefore = useAppStore.getState().sessions.filter((s) => !s.hidden).length;

    await useAppStore.getState().openFilesHost(7);

    const state = useAppStore.getState();
    const bound = state.sessions.find((s) => s.id === state.filesPanes.right.target);
    expect(bound?.hidden).toBe(true);
    expect(state.activeSessionId).toBe(activeBefore);
    expect(state.sessions.filter((s) => !s.hidden)).toHaveLength(visibleBefore);
    expect(connectActive).toHaveBeenCalledWith(bound?.id);
  });

  it('openFilesHost binds to a live matching terminal session instead of connecting', async () => {
    const { useAppStore } = await import('./appStore');
    const connectActive = vi.fn();
    useAppStore.setState({
      connectActive,
      savedConnections: [
        { id: 7, name: 'ops', host: 'h9', port: 22, username: 'u9', password: 'pw', encrypted: false },
      ],
    });
    const liveId = useAppStore.getState().createSession();
    useAppStore.setState({
      sessions: useAppStore.getState().sessions.map((session) => (
        session.id === liveId
          ? { ...session, status: 'ready', host: 'h9', port: 22, username: 'u9' }
          : session
      )),
    });

    await useAppStore.getState().openFilesHost(7);

    const state = useAppStore.getState();
    expect(state.filesPanes.right.target).toBe(liveId);
    expect(connectActive).not.toHaveBeenCalled();
    expect(state.sessions.some((s) => s.hidden)).toBe(false);
  });

  it('closing the bound files session releases the binding and keeps a visible tab', async () => {
    const { useAppStore } = await import('./appStore');
    useAppStore.setState({
      connectActive: vi.fn(),
      savedConnections: [
        { id: 7, name: 'ops', host: 'h9', port: 22, username: 'u9', password: 'pw', encrypted: false },
      ],
    });
    await useAppStore.getState().openFilesHost(7);
    const filesId = useAppStore.getState().filesPanes.right.target as string;
    expect(useAppStore.getState().sessions.find((s) => s.id === filesId)?.hidden).toBe(true);

    // Close every visible tab, then the files session: a fresh visible tab must remain.
    for (const s of useAppStore.getState().sessions.filter((x) => !x.hidden)) {
      useAppStore.getState().closeSession(s.id);
    }
    useAppStore.getState().closeSession(filesId);

    const state = useAppStore.getState();
    expect(state.filesPanes.right.target).toBeNull();
    const visible = state.sessions.filter((s) => !s.hidden);
    expect(visible).toHaveLength(1);
    expect(state.activeSessionId).toBe(visible[0].id);
  });

  const sampleFile = {
    filename: 'a.txt', longname: '', isDir: false, size: 5, mtime: 0, mode: 0, perm: '',
  };

  const setupLocalToRemotePane = async () => {
    const { useAppStore } = await import('./appStore');
    const sessionId = useAppStore.getState().createSession();
    useAppStore.setState({
      sessions: useAppStore.getState().sessions.map((s) => (
        s.id === sessionId
          ? { ...s, status: 'ready' as const, sftpStatus: 'ready' as const, remotePath: '/srv' }
          : s
      )),
      filesPanes: { left: { target: 'local' }, right: { target: sessionId } },
      localPanes: {
        left: { path: '/tmp', files: [], listLoading: false, listRequestId: null },
        right: { path: null, files: [], listLoading: false, listRequestId: null },
      },
    });
    return sessionId;
  };

  it('transferToOtherPane sends TRANSFER_START with null sessionId for the local side', async () => {
    const { useAppStore } = await import('./appStore');
    const { sshSocket } = await import('../lib/ws');
    const send = vi.spyOn(sshSocket, 'send').mockReturnValue(true);
    const sessionId = await setupLocalToRemotePane();

    useAppStore.getState().transferToOtherPane('left', sampleFile);

    const call = send.mock.calls.find(
      ([msg]) => (msg as { type?: string }).type === 'transfer-start',
    );
    expect(call).toBeTruthy();
    const msg = call![0] as {
      id: string;
      src: { sessionId: string | null; path: string };
      dst: { sessionId: string | null; path: string };
    };
    expect(msg.src).toEqual({ sessionId: null, path: '/tmp/a.txt' });
    expect(msg.dst).toEqual({ sessionId, path: '/srv/a.txt' });
    expect(useAppStore.getState().paneTransfers.right?.id).toBe(msg.id);
    send.mockRestore();
  });

  it('stores LOCAL_LIST_RESULT on the pane that requested it', async () => {
    const { useAppStore } = await import('./appStore');
    useAppStore.setState({
      localPanes: {
        left: { path: null, files: [], listLoading: true, listRequestId: 'req-1' },
        right: { path: null, files: [], listLoading: false, listRequestId: null },
      },
    });

    useAppStore.getState().handleWsMessage({
      type: 'local-list-result',
      id: 'req-1',
      path: '/home/tester',
      files: [sampleFile],
    });

    const pane = useAppStore.getState().localPanes.left;
    expect(pane.path).toBe('/home/tester');
    expect(pane.files).toHaveLength(1);
    expect(pane.listLoading).toBe(false);
    expect(pane.listRequestId).toBeNull();
  });

  it('TRANSFER_PROGRESS/RESULT update then clear the destination pane transfer', async () => {
    const { useAppStore } = await import('./appStore');
    const { sshSocket } = await import('../lib/ws');
    const send = vi.spyOn(sshSocket, 'send').mockReturnValue(true);
    await setupLocalToRemotePane();

    useAppStore.getState().transferToOtherPane('left', sampleFile);
    const id = useAppStore.getState().paneTransfers.right?.id as string;
    expect(id).toBeTruthy();

    useAppStore.getState().handleWsMessage({
      type: 'transfer-progress', id, written: 3, total: 5, file: '/tmp/a.txt',
    });
    expect(useAppStore.getState().paneTransfers.right?.written).toBe(3);

    useAppStore.getState().handleWsMessage({ type: 'transfer-result', id, error: null });
    expect(useAppStore.getState().paneTransfers.right).toBeUndefined();
    send.mockRestore();
  });

  it('paneTouch on the local pane sends LOCAL_TOUCH and relists on result', async () => {
    const { useAppStore } = await import('./appStore');
    const { sshSocket } = await import('../lib/ws');
    const send = vi.spyOn(sshSocket, 'send').mockReturnValue(true);
    await setupLocalToRemotePane();

    useAppStore.getState().paneTouch('left', 'new.txt');

    const touchCall = send.mock.calls.find(
      ([msg]) => (msg as { type?: string }).type === 'local-touch',
    );
    expect(touchCall).toBeTruthy();
    const touchMsg = touchCall![0] as { id: string; path: string };
    expect(touchMsg.path).toBe('/tmp/new.txt');

    send.mockClear();
    useAppStore.getState().handleWsMessage({
      type: 'local-touch-result', id: touchMsg.id, error: null,
    });
    const relist = send.mock.calls.find(
      ([msg]) => (msg as { type?: string }).type === 'local-list',
    );
    expect(relist).toBeTruthy();
    send.mockRestore();
  });

  it('paneTouch on a remote pane reuses SFTP_WRITE with createOnly', async () => {
    const { useAppStore } = await import('./appStore');
    const { sshSocket } = await import('../lib/ws');
    const send = vi.spyOn(sshSocket, 'send').mockReturnValue(true);
    const sessionId = await setupLocalToRemotePane();

    useAppStore.getState().paneTouch('right', 'new.txt');

    const call = send.mock.calls.find(
      ([msg]) => (msg as { type?: string }).type === 'sftp-write',
    );
    expect(call).toBeTruthy();
    const msg = call![0] as {
      sessionId: string; path: string; content: string; createOnly: boolean;
    };
    expect(msg).toMatchObject({
      sessionId, path: '/srv/new.txt', content: '', createOnly: true,
    });
    send.mockRestore();
  });
});
