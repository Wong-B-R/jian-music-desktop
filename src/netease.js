const OpenCC = require('opencc-js');

const toTaiwan = OpenCC.Converter({ from: 'cn', to: 'tw' });
const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
const SIMPLIFIED_ARTISTS = new Set(['许嵩', '王菲', '窦靖童', '陈粒', '陈婧霏']);

function useSimplified(artist) {
  return String(artist || '')
    .split(/[/／、,&]/)
    .map((name) => name.replace(/[（(].*?[）)]/g, '').trim())
    .some((name) => SIMPLIFIED_ARTISTS.has(name));
}

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Referer: 'https://music.163.com/',
  Cookie: 'appver=8.9.75; os=pc; osver=Microsoft-Windows-10',
};

function norm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[（(].*?[）)]/g, '');
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function scoreSong(song, title, artist, albumHint) {
  let score = 0;
  const name = norm(song.name);
  const wanted = norm(title);
  if (!wanted) return -1;
  if (name === wanted) score += 6;
  else if (name.includes(wanted) || wanted.includes(name)) score += 3;
  else return -1;

  const artists = (song.artists || song.ar || []).map((item) => norm(item.name)).join(' ');
  const wantedArtist = norm(artist);
  if (wantedArtist && artists.includes(wantedArtist)) score += 4;

  const album = norm(song.album?.name || song.al?.name || '');
  const hint = norm(albumHint);
  if (album && hint.includes(album)) score += 10 + album.length;
  return score;
}

async function searchSong(title, artist, albumHint) {
  const keyword = [title, artist].filter(Boolean).join(' ');
  if (!keyword) return null;
  const url = `https://music.163.com/api/search/get?s=${encodeURIComponent(keyword)}&type=1&offset=0&limit=12`;
  const data = await getJson(url);
  const songs = data?.result?.songs || [];
  let best = null;
  let bestScore = 0;
  for (const song of songs) {
    const value = scoreSong(song, title, artist, albumHint);
    if (value > bestScore) {
      best = song;
      bestScore = value;
    }
  }
  if (!best) return null;
  let pic = best.album?.picUrl || best.al?.picUrl || '';
  let duration = best.duration || best.dt || 0;
  if (!pic) {
    try {
      const detail = await getJson(`https://music.163.com/api/song/detail/?id=${best.id}&ids=[${best.id}]`);
      const full = detail?.songs?.[0];
      pic = full?.album?.picUrl || '';
      duration = duration || full?.duration || 0;
    } catch {
      pic = '';
    }
  }
  return {
    id: best.id,
    name: best.name,
    artist: (best.artists || best.ar || []).map((item) => item.name).join(' / '),
    album: best.album?.name || best.al?.name || '',
    cover: pic ? `${pic}${pic.includes('?') ? '&' : '?'}param=480y480` : '',
    duration,
  };
}

function parseLrc(raw) {
  const lines = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const matched = /\[(\d+):(\d+(?:\.\d+)?)\](.*)/.exec(line);
    if (!matched) continue;
    const text = matched[3].trim();
    if (!text) continue;
    lines.push({
      t: Number(matched[1]) * 60 + Number(matched[2]),
      text,
    });
  }
  return lines;
}

function mergeLyrics(origin, trans, convert) {
  return origin.map((line) => {
    let translated = '';
    let best = 0.6;
    for (const item of trans) {
      const gap = Math.abs(item.t - line.t);
      if (gap < best) {
        best = gap;
        translated = item.text;
      }
    }
    return { t: line.t, text: convert(line.text), trans: translated ? convert(translated) : '' };
  });
}

async function fetchLyrics(id, artist) {
  const data = await getJson(`https://music.163.com/api/song/lyric?id=${id}&lv=1&kv=1&tv=1`);
  const origin = parseLrc(data?.lrc?.lyric);
  const trans = parseLrc(data?.tlyric?.lyric);
  const convert = useSimplified(artist) ? toSimplified : toTaiwan;
  return mergeLyrics(origin, trans, convert);
}

async function fetchComments(id) {
  const data = await getJson(`https://music.163.com/api/v1/resource/comments/R_SO_4_${id}?limit=20`);
  const list = data.hotComments?.length ? data.hotComments : data.comments || [];
  return list
    .map((item) => ({
      content: String(item.content || '').replace(/\s+/g, ' ').trim(),
      user: item.user?.nickname || '云村村民',
      liked: item.likedCount || 0,
    }))
    .filter((item) => item.content.length >= 8)
    .slice(0, 12);
}

async function fetchCoverData(url) {
  const response = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`cover HTTP ${response.status}`);
  let type = (response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  if (type === 'image/jpg') type = 'image/jpeg';
  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:${type};base64,${bytes.toString('base64')}`;
}

async function songById(id) {
  const detail = await getJson(`https://music.163.com/api/song/detail/?id=${id}&ids=[${id}]`);
  const song = detail?.songs?.[0];
  if (!song) return null;
  const pic = song.album?.picUrl || '';
  return {
    id: song.id,
    name: song.name,
    artist: (song.artists || []).map((item) => item.name).join(' / '),
    album: song.album?.name || '',
    cover: pic ? `${pic}${pic.includes('?') ? '&' : '?'}param=480y480` : '',
    duration: song.duration || 0,
  };
}

module.exports = { searchSong, songById, fetchLyrics, fetchComments, fetchCoverData };
