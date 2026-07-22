import { create } from 'zustand';
import type { CmdLogItem, JumpHost, RemoteFile } from '@shared/protocol';
import { MSG } from '@shared/protocol';
import { WS_BIN_KIND, PROGRESS_THROTTLE_MS } from '@shared/wsBinary';
import { sshSocket } from '../lib/ws';
import {
  decryptSecrets,
  encryptSecrets,
  hasVault,
  loadRawConnections,
  migrateLegacyConnections,
  saveRawConnections,
  setupVault,
  unlockVault,
  type SecretFields,
} from '../lib/crypto';

type DownloadBuf = {
  parts: BlobPart[];
  filename: string;
  size: number;
  written: number;
  sessionId: string;
  lastProgressAt: number;
};

/** Out-of-store download buffers to avoid Zustand churn / base64 copies. */
const downloadBuffers = new Map<string, DownloadBuf>();

function clearTransfersForSession(sessionId: string) {
  for (const [id, buf] of [...downloadBuffers.entries()]) {
    if (buf.sessionId !== sessionId) continue;
    sshSocket.send({ type: MSG.SFTP_DOWNLOAD_ABORT, sessionId, id });
    downloadBuffers.delete(id);
  }
}

export type SessionStatus = 'idle' | 'connecting' | 'ready' | 'disconnecting' | 'error';
export type SftpStatus = 'idle' | 'connecting' | 'ready' | 'error';

export type EditorFile = {
  id: string;
  sessionId: string;
  path: string;
  content: string;
  original: string;
  size: number;
  mtime: number | null;
  saving: boolean;
  writeId: string | null;
  savingContent: string | null;
  dirty: boolean;
};

export type ToastItem = {
  id: number;
  kind: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
};

export type SessionState = {
  id: string;
  label: string;
  status: SessionStatus;
  sftpStatus: SftpStatus;
  error: string | null;
  host?: string;
  port?: number;
  username?: string;
  remotePath: string;
  files: RemoteFile[];
  cmdLog: CmdLogItem[];
  serverInfo: Record<string, string> | null;
  transferProgress: { id: string; written: number; total: number; kind: 'up' | 'down' } | null;
  listRequestId: string | null;
  listLoading: boolean;
  fileOperation: string | null;
  workspaceMode: 'terminal' | 'editor';
  activeEditorId: string | null;
  startedAt: number | null;
};

export type ConnectForm = {
  host: string;
  port: number;
  username: string;
  password: string;
  privateKey: string;
  passphrase: string;
  authMode: 'password' | 'key';
  proxyType: string;
  proxyHost: string;
  proxyPort: number;
  useJump: boolean;
  jumpHost: string;
  jumpPort: number;
  jumpUsername: string;
  jumpPassword: string;
  jumpPrivateKey: string;
  jumpPassphrase: string;
  x11Forward: boolean;
  x11Trusted: boolean;
};

export type AuthUser = {
  id: number;
  username: string;
  role: 'admin' | 'user';
};

type AppState = {
  accessToken: string;
  authRequired: boolean;
  authenticated: boolean;
  authMode: 'users' | 'token' | 'none';
  user: AuthUser | null;
  showAdmin: boolean;
  vaultKey: CryptoKey | null;
  vaultUnlocked: boolean;
  sessions: SessionState[];
  activeSessionId: string | null;
  sidebarTab: string;
  termFontSize: number;
  filePanelOpen: boolean;
  bgUrl: string;
  bgOpacity: number;
  form: ConnectForm;
  snippets: { name: string; cmd: string }[];
  savedConnections: Array<Record<string, unknown>>;
  editors: EditorFile[];
  pendingPreviews: Record<string, { sessionId: string; path: string }>;
  pendingCreates: Record<string, { sessionId: string; path: string }>;
  toasts: ToastItem[];

  init: () => Promise<void>;
  loginAccess: (token: string) => Promise<boolean>;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  setShowAdmin: (show: boolean) => void;
  setupMaster: (password: string) => Promise<void>;
  unlockMaster: (password: string) => Promise<void>;
  lockVault: () => void;
  setForm: (patch: Partial<ConnectForm>) => void;
  setSidebarTab: (t: string) => void;
  setFontSize: (n: number) => void;
  toggleFilePanel: () => void;
  setBg: (url: string, opacity: number) => void;
  clearBg: () => void;
  createSession: () => string;
  setActiveSession: (id: string) => void;
  closeSession: (id: string) => void;
  connectActive: () => Promise<void>;
  applySavedConnection: (id: number) => Promise<boolean>;
  connectSaved: (id: number) => Promise<void>;
  disconnectActive: () => void;
  sendInput: (data: string, sessionId?: string) => void;
  sendResize: (cols: number, rows: number, sessionId?: string) => void;
  listFiles: (path?: string, sessionId?: string) => void;
  addCmdLog: (type: string, cmd: string, desc: string) => void;
  saveCurrentConnection: (name: string) => Promise<void>;
  deleteSaved: (id: number) => void;
  exportConnections: () => void;
  importConnections: (file: File) => Promise<void>;
  refreshServerInfo: () => void;
  runExec: (command: string, id?: string) => void;
  mkdir: (name: string) => void;
  rename: (from: string, to: string) => void;
  removePath: (path: string) => void;
  previewFile: (path: string) => void;
  createFile: (name: string) => void;
  setActiveEditor: (id: string) => void;
  showTerminal: () => void;
  setEditorContent: (id: string, content: string) => void;
  saveEditor: (id?: string) => void;
  closeEditor: (id: string, force?: boolean) => boolean;
  uploadFiles: (files: FileList | File[]) => Promise<void>;
  downloadFile: (remotePath: string) => void;
  setSnippets: (list: { name: string; cmd: string }[]) => void;
  notify: (kind: ToastItem['kind'], title: string, message?: string) => void;
  dismissToast: (id: number) => void;
  handleWsMessage: (msg: Record<string, unknown>) => void;
};

const DEFAULT_SNIPPETS = [
  { name: '查看磁盘', cmd: 'df -h' },
  { name: '查看内存', cmd: 'free -h' },
  { name: '查看进程', cmd: 'top -bn1 | head -20' },
  { name: '查看端口', cmd: 'ss -tlnp || netstat -tlnp' },
  { name: '系统信息', cmd: 'uname -a' },
  { name: '当前目录', cmd: 'pwd && ls -lah' },
  { name: 'Docker 容器', cmd: 'docker ps -a' },
  { name: '日志尾部', cmd: 'tail -n 100 /var/log/syslog 2>/dev/null || journalctl -n 50 --no-pager' },
];

const defaultForm = (): ConnectForm => ({
  host: '',
  port: 22,
  username: '',
  password: '',
  privateKey: '',
  passphrase: '',
  authMode: 'password',
  proxyType: '',
  proxyHost: '',
  proxyPort: 0,
  useJump: false,
  jumpHost: '',
  jumpPort: 22,
  jumpUsername: '',
  jumpPassword: '',
  jumpPrivateKey: '',
  jumpPassphrase: '',
  x11Forward: false,
  x11Trusted: false,
});

function newSession(label = '新会话'): SessionState {
  return {
    id: `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label,
    status: 'idle',
    sftpStatus: 'idle',
    error: null,
    remotePath: '/home',
    files: [],
    cmdLog: [],
    serverInfo: null,
    transferProgress: null,
    listRequestId: null,
    listLoading: false,
    fileOperation: null,
    workspaceMode: 'terminal',
    activeEditorId: null,
    startedAt: null,
  };
}

function patchSession(
  sessions: SessionState[],
  id: string,
  patch: Partial<SessionState>,
): SessionState[] {
  return sessions.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

const connectTimers = new Map<string, ReturnType<typeof setTimeout>>();
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(
  timers: Map<string, ReturnType<typeof setTimeout>>,
  id: string,
) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
}

async function applySession(sessionToken: string, user: AuthUser | null, authMode: AppState['authMode']) {
  localStorage.setItem('ssh_access_token', sessionToken);
  sshSocket.setToken(sessionToken);
  useAppStore.setState({
    accessToken: sessionToken,
    authenticated: true,
    authRequired: authMode !== 'none',
    authMode,
    user,
  });
  await sshSocket.ensureOpen().catch(() => undefined);
  if (sessionToken) {
    sshSocket.send({ type: MSG.AUTH, token: sessionToken });
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  accessToken: localStorage.getItem('ssh_access_token') || '',
  authRequired: false,
  authenticated: false,
  authMode: 'none',
  user: null,
  showAdmin: false,
  vaultKey: null,
  vaultUnlocked: !hasVault(),
  sessions: [],
  activeSessionId: null,
  sidebarTab: 'connect',
  termFontSize: parseInt(localStorage.getItem('ssh_font_size') || '14', 10) || 14,
  filePanelOpen: true,
  bgUrl: localStorage.getItem('ssh_bg_url') || '',
  bgOpacity: parseInt(localStorage.getItem('ssh_bg_opacity') || '15', 10) || 15,
  form: defaultForm(),
  snippets: (() => {
    try {
      const s = JSON.parse(localStorage.getItem('ssh_snippets') || 'null');
      return Array.isArray(s) ? s : DEFAULT_SNIPPETS;
    } catch {
      return DEFAULT_SNIPPETS;
    }
  })(),
  savedConnections: loadRawConnections() as Array<Record<string, unknown>>,
  editors: [],
  pendingPreviews: {},
  pendingCreates: {},
  toasts: [],

  init: async () => {
    const first = newSession('会话 1');
    set({ sessions: [first], activeSessionId: first.id, vaultUnlocked: !hasVault() });

    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      const mode = (data.authMode || (data.authRequired ? 'token' : 'none')) as AppState['authMode'];
      set({ authRequired: Boolean(data.authRequired), authMode: mode });
      if (!data.authRequired) {
        set({ authenticated: true, user: null });
      } else if (get().accessToken) {
        const me = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${get().accessToken}` },
        });
        if (me.ok) {
          const body = await me.json();
          await applySession(get().accessToken, body.user || null, mode);
        } else {
          localStorage.removeItem('ssh_access_token');
          set({ accessToken: '', authenticated: false, user: null });
        }
      }
    } catch {
      set({ authenticated: true, authRequired: false, authMode: 'none' });
    }

    sshSocket.setToken(get().accessToken);
    sshSocket.onMessage((msg) => get().handleWsMessage(msg));
    sshSocket.onBinary((frame) => {
      if (frame.kind !== WS_BIN_KIND.DOWNLOAD_CHUNK) return;
      const cur = downloadBuffers.get(frame.transferId);
      if (!cur) return;
      // Copy payload — the frame buffer may be reused by the socket stack.
      const copy = new Uint8Array(frame.payload.byteLength);
      copy.set(frame.payload);
      cur.parts.push(copy);
      cur.written += copy.byteLength;
      const now = Date.now();
      if (now - cur.lastProgressAt >= PROGRESS_THROTTLE_MS) {
        cur.lastProgressAt = now;
        set({
          sessions: patchSession(get().sessions, cur.sessionId, {
            transferProgress: {
              id: frame.transferId,
              written: cur.written,
              total: cur.size,
              kind: 'down',
            },
          }),
        });
      }
    });
    await sshSocket.ensureOpen().catch(() => undefined);
  },

  loginAccess: async (token: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    const sessionToken = data.token || token;
    await applySession(sessionToken, data.user || null, data.authMode || 'token');
    return true;
  },

  login: async (username: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data.token) return false;
    await applySession(data.token, data.user || null, data.authMode || 'users');
    return true;
  },

  logout: async () => {
    const token = get().accessToken;
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch {
      /* ignore */
    }
    localStorage.removeItem('ssh_access_token');
    sshSocket.setToken('');
    set({
      accessToken: '',
      authenticated: false,
      user: null,
      showAdmin: false,
      authRequired: get().authMode !== 'none',
    });
  },

  setShowAdmin: (show: boolean) => set({ showAdmin: show }),

  setupMaster: async (password: string) => {
    const key = await setupVault(password);
    const n = await migrateLegacyConnections(key);
    set({
      vaultKey: key,
      vaultUnlocked: true,
      savedConnections: loadRawConnections() as Array<Record<string, unknown>>,
    });
    if (n > 0) {
      console.info(`Migrated ${n} connections to encrypted vault`);
    }
  },

  unlockMaster: async (password: string) => {
    const key = await unlockVault(password);
    await migrateLegacyConnections(key);
    set({
      vaultKey: key,
      vaultUnlocked: true,
      savedConnections: loadRawConnections() as Array<Record<string, unknown>>,
    });
  },

  lockVault: () => set({ vaultKey: null, vaultUnlocked: false }),

  setForm: (patch) => set({ form: { ...get().form, ...patch } }),
  setSidebarTab: (t) => set({ sidebarTab: t }),
  setFontSize: (n) => {
    localStorage.setItem('ssh_font_size', String(n));
    set({ termFontSize: n });
  },
  toggleFilePanel: () => set({ filePanelOpen: !get().filePanelOpen }),
  setBg: (url, opacity) => {
    localStorage.setItem('ssh_bg_url', url);
    localStorage.setItem('ssh_bg_opacity', String(opacity));
    set({ bgUrl: url, bgOpacity: opacity });
  },
  clearBg: () => {
    localStorage.removeItem('ssh_bg_url');
    localStorage.removeItem('ssh_bg_opacity');
    set({ bgUrl: '', bgOpacity: 15 });
  },
  notify: (kind, title, message) => {
    const item: ToastItem = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      kind,
      title,
      message,
    };
    set({ toasts: [...get().toasts, item].slice(-5) });
    window.setTimeout(() => get().dismissToast(item.id), 4500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((item) => item.id !== id) }),

  createSession: () => {
    const s = newSession(`会话 ${get().sessions.length + 1}`);
    set({ sessions: [...get().sessions, s], activeSessionId: s.id, sidebarTab: 'connect' });
    return s.id;
  },

  setActiveSession: (id) => set({ activeSessionId: id }),

  closeSession: (id) => {
    clearTransfersForSession(id);
    sshSocket.send({ type: MSG.DISCONNECT, sessionId: id });
    clearTimer(connectTimers, id);
    clearTimer(disconnectTimers, id);
    const sessions = get().sessions.filter((s) => s.id !== id);
    const editors = get().editors.filter((editor) => editor.sessionId !== id);
    let active = get().activeSessionId;
    if (active === id) active = sessions[0]?.id || null;
    if (sessions.length === 0) {
      const s = newSession('会话 1');
      set({ sessions: [s], activeSessionId: s.id, editors });
      return;
    }
    set({ sessions, activeSessionId: active, editors });
  },

  connectActive: async () => {
    const { form, activeSessionId, sessions } = get();
    if (!activeSessionId) return;
    const sess = sessions.find((s) => s.id === activeSessionId);
    if (sess && ['connecting', 'ready', 'disconnecting'].includes(sess.status)) return;
    if (!form.host || !form.username) {
      get().notify('warning', '连接信息不完整', '请输入主机地址和用户名');
      return;
    }

    const label = `${form.username}@${form.host}`;
    set({
      sessions: patchSession(sessions, activeSessionId, {
        label,
        host: form.host,
        port: form.port,
        username: form.username,
        status: 'connecting',
        sftpStatus: 'idle',
        error: null,
        files: [],
        transferProgress: null,
      }),
    });
    window.dispatchEvent(new CustomEvent('ssh-term-write', {
      detail: {
        sessionId: activeSessionId,
        data: `\r\n\x1b[36m正在连接 ${form.username}@${form.host}:${form.port}…\x1b[0m\r\n`,
      },
    }));

    try {
      await sshSocket.ensureOpen();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'WebSocket 连接失败';
      set({
        sessions: patchSession(get().sessions, activeSessionId, {
          status: 'error',
          sftpStatus: 'idle',
          error: msg,
        }),
      });
      window.dispatchEvent(new CustomEvent('ssh-term-write', {
        detail: {
          sessionId: activeSessionId,
          data: `\r\n\x1b[31m${msg}\x1b[0m\r\n`,
        },
      }));
      get().notify('error', '连接失败', msg);
      return;
    }

    const jumpHost: JumpHost | null = form.useJump && form.jumpHost && form.jumpUsername
      ? {
          host: form.jumpHost,
          port: form.jumpPort || 22,
          username: form.jumpUsername,
          password: form.jumpPassword || undefined,
          privateKey: form.jumpPrivateKey || undefined,
          passphrase: form.jumpPassphrase || undefined,
        }
      : null;

    const xFlag = form.x11Forward ? (form.x11Trusted ? ' -Y' : ' -X') : '';
    get().addCmdLog(
      'connect',
      `ssh${xFlag} ${form.username}@${form.host} -p ${form.port}`,
      `连接 ${label}${form.x11Forward ? ' (X11)' : ''}`,
    );

    const sent = sshSocket.send({
      type: MSG.CONNECT,
      sessionId: activeSessionId,
      host: form.host,
      port: form.port,
      username: form.username,
      password: form.authMode === 'password' ? form.password : undefined,
      privateKey: form.authMode === 'key' ? form.privateKey : undefined,
      passphrase: form.passphrase || undefined,
      proxyType: form.proxyType || undefined,
      proxyHost: form.proxyHost || undefined,
      proxyPort: form.proxyPort || undefined,
      jumpHost,
      x11Forward: form.x11Forward || undefined,
      x11Trusted: form.x11Trusted || undefined,
    });
    if (!sent) {
      const message = '控制连接不可用，请重试';
      set({
        sessions: patchSession(get().sessions, activeSessionId, {
          status: 'error',
          error: message,
        }),
      });
      get().notify('error', '连接失败', message);
      return;
    }

    clearTimer(connectTimers, activeSessionId);
    connectTimers.set(activeSessionId, setTimeout(() => {
      const current = get().sessions.find((item) => item.id === activeSessionId);
      if (current?.status !== 'connecting') return;
      sshSocket.send({ type: MSG.DISCONNECT, sessionId: activeSessionId });
      set({
        sessions: patchSession(get().sessions, activeSessionId, {
          status: 'error',
          sftpStatus: 'idle',
          error: 'SSH 连接超时',
        }),
      });
      get().notify('error', '连接超时', '服务器在 25 秒内未完成 SSH 握手');
    }, 25_000));
  },

  applySavedConnection: async (id) => {
    const c = get().savedConnections.find((x) => x.id === id);
    if (!c) return false;
    let secrets: SecretFields = {
      password: (c.password as string) || '',
      privateKey: (c.privateKey as string) || '',
      passphrase: (c.passphrase as string) || '',
      jumpHost: (c.jumpHost as JumpHost) || null,
    };
    if (c.encrypted && typeof c.secrets === 'string') {
      const key = get().vaultKey;
      if (!key) {
        alert('请先解锁凭据保险库');
        return false;
      }
      secrets = await decryptSecrets(key, c.secrets);
    }
    const jump = secrets.jumpHost;
    set({
      form: {
        ...get().form,
        host: c.host as string,
        port: (c.port as number) || 22,
        username: c.username as string,
        password: secrets.password || '',
        privateKey: secrets.privateKey || '',
        passphrase: secrets.passphrase || '',
        authMode: secrets.privateKey ? 'key' : 'password',
        proxyType: (c.proxyType as string) || '',
        proxyHost: (c.proxyHost as string) || '',
        proxyPort: (c.proxyPort as number) || 0,
        useJump: Boolean(jump?.host),
        jumpHost: jump?.host || '',
        jumpPort: jump?.port || 22,
        jumpUsername: jump?.username || '',
        jumpPassword: jump?.password || '',
        jumpPrivateKey: jump?.privateKey || '',
        jumpPassphrase: jump?.passphrase || '',
        x11Forward: Boolean(c.x11Forward),
        x11Trusted: Boolean(c.x11Trusted),
      },
      sidebarTab: 'connect',
    });
    return true;
  },

  connectSaved: async (id) => {
    const ok = await get().applySavedConnection(id);
    if (ok) await get().connectActive();
  },

  disconnectActive: () => {
    const id = get().activeSessionId;
    if (!id) return;
    const sess = get().sessions.find((item) => item.id === id);
    if (!sess || !['connecting', 'ready', 'error'].includes(sess.status)) return;
    clearTransfersForSession(id);
    clearTimer(connectTimers, id);
    set({
      sessions: patchSession(get().sessions, id, {
        status: 'disconnecting',
        sftpStatus: 'idle',
        error: null,
      }),
    });
    const sent = sshSocket.send({ type: MSG.DISCONNECT, sessionId: id });
    get().addCmdLog('connect', 'exit', '断开连接');
    if (!sent) {
      set({
        sessions: patchSession(get().sessions, id, {
          status: 'idle',
          startedAt: null,
          files: [],
          transferProgress: null,
        }),
      });
      return;
    }
    clearTimer(disconnectTimers, id);
    disconnectTimers.set(id, setTimeout(() => {
      const current = get().sessions.find((item) => item.id === id);
      if (current?.status !== 'disconnecting') return;
      set({
        sessions: patchSession(get().sessions, id, {
          status: 'idle',
          sftpStatus: 'idle',
          startedAt: null,
          files: [],
          transferProgress: null,
        }),
      });
    }, 5_000));
  },

  sendInput: (data, sessionId) => {
    const id = sessionId || get().activeSessionId;
    if (!id) return;
    sshSocket.send({ type: MSG.INPUT, sessionId: id, data });
  },

  sendResize: (cols, rows, sessionId) => {
    const id = sessionId || get().activeSessionId;
    if (!id) return;
    sshSocket.send({ type: MSG.RESIZE, sessionId: id, cols, rows });
  },

  listFiles: (path, sessionId) => {
    const id = sessionId || get().activeSessionId;
    const sess = get().sessions.find((s) => s.id === id);
    if (!id || !sess || sess.sftpStatus !== 'ready') return;
    const p = path ?? sess.remotePath;
    const requestId = `list-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const sent = sshSocket.send({
      type: MSG.SFTP_LIST,
      sessionId: id,
      id: requestId,
      path: p,
    });
    if (!sent) {
      get().notify('error', '无法读取目录', '控制连接已断开');
      return;
    }
    set({
      sessions: patchSession(get().sessions, id, {
        listRequestId: requestId,
        listLoading: true,
      }),
    });
  },

  addCmdLog: (type, cmd, desc) => {
    const id = get().activeSessionId;
    if (!id) return;
    const item: CmdLogItem = {
      id: Date.now(),
      type,
      cmd,
      desc,
      time: new Date().toLocaleTimeString(),
    };
    set({
      sessions: get().sessions.map((s) =>
        (s.id === id ? { ...s, cmdLog: [item, ...s.cmdLog].slice(0, 200) } : s)),
    });
  },

  saveCurrentConnection: async (name) => {
    const { form, vaultKey } = get();
    if (!form.host || !form.username) {
      alert('请至少填写主机地址和用户名');
      return;
    }
    if (hasVault() && !vaultKey) {
      alert('请先解锁凭据保险库');
      return;
    }
    const jumpHost = form.useJump && form.jumpHost
      ? {
          host: form.jumpHost,
          port: form.jumpPort,
          username: form.jumpUsername,
          password: form.jumpPassword,
          privateKey: form.jumpPrivateKey,
          passphrase: form.jumpPassphrase,
        }
      : null;
    const secrets: SecretFields = {
      password: form.password,
      privateKey: form.privateKey,
      passphrase: form.passphrase,
      jumpHost,
    };
    let entry: Record<string, unknown>;
    if (vaultKey) {
      entry = {
        id: Date.now(),
        name,
        host: form.host,
        port: form.port,
        username: form.username,
        proxyType: form.proxyType,
        proxyHost: form.proxyHost,
        proxyPort: form.proxyPort,
        x11Forward: form.x11Forward,
        x11Trusted: form.x11Trusted,
        encrypted: true,
        secrets: await encryptSecrets(vaultKey, secrets),
      };
    } else {
      entry = {
        id: Date.now(),
        name,
        host: form.host,
        port: form.port,
        username: form.username,
        ...secrets,
        proxyType: form.proxyType,
        proxyHost: form.proxyHost,
        proxyPort: form.proxyPort,
        x11Forward: form.x11Forward,
        x11Trusted: form.x11Trusted,
        encrypted: false,
      };
    }
    const list = [...get().savedConnections, entry];
    saveRawConnections(list);
    set({ savedConnections: list, sidebarTab: 'saved' });
  },

  deleteSaved: (id) => {
    const list = get().savedConnections.filter((c) => c.id !== id);
    saveRawConnections(list);
    set({ savedConnections: list });
  },

  exportConnections: () => {
    const blob = new Blob([JSON.stringify(get().savedConnections, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'noe-ssh-connections.json';
    a.click();
  },

  importConnections: async (file) => {
    const text = await file.text();
    const incoming = JSON.parse(text) as Array<Record<string, unknown>>;
    const merged = [...get().savedConnections];
    for (const c of incoming) {
      if (!merged.some((x) => x.id === c.id)) merged.push(c);
    }
    saveRawConnections(merged);
    set({ savedConnections: merged });
  },

  refreshServerInfo: () => {
    const id = get().activeSessionId;
    const sess = get().sessions.find((item) => item.id === id);
    if (!id || sess?.status !== 'ready') return;
    sshSocket.send({ type: MSG.SERVER_INFO, sessionId: id, id: 'info' });
  },

  runExec: (command, execId) => {
    const id = get().activeSessionId;
    const sess = get().sessions.find((item) => item.id === id);
    if (!id || sess?.status !== 'ready') return;
    sshSocket.send({ type: MSG.EXEC, sessionId: id, id: execId || `exec-${Date.now()}`, command });
  },

  mkdir: (name) => {
    const id = get().activeSessionId;
    const sess = get().sessions.find((s) => s.id === id);
    if (!id || !sess || sess.sftpStatus !== 'ready') return;
    const path = `${sess.remotePath}/${name}`.replace(/\/+/g, '/');
    const opId = `mkdir-${Date.now()}`;
    get().addCmdLog('mkdir', `mkdir -p ${path}`, `新建文件夹 ${name}`);
    if (sshSocket.send({ type: MSG.SFTP_MKDIR, sessionId: id, id: opId, path })) {
      set({ sessions: patchSession(get().sessions, id, { fileOperation: opId }) });
    }
  },

  rename: (from, to) => {
    const id = get().activeSessionId;
    const sess = get().sessions.find((item) => item.id === id);
    if (!id || sess?.sftpStatus !== 'ready') return;
    const opId = `rename-${Date.now()}`;
    get().addCmdLog('rename', `mv ${from} ${to}`, '重命名');
    if (sshSocket.send({ type: MSG.SFTP_RENAME, sessionId: id, id: opId, from, to })) {
      set({ sessions: patchSession(get().sessions, id, { fileOperation: opId }) });
    }
  },

  removePath: (path) => {
    const id = get().activeSessionId;
    const sess = get().sessions.find((item) => item.id === id);
    if (!id || sess?.sftpStatus !== 'ready') return;
    const opId = `remove-${Date.now()}`;
    get().addCmdLog('rm', `rm -rf ${path}`, `删除 ${path}`);
    if (sshSocket.send({ type: MSG.SFTP_RM, sessionId: id, id: opId, path })) {
      set({ sessions: patchSession(get().sessions, id, { fileOperation: opId }) });
    }
  },

  previewFile: (path) => {
    const id = get().activeSessionId;
    const sess = get().sessions.find((item) => item.id === id);
    if (!id || sess?.sftpStatus !== 'ready') return;
    const existing = get().editors.find((editor) => editor.sessionId === id && editor.path === path);
    if (existing) {
      get().setActiveEditor(existing.id);
      return;
    }
    const requestId = `prev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    if (!sshSocket.send({ type: MSG.SFTP_PREVIEW, sessionId: id, id: requestId, path })) {
      get().notify('error', '无法打开文件', '控制连接已断开');
      return;
    }
    set({
      pendingPreviews: {
        ...get().pendingPreviews,
        [requestId]: { sessionId: id, path },
      },
    });
  },

  createFile: (name) => {
    const id = get().activeSessionId;
    const sess = get().sessions.find((item) => item.id === id);
    if (!id || sess?.sftpStatus !== 'ready') return;
    const path = `${sess.remotePath}/${name}`.replace(/\/+/g, '/');
    const requestId = `create-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    if (!sshSocket.send({
      type: MSG.SFTP_WRITE,
      sessionId: id,
      id: requestId,
      path,
      content: '',
      createOnly: true,
    })) {
      get().notify('error', '新建文件失败', '控制连接已断开');
      return;
    }
    set({
      pendingCreates: {
        ...get().pendingCreates,
        [requestId]: { sessionId: id, path },
      },
    });
  },

  setActiveEditor: (editorId) => {
    const editor = get().editors.find((item) => item.id === editorId);
    if (!editor) return;
    set({
      activeSessionId: editor.sessionId,
      sessions: patchSession(get().sessions, editor.sessionId, {
        activeEditorId: editorId,
        workspaceMode: 'editor',
      }),
    });
  },

  showTerminal: () => {
    const id = get().activeSessionId;
    if (!id) return;
    set({
      sessions: patchSession(get().sessions, id, { workspaceMode: 'terminal' }),
    });
  },

  setEditorContent: (editorId, content) => {
    set({
      editors: get().editors.map((editor) => (
        editor.id === editorId
          ? {
              ...editor,
              content,
              size: new Blob([content]).size,
              dirty: content !== editor.original,
            }
          : editor
      )),
    });
  },

  saveEditor: (editorId) => {
    const activeSession = get().sessions.find((item) => item.id === get().activeSessionId);
    const id = editorId || activeSession?.activeEditorId || '';
    const editor = get().editors.find((item) => item.id === id);
    const sess = editor && get().sessions.find((item) => item.id === editor.sessionId);
    if (!editor || !editor.dirty || editor.saving || sess?.sftpStatus !== 'ready') return;
    const writeId = `write-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set({
      editors: get().editors.map((item) => (
        item.id === editor.id
          ? { ...item, saving: true, writeId, savingContent: item.content }
          : item
      )),
    });
    get().addCmdLog('edit', `# write ${editor.path}`, `保存 ${editor.path}`);
    const sent = sshSocket.send({
      type: MSG.SFTP_WRITE,
      sessionId: editor.sessionId,
      id: writeId,
      path: editor.path,
      content: editor.content,
      expectedMtime: editor.mtime,
    });
    if (!sent) {
      set({
        editors: get().editors.map((item) => (
          item.id === editor.id
            ? { ...item, saving: false, writeId: null, savingContent: null }
            : item
        )),
      });
      get().notify('error', '保存失败', '控制连接已断开，修改内容仍保留在编辑器中');
      return;
    }
    clearTimer(saveTimers, writeId);
    saveTimers.set(writeId, setTimeout(() => {
      const current = get().editors.find((item) => item.writeId === writeId);
      if (!current) return;
      set({
        editors: get().editors.map((item) => (
          item.writeId === writeId
            ? { ...item, saving: false, writeId: null, savingContent: null }
            : item
        )),
      });
      get().notify('error', '保存超时', `${current.path} 的修改仍保留在编辑器中`);
    }, 15_000));
  },

  closeEditor: (editorId, force = false) => {
    const editor = get().editors.find((item) => item.id === editorId);
    if (!editor) return true;
    if (editor.dirty && !force) return false;
    if (editor.writeId) clearTimer(saveTimers, editor.writeId);
    const editors = get().editors.filter((item) => item.id !== editorId);
    const siblings = editors.filter((item) => item.sessionId === editor.sessionId);
    const next = siblings[siblings.length - 1] || null;
    set({
      editors,
      sessions: patchSession(get().sessions, editor.sessionId, {
        activeEditorId: next?.id || null,
        workspaceMode: next ? 'editor' : 'terminal',
      }),
    });
    return true;
  },

  uploadFiles: async (files) => {
    const id = get().activeSessionId;
    const sess = get().sessions.find((s) => s.id === id);
    if (!id || sess?.sftpStatus !== 'ready') return;
    for (const file of Array.from(files)) {
      const transferId = `up-${Date.now()}-${file.name}`;
      get().addCmdLog('upload', `scp "${file.name}" ${sess.username}@${sess.host}:${sess.remotePath}/${file.name}`, `上传 ${file.name}`);
      try {
        await sshSocket.uploadFile(id, transferId, sess.remotePath, file, (written, total) => {
          set({
            sessions: patchSession(get().sessions, id, {
              transferProgress: { id: transferId, written, total, kind: 'up' },
            }),
          });
        });
      } catch (err) {
        sshSocket.send({ type: MSG.SFTP_UPLOAD_ABORT, sessionId: id, id: transferId });
        set({
          sessions: patchSession(get().sessions, id, { transferProgress: null }),
        });
        get().notify(
          'error',
          `上传 ${file.name} 失败`,
          err instanceof Error ? err.message : String(err),
        );
        break;
      }
    }
  },

  downloadFile: (remotePath) => {
    const id = get().activeSessionId;
    const sess = get().sessions.find((s) => s.id === id);
    if (!id || !sess || sess.sftpStatus !== 'ready') return;
    const transferId = `dl-${Date.now()}`;
    get().addCmdLog('download', `scp ${sess.username}@${sess.host}:${remotePath} ./`, `下载 ${remotePath}`);
    downloadBuffers.set(transferId, {
      parts: [],
      filename: remotePath.split('/').pop() || 'file',
      size: 0,
      written: 0,
      sessionId: id,
      lastProgressAt: 0,
    });
    if (!sshSocket.send({
      type: MSG.SFTP_DOWNLOAD_START,
      sessionId: id,
      id: transferId,
      remotePath,
    })) {
      downloadBuffers.delete(transferId);
      get().notify('error', '下载失败', '控制连接已断开');
    }
  },

  setSnippets: (list) => {
    localStorage.setItem('ssh_snippets', JSON.stringify(list));
    set({ snippets: list });
  },

  handleWsMessage: (msg) => {
    const type = msg.type as string;
    const sessionId = (msg.sessionId as string) || get().activeSessionId;
    const friendlySftpError = (raw: unknown) => {
      const text = String(raw || '未知错误');
      if (/Channel open failure|open failed/i.test(text)) {
        return 'SFTP 通道打开失败，请断开后重新连接再试';
      }
      if (/No such file|ENOENT/i.test(text)) return '路径不存在';
      if (/Permission denied/i.test(text)) return '权限不足';
      if (/already exists|FILE_EXISTS/i.test(text)) return '同名文件已存在';
      return text;
    };

    if (type === MSG.AUTH_OK) {
      set({ authenticated: true });
      return;
    }
    if (type === MSG.AUTH_REQUIRED) {
      set({ authRequired: true, authenticated: false });
      return;
    }
    if (type === MSG.AUTH_FAIL) {
      get().notify('error', '认证失败', String(msg.data || '访问令牌无效'));
      return;
    }
    if (type === 'socket-closed') {
      for (const id of connectTimers.keys()) clearTimer(connectTimers, id);
      for (const id of disconnectTimers.keys()) clearTimer(disconnectTimers, id);
      set({
        sessions: get().sessions.map((session) => ({
          ...session,
          status: session.status === 'idle' ? 'idle' : 'error',
          sftpStatus: 'idle',
          error: session.status === 'idle' ? session.error : '控制连接已断开',
          startedAt: null,
          files: [],
          listLoading: false,
          listRequestId: null,
          fileOperation: null,
          transferProgress: null,
        })),
        editors: get().editors.map((editor) => ({
          ...editor,
          saving: false,
          writeId: null,
          savingContent: null,
        })),
      });
      get().notify('error', '连接已中断', '与 Noe-SSH 服务的连接断开，可直接重新连接');
      return;
    }

    if (!sessionId) return;

    if (type === MSG.CONNECTED) {
      clearTimer(connectTimers, sessionId);
      set({
        sessions: patchSession(get().sessions, sessionId, {
          status: 'ready',
          sftpStatus: 'connecting',
          error: null,
          startedAt: Date.now(),
        }),
      });
      return;
    }

    if ((type === MSG.SFTP_READY || type === MSG.HOME_DIR) && msg.path) {
      set({
        sessions: patchSession(get().sessions, sessionId, {
          sftpStatus: 'ready',
          remotePath: msg.path as string,
        }),
      });
      get().listFiles(msg.path as string, sessionId);
      return;
    }

    if (type === MSG.SFTP_ERROR) {
      const message = friendlySftpError(msg.error);
      set({
        sessions: patchSession(get().sessions, sessionId, {
          sftpStatus: 'error',
          error: `文件通道：${message}`,
        }),
      });
      get().notify('warning', 'SSH 已连接，但文件通道不可用', message);
      return;
    }

    if (type === MSG.DISCONNECTED) {
      clearTransfersForSession(sessionId);
      clearTimer(connectTimers, sessionId);
      clearTimer(disconnectTimers, sessionId);
      set({
        sessions: patchSession(get().sessions, sessionId, {
          status: 'idle',
          sftpStatus: 'idle',
          error: null,
          startedAt: null,
          files: [],
          listLoading: false,
          listRequestId: null,
          fileOperation: null,
          transferProgress: null,
        }),
        editors: get().editors.map((editor) => (
          editor.sessionId === sessionId
            ? { ...editor, saving: false, writeId: null, savingContent: null }
            : editor
        )),
      });
      return;
    }

    if (type === MSG.ERROR) {
      clearTimer(connectTimers, sessionId);
      const message = String(msg.data || 'SSH 连接错误');
      const current = get().sessions.find((session) => session.id === sessionId);
      set({
        sessions: patchSession(get().sessions, sessionId, {
          status: msg.fatal || current?.status === 'connecting' ? 'error' : (current?.status || 'error'),
          sftpStatus: msg.fatal ? 'idle' : (current?.sftpStatus || 'idle'),
          error: message,
          startedAt: msg.fatal ? null : current?.startedAt || null,
        }),
      });
      window.dispatchEvent(new CustomEvent('ssh-term-write', {
        detail: { sessionId, data: `\r\n\x1b[31m${message}\x1b[0m\r\n` },
      }));
      get().notify('error', 'SSH 错误', message);
      return;
    }

    if (type === MSG.DATA) {
      window.dispatchEvent(new CustomEvent('ssh-term-write', {
        detail: { sessionId, data: msg.data as string },
      }));
      return;
    }

    if (type === MSG.SFTP_LIST_RESULT) {
      const sess = get().sessions.find((session) => session.id === sessionId);
      if (!sess || (msg.id && sess.listRequestId !== msg.id)) return;
      if (msg.error) {
        set({
          sessions: patchSession(get().sessions, sessionId, {
            listLoading: false,
            listRequestId: null,
          }),
        });
        get().notify('error', '目录读取失败', friendlySftpError(msg.error));
        return;
      }
      set({
        sessions: patchSession(get().sessions, sessionId, {
          remotePath: (msg.path as string) || sess.remotePath || '/',
          files: (msg.files as RemoteFile[]) || [],
          listLoading: false,
          listRequestId: null,
        }),
      });
      return;
    }

    if (type === MSG.SFTP_UPLOAD_PROGRESS) {
      set({
        sessions: patchSession(get().sessions, sessionId, {
          transferProgress: {
            id: msg.id as string,
            written: msg.written as number,
            total: msg.total as number,
            kind: 'up',
          },
        }),
      });
      return;
    }

    if (type === MSG.SFTP_UPLOAD_RESULT) {
      if (msg.error) get().notify('error', '上传失败', friendlySftpError(msg.error));
      set({
        sessions: patchSession(get().sessions, sessionId, { transferProgress: null }),
      });
      if (!msg.error) {
        get().notify('success', '上传完成');
        get().listFiles(undefined, sessionId);
      }
      return;
    }

    if (type === MSG.SFTP_DOWNLOAD_META) {
      const cur = downloadBuffers.get(msg.id as string);
      if (cur) {
        cur.filename = (msg.filename as string) || cur.filename;
        cur.size = (msg.size as number) || 0;
        set({
          sessions: patchSession(get().sessions, sessionId, {
            transferProgress: {
              id: msg.id as string,
              written: 0,
              total: cur.size,
              kind: 'down',
            },
          }),
        });
      }
      return;
    }

    // JSON DOWNLOAD_CHUNK is progress-only (payload arrives via binary frames).
    if (type === MSG.SFTP_DOWNLOAD_CHUNK) {
      const cur = downloadBuffers.get(msg.id as string);
      if (cur && typeof msg.written === 'number') {
        cur.written = Math.max(cur.written, msg.written as number);
        set({
          sessions: patchSession(get().sessions, sessionId, {
            transferProgress: {
              id: msg.id as string,
              written: cur.written,
              total: (msg.total as number) || cur.size,
              kind: 'down',
            },
          }),
        });
      }
      return;
    }

    if (type === MSG.SFTP_DOWNLOAD_RESULT) {
      if (msg.error) {
        get().notify('error', '下载失败', friendlySftpError(msg.error));
        downloadBuffers.delete(msg.id as string);
      } else {
        const cur = downloadBuffers.get(msg.id as string);
        if (cur) {
          const blob = new Blob(cur.parts);
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = (msg.filename as string) || cur.filename;
          a.click();
          URL.revokeObjectURL(a.href);
          downloadBuffers.delete(msg.id as string);
          get().notify('success', '下载完成', cur.filename);
        }
      }
      set({
        sessions: patchSession(get().sessions, sessionId, { transferProgress: null }),
      });
      return;
    }

    if (type === MSG.SFTP_MKDIR_RESULT || type === MSG.SFTP_RENAME_RESULT || type === MSG.SFTP_RM_RESULT) {
      const sess = get().sessions.find((session) => session.id === sessionId);
      if (msg.id && sess?.fileOperation && sess.fileOperation !== msg.id) return;
      let editors = get().editors;
      let sessions = get().sessions;
      if (!msg.error && type === MSG.SFTP_RENAME_RESULT && msg.from && msg.to) {
        const from = msg.from as string;
        const to = msg.to as string;
        const idChanges = new Map<string, string>();
        editors = editors.map((editor) => {
          if (
            editor.sessionId !== sessionId
            || (editor.path !== from && !editor.path.startsWith(`${from}/`))
          ) {
            return editor;
          }
          const path = `${to}${editor.path.slice(from.length)}`;
          const id = `${sessionId}::${path}`;
          idChanges.set(editor.id, id);
          return { ...editor, id, path };
        });
        sessions = sessions.map((session) => (
          session.id === sessionId && session.activeEditorId
            ? {
                ...session,
                activeEditorId: idChanges.get(session.activeEditorId) || session.activeEditorId,
              }
            : session
        ));
      }
      if (!msg.error && type === MSG.SFTP_RM_RESULT && msg.path) {
        const removedPath = msg.path as string;
        const removedIds = new Set(
          editors
            .filter((editor) =>
              editor.sessionId === sessionId
              && (editor.path === removedPath || editor.path.startsWith(`${removedPath}/`)))
            .map((editor) => editor.id),
        );
        editors = editors.filter((editor) => !removedIds.has(editor.id));
        sessions = sessions.map((session) => {
          if (session.id !== sessionId || !session.activeEditorId || !removedIds.has(session.activeEditorId)) {
            return session;
          }
          const fallback = editors.filter((editor) => editor.sessionId === sessionId).at(-1);
          return {
            ...session,
            activeEditorId: fallback?.id || null,
            workspaceMode: fallback ? 'editor' : 'terminal',
          };
        });
      }
      set({
        editors,
        sessions: patchSession(sessions, sessionId, { fileOperation: null }),
      });
      if (msg.error) get().notify('error', '文件操作失败', friendlySftpError(msg.error));
      else get().listFiles(undefined, sessionId);
      return;
    }

    if (type === MSG.SFTP_PREVIEW_RESULT) {
      const requestId = msg.id as string;
      const pending = get().pendingPreviews[requestId];
      if (!pending) return;
      const pendingPreviews = { ...get().pendingPreviews };
      delete pendingPreviews[requestId];
      if (msg.error) {
        set({ pendingPreviews });
        get().notify('error', '无法打开文件', friendlySftpError(msg.error));
        return;
      }
      if (msg.binary) {
        set({ pendingPreviews });
        get().notify('warning', '无法在线编辑', '二进制文件请下载后修改');
        return;
      }
      const content = (msg.content as string) || '';
      const path = (msg.path as string) || pending.path;
      const editorId = `${pending.sessionId}::${path}`;
      const editor: EditorFile = {
        id: editorId,
        sessionId: pending.sessionId,
        path,
        content,
        original: content,
        size: (msg.size as number) || new Blob([content]).size,
        mtime: typeof msg.mtime === 'number' ? msg.mtime : null,
        saving: false,
        writeId: null,
        savingContent: null,
        dirty: false,
      };
      const editors = get().editors.some((item) => item.id === editorId)
        ? get().editors.map((item) => (item.id === editorId ? editor : item))
        : [...get().editors, editor];
      set({
        pendingPreviews,
        editors,
        sessions: patchSession(get().sessions, pending.sessionId, {
          activeEditorId: editorId,
          workspaceMode: 'editor',
        }),
      });
      return;
    }

    if (type === MSG.SFTP_WRITE_RESULT) {
      const requestId = msg.id as string;
      const pendingCreate = get().pendingCreates[requestId];
      if (pendingCreate) {
        const pendingCreates = { ...get().pendingCreates };
        delete pendingCreates[requestId];
        set({ pendingCreates });
        if (msg.error) {
          get().notify('error', '新建文件失败', friendlySftpError(msg.error));
          return;
        }
        get().listFiles(undefined, pendingCreate.sessionId);
        const previewId = `prev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const pendingPreviews = {
          ...get().pendingPreviews,
          [previewId]: pendingCreate,
        };
        set({ pendingPreviews });
        sshSocket.send({
          type: MSG.SFTP_PREVIEW,
          sessionId: pendingCreate.sessionId,
          id: previewId,
          path: pendingCreate.path,
        });
        return;
      }

      const editor = get().editors.find((item) => item.writeId === requestId);
      if (!editor) return;
      clearTimer(saveTimers, requestId);
      if (msg.error) {
        set({
          editors: get().editors.map((item) => (
            item.id === editor.id
              ? { ...item, saving: false, writeId: null, savingContent: null }
              : item
          )),
        });
        get().notify(
          msg.code === 'FILE_CONFLICT' ? 'warning' : 'error',
          msg.code === 'FILE_CONFLICT' ? '检测到远端修改' : '保存失败',
          friendlySftpError(msg.error),
        );
        return;
      }
      const savedContent = editor.savingContent ?? editor.content;
      set({
        editors: get().editors.map((item) => (
          item.id === editor.id
            ? {
                ...item,
                original: savedContent,
                dirty: item.content !== savedContent,
                saving: false,
                writeId: null,
                savingContent: null,
                size: (msg.size as number) || new Blob([savedContent]).size,
                mtime: typeof msg.mtime === 'number' ? msg.mtime : item.mtime,
              }
            : item
        )),
      });
      get().notify('success', '文件已保存', editor.path);
      get().listFiles(undefined, sessionId);
      return;
    }

    if (type === MSG.SERVER_INFO_RESULT) {
      if (msg.error) return;
      set({
        sessions: patchSession(get().sessions, sessionId, {
          serverInfo: msg.info as Record<string, string>,
        }),
      });
      return;
    }

    if (type === MSG.EXEC_RESULT) {
      const text = msg.error
        ? `\r\n\x1b[31m${msg.error}\x1b[0m\r\n`
        : `\r\n${msg.output || ''}\r\n`;
      window.dispatchEvent(new CustomEvent('ssh-term-write', { detail: { sessionId, data: text } }));
    }
  },
}));
