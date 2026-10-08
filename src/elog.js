const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = path.join(process.env.LOCALAPPDATA || '', 'NetEase', 'CloudMusic', 'cloudmusic.elog');

let offset = 0;
let pending = '';
let lastEventAt = 0;
let awaitingPlay = false;
let state = {
  id: 0,
  title: '',
  artist: '',
  album: '',
  cover: '',
  durationMs: 0,
  playing: false,
  audible: null,
  anchorMs: 0,
  anchorAt: 0,
};

function decode(buffer) {
  const out = Buffer.alloc(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    const byte = buffer[i];
    const hexDigit = (Math.floor(byte / 16) ^ ((byte % 16) + 8)) % 16;
    out[i] = (hexDigit * 16 + Math.floor(byte / 64) * 4 + (~Math.floor(byte / 16) & 3)) & 255;
  }
  return out.toString('utf8');
}

function eventTime(line) {
  const header = /^\[(\d+):(\d+):(\d{4}\/\d{6}:\d+):/.exec(line);
  const stamp = header ? Number(header[3].split(':')[1]) : NaN;
  if (!Number.isFinite(stamp)) return Date.now();
  return Date.now() - os.uptime() * 1000 + stamp;
}

function extractJson(line) {
  const start = line.indexOf('{');
  const end = line.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(line.slice(start, end + 1));
  } catch {
    return null;
  }
}

function movingAt(at) {
  if (!state.playing) return state.anchorMs;
  return state.anchorMs + Math.max(0, at - state.anchorAt);
}

function clamp(ms) {
  const value = Math.max(0, ms);
  if (state.durationMs > 0) return Math.min(state.durationMs, value);
  return value;
}

function rememberTrack(line, restart) {
  const data = extractJson(line);
  const track = data?.track || data;
  const id = Number(track?.id || data?.id);
  if (!id) return;
  const next = {
    id,
    title: track.name || state.title,
    artist: (track.artists || []).map((item) => item.name).filter(Boolean).join(' / ') || state.artist,
    album: track.album?.name || track.album?.albumName || state.album,
    cover: track.album?.picUrl || track.album?.cover || state.cover,
    durationMs: Number(track.duration) || state.durationMs,
  };
  if (restart || id !== state.id) {
    state = {
      ...state,
      ...next,
      playing: false,
      anchorMs: 0,
      anchorAt: eventTime(line),
    };
    awaitingPlay = true;
    return;
  }
  state = { ...state, ...next };
}

function rememberPosition(line) {
  const matched = /setPlayingPosition",(\d+(?:\.\d+)?)/.exec(line);
  if (!matched) return;
  let seconds = Number(matched[1]);
  if (!Number.isFinite(seconds)) return;
  if (state.durationMs && seconds > state.durationMs / 1000 + 2 && seconds <= state.durationMs + 2000) {
    seconds /= 1000;
  }
  state.anchorMs = clamp(seconds * 1000);
  state.anchorAt = eventTime(line);
}

function rememberStatus(line) {
  const matched = /native播放state",(\d+),"(\d+)/.exec(line);
  if (!matched) return;
  const at = eventTime(line);
  const playing = matched[1] === '1';
  const songId = Number(matched[2]);
  if (awaitingPlay) {
    if (!playing || (songId && state.id && songId !== state.id)) return;
    state.anchorMs = 0;
    state.anchorAt = at;
    state.playing = true;
    awaitingPlay = false;
    lastEventAt = at;
    return;
  }
  if (at + 200 < lastEventAt) return;
  lastEventAt = at;
  if (state.playing && !playing) state.anchorMs = clamp(state.anchorMs + Math.max(0, at - state.anchorAt));
  if (!state.playing && playing) state.anchorAt = at;
  state.playing = playing;
  if (!playing) state.anchorAt = at;
}

function apply(line) {
  if (!line.startsWith('[') || !line.includes('【playing】')) return;
  if (line.includes('playOneTrackInPlayingList')) rememberTrack(line, true);
  else if (line.includes('checkPlayPrivilege')) {
    // 「添加到下一首播放」也会查这首歌的版权，不能当成已经在播
    const data = extractJson(line);
    const id = Number((data?.track || data)?.id || data?.id);
    if (id && state.id && id === state.id) rememberTrack(line, false);
  }
  else if (line.includes('setPlayingPosition')) rememberPosition(line);
  else if (line.includes('native播放state')) rememberStatus(line);
}

function ingest(buffer, dropHead) {
  const text = pending + decode(buffer);
  const lines = text.split(/\r?\n/);
  pending = lines.pop() || '';
  if (dropHead) lines.shift();
  for (const line of lines) apply(line);
}

function readRange(start, length) {
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(FILE, 'r');
  try {
    fs.readSync(fd, buffer, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }
  return buffer;
}

function pull() {
  let stat;
  try {
    stat = fs.statSync(FILE);
  } catch {
    return;
  }
  if (stat.size < offset) {
    offset = 0;
    pending = '';
    lastEventAt = 0;
    awaitingPlay = false;
  }
  if (stat.size <= offset) return;
  const start = offset;
  const buffer = readRange(start, stat.size - start);
  offset = stat.size;
  ingest(buffer, false);
}

function start() {
  try {
    const stat = fs.statSync(FILE);
    const startAt = stat.size > 20 * 1024 * 1024 ? stat.size - 8 * 1024 * 1024 : 0;
    if (stat.size > startAt) ingest(readRange(startAt, stat.size - startAt), startAt > 0);
    offset = stat.size;
  } catch {
    offset = 0;
  }
  fs.watchFile(FILE, { interval: 100 }, () => {
    try {
      pull();
    } catch {
      /* 日志正在被写入时读一小段失败，下一轮再读 */
    }
  });
}

function noteAudible() {
  /* 播放进度只认网易云日志里的暂停时间，不用音量静音去改进度 */
}

function seekTo(ms) {
  state.anchorMs = clamp(ms);
  state.anchorAt = Date.now();
}

function toggleLocal() {
  /* 暂停和继续只交给网易云日志记时，这里提前改时钟会让每次点击都慢一截 */
}

function get() {
  if (!state.id) return null;
  const at = Date.now();
  return {
    id: state.id,
    title: state.title,
    artist: state.artist,
    album: state.album,
    cover: state.cover,
    durationMs: state.durationMs,
    playing: state.playing,
    positionMs: clamp(movingAt(at)),
  };
}

module.exports = { start, get, noteAudible, seekTo, toggleLocal };
