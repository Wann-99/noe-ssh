const net = require('net');
const { execSync } = require('child_process');

/**
 * Resolve local X11 endpoint from DISPLAY / NOE_SSH_X11_DISPLAY.
 * Supports :N, host:N, unix sockets under /tmp/.X11-unix.
 */
function resolveX11Endpoint(displayEnv) {
  const display = (displayEnv
    || process.env.NOE_SSH_X11_DISPLAY
    || process.env.SUPER_SSH_X11_DISPLAY
    || process.env.DISPLAY
    || '').trim();
  if (!display) return null;

  // Absolute path (e.g. macOS launchd XQuartz socket path ending with :0)
  if (display.startsWith('/')) {
    const m = display.match(/^(.*):(\d+)(?:\.\d+)?$/);
    if (m) {
      return { type: 'unix', path: m[1], screen: Number(m[2]), display };
    }
    return { type: 'unix', path: display, screen: 0, display };
  }

  const m = display.match(/^(.*):(\d+)(?:\.(\d+))?$/);
  if (!m) return null;

  const hostPart = m[1];
  const screen = Number(m[2]);

  if (!hostPart || hostPart === 'unix') {
    return {
      type: 'unix',
      path: `/tmp/.X11-unix/X${screen}`,
      screen,
      display,
    };
  }

  return {
    type: 'tcp',
    host: hostPart === 'localhost' ? '127.0.0.1' : hostPart,
    port: 6000 + screen,
    screen,
    display,
  };
}

function getXauthCookie(display) {
  if (!display) return null;
  try {
    const safe = display.replace(/"/g, '');
    const out = execSync(`xauth list "${safe}"`, {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, DISPLAY: display },
    });
    const line = out.trim().split('\n').find(Boolean);
    if (!line) return null;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) return null;
    return {
      protocol: parts[parts.length - 2],
      cookie: parts[parts.length - 1],
    };
  } catch (_) {
    return null;
  }
}

function connectLocalX11(endpoint) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    const fail = (err) => {
      sock.destroy();
      reject(err);
    };
    sock.once('error', fail);
    sock.once('connect', () => {
      sock.removeListener('error', fail);
      resolve(sock);
    });
    if (endpoint.type === 'unix') {
      sock.connect(endpoint.path);
    } else {
      sock.connect(endpoint.port, endpoint.host);
    }
  });
}

/**
 * Attach X11 forwarding handler (ssh -X / -Y style) to an ssh2 Client.
 * Returns { ok, endpoint, warning } describing local display readiness.
 */
function attachX11Forwarding(client, options = {}) {
  const trusted = Boolean(options.trusted);
  const endpoint = resolveX11Endpoint(options.display);
  if (!endpoint) {
    return {
      ok: false,
      endpoint: null,
      x11Option: null,
      warning: '本机未设置 DISPLAY（亦无 NOE_SSH_X11_DISPLAY），无法启用 X11 转发',
    };
  }

  let x11Option = true;
  if (trusted) {
    const auth = getXauthCookie(endpoint.display);
    if (auth) {
      x11Option = {
        protocol: auth.protocol,
        cookie: auth.cookie,
        screen: endpoint.screen || 0,
        single: false,
      };
    } else {
      x11Option = { screen: endpoint.screen || 0, single: false };
    }
  } else {
    x11Option = { screen: endpoint.screen || 0, single: false };
  }

  client.on('x11', (info, accept, reject) => {
    connectLocalX11(endpoint)
      .then((xserversock) => {
        const xclientsock = accept();
        xclientsock.pipe(xserversock).pipe(xclientsock);
        const cleanup = () => {
          try { xserversock.destroy(); } catch (_) { /* ignore */ }
          try { xclientsock.close(); } catch (_) { /* ignore */ }
        };
        xserversock.on('close', cleanup);
        xclientsock.on('close', cleanup);
        xserversock.on('error', cleanup);
        xclientsock.on('error', cleanup);
      })
      .catch((err) => {
        reject();
        console.error('[x11] local display connect failed:', err.message);
      });
  });

  return {
    ok: true,
    endpoint,
    x11Option,
    warning: null,
  };
}

module.exports = {
  resolveX11Endpoint,
  getXauthCookie,
  attachX11Forwarding,
};
