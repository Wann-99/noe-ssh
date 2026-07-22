/**
 * Shared WebSocket protocol constants (CommonJS for Node, imported by Vite client).
 */

const MSG = {
  // client -> server
  AUTH: 'auth',
  CONNECT: 'connect',
  INPUT: 'input',
  RESIZE: 'resize',
  DISCONNECT: 'disconnect',
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
  // server -> client
  AUTH_OK: 'auth-ok',
  AUTH_REQUIRED: 'auth-required',
  AUTH_FAIL: 'auth-fail',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
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
};

const PREVIEW_MAX_BYTES = 1024 * 1024;
const UPLOAD_CHUNK_SIZE = 256 * 1024;

module.exports = { MSG, PREVIEW_MAX_BYTES, UPLOAD_CHUNK_SIZE };
