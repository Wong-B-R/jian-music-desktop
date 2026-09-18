const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const file = path.join(dataDir, 'state.json');

const defaults = {
  autostart: true,
  ambient: true,
  lyricMode: 'origin',
  deadlines: [],
  listenByDay: {},
};

function ensure() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaults, null, 2), 'utf8');
  }
}

function read() {
  ensure();
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return { ...defaults };
  }
}

function write(next) {
  ensure();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return next;
}

function update(patch) {
  const current = read();
  const next = { ...current, ...patch };
  return write(next);
}

function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

module.exports = { dataDir, read, write, update, todayKey };
