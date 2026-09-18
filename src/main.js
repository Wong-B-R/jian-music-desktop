const { app, BrowserWindow, ipcMain, clipboard, dialog, screen, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');

const store = require('./store');
const autostart = require('./autostart');
const netease = require('./netease');
const desktop = require('./desktop');
const playback = require('./playback');
const live = require('./live');
const elog = require('./elog');

let win = null;
let ignoring = true;
let sessions = [];
let smtcReady = false;
let songCache = { key: '', song: null, lyrics: [], comments: [] };
let lastTickAt = 0;
let broadcasting = false;
let titleCheckedAt = 0;
let titleFallback = null;
let cursor = { key: '', ms: 0, at: 0, playing: false };

function followPlayback(key) {
  const now = Date.now();
  const playingNow = playback.isPlaying();
  if (cursor.key !== key) {
    cursor = { key, ms: 0, at: now, playing: playingNow };
    return { playing: playingNow, positionMs: 0 };
  }
  if (cursor.playing) cursor.ms += Math.min(1200, Math.max(0, now - cursor.at));
  cursor.at = now;
  cursor.playing = playingNow;
  return { playing: playingNow, positionMs: cursor.ms };
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function isNetease(session) {
  const blob = `${session.sourceAppUserModelId || ''} ${session.sourceAppDisplayName || ''}`.toLowerCase();
  return blob.includes('cloudmusic') || blob.includes('netease') || blob.includes('orpheus') || blob.includes('网易云');
}

function pickSession() {
  const list = sessions.filter(isNetease).filter((item) => item.title);
  return list.find((item) => item.playbackStatus === 'playing') || list[0] || null;
}

function windowTitle() {
  const script = `
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $title = Get-Process cloudmusic, netease -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle -ne '网易云音乐' } |
      Select-Object -First 1 -ExpandProperty MainWindowTitle
    if ($title) { $title }
  `;
  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-Command', script],
      { windowsHide: true, timeout: 4000, encoding: 'utf8' },
      (error, stdout) => {
        if (error) {
          resolve('');
          return;
        }
        resolve(String(stdout || '').replace(/^\uFEFF/, '').trim());
      },
    );
  });
}

function parseTitle(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text || text === '网易云音乐') return null;
  const parts = text.split(' - ');
  if (parts.length < 2) return { title: text, artist: '' };
  return { title: parts[0].trim(), artist: parts.slice(1).join(' - ').trim() };
}

async function resolveTrack() {
  const clock = elog.get();
  if (clock?.id) {
    return {
      title: clock.title,
      artist: clock.artist,
      album: clock.album,
      cover: clock.cover,
      songId: clock.id,
      playing: clock.playing,
      positionMs: clock.positionMs,
      durationMs: clock.durationMs,
      source: 'elog',
    };
  }

  const session = pickSession();
  if (session?.title) {
    return {
      title: session.title,
      artist: session.artist || '',
      album: session.albumTitle || '',
      cover: session.thumbnail || '',
      playing: session.playbackStatus === 'playing',
      positionMs: session.timeline?.positionMs || 0,
      durationMs: session.timeline?.durationMs || 0,
      source: 'smtc',
    };
  }

  const now = Date.now();
  if (!(titleFallback && now - titleCheckedAt < 2000)) {
    titleCheckedAt = now;
    const parsed = parseTitle(await windowTitle());
    titleFallback = parsed
      ? {
          title: parsed.title,
          artist: parsed.artist,
          album: '',
          cover: '',
          durationMs: 0,
          source: 'window',
        }
      : null;
  }
  if (!titleFallback) return null;
  const motion = followPlayback(`${titleFallback.title}::${titleFallback.artist}`);
  const sample = live.get();
  return {
    ...titleFallback,
    ...motion,
    albumHint: sample?.album || '',
    ratio: Number.isFinite(sample?.ratio) ? sample.ratio : null,
    ratioAt: sample?.at || 0,
  };
}

function enrichKey(track) {
  if (track.songId) return `id:${track.songId}`;
  const hint = String(track.albumHint || '').replace(/\s+/g, '');
  const albumKey = (/专辑[:：](.+?)歌手/.exec(hint) || [])[1] || '';
  return `${track.title}::${track.artist}::${albumKey}`;
}

async function enrich(track) {
  const key = enrichKey(track);
  if (songCache.key === key) return songCache;
  songCache = { key, song: null, lyrics: [], comments: [] };
  try {
    const song = track.songId
      ? await netease.songById(track.songId)
      : await netease.searchSong(track.title, track.artist, track.albumHint);
    if (!song) return songCache;
    songCache.song = song;
    if (song.cover && !song.cover.startsWith('data:')) {
      song.cover = await netease.fetchCoverData(song.cover).catch(() => '');
    }
    const [lyrics, comments] = await Promise.all([
      netease.fetchLyrics(song.id).catch(() => []),
      netease.fetchComments(song.id).catch(() => []),
    ]);
    songCache.lyrics = lyrics;
    songCache.comments = comments;
  } catch {
    /* 公开接口失败时仍显示系统媒体信息 */
  }
  return songCache;
}

function addListen(ms) {
  if (ms <= 0 || ms > 5000) return;
  const state = store.read();
  const key = store.todayKey();
  const listenByDay = { ...state.listenByDay, [key]: (state.listenByDay[key] || 0) + ms };
  store.update({ listenByDay });
}

async function broadcast(forceSong = false) {
  if (!win || win.isDestroyed() || broadcasting) return;
  broadcasting = true;
  try {
  const now = Date.now();
  const track = await resolveTrack();
  const state = store.read();

  if (track?.playing && lastTickAt) addListen(now - lastTickAt);
  lastTickAt = now;

  let extra = songCache;
  if (track && (forceSong || songCache.key !== enrichKey(track))) {
    extra = await enrich(track);
  }
  if (!track) {
    songCache = { key: '', song: null, lyrics: [], comments: [] };
    extra = songCache;
  }

  const sent = track
    ? {
        ...track,
        songId: extra.song?.id || null,
        cover: extra.song?.cover || track.cover,
        album: extra.song?.album || track.album,
        durationMs: track.durationMs || extra.song?.duration || 0,
      }
    : null;
  if (sent?.source !== 'elog' && sent && Number.isFinite(sent.ratio) && extra.song?.duration) {
    const drift = sent.playing ? Math.min(1600, Math.max(0, Date.now() - sent.ratioAt)) : 0;
    sent.positionMs = sent.ratio * extra.song.duration + drift;
    sent.durationMs = extra.song.duration;
  }
  win.webContents.send('state', {
    connected: smtcReady,
    track: sent,
    lyrics: extra.lyrics || [],
    comments: extra.comments || [],
    deadlines: state.deadlines || [],
    listenTodayMs: state.listenByDay[store.todayKey()] || 0,
    ambient: state.ambient !== false,
    lyricMode: state.lyricMode || 'origin',
    autostart: state.autostart !== false,
    sentAt: Date.now(),
  });
  } catch (error) {
    console.error(error);
  } finally {
    broadcasting = false;
  }
}

function createWindow() {
  const bounds = screen.getPrimaryDisplay().bounds;
  win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    thickFrame: false,
    roundedCorners: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  Menu.setApplicationMenu(null);
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('show', () => desktop.hideCaption(win));
  win.on('restore', () => desktop.hideCaption(win));
  win.on('focus', () => desktop.hideCaption(win));
  win.once('ready-to-show', () => {
    win.showInactive();
    desktop.hideCaption(win);
    win.setIgnoreMouseEvents(true, { forward: true });
  });
  win.on('minimize', () => {
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      const next = screen.getPrimaryDisplay().bounds;
      if (win.isMinimized()) win.restore();
      win.setBounds(next);
      win.showInactive();
      win.setSkipTaskbar(true);
      desktop.hideCaption(win);
    }, 80);
  });
}

function copyWallpaper(source) {
  const ext = path.extname(source).toLowerCase() || '.jpg';
  const target = path.join(store.dataDir, `wallpaper${ext}`);
  fs.mkdirSync(store.dataDir, { recursive: true });
  fs.copyFileSync(source, target);
  return target;
}

async function chooseWallpaper() {
  const result = await dialog.showOpenDialog(win, {
    title: '选择壁纸',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp'] }],
  });
  if (result.canceled || !result.filePaths[0]) return false;
  const target = copyWallpaper(result.filePaths[0]);
  execFile(
    'reg',
    ['add', 'HKCU\\Control Panel\\Desktop', '/v', 'WallpaperStyle', '/t', 'REG_SZ', '/d', '10', '/f'],
    { windowsHide: true },
  );
  execFile(
    'reg',
    ['add', 'HKCU\\Control Panel\\Desktop', '/v', 'TileWallpaper', '/t', 'REG_SZ', '/d', '0', '/f'],
    { windowsHide: true },
  );
  desktop.setWallpaper(target);
  return true;
}

function setupIpc() {
  ipcMain.on('ignore-mouse', (_event, ignore) => {
    if (!win || ignore === ignoring) return;
    ignoring = ignore;
    win.setIgnoreMouseEvents(ignore, { forward: true });
    if (!ignore) {
      win.moveTop();
      desktop.hideCaption(win);
    }
  });

  ipcMain.handle('menu', async (_event, action, payload) => {
    const state = store.read();
    if (action === 'wallpaper') return chooseWallpaper();
    if (action === 'copy') {
      clipboard.writeText(String(payload || ''));
      return true;
    }
    if (action === 'ambient') {
      store.update({ ambient: !state.ambient });
      await broadcast(true);
      return true;
    }
    if (action === 'lyric-mode') {
      store.update({ lyricMode: payload === 'trans' ? 'trans' : 'origin' });
      await broadcast(true);
      return true;
    }
    if (action === 'autostart') {
      const next = !state.autostart;
      if (next) await autostart.enable();
      else await autostart.disable();
      store.update({ autostart: next });
      await broadcast(true);
      return next;
    }
    if (action === 'quit') app.quit();
    return false;
  });

function keepBare() {
  if (!win || win.isDestroyed()) return;
  desktop.hideCaption(win);
  setTimeout(() => {
    if (win && !win.isDestroyed()) desktop.hideCaption(win);
  }, 220);
  setTimeout(() => {
    if (win && !win.isDestroyed()) desktop.hideCaption(win);
  }, 520);
}

  ipcMain.handle('seek', async (_event, ratio) => {
    const value = Math.min(0.995, Math.max(0, Number(ratio) || 0));
    const clock = elog.get();
    if (clock?.durationMs) elog.seekTo(value * clock.durationMs);
    if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(true, { forward: true });
    live.command(`seek ${value}`);
    keepBare();
    return true;
  });

  ipcMain.handle('toggle-play', async () => {
    if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(true, { forward: true });
    live.command('toggle');
    keepBare();
    return true;
  });

  ipcMain.handle('skip', async (_event, direction) => {
    if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(true, { forward: true });
    live.command(direction === 'prev' ? 'prev' : 'next');
    keepBare();
    return true;
  });

  ipcMain.handle('ddl-add', async (_event, item) => {
    const title = String(item?.title || '').trim();
    const at = String(item?.at || '');
    if (!title || !at) return store.read().deadlines;
    const deadlines = [
      ...store.read().deadlines,
      { id: crypto.randomUUID(), title, at, done: false },
    ];
    store.update({ deadlines });
    await broadcast(true);
    return deadlines;
  });

  ipcMain.handle('ddl-toggle', async (_event, id) => {
    const deadlines = store.read().deadlines.map((item) =>
      item.id === id ? { ...item, done: !item.done } : item,
    );
    store.update({ deadlines });
    await broadcast(true);
    return deadlines;
  });

  ipcMain.handle('ddl-remove', async (_event, id) => {
    const deadlines = store.read().deadlines.filter((item) => item.id !== id);
    store.update({ deadlines });
    await broadcast(true);
    return deadlines;
  });
}

async function startSmtc() {
  try {
    const media = require('windows-media-sessions');
    sessions = await media.getAllSessions();
    smtcReady = true;
    media.onSessionsChanged((next) => {
      sessions = next || [];
    });
    app.on('before-quit', () => {
      media.shutdown?.();
    });
  } catch (error) {
    smtcReady = false;
    console.error('SMTC 不可用', error);
  }
}

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.126.net/*', '*://music.163.com/*'] },
    (details, callback) => {
      details.requestHeaders.Referer = 'https://music.163.com/';
      callback({ requestHeaders: details.requestHeaders });
    },
  );
  const state = store.read();
  if (state.autostart) await autostart.enable();
  setupIpc();
  playback.start();
  elog.start();
  live.start();
  createWindow();
  await startSmtc();
  await broadcast(true);
  setInterval(() => {
    broadcast(false).catch(() => {});
  }, 1000);
});

app.on('second-instance', () => {
  if (!win) return;
  win.showInactive();
});

app.on('window-all-closed', () => {
  app.quit();
});
