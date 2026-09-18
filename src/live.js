const { spawn } = require('child_process');
const path = require('path');

let latest = null;
let child = null;
let holdUntil = 0;

function start() {
  if (child && !child.killed) return;
  child = spawn('py', ['-3.11', path.join(__dirname, 'progress.py')], {
    windowsHide: true,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim().startsWith('{')) continue;
      try {
        const data = JSON.parse(line);
        if (Date.now() < holdUntil && latest && Number.isFinite(latest.ratio)) {
          data.ratio = latest.ratio;
        }
        if (data.ok && Number.isFinite(data.ratio)) {
          latest = { ...data, at: Date.now() };
        }
      } catch {
        /* 半行忽略 */
      }
    }
  });
  child.on('exit', () => {
    child = null;
    setTimeout(start, 1500);
  });
}

function command(line) {
  if (String(line).startsWith('seek ')) {
    const ratio = Number(String(line).slice(5));
    if (Number.isFinite(ratio)) {
      holdUntil = Date.now() + 1600;
      latest = { ...(latest || {}), ok: true, ratio, at: Date.now() };
    }
  }
  if (child && child.stdin && child.stdin.writable) {
    child.stdin.write(`${line}\n`);
  }
}

function get() {
  if (!latest || Date.now() - latest.at > 4000) return null;
  return latest;
}

module.exports = { start, get, command };
