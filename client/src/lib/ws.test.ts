import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SshSocket } from './ws';

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  addEventListener() {}
  removeEventListener() {}

  open() {
    this.readyState = FakeWebSocket.OPEN;
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

describe('SshSocket', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('location', {
      protocol: 'http:',
      host: 'localhost:3000',
    });
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  it('reports a failed send instead of silently succeeding', () => {
    const socket = new SshSocket();
    expect(socket.send({ type: 'input', data: 'pwd' })).toBe(false);
  });

  it('sends only after the control socket is open and reports close', () => {
    const socket = new SshSocket();
    const messages: Array<Record<string, unknown>> = [];
    socket.onMessage((message) => messages.push(message));
    socket.connect();
    const ws = FakeWebSocket.instances[0];

    expect(socket.send({ type: 'input' })).toBe(false);
    ws.open();
    expect(socket.send({ type: 'input', data: 'ls' })).toBe(true);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'input', data: 'ls' });

    ws.close();
    expect(messages.at(-1)).toEqual({ type: 'socket-closed' });
    expect(socket.isOpen()).toBe(false);
  });
});
