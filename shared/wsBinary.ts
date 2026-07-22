/**
 * Binary WebSocket frame codec (ESM for Vite client).
 *
 * Layout:
 *   magic(1)=0x01 | kind(1) | sessionIdLen(1) | transferIdLen(1)
 *   | sessionId(utf8) | transferId(utf8) | payload
 */

export const WS_BIN_MAGIC = 0x01;

export const WS_BIN_KIND = {
  TERM_OUT: 0,
  TERM_IN: 1,
  UPLOAD_CHUNK: 2,
  DOWNLOAD_CHUNK: 3,
} as const;

export type WsBinKind = (typeof WS_BIN_KIND)[keyof typeof WS_BIN_KIND];

export const TRANSFER_CHUNK_SIZE = 256 * 1024;
export const WS_BUFFER_HIGH = 1.5 * 1024 * 1024;
export const WS_BUFFER_LOW = 512 * 1024;
export const TERM_COALESCE_MS = 12;
export const TERM_COALESCE_BYTES = 32 * 1024;
export const PROGRESS_THROTTLE_MS = 200;
export const INACTIVE_PENDING_MAX = 64 * 1024;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type DecodedFrame = {
  kind: number;
  sessionId: string;
  transferId: string;
  payload: Uint8Array;
};

export function encodeFrame(
  kind: number,
  sessionId: string,
  transferId: string,
  payload: Uint8Array | ArrayBuffer,
): ArrayBuffer {
  const sid = textEncoder.encode(sessionId || '');
  const tid = textEncoder.encode(transferId || '');
  if (sid.length > 255 || tid.length > 255) {
    throw new Error('sessionId/transferId too long for binary frame');
  }
  const body = payload instanceof Uint8Array
    ? payload
    : new Uint8Array(payload);
  const out = new Uint8Array(4 + sid.length + tid.length + body.length);
  out[0] = WS_BIN_MAGIC;
  out[1] = kind & 0xff;
  out[2] = sid.length;
  out[3] = tid.length;
  out.set(sid, 4);
  out.set(tid, 4 + sid.length);
  out.set(body, 4 + sid.length + tid.length);
  return out.buffer;
}

export function decodeFrame(buf: ArrayBuffer | Uint8Array): DecodedFrame | null {
  const data = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (data.length < 4 || data[0] !== WS_BIN_MAGIC) return null;
  const kind = data[1];
  const sidLen = data[2];
  const tidLen = data[3];
  const min = 4 + sidLen + tidLen;
  if (data.length < min) return null;
  const sessionId = textDecoder.decode(data.subarray(4, 4 + sidLen));
  const transferId = textDecoder.decode(data.subarray(4 + sidLen, min));
  const payload = data.subarray(min);
  return { kind, sessionId, transferId, payload };
}
