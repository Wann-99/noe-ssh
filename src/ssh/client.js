const { Client } = require('ssh2');
const { createProxySocket } = require('./proxy');

function buildAuthConfig(cfg) {
  const connectConfig = {
    host: cfg.host,
    port: cfg.port || 22,
    username: cfg.username,
    readyTimeout: 20000,
    keepaliveInterval: 20000,
  };
  if (cfg.password) connectConfig.password = cfg.password;
  if (cfg.privateKey) {
    connectConfig.privateKey = cfg.privateKey;
    if (cfg.passphrase) connectConfig.passphrase = cfg.passphrase;
  }
  return connectConfig;
}

function connectSsh(config) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { client.end(); } catch (_) { /* ignore */ }
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    client.on('ready', () => {
      if (settled) return;
      settled = true;
      resolve(client);
    });
    client.on('error', fail);

    client.connect(config);
  });
}

/**
 * Open a TCP channel through an existing SSH connection (ProxyJump).
 */
function forwardOut(jumpClient, host, port) {
  return new Promise((resolve, reject) => {
    jumpClient.forwardOut('127.0.0.1', 0, host, port, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(stream);
    });
  });
}

/**
 * Connect to target, optionally via one-level ProxyJump and/or HTTP/SOCKS5 proxy.
 * Jump takes precedence over application proxy when both are set.
 */
async function openSshConnection(msg) {
  const targetPort = msg.port || 22;
  const jump = msg.jumpHost;

  if (jump && jump.host && jump.username) {
    const jumpConfig = buildAuthConfig({
      host: jump.host,
      port: jump.port || 22,
      username: jump.username,
      password: jump.password,
      privateKey: jump.privateKey,
      passphrase: jump.passphrase,
    });

    // Optional: proxy only for reaching the jump host
    if (msg.proxyType && msg.proxyHost && msg.proxyPort) {
      const sock = await createProxySocket(
        msg.proxyType,
        msg.proxyHost,
        Number(msg.proxyPort),
        jump.host,
        jump.port || 22,
      );
      jumpConfig.sock = sock;
    }

    const jumpClient = await connectSsh(jumpConfig);
    try {
      const stream = await forwardOut(jumpClient, msg.host, targetPort);
      const targetConfig = buildAuthConfig(msg);
      delete targetConfig.host;
      delete targetConfig.port;
      targetConfig.sock = stream;

      const targetClient = await connectSsh(targetConfig);
      // Keep jump alive while target is used; clean up jump when target ends
      targetClient.on('close', () => {
        try { jumpClient.end(); } catch (_) { /* ignore */ }
      });
      return { client: targetClient, jumpClient };
    } catch (err) {
      try { jumpClient.end(); } catch (_) { /* ignore */ }
      throw err;
    }
  }

  const connectConfig = buildAuthConfig(msg);
  if (msg.proxyType && msg.proxyHost && msg.proxyPort) {
    const sock = await createProxySocket(
      msg.proxyType,
      msg.proxyHost,
      Number(msg.proxyPort),
      msg.host,
      targetPort,
    );
    connectConfig.sock = sock;
  }

  const client = await connectSsh(connectConfig);
  return { client, jumpClient: null };
}

function execCommand(sshClient, command, options = {}) {
  return new Promise((resolve, reject) => {
    const execOpts = {};
    if (options.x11) execOpts.x11 = true;
    sshClient.exec(command, execOpts, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      let stdout = '';
      let stderr = '';
      stream.on('data', (chunk) => { stdout += chunk.toString('utf-8'); });
      stream.stderr.on('data', (chunk) => { stderr += chunk.toString('utf-8'); });
      stream.on('close', (code) => {
        if (code !== 0 && !stdout.trim()) {
          reject(new Error(stderr.trim() || `Command failed (${code})`));
          return;
        }
        resolve(stdout.trim() || stderr.trim());
      });
    });
  });
}

module.exports = {
  openSshConnection,
  execCommand,
  buildAuthConfig,
};
