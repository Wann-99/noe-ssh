import assert from 'assert';
import { createRequire } from 'module';
import net from 'net';

const require = createRequire(import.meta.url);
const { createProxySocket } = require('./proxy.js');

const BANNER = 'SSH-2.0-NoeTest_1.0\r\n';

/**
 * Start a fake HTTP CONNECT proxy whose response is produced by `script`.
 * script(socket) runs once the CONNECT request headers are complete.
 */
function startFakeProxy(script) {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let header = Buffer.alloc(0);
      const onData = (chunk) => {
        header = Buffer.concat([header, chunk]);
        if (header.indexOf('\r\n\r\n') === -1) return;
        socket.removeListener('data', onData);
        script(socket);
      };
      socket.on('data', onData);
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function readOnce(socket) {
  return new Promise((resolve) => {
    socket.once('data', resolve);
    socket.resume();
  });
}

async function runCase(script, verify) {
  const { server, port } = await startFakeProxy(script);
  try {
    await verify(port);
  } finally {
    server.close();
  }
}

// 200 coalesced with the target's SSH banner in one write: banner must survive
await runCase(
  (socket) => socket.write(Buffer.concat([
    Buffer.from('HTTP/1.1 200 Connection established\r\n\r\n'),
    Buffer.from(BANNER),
  ])),
  async (port) => {
    const socket = await createProxySocket('http', '127.0.0.1', port, 'target', 22);
    assert.equal((await readOnce(socket)).toString(), BANNER);
    socket.destroy();
  },
);

// response split across two chunks: resolve only after the header completes
await runCase(
  (socket) => {
    socket.write('HTTP/1.1 200 Connection established\r\n');
    setTimeout(() => socket.write(`\r\n${BANNER}`), 50);
  },
  async (port) => {
    const socket = await createProxySocket('http', '127.0.0.1', port, 'target', 22);
    assert.equal((await readOnce(socket)).toString(), BANNER);
    socket.destroy();
  },
);

// status line without a reason phrase still passes
await runCase(
  (socket) => socket.write(`HTTP/1.1 200\r\n\r\n${BANNER}`),
  async (port) => {
    const socket = await createProxySocket('http', '127.0.0.1', port, 'target', 22);
    assert.equal((await readOnce(socket)).toString(), BANNER);
    socket.destroy();
  },
);

// non-2xx is rejected with the status line in the error
await runCase(
  (socket) => socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'),
  async (port) => {
    await assert.rejects(
      () => createProxySocket('http', '127.0.0.1', port, 'target', 22),
      /407/,
    );
  },
);

console.log('ssh proxy.test: OK');
