/**
 * Binary WebSocket frame codec (CommonJS for Node hub).
 *
 * Layout:
 *   magic(1)=0x01 | kind(1) | sessionIdLen(1) | transferIdLen(1)
 *   | sessionId(utf8) | transferId(utf8) | payload
 */

const WS_BIN_MAGIC = 0x01;

const WS_BIN_KIND = {
  TERM_OUT: 0,
  TERM_IN: 1,
  UPLOAD_CHUNK: 2,
  DOWNLOAD_CHUNK: 3,
};

const TRANSFER_CHUNK_SIZE = 256 * 1024;
const WS_BUFFER_HIGH = 1.5 * 1024 * 1024;
const WS_BUFFER_LOW = 512 * 1024;
const TERM_COALESCE_MS = 12;
const TERM_COALESCE_BYTES = 32 * 1024;
const PROGRESS_THROTTLE_MS = 200;

function encodeFrame(kind, sessionId, transferId, payload) {
  const sid = Buffer.from(String(sessionId || ''), 'utf8');
  const tid = Buffer.from(String(transferId || ''), 'utf8');
  if (sid.length > 255 || tid.length > 255) {
    throw new Error('sessionId/transferId too long for binary frame');
  }
  const body = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(payload || '');
  const header = Buffer.allocUnsafe(4);
  header[0] = WS_BIN_MAGIC;
  header[1] = kind & 0xff;
  header[2] = sid.length;
  header[3] = tid.length;
  return Buffer.concat([header, sid, tid, body]);
}

function decodeFrame(buf) {
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (data.length < 4 || data[0] !== WS_BIN_MAGIC) return null;
  const kind = data[1];
  const sidLen = data[2];
  const tidLen = data[3];
  const min = 4 + sidLen + tidLen;
  if (data.length < min) return null;
  const sessionId = data.subarray(4, 4 + sidLen).toString('utf8');
  const transferId = data.subarray(4 + sidLen, min).toString('utf8');
  const payload = data.subarray(min);
  return { kind, sessionId, transferId, payload };
}

module.exports = {
  WS_BIN_MAGIC,
  WS_BIN_KIND,
  TRANSFER_CHUNK_SIZE,
  WS_BUFFER_HIGH,
  WS_BUFFER_LOW,
  TERM_COALESCE_MS,
  TERM_COALESCE_BYTES,
  PROGRESS_THROTTLE_MS,
  encodeFrame,
  decodeFrame,
};
