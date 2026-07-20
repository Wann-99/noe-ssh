import { create } from 'zustand';
import type { CmdLogItem, JumpHost, RemoteFile } from '@shared/protocol';
import { MSG } from '@shared/protocol';
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

export type SessionState = {
  id: string;
  label: string;
  connected: boolean;
  connecting: boolean;
  host?: string;
  port?: number;
  username?: string;
  remotePath: string;
  files: RemoteFile[];
  cmdLog: CmdLogItem[];
  serverInfo: Record<string, string> | null;
  transferProgress: { id: string; written: number; total: number; kind: 'up' | 'down' } | null;
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

type AppState = {
  accessToken: string;
  authRequired: boolean;
  authenticated: boolean;
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
  preview: {
    path: string;
    content: string;
    original: string;
    size: number;
    saving: boolean;
    dirty: boolean;
  } | null;
  downloadBuffers: Map<string, { chunks: string[]; filename: string; size: number }>;

  init: () => Promise<void>;
  loginAccess: (token: string) => Promise<boolean>;
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
  sendInput: (data: string) => void;
  sendResize: (cols: number, rows: number) => void;
  listFiles: (path?: string) => void;
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
  setPreviewContent: (content: string) => void;
  savePreviewFile: () => void;
  closePreview: () => void;
  uploadFiles: (files: FileList | File[]) => Promise<void>;
  downloadFile: (remotePath: string) => void;
  setSnippets: (list: { name: string; cmd: string }[]) => void;
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
    connected: false,
    connecting: false,
    remotePath: '/home',
    files: [],
    cmdLog: [],
    serverInfo: null,
    transferProgress: null,
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

export const useAppStore = create<AppState>((set, get) => ({
  accessToken: localStorage.getItem('ssh_access_token') || '',
  authRequired: false,
  authenticated: false,
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
  preview: null,
  downloadBuffers: new Map(),

  init: async () => {
    const first = newSession('会话 1');
    set({ sessions: [first], activeSessionId: first.id, vaultUnlocked: !hasVault() });

    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      set({ authRequired: Boolean(data.authRequired) });
      if (!data.authRequired) {
        set({ authenticated: true });
      } else if (get().accessToken) {
        await get().loginAccess(get().accessToken);
      }
    } catch {
      set({ authenticated: true, authRequired: false });
    }

    sshSocket.setToken(get().accessToken);
    sshSocket.onMessage((msg) => get().handleWsMessage(msg));
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
    localStorage.setItem('ssh_access_token', sessionToken);
    sshSocket.setToken(sessionToken);
    set({ accessToken: sessionToken, authenticated: true, authRequired: true });
    await sshSocket.ensureOpen();
    sshSocket.send({ type: MSG.AUTH, token: sessionToken });
    return true;
  },

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

  createSession: () => {
    const s = newSession(`会话 ${get().sessions.length + 1}`);
    set({ sessions: [...get().sessions, s], activeSessionId: s.id, sidebarTab: 'connect' });
    return s.id;
  },

  setActiveSession: (id) => set({ activeSessionId: id }),

  closeSession: (id) => {
    sshSocket.send({ type: MSG.DISCONNECT, sessionId: id });
    const sessions = get().sessions.filter((s) => s.id !== id);
    let active = get().activeSessionId;
    if (active === id) active = sessions[0]?.id || null;
    if (sessions.length === 0) {
      const s = newSession('会话 1');
      set({ sessions: [s], activeSessionId: s.id });
      return;
    }
    set({ sessions, activeSessionId: active });
  },

  connectActive: async () => {
    const { form, activeSessionId, sessions } = get();
    if (!activeSessionId) return;
    const sess = sessions.find((s) => s.id === activeSessionId);
    if (sess?.connecting || sess?.connected) return;
    if (!form.host || !form.username) {
      alert('请输入主机地址和用户名');
      return;
    }

    const label = `${form.username}@${form.host}`;
    set({
      sessions: patchSession(sessions, activeSessionId, {
        label,
        host: form.host,
        port: form.port,
        username: form.username,
        connecting: true,
        connected: false,
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
        sessions: patchSession(get().sessions, activeSessionId, { connecting: false }),
      });
      window.dispatchEvent(new CustomEvent('ssh-term-write', {
        detail: {
          sessionId: activeSessionId,
          data: `\r\n\x1b[31m${msg}\x1b[0m\r\n`,
        },
      }));
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

    sshSocket.send({
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
    set({
      sessions: patchSession(get().sessions, id, { connecting: false }),
    });
    sshSocket.send({ type: MSG.DISCONNECT, sessionId: id });
    get().addCmdLog('connect', 'exit', '断开连接');
  },

  sendInput: (data) => {
    const id = get().activeSessionId;
    if (!id) return;
    sshSocket.send({ type: MSG.INPUT, sessionId: id, data });
  },

  sendResize: (cols, rows) => {
    const id = get().activeSessionId;
    if (!id) return;
    sshSocket.send({ type: MSG.RESIZE, sessionId: id, cols, rows });
  },

  listFiles: (path) => {
    const id = get().activeSessionId;
    const sess = get().sessions.find((s) => s.id === id);
    if (!id || !sess) return;
    const p = path ?? sess.remotePath;
    sshSocket.send({ type: MSG.SFTP_LIST, sessionId: id, id: `list-${Date.now()}`, path: p });
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
    if (!id) return;
    sshSocket.send({ type: MSG.SERVER_INFO, sessionId: id, id: 'info' });
  },

  runExec: (command, execId) => {
    const id = get().activeSessionId;
    if (!id) return;
    sshSocket.send({ type: MSG.EXEC, sessionId: id, id: execId || `exec-${Date.now()}`, command });
  },

  mkdir: (name) => {
    const id = get().activeSessionId;
    const sess = get().sessions.find((s) => s.id === id);
    if (!id || !sess) return;
    const path = `${sess.remotePath}/${name}`.replace(/\/+/g, '/');
    get().addCmdLog('mkdir', `mkdir -p ${path}`, `新建文件夹 ${name}`);
    sshSocket.send({ type: MSG.SFTP_MKDIR, sessionId: id, path });
  },

  rename: (from, to) => {
    const id = get().activeSessionId;
    if (!id) return;
    get().addCmdLog('rename', `mv ${from} ${to}`, '重命名');
    sshSocket.send({ type: MSG.SFTP_RENAME, sessionId: id, from, to });
  },

  removePath: (path) => {
    const id = get().activeSessionId;
    if (!id) return;
    get().addCmdLog('rm', `rm -rf ${path}`, `删除 ${path}`);
    sshSocket.send({ type: MSG.SFTP_RM, sessionId: id, path });
  },

  previewFile: (path) => {
    const id = get().activeSessionId;
    if (!id) return;
    sshSocket.send({ type: MSG.SFTP_PREVIEW, sessionId: id, id: `prev-${Date.now()}`, path });
  },

  setPreviewContent: (content) => {
    const prev = get().preview;
    if (!prev) return;
    set({
      preview: {
        ...prev,
        content,
        dirty: content !== prev.original,
      },
    });
  },

  savePreviewFile: () => {
    const id = get().activeSessionId;
    const prev = get().preview;
    if (!id || !prev || prev.saving) return;
    set({ preview: { ...prev, saving: true } });
    get().addCmdLog('edit', `# write ${prev.path}`, `保存 ${prev.path}`);
    sshSocket.send({
      type: MSG.SFTP_WRITE,
      sessionId: id,
      id: `write-${Date.now()}`,
      path: prev.path,
      content: prev.content,
    });
  },

  closePreview: () => {
    const prev = get().preview;
    if (prev?.dirty && !confirm('文件已修改，确定关闭而不保存？')) return;
    set({ preview: null });
  },

  uploadFiles: async (files) => {
    const id = get().activeSessionId;
    const sess = get().sessions.find((s) => s.id === id);
    if (!id || !sess?.connected) return;
    for (const file of Array.from(files)) {
      const transferId = `up-${Date.now()}-${file.name}`;
      get().addCmdLog('upload', `scp "${file.name}" ${sess.username}@${sess.host}:${sess.remotePath}/${file.name}`, `上传 ${file.name}`);
      await sshSocket.uploadFile(id, transferId, sess.remotePath, file, (written, total) => {
        set({
          sessions: patchSession(get().sessions, id, {
            transferProgress: { id: transferId, written, total, kind: 'up' },
          }),
        });
      });
    }
  },

  downloadFile: (remotePath) => {
    const id = get().activeSessionId;
    const sess = get().sessions.find((s) => s.id === id);
    if (!id || !sess) return;
    const transferId = `dl-${Date.now()}`;
    get().addCmdLog('download', `scp ${sess.username}@${sess.host}:${remotePath} ./`, `下载 ${remotePath}`);
    const buffers = new Map(get().downloadBuffers);
    buffers.set(transferId, { chunks: [], filename: remotePath.split('/').pop() || 'file', size: 0 });
    set({ downloadBuffers: buffers });
    sshSocket.send({ type: MSG.SFTP_DOWNLOAD_START, sessionId: id, id: transferId, remotePath });
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
      alert(String(msg.data || '认证失败'));
      return;
    }

    if (!sessionId) return;

    if (type === MSG.CONNECTED) {
      set({
        sessions: patchSession(get().sessions, sessionId, {
          connected: true,
          connecting: false,
          startedAt: Date.now(),
        }),
      });
      // Wait for HOME_DIR before listing to avoid racing SFTP open with shell setup
      return;
    }

    if (type === MSG.HOME_DIR && msg.path) {
      set({
        sessions: patchSession(get().sessions, sessionId, { remotePath: msg.path as string }),
      });
      get().listFiles(msg.path as string);
      return;
    }

    if (type === MSG.DISCONNECTED) {
      set({
        sessions: patchSession(get().sessions, sessionId, {
          connected: false,
          connecting: false,
          startedAt: null,
          files: [],
          transferProgress: null,
        }),
      });
      return;
    }

    if (type === MSG.ERROR) {
      set({
        sessions: patchSession(get().sessions, sessionId, { connecting: false }),
      });
      // terminal component listens via custom event
      window.dispatchEvent(new CustomEvent('ssh-term-write', {
        detail: { sessionId, data: `\r\n\x1b[31m${msg.data}\x1b[0m\r\n` },
      }));
      return;
    }

    if (type === MSG.DATA) {
      window.dispatchEvent(new CustomEvent('ssh-term-write', {
        detail: { sessionId, data: msg.data as string },
      }));
      return;
    }

    if (type === MSG.SFTP_LIST_RESULT) {
      if (msg.error) {
        alert(`列表失败: ${friendlySftpError(msg.error)}`);
        return;
      }
      set({
        sessions: patchSession(get().sessions, sessionId, {
          remotePath: (msg.path as string) || get().sessions.find((s) => s.id === sessionId)?.remotePath || '/',
          files: (msg.files as RemoteFile[]) || [],
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
      if (msg.error) alert(`上传失败: ${friendlySftpError(msg.error)}`);
      set({
        sessions: patchSession(get().sessions, sessionId, { transferProgress: null }),
      });
      if (!msg.error) get().listFiles();
      return;
    }

    if (type === MSG.SFTP_DOWNLOAD_META) {
      const buffers = new Map(get().downloadBuffers);
      const cur = buffers.get(msg.id as string) || { chunks: [], filename: 'file', size: 0 };
      cur.filename = (msg.filename as string) || cur.filename;
      cur.size = (msg.size as number) || 0;
      buffers.set(msg.id as string, cur);
      set({ downloadBuffers: buffers });
      return;
    }

    if (type === MSG.SFTP_DOWNLOAD_CHUNK) {
      const buffers = new Map(get().downloadBuffers);
      const cur = buffers.get(msg.id as string);
      if (cur) {
        cur.chunks.push(msg.data as string);
        buffers.set(msg.id as string, cur);
        set({
          downloadBuffers: buffers,
          sessions: patchSession(get().sessions, sessionId, {
            transferProgress: {
              id: msg.id as string,
              written: msg.written as number,
              total: msg.total as number,
              kind: 'down',
            },
          }),
        });
      }
      return;
    }

    if (type === MSG.SFTP_DOWNLOAD_RESULT) {
      if (msg.error) {
        alert(`下载失败: ${friendlySftpError(msg.error)}`);
      } else {
        const buffers = new Map(get().downloadBuffers);
        const cur = buffers.get(msg.id as string);
        if (cur) {
          const bin = cur.chunks.map((c) => atob(c)).join('');
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
          const blob = new Blob([bytes]);
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = cur.filename;
          a.click();
          buffers.delete(msg.id as string);
          set({ downloadBuffers: buffers });
        }
      }
      set({
        sessions: patchSession(get().sessions, sessionId, { transferProgress: null }),
      });
      return;
    }

    if (type === MSG.SFTP_MKDIR_RESULT || type === MSG.SFTP_RENAME_RESULT || type === MSG.SFTP_RM_RESULT) {
      if (msg.error) alert(friendlySftpError(msg.error));
      else get().listFiles();
      return;
    }

    if (type === MSG.SFTP_PREVIEW_RESULT) {
      if (msg.error) {
        alert(friendlySftpError(msg.error));
        return;
      }
      if (msg.binary) {
        alert('二进制文件无法在线编辑，请下载后修改');
        return;
      }
      const content = (msg.content as string) || '';
      set({
        preview: {
          path: msg.path as string,
          content,
          original: content,
          size: (msg.size as number) || content.length,
          saving: false,
          dirty: false,
        },
      });
      return;
    }

    if (type === MSG.SFTP_WRITE_RESULT) {
      const prev = get().preview;
      if (!prev) return;
      if (msg.error) {
        set({ preview: { ...prev, saving: false } });
        alert(`保存失败: ${friendlySftpError(msg.error)}`);
        return;
      }
      set({
        preview: {
          ...prev,
          original: prev.content,
          dirty: false,
          saving: false,
          size: (msg.size as number) || prev.content.length,
        },
      });
      get().listFiles();
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
