import { MSG, UPLOAD_CHUNK_SIZE } from '@shared/protocol';
import {
  WS_BIN_KIND,
  WS_BUFFER_HIGH,
  encodeFrame,
  decodeFrame,
} from '@shared/wsBinary';

type Handler = (msg: Record<string, unknown>) => void;
type BinaryHandler = (frame: {
  kind: number;
  sessionId: string;
  transferId: string;
  payload: Uint8Array;
}) => void;

function wsUrl(token?: string): string {
  const env = import.meta.env.VITE_WS_URL as string | undefined;
  if (env) {
    const u = new URL(env);
    if (token) u.searchParams.set('token', token);
    return u.toString();
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (import.meta.env.DEV) {
    const u = new URL(`${proto}//127.0.0.1:3000`);
    if (token) u.searchParams.set('token', token);
    return u.toString();
  }
  const u = new URL(`${proto}//${location.host}`);
  if (token) u.searchParams.set('token', token);
  return u.toString();
}

export class SshSocket {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private binaryHandlers = new Set<BinaryHandler>();
  private token = '';
  private waiters = new Set<{
    matches: (msg: Record<string, unknown>) => boolean;
    resolve: (msg: Record<string, unknown>) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  setToken(token: string) {
    this.token = token;
  }

  onMessage(fn: Handler) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  onBinary(fn: BinaryHandler) {
    this.binaryHandlers.add(fn);
    return () => this.binaryHandlers.delete(fn);
  }

  private emit(msg: Record<string, unknown>) {
    for (const waiter of [...this.waiters]) {
      if (waiter.matches(msg)) {
        clearTimeout(waiter.timer);
        this.waiters.delete(waiter);
        waiter.resolve(msg);
      }
    }
    for (const h of this.handlers) h(msg);
  }

  private emitBinary(frame: {
    kind: number;
    sessionId: string;
    transferId: string;
    payload: Uint8Array;
  }) {
    for (const h of this.binaryHandlers) h(frame);
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const socket = new WebSocket(wsUrl(this.token || undefined));
    socket.binaryType = 'arraybuffer';
    this.ws = socket;
    socket.onmessage = (ev) => {
      if (typeof ev.data !== 'string') {
        try {
          const frame = decodeFrame(ev.data as ArrayBuffer);
          if (!frame) return;
          if (frame.kind === WS_BIN_KIND.TERM_OUT) {
            window.dispatchEvent(new CustomEvent('ssh-term-write', {
              detail: {
                sessionId: frame.sessionId,
                data: frame.payload,
              },
            }));
            return;
          }
          this.emitBinary(frame);
        } catch {
          /* ignore */
        }
        return;
      }
      try {
        const msg = JSON.parse(ev.data) as Record<string, unknown>;
        this.emit(msg);
      } catch {
        /* ignore */
      }
    };
    socket.onclose = () => {
      if (this.ws === socket) this.ws = null;
      for (const waiter of [...this.waiters]) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('WebSocket 已断开'));
      }
      this.waiters.clear();
      this.emit({ type: 'socket-closed' });
    };
    socket.onerror = () => {
      this.emit({ type: MSG.ERROR, data: 'WebSocket 连接失败' });
    };
  }

  ensureOpen(timeoutMs = 8000): Promise<void> {
    this.connect();
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('No socket'));
        return;
      }
      if (this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      const ws = this.ws;
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('WebSocket 连接超时'));
      }, timeoutMs);
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onErr = () => {
        cleanup();
        reject(new Error('WebSocket failed'));
      };
      const cleanup = () => {
        clearTimeout(timer);
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onErr);
      };
      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onErr);
    });
  }

  isOpen() {
    return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);
  }

  bufferedAmount() {
    return this.ws?.bufferedAmount || 0;
  }

  private async waitForSendWindow() {
    while (this.ws && this.ws.readyState === WebSocket.OPEN && this.ws.bufferedAmount > WS_BUFFER_HIGH) {
      await new Promise((r) => setTimeout(r, 8));
    }
  }

  send(msg: Record<string, unknown>): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  sendBinary(kind: number, sessionId: string, transferId: string, payload: Uint8Array): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeFrame(kind, sessionId, transferId, payload));
      return true;
    }
    return false;
  }

  waitFor(
    matches: (msg: Record<string, unknown>) => boolean,
    timeoutMs = 8000,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let waiter!: {
        matches: (msg: Record<string, unknown>) => boolean;
        resolve: (msg: Record<string, unknown>) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      };
      waiter = {
        matches,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error('服务器响应超时'));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  async auth(token: string) {
    this.setToken(token);
    await this.ensureOpen();
    this.send({ type: MSG.AUTH, token });
  }

  async uploadFile(
    sessionId: string,
    id: string,
    remotePath: string,
    file: File,
    onProgress?: (written: number, total: number) => void,
  ) {
    await this.ensureOpen();
    const ready = this.waitFor(
      (msg) =>
        msg.id === id
        && (msg.type === MSG.SFTP_UPLOAD_PROGRESS || msg.type === MSG.SFTP_UPLOAD_RESULT),
    );
    if (!this.send({
      type: MSG.SFTP_UPLOAD_START,
      sessionId,
      id,
      remotePath,
      filename: file.name,
      size: file.size,
    })) {
      throw new Error('WebSocket 未连接');
    }
    const first = await ready;
    if (first.type === MSG.SFTP_UPLOAD_RESULT && first.error) {
      throw new Error(String(first.error));
    }

    const chunkSize = UPLOAD_CHUNK_SIZE;
    let offset = 0;
    while (offset < file.size) {
      await this.waitForSendWindow();
      if (!this.isOpen()) throw new Error('上传过程中连接已断开');
      const slice = file.slice(offset, offset + chunkSize);
      const buf = new Uint8Array(await slice.arrayBuffer());
      if (!this.sendBinary(WS_BIN_KIND.UPLOAD_CHUNK, sessionId, id, buf)) {
        throw new Error('上传过程中连接已断开');
      }
      offset += buf.length;
      onProgress?.(offset, file.size);
    }
    if (!this.send({ type: MSG.SFTP_UPLOAD_END, sessionId, id })) {
      throw new Error('上传完成确认发送失败');
    }
  }
}

export const sshSocket = new SshSocket();
