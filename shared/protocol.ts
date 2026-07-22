/** ESM/TS mirror of protocol.js for the React client. */

export const MSG = {
  AUTH: 'auth',
  CONNECT: 'connect',
  INPUT: 'input',
  RESIZE: 'resize',
  DISCONNECT: 'disconnect',
  SHELL_OPEN: 'shell-open',
  SHELL_CLOSE: 'shell-close',
  EXEC: 'exec',
  SERVER_INFO: 'server-info',
  SFTP_LIST: 'sftp-list',
  SFTP_MKDIR: 'sftp-mkdir',
  SFTP_RENAME: 'sftp-rename',
  SFTP_RM: 'sftp-rm',
  SFTP_PREVIEW: 'sftp-preview',
  SFTP_WRITE: 'sftp-write',
  SFTP_UPLOAD_START: 'sftp-upload-start',
  SFTP_UPLOAD_CHUNK: 'sftp-upload-chunk',
  SFTP_UPLOAD_END: 'sftp-upload-end',
  SFTP_UPLOAD_ABORT: 'sftp-upload-abort',
  SFTP_DOWNLOAD_START: 'sftp-download-start',
  SFTP_DOWNLOAD_ABORT: 'sftp-download-abort',
  AUTH_OK: 'auth-ok',
  AUTH_REQUIRED: 'auth-required',
  AUTH_FAIL: 'auth-fail',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  SHELL_OPENED: 'shell-opened',
  SHELL_CLOSED: 'shell-closed',
  DATA: 'data',
  ERROR: 'error',
  HOME_DIR: 'home-dir',
  SFTP_READY: 'sftp-ready',
  SFTP_ERROR: 'sftp-error',
  EXEC_RESULT: 'exec-result',
  SERVER_INFO_RESULT: 'server-info-result',
  SFTP_LIST_RESULT: 'sftp-list-result',
  SFTP_MKDIR_RESULT: 'sftp-mkdir-result',
  SFTP_RENAME_RESULT: 'sftp-rename-result',
  SFTP_RM_RESULT: 'sftp-rm-result',
  SFTP_PREVIEW_RESULT: 'sftp-preview-result',
  SFTP_WRITE_RESULT: 'sftp-write-result',
  SFTP_UPLOAD_PROGRESS: 'sftp-upload-progress',
  SFTP_UPLOAD_RESULT: 'sftp-upload-result',
  SFTP_DOWNLOAD_META: 'sftp-download-meta',
  SFTP_DOWNLOAD_CHUNK: 'sftp-download-chunk',
  SFTP_DOWNLOAD_RESULT: 'sftp-download-result',
} as const;

/** Default shell id created with the SSH session. */
export const DEFAULT_TERMINAL_ID = 't1';
/** Soft limit of interactive shells per SSH session. */
export const MAX_TERMINALS_PER_SESSION = 8;

export const PREVIEW_MAX_BYTES = 1024 * 1024;
/** Preferred transfer chunk size (binary WS frames). */
export const UPLOAD_CHUNK_SIZE = 256 * 1024;

export type JumpHost = {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
};

export type ConnectPayload = {
  type: typeof MSG.CONNECT;
  sessionId: string;
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  proxyType?: string;
  proxyHost?: string;
  proxyPort?: number;
  jumpHost?: JumpHost | null;
  /** Enable X11 forwarding (ssh -X) */
  x11Forward?: boolean;
  /** Trusted X11 (ssh -Y), uses local xauth cookie when available */
  x11Trusted?: boolean;
  /** Override local DISPLAY for Noe-SSH host */
  x11Display?: string;
  cols?: number;
  rows?: number;
  /** Primary interactive shell id (defaults to DEFAULT_TERMINAL_ID). */
  terminalId?: string;
};

export type SavedConnection = {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  /** Encrypted blob or legacy plaintext */
  password?: string;
  privateKey?: string;
  passphrase?: string;
  proxyType?: string;
  proxyHost?: string;
  proxyPort?: number;
  jumpHost?: JumpHost | null;
  x11Forward?: boolean;
  x11Trusted?: boolean;
  /** When true, secrets are AES-GCM encrypted ciphertext (base64) */
  encrypted?: boolean;
};

export type CmdLogItem = {
  id: number;
  type: string;
  cmd: string;
  desc: string;
  time: string;
};

export type RemoteFile = {
  filename: string;
  longname: string;
  isDir: boolean;
  size: number;
  mtime: number;
  mode: number;
  perm: string;
};
