const commentEl = document.querySelector('#comment');
const commentText = document.querySelector('#comment-text');
const commentMeta = document.querySelector('#comment-meta');
const commentDots = document.querySelector('#comment-dots');
const linePrev = document.querySelector('#line-prev');
const lineNow = document.querySelector('#line-now');
const lineNext = document.querySelector('#line-next');
const lyricToggle = document.querySelector('#lyric-toggle');
const spectrum = document.querySelector('#spectrum');
const cover = document.querySelector('#cover');
const coverBtn = document.querySelector('#cover-btn');
const progressBar = document.querySelector('#progress-bar');
const playClock = document.querySelector('#play-clock');
const songTitle = document.querySelector('#song-title');
const songArtist = document.querySelector('#song-artist');
const listenTime = document.querySelector('#listen-time');
const monthLabel = document.querySelector('#month-label');
const monthGrid = document.querySelector('#month-grid');
const dayList = document.querySelector('#day-list');
const composer = document.querySelector('#composer');
const menu = document.querySelector('#menu');

for (let i = 0; i < 18; i += 1) {
  const bar = document.createElement('span');
  spectrum.appendChild(bar);
}

const view = {
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  selected: dateKey(new Date()),
};

let latest = null;
let commentIndex = 0;
let commentTimer = 0;
let anchor = { positionMs: 0, sentAt: 0, playing: false };

function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function clockText(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function formatLikes(count) {
  if (!count) return '';
  if (count >= 10000) return `${(count / 10000).toFixed(1).replace(/\.0$/, '')}万赞`;
  return `${count}赞`;
}

function positionNow() {
  if (!anchor.playing) return anchor.positionMs;
  return anchor.positionMs + (Date.now() - anchor.sentAt);
}

function lyricNow() {
  return positionNow() + 250;
}

function lyricLine(line, mode) {
  if (!line) return '';
  if (mode === 'trans' && line.trans) return line.trans;
  return line.text;
}

function renderLyrics() {
  const lyrics = latest?.lyrics || [];
  const mode = latest?.lyricMode || 'origin';
  lyricToggle.textContent = mode === 'trans' ? '译' : '原文';
  if (!lyrics.length) {
    linePrev.textContent = '';
    lineNow.textContent = latest?.track ? latest.track.title : '打开网易云，开始播放';
    lineNext.textContent = latest?.track ? '这首歌暂时没有歌词' : '桌面会跟着当前播放的歌走';
    return;
  }
  const sec = lyricNow() / 1000;
  let index = 0;
  for (let i = 0; i < lyrics.length; i += 1) {
    if (lyrics[i].t <= sec + 0.15) index = i;
  }
  linePrev.textContent = lyricLine(lyrics[index - 1], mode);
  lineNow.textContent = lyricLine(lyrics[index], mode);
  lineNext.textContent = lyricLine(lyrics[index + 1], mode);
}

function renderComment() {
  const comments = latest?.comments || [];
  if (!comments.length) {
    commentEl.hidden = true;
    return;
  }
  commentIndex = commentIndex % comments.length;
  const item = comments[commentIndex];
  commentEl.hidden = false;
  commentText.textContent = item.content;
  const likes = formatLikes(item.liked);
  commentMeta.textContent = `云村 · ${item.user}${likes ? `  ·  ${likes}` : ''}`;
  commentDots.innerHTML = comments
    .map((_, index) => `<i class="${index === commentIndex ? 'on' : ''}"></i>`)
    .join('');
}

let shownCover = '';

function renderPlayer() {
  const track = latest?.track;
  const playing = Boolean(track?.playing);
  spectrum.classList.toggle('on', playing);
  document.body.classList.toggle('ambient', latest?.ambient !== false && Boolean(track?.cover));
  if (!track) {
    cover.classList.remove('show');
    cover.removeAttribute('src');
    songTitle.textContent = '尚未播放';
    songArtist.textContent = '';
    progressBar.style.width = '0%';
    playClock.textContent = '';
    return;
  }
  songTitle.textContent = track.title || '未知歌曲';
  songArtist.textContent = track.artist || '';
  if (track.cover) {
    if (shownCover !== track.cover) {
      shownCover = track.cover;
      cover.src = track.cover;
    }
    cover.classList.add('show');
  } else {
    shownCover = '';
    cover.classList.remove('show');
  }
  const duration = track.durationMs || 0;
  const ratio = duration ? Math.min(100, (positionNow() / duration) * 100) : 0;
  if (!dragging) progressBar.style.width = `${ratio}%`;
  playToggle.textContent = playing ? '❚❚' : '▶';
  playClock.textContent = `${clockText(positionNow())} / ${clockText(duration)}${playing ? '' : '  已暂停'}`;
  if (track.cover && latest?.ambient !== false) tintFromCover();
}

function tintFromCover() {
  if (!cover.complete || !cover.naturalWidth) return;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 12;
    canvas.height = 12;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(cover, 0, 0, 12, 12);
    const data = ctx.getImageData(0, 0, 12, 12).data;
    let r = 0;
    let g = 0;
    let b = 0;
    const count = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    const lift = (value) => Math.min(255, Math.round(value / count + 70));
    document.documentElement.style.setProperty('--accent', `rgb(${lift(r)}, ${lift(g)}, ${lift(b)})`);
  } catch {
    /* 远程封面跨域时保留默认米色 */
  }
}

function deadlinesOn(key) {
  return (latest?.deadlines || []).filter((item) => String(item.at).slice(0, 10) === key);
}

function renderCalendar() {
  const first = new Date(view.year, view.month, 1);
  monthLabel.textContent = `${view.year}年${view.month + 1}月`;
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(view.year, view.month + 1, 0).getDate();
  const today = dateKey(new Date());
  monthGrid.innerHTML = '';
  for (let i = 0; i < offset; i += 1) monthGrid.appendChild(document.createElement('span'));
  for (let day = 1; day <= days; day += 1) {
    const date = new Date(view.year, view.month, day);
    const key = dateKey(date);
    const items = deadlinesOn(key).filter((item) => !item.done);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'day';
    if (key === today) button.classList.add('today');
    if (key === view.selected) button.classList.add('selected');
    const soon = items.some((item) => new Date(item.at) - Date.now() < 48 * 3600 * 1000);
    if (soon) button.classList.add('urgent');
    button.innerHTML = `${day}${items.length ? '<i class="dot"></i>' : ''}`;
    button.addEventListener('click', () => {
      view.selected = key;
      renderCalendar();
    });
    monthGrid.appendChild(button);
  }

  const selectedItems = (latest?.deadlines || [])
    .filter((item) => String(item.at).slice(0, 10) === view.selected)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  dayList.innerHTML = '';
  if (!selectedItems.length) {
    const empty = document.createElement('li');
    empty.textContent = '这一天还没有 DDL';
    dayList.appendChild(empty);
    return;
  }
  for (const item of selectedItems) {
    const row = document.createElement('li');
    if (item.done) row.classList.add('done');
    const label = document.createElement('span');
    const time = new Date(item.at);
    const clock = Number.isNaN(time.getTime())
      ? ''
      : `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')} `;
    label.textContent = `${clock}${item.title}`;
    label.addEventListener('click', () => window.desk.toggleDeadline(item.id));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '删除';
    remove.addEventListener('click', () => window.desk.removeDeadline(item.id));
    row.append(label, remove);
    dayList.appendChild(row);
  }
}

function renderListen() {
  const minutes = Math.floor((latest?.listenTodayMs || 0) / 60000);
  listenTime.textContent = `今日已听 ${minutes} 分钟`;
}

function renderMenuState() {
  menu.querySelector('[data-action="ambient"]').classList.toggle('on', latest?.ambient !== false);
  menu.querySelector('[data-action="autostart"]').classList.toggle('on', latest?.autostart !== false);
}

function renderAll() {
  renderPlayer();
  renderLyrics();
  renderComment();
  renderCalendar();
  renderListen();
  renderMenuState();
}

function openMenu(x, y) {
  menu.hidden = false;
  const width = 180;
  const height = 210;
  menu.style.left = `${Math.min(x, window.innerWidth - width)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - height)}px`;
}

coverBtn.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  openMenu(event.clientX, event.clientY);
});

const progress = document.querySelector('#progress');
const playToggle = document.querySelector('#play-toggle');
let dragging = false;

function ratioFromEvent(event) {
  const rect = progress.getBoundingClientRect();
  if (!rect.width) return 0;
  return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
}

progress.addEventListener('pointerdown', (event) => {
  dragging = true;
  progress.setPointerCapture(event.pointerId);
  progressBar.style.width = `${ratioFromEvent(event) * 100}%`;
});

progress.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  progressBar.style.width = `${ratioFromEvent(event) * 100}%`;
});

progress.addEventListener('pointerup', (event) => {
  if (!dragging) return;
  dragging = false;
  const ratio = ratioFromEvent(event);
  progressBar.style.width = `${ratio * 100}%`;
  window.desk.seek(ratio);
});

playToggle.addEventListener('click', () => {
  playToggle.textContent = playToggle.textContent === '▶' ? '❚❚' : '▶';
  window.desk.togglePlay();
});

document.querySelector('#skip-prev').addEventListener('click', () => {
  window.desk.skip('prev');
});

document.querySelector('#skip-next').addEventListener('click', () => {
  window.desk.skip('next');
});

menu.addEventListener('click', async (event) => {
  const action = event.target?.dataset?.action;
  if (!action) return;
  if (action === 'copy') {
    const comments = latest?.comments || [];
    const text = comments[commentIndex]?.content || '';
    await window.desk.menu('copy', text);
  } else if (action === 'wallpaper' || action === 'ambient' || action === 'autostart' || action === 'quit') {
    await window.desk.menu(action);
  }
  menu.hidden = true;
});

document.addEventListener('mousedown', (event) => {
  if (!menu.contains(event.target) && event.target !== coverBtn) menu.hidden = true;
});

lyricToggle.addEventListener('click', async () => {
  const next = latest?.lyricMode === 'trans' ? 'origin' : 'trans';
  await window.desk.menu('lyric-mode', next);
});

document.querySelector('#month-prev').addEventListener('click', () => {
  view.month -= 1;
  if (view.month < 0) {
    view.month = 11;
    view.year -= 1;
  }
  renderCalendar();
});

document.querySelector('#month-next').addEventListener('click', () => {
  view.month += 1;
  if (view.month > 11) {
    view.month = 0;
    view.year += 1;
  }
  renderCalendar();
});

document.querySelector('#ddl-open').addEventListener('click', () => {
  composer.hidden = false;
  const base = view.selected || dateKey(new Date());
  document.querySelector('#ddl-time').value = `${base}T23:59`;
  document.querySelector('#ddl-title').focus();
});

document.querySelector('#ddl-cancel').addEventListener('click', () => {
  composer.hidden = true;
});

composer.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = document.querySelector('#ddl-title').value.trim();
  const at = document.querySelector('#ddl-time').value;
  if (!title || !at) return;
  await window.desk.addDeadline({ title, at });
  document.querySelector('#ddl-title').value = '';
  composer.hidden = true;
  view.selected = at.slice(0, 10);
});

let hitting = false;
window.addEventListener('mousemove', (event) => {
  const node = document.elementFromPoint(event.clientX, event.clientY);
  const hit = Boolean(node && node.closest('[data-hit]'));
  if (hit === hitting) return;
  hitting = hit;
  window.desk.setIgnore(!hit);
});

window.desk.onState((state) => {
  const track = state.track;
  const previous = latest?.track;
  const changed = !previous || !track || previous.title !== track.title || previous.artist !== track.artist;
  latest = state;
  if (track) {
    anchor = {
      positionMs: track.positionMs || 0,
      sentAt: state.sentAt || Date.now(),
      playing: Boolean(track.playing),
    };
  }
  if (changed) commentIndex = 0;
  renderAll();
});

commentTimer = window.setInterval(() => {
  const count = latest?.comments?.length || 0;
  if (count > 1) {
    commentIndex = (commentIndex + 1) % count;
    renderComment();
  }
}, 14000);

window.setInterval(() => {
  if (!latest?.track) return;
  renderLyrics();
  renderPlayer();
}, 400);

renderCalendar();
