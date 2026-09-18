const { execFile } = require('child_process');
const path = require('path');

const NAME = 'JianMusicDesktop';
const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

function command() {
  const appDir = path.resolve(__dirname, '..');
  return `"${process.execPath}" "${appDir}"`;
}

function reg(args) {
  return new Promise((resolve) => {
    execFile('reg', args, { windowsHide: true }, (error) => {
      resolve(!error);
    });
  });
}

async function enable() {
  return reg(['add', KEY, '/v', NAME, '/t', 'REG_SZ', '/d', command(), '/f']);
}

async function disable() {
  return reg(['delete', KEY, '/v', NAME, '/f']);
}

function query() {
  return new Promise((resolve) => {
    execFile('reg', ['query', KEY, '/v', NAME], { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }
      resolve(String(stdout).includes(NAME));
    });
  });
}

module.exports = { enable, disable, query, command };
