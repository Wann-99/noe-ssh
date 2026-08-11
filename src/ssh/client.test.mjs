import assert from 'assert';
import { createRequire } from 'module';
import { generateKeyPairSync } from 'crypto';

const require = createRequire(import.meta.url);
const { Server } = require('ssh2');
const { openSshConnection } = require('./client.js');

// ssh2's key parser accepts PKCS#1 RSA PEM (not PKCS#8).
const hostKey = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
}).privateKey;

/** sshd that only offers keyboard-interactive auth, like a typical bastion. */
function startKeyboardOnlyServer() {
  return new Promise((resolve) => {
    let sawKeyboardInteractive = false;
    const server = new Server({ hostKeys: [hostKey] }, (client) => {
      client.on('authentication', (ctx) => {
        if (ctx.method === 'keyboard-interactive') {
          sawKeyboardInteractive = true;
          ctx.prompt([{ prompt: 'Password: ', echo: false }], (answers) => {
            if (answers[0] === 's3cret') ctx.accept();
            else ctx.reject(['keyboard-interactive']);
          });
          return;
        }
        ctx.reject(['keyboard-interactive']);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: server.address().port,
        sawKeyboardInteractive: () => sawKeyboardInteractive,
      });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    // server.close() waits for open sessions; do not hang if one lingers
    setTimeout(resolve, 2000).unref();
  });
}

// password answers the keyboard-interactive prompt (tryKeyboard)
{
  const { server, port, sawKeyboardInteractive } = await startKeyboardOnlyServer();
  const { client } = await openSshConnection({
    host: '127.0.0.1', port, username: 'u', password: 's3cret',
  });
  assert.equal(sawKeyboardInteractive(), true);
  client.end();
  await closeServer(server);
}

// wrong password is rejected
{
  const { server, port } = await startKeyboardOnlyServer();
  await assert.rejects(
    () => openSshConnection({ host: '127.0.0.1', port, username: 'u', password: 'wrong' }),
    /authentication methods failed/i,
  );
  await closeServer(server);
}

console.log('ssh client.test: OK');
