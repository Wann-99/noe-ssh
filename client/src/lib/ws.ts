import { MSG, UPLOAD_CHUNK_SIZE } from '@shared/protocol';

type Handler = (msg: Record<string, unknown>) => void;

function wsUrl(token?: string): string {
  const env = import.meta.env.VITE_WS_URL as string | undefined;
  if (env) {
    const u = new URL(env);
    if (token) u.searchParams.set('token', token);
    return u.toString();
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Dev: talk to backend directly
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
  private token = '';

  setToken(token: string) {
    this.token = token;
  }

  onMessage(fn: Handler) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  private emit(msg: Record<string, unknown>) {
    for (const h of this.handlers) h(msg);
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.ws = new WebSocket(wsUrl(this.token || undefined));
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as Record<string, unknown>;
        this.emit(msg);
      } catch {
        /* ignore */
      }
    };
    this.ws.onclose = () => {
      this.emit({ type: 'socket-closed' });
    };
    this.ws.onerror = () => {
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

  send(msg: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
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
    this.send({
      type: MSG.SFTP_UPLOAD_START,
      sessionId,
      id,
      remotePath,
      filename: file.name,
      size: file.size,
    });

    const chunkSize = UPLOAD_CHUNK_SIZE;
    let offset = 0;
    while (offset < file.size) {
      const slice = file.slice(offset, offset + chunkSize);
      const buf = await slice.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      const data = btoa(binary);
      this.send({
        type: MSG.SFTP_UPLOAD_CHUNK,
        sessionId,
        id,
        data,
      });
      offset += bytes.length;
      onProgress?.(offset, file.size);
      // Yield to event loop
      await new Promise((r) => setTimeout(r, 0));
    }
    this.send({ type: MSG.SFTP_UPLOAD_END, sessionId, id });
  }
}

export const sshSocket = new SshSocket();
