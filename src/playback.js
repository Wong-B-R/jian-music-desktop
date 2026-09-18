const { spawn } = require('child_process');
const path = require('path');

let playing = false;
let quietSince = 0;
let heardAt = 0;

function start() {
  const exe = path.join(__dirname, '..', 'bin', 'audio-peak.exe');
  const child = spawn(exe, ['cloudmusic'], { windowsHide: true });
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const sample = JSON.parse(line);
        heardAt = Date.now();
        const loud = Number(sample.peak) > 0.008;
        if (loud) {
          playing = true;
          quietSince = 0;
        } else if (!quietSince) {
          quietSince = Date.now();
        } else if (Date.now() - quietSince > 900) {
          playing = false;
        }
      } catch {
        /* 忽略半行 */
      }
    }
  });
  child.on('exit', () => {
    playing = false;
    setTimeout(start, 1500);
  });
}

function isPlaying() {
  if (!heardAt || Date.now() - heardAt > 4000) return false;
  return playing;
}

module.exports = { start, isPlaying };
