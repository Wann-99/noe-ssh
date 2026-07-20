const http = require('http');
const { exec } = require('child_process');
const { createApp, APP_MODE } = require('./http/app');
const { attachWsHub } = require('./ws/hub');
const pkg = require('../package.json');

const IS_LOCAL_MODE = APP_MODE === 'desktop' || APP_MODE === 'portable';

function openBrowser(url) {
  const platform = process.platform;
  if (platform === 'darwin') {
    exec(`open "${url}"`);
  } else if (platform === 'win32') {
    exec(`start "" "${url}"`, { shell: true });
  } else {
    exec(`xdg-open "${url}"`);
  }
}

function start() {
  const app = createApp();
  const server = http.createServer(app);
  attachWsHub(server);

  const PORT = process.env.PORT || 3000;
  const HOST = process.env.HOST || (IS_LOCAL_MODE ? '127.0.0.1' : '0.0.0.0');
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;

  server.listen(PORT, HOST, () => {
    const url = `http://${displayHost}:${PORT}`;
    console.log(`Noe-SSH v${pkg.version} running at ${url}`);
    if (process.env.NOE_SSH_OPEN_BROWSER === '1' || process.env.SUPER_SSH_OPEN_BROWSER === '1') {
      openBrowser(url);
    }
  });

  return server;
}

if (require.main === module) {
  start();
}

module.exports = { start };
