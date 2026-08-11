const net = require('net');
const { SocksClient } = require('socks');

function createProxySocket(proxyType, proxyHost, proxyPort, targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    if (proxyType === 'socks5') {
      SocksClient.createConnection({
        proxy: { host: proxyHost, port: proxyPort, type: 5 },
        command: 'connect',
        destination: { host: targetHost, port: targetPort },
      })
        .then((info) => resolve(info.socket))
        .catch(reject);
      return;
    }

    if (proxyType === 'http') {
      const socket = net.connect(proxyPort, proxyHost);
      let settled = false;
      let buffer = Buffer.alloc(0);

      const fail = (err) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(err);
      };

      socket.on('error', fail);
      // A proxy that never answers must not hang the ssh handshake forever.
      socket.setTimeout(15000, () => fail(new Error('HTTP proxy response timeout')));
      socket.on('connect', () => {
        socket.write(
          `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n`
          + `Host: ${targetHost}:${targetPort}\r\n`
          + 'Proxy-Connection: keep-alive\r\n\r\n',
        );
      });

      const onData = (chunk) => {
        if (settled) return;
        // The response may arrive split across chunks, and a fast proxy can
        // coalesce the target's first bytes (SSH banner) into the same chunk.
        buffer = Buffer.concat([buffer, chunk]);
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const statusLine = buffer.slice(0, buffer.indexOf('\r\n')).toString();
        const m = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(statusLine);
        const status = m ? Number(m[1]) : 0;
        if (status < 200 || status >= 300) {
          fail(new Error(`HTTP proxy failed: ${statusLine.trim() || 'unknown error'}`));
          return;
        }
        settled = true;
        socket.setTimeout(0);
        socket.removeListener('error', fail);
        // Stop the flowing stream and detach our reader before handing bytes
        // past the header (e.g. the SSH banner) back — otherwise the pending
        // re-emit would hit this listener and the banner would be lost.
        socket.pause();
        socket.removeListener('data', onData);
        const rest = buffer.slice(headerEnd + 4);
        if (rest.length) socket.unshift(rest);
        resolve(socket);
      };
      socket.on('data', onData);
      return;
    }

    reject(new Error(`Unsupported proxy type: ${proxyType}`));
  });
}

module.exports = { createProxySocket };
