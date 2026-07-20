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

      const fail = (err) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(err);
      };

      socket.on('error', fail);
      socket.on('connect', () => {
        socket.write(
          `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n`
          + `Host: ${targetHost}:${targetPort}\r\n`
          + 'Proxy-Connection: keep-alive\r\n\r\n',
        );
      });

      socket.on('data', (chunk) => {
        if (settled) return;
        const header = chunk.toString();
        const statusLine = header.split('\r\n')[0] || '';
        if (!/\s200\s/.test(statusLine)) {
          fail(new Error(`HTTP proxy failed: ${statusLine.trim() || 'unknown error'}`));
          return;
        }
        settled = true;
        socket.removeListener('error', fail);
        resolve(socket);
      });
      return;
    }

    reject(new Error(`Unsupported proxy type: ${proxyType}`));
  });
}

module.exports = { createProxySocket };
