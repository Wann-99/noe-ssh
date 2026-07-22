import assert from 'assert';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  encodeFrame,
  decodeFrame,
  WS_BIN_KIND,
  WS_BIN_MAGIC,
  TRANSFER_CHUNK_SIZE,
} = require('./wsBinary.js');

const payload = Buffer.from('perf-binary-payload');
const encoded = encodeFrame(WS_BIN_KIND.DOWNLOAD_CHUNK, 'sess-a', 'dl-1', payload);
assert.ok(Buffer.isBuffer(encoded));
assert.equal(encoded[0], WS_BIN_MAGIC);

const decoded = decodeFrame(encoded);
assert.equal(decoded.kind, WS_BIN_KIND.DOWNLOAD_CHUNK);
assert.equal(decoded.sessionId, 'sess-a');
assert.equal(decoded.transferId, 'dl-1');
assert.equal(decoded.payload.toString('utf8'), 'perf-binary-payload');

const term = encodeFrame(WS_BIN_KIND.TERM_OUT, 's2', '', Buffer.from('\x1b[31mhi\x1b[0m'));
const termDecoded = decodeFrame(term);
assert.equal(termDecoded.transferId, '');
assert.equal(termDecoded.payload.toString('utf8'), '\x1b[31mhi\x1b[0m');

assert.equal(TRANSFER_CHUNK_SIZE, 256 * 1024);
assert.equal(decodeFrame(Buffer.from([0, 1, 2, 3])), null);

console.log('wsBinary.test: OK');
