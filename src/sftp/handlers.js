const { PREVIEW_MAX_BYTES } = require('../../shared/protocol');

function formatMode(mode) {
  const types = ['p', 'c', 'd', 'b', '-', 'l', 's'];
  let str = types[((mode >> 12) & 0o17)] || '-';
  const masks = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001];
  const chars = 'rwxrwxrwx';
  for (let i = 0; i < 9; i += 1) {
    str += (mode & masks[i]) ? chars[i] : '-';
  }
  return `${str} ${(mode & 0o777).toString(8).padStart(3, '0')}`;
}

/**
 * Open or reuse a single SFTP subsystem per SSH session.
 * Opening a new channel for every file op exhausts MaxSessions and causes
 * "Channel open failure: open failed".
 */
function ensureSftp(sess) {
  if (!sess || !sess.client) {
    return Promise.reject(new Error('Not connected'));
  }
  if (sess.sftp) {
    return Promise.resolve(sess.sftp);
  }
  if (sess._sftpPending) {
    return sess._sftpPending;
  }

  sess._sftpPending = new Promise((resolve, reject) => {
    sess.client.sftp((err, sftp) => {
      sess._sftpPending = null;
      if (err) {
        reject(err);
        return;
      }
      sess.sftp = sftp;
      const clear = () => {
        if (sess.sftp === sftp) sess.sftp = null;
      };
      sftp.on('close', clear);
      sftp.on('end', clear);
      sftp.on('error', clear);
      resolve(sftp);
    });
  });

  return sess._sftpPending;
}

function endSftp(sess) {
  if (!sess) return;
  sess._sftpPending = null;
  if (sess.sftp) {
    try { sess.sftp.end(); } catch (_) { /* ignore */ }
    sess.sftp = null;
  }
}

function listDir(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath || '.', (err, list) => {
      if (err) {
        reject(err);
        return;
      }
      const files = list
        .filter((f) => f.filename !== '.' && f.filename !== '..')
        .map((f) => ({
          filename: f.filename,
          longname: f.longname,
          isDir: (f.attrs.mode & 0o040000) === 0o040000,
          size: f.attrs.size,
          mtime: f.attrs.mtime * 1000,
          mode: f.attrs.mode,
          perm: formatMode(f.attrs.mode),
        }));
      resolve(files);
    });
  });
}

function realpath(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.realpath(remotePath || '.', (err, abs) => {
      if (err) reject(err);
      else resolve(abs);
    });
  });
}

function mkdir(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function rename(sftp, from, to) {
  return new Promise((resolve, reject) => {
    sftp.rename(from, to, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function remove(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.unlink(remotePath, (err) => {
      if (!err) {
        resolve();
        return;
      }
      sftp.rmdir(remotePath, (err2) => {
        if (err2) reject(err2);
        else resolve();
      });
    });
  });
}

function previewFile(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err, stats) => {
      if (err) {
        reject(err);
        return;
      }
      if ((stats.mode & 0o170000) === 0o040000) {
        reject(new Error('目录无法打开'));
        return;
      }
      if (stats.size > PREVIEW_MAX_BYTES) {
        reject(new Error(`文件过大 (${stats.size} bytes)，请下载后编辑（上限 ${PREVIEW_MAX_BYTES} bytes）`));
        return;
      }
      sftp.readFile(remotePath, (readErr, data) => {
        if (readErr) {
          reject(readErr);
          return;
        }
        const text = data.toString('utf-8');
        const binary = /[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 8000));
        resolve({
          path: remotePath,
          size: stats.size,
          binary,
          content: binary ? null : text,
        });
      });
    });
  });
}

function writeFile(sftp, remotePath, content) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(content, 'utf-8');
    if (buf.length > PREVIEW_MAX_BYTES) {
      reject(new Error(`内容过大 (${buf.length} bytes)，上限 ${PREVIEW_MAX_BYTES} bytes`));
      return;
    }
    sftp.writeFile(remotePath, buf, (err) => {
      if (err) reject(err);
      else resolve({ path: remotePath, size: buf.length });
    });
  });
}

function createUploadStream(sftp, remoteFile) {
  const writeStream = sftp.createWriteStream(remoteFile);
  return writeStream;
}

function createDownloadStream(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err, stats) => {
      if (err) {
        reject(err);
        return;
      }
      const readStream = sftp.createReadStream(remotePath);
      resolve({ readStream, size: stats.size, filename: remotePath.split('/').pop() });
    });
  });
}

module.exports = {
  formatMode,
  ensureSftp,
  endSftp,
  listDir,
  realpath,
  mkdir,
  rename,
  remove,
  previewFile,
  writeFile,
  createUploadStream,
  createDownloadStream,
  PREVIEW_MAX_BYTES,
};
