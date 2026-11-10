'use strict';
/* rJuke — UI */

// ===================== utilities =====================
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const coll = new Intl.Collator('it', { sensitivity: 'base', numeric: true });
const sortName = (s) => String(s || '').replace(/^(the|il|lo|la|i|gli|le)\s+/i, '');
const byName = (get) => (a, b) => coll.compare(sortName(get(a)), sortName(get(b)));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const nf = new Intl.NumberFormat(loc());

function fileUrl(p) { return window.rjFileSrc(p); }
function fileUrlDesktop(p) {
  if (!p) return '';
  const s = p.replace(/\\/g, '/');
  const enc = s.split('/').map((seg) => (/^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg))).join('/');
  if (s.startsWith('//')) return 'file:' + enc;
  if (s.startsWith('/')) return 'file://' + enc;
  return 'file:///' + enc;
}
const cssUrl = (p) => `url('${fileUrl(p).replace(/'/g, '%27')}')`;

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const hh = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return hh ? `${hh}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function fmtLong(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return m === 1 ? T('1 minute') : `${T('{0} minutes', m)}`;
  const hh = Math.floor(m / 60), mm = m % 60;
  const hs = hh === 1 ? T('1 hour') : `${T('{0} hours', hh)}`;
  return mm ? `${T('{0} and {1} min', hs, mm)}` : hs;
}
// «3 tracks» — a word repeated identical in English carries a «#n» mark for the plural (e.g. «skipped#n»)
const plural = (n, one, many) => `${nf.format(n)} ${(n === 1 ? one : many).replace(/#n$/, "")}`;
function hashStr(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
function seeded(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffled(arr, rnd = Math.random) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function mixHex(hex, other, k) {
  const p = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
  const a = p(hex), b = p(other);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * k).toString(16).padStart(2, '0')).join('');
}

const nm = () => (S.settings && S.settings.name) || '';
function isBirthday() {
  const b = S.settings && S.settings.birthday;
  if (!b) return false;
  const d = new Date();
  return b === `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function greeting() {
  const n = nm();
  const d = new Date(), hr = d.getHours(), wd = d.getDay();
  const weekend = wd === 0 || wd === 6;
  if (isBirthday()) return { hi: T('Happy birthday'), sub: T('Today the music is all yours. 🎂'), bday: true };
  if (hr >= 5 && hr < 12) return { hi: T('Good morning'), sub: weekend ? T('Happy weekend! Taking it easy?') : T('Start the day with your music.') };
  if (hr >= 12 && hr < 18) return { hi: T('Good afternoon'), sub: weekend ? T('Happy weekend! What are we listening to?') : T('What shall we listen to today?') };
  if (hr >= 18 && hr < 24) return { hi: T('Good evening'), sub: wd === 6 ? T('Saturday night: turn it up.') : T('Relax with your favourite music.') };
  return { hi: T('Good night'), sub: T('Still up? Here\'s something for the night.') };
}
function todayLabel() {
  const s = new Intl.DateTimeFormat(loc(), { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ===================== state =====================
const S = {
  info: {}, settings: null,
  tracks: [], byPath: new Map(), albums: [], albumMap: new Map(), artists: [], artistMap: new Map(),
  playlists: [], plMap: new Map(),
  view: null, section: 'home', history: [], cleanup: [],
  queue: [], original: null, qi: -1, ctx: null,
  shuffle: false, repeat: 'off', volume: 0.8, playing: false,
  lyrics: null, npMode: 'lyrics', npOpen: false, queueOpen: false,
  songSort: { key: 'title', dir: 1 },
  recent: [], scanning: false,
};
const cur = () => S.queue[S.qi] || null;
const content = () => $('#content');

const store = {
  get(k, d) { try { const v = localStorage.getItem('rj.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rj.' + k, JSON.stringify(v)); } catch { /* */ } },
};

// ===================== library =====================
// “21 Savage, Travis Scott” are two artists: the comma (and ; / feat.) separates names.
// Bands with a comma in their name stay whole.
const ARTIST_KEEP = ['tyler, the creator', 'earth, wind & fire', 'crosby, stills, nash & young', 'crosby, stills & nash', 'emerson, lake & palmer', 'blood, sweat & tears', 'peter, paul and mary', 'now, now', 'portugal. the man'];
function splitArtists(s) {
  s = String(s || '').trim();
  if (!s) return [T('Unknown artist')];
  const keep = [];
  let rest = s;
  for (const k of ARTIST_KEEP) {
    const i = norm(rest).indexOf(k);
    if (i >= 0 && norm(rest).length === rest.length) { keep.push(rest.slice(i, i + k.length)); rest = rest.slice(0, i) + '\u0001' + rest.slice(i + k.length); }
  }
  let k = 0;
  const out = rest.split(/\s*(?:,|;|\s\/\s|\s+(?:feat\.?|ft\.?|featuring)\s+)\s*/i)
    .map((x) => x.replace(/\u0001/g, () => keep[k++] || '').trim()).filter(Boolean);
  const seen = new Set();
  return out.filter((x) => { const n = norm(x); if (seen.has(n)) return false; seen.add(n); return true; });
}
const artistLinks = (s, cls = 'link') => splitArtists(s).map((n) => `<span class="${cls}" data-artist-link="${esc(norm(n))}">${esc(n)}</span>`).join(', ');

function buildLibrary(lib) {
  const covers = lib.covers || {};
  const tracks = lib.tracks.map((t) => ({ ...t }));
  const albumMap = new Map();
  for (const t of tracks) {
    let a = albumMap.get(t.albumKey);
    if (!a) {
      a = { key: t.albumKey, title: t.album || T('Unknown album'), tracks: [], cover: covers[t.albumKey] || null, year: null, genre: '', added: 0, duration: 0, aa: '' };
      albumMap.set(t.albumKey, a);
    }
    a.tracks.push(t);
    if (t.albumArtist && !a.aa) a.aa = t.albumArtist;
    if (t.year && (!a.year || t.year > a.year)) a.year = t.year;
    if (t.genre && !a.genre) a.genre = t.genre;
    a.added = Math.max(a.added, t.added || 0);
    a.duration += t.duration || 0;
    t.album_ = a;
    t.cover = a.cover;
  }
  const albums = [...albumMap.values()];
  for (const a of albums) {
    a.tracks.sort((x, y) => (x.disc || 1) - (y.disc || 1) || (x.track || 999) - (y.track || 999) || coll.compare(x.title, y.title));
    const artists = new Set(a.tracks.map((t) => t.artist));
    a.artist = a.aa || (artists.size === 1 ? a.tracks[0].artist : T('Various artists'));
    a.discs = new Set(a.tracks.map((t) => t.disc || 1)).size;
    a.s = norm(a.title + ' ' + a.artist);
  }
  albums.sort(byName((a) => a.title));

  const artistMap = new Map();
  const getArtist = (name) => {
    const k = norm(name);
    let ar = artistMap.get(k);
    if (!ar) { ar = { key: k, name, albums: [], appears: new Set(), tracks: [] }; artistMap.set(k, ar); }
    return ar;
  };
  for (const a of albums) {
    a.artists = a.artist === T('Various artists') ? [] : splitArtists(a.artist);
    for (const n of a.artists) getArtist(n).albums.push(a);
  }
  for (const t of tracks) {
    t.artists = splitArtists(t.artist);
    for (const n of t.artists) {
      const ar = getArtist(n);
      ar.tracks.push(t);
      if (!t.album_.artists.some((x) => norm(x) === ar.key)) ar.appears.add(t.album_);
    }
  }
  const artists = [...artistMap.values()];
  for (const ar of artists) {
    ar.albums.sort((x, y) => (y.year || 0) - (x.year || 0));
    ar.appears = [...ar.appears];
    const withCover = ar.albums.find((x) => x.cover) || ar.appears.find((x) => x.cover);
    ar.cover = withCover ? withCover.cover : null;
    ar.s = norm(ar.name);
  }
  artists.sort(byName((a) => a.name));

  for (const t of tracks) t.s = norm(`${t.title} ${t.artist} ${t.album_.title}`);
  S.tracks = tracks;
  S.byPath = new Map(tracks.map((t) => [t.path, t]));
  S.albums = albums;
  S.albumMap = albumMap;
  S.artists = artists;
  S.artistMap = artistMap;
  // remaps the queue onto the new library
  S.queue = S.queue.map((t) => S.byPath.get(t.path)).filter(Boolean);
  if (S.original) S.original = S.original.map((t) => S.byPath.get(t.path)).filter(Boolean);
  if (S.qi >= S.queue.length) S.qi = S.queue.length - 1;
}

// ===================== theme =====================
function applyTheme() {
  const pref = (S.settings && S.settings.theme) || 'system';
  const dark = pref === 'dark' || (pref === 'system' && S.info.dark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  updateChrome();
}
function updateChrome() {
  if (!$('#setup').hidden) return rj.chromeColors({ color: '#0c0c10', symbolColor: '#ffffff' });
  if (S.npOpen) return rj.chromeColors({ color: S.npBase || '#222222', symbolColor: '#ffffff' });
  const dark = document.documentElement.dataset.theme === 'dark';
  rj.chromeColors(dark ? { color: '#1f1f22', symbolColor: '#f5f5f7' } : { color: '#f7f7f8', symbolColor: '#1d1d1f' });
}

// ===================== covers =====================
function phStyle(key) {
  const hue = hashStr(key || 'x') % 360;
  return `background:linear-gradient(135deg, hsl(${hue} 52% 64%), hsl(${(hue + 38) % 360} 48% 42%))`;
}
function artHTML(cover, key, { size = 's', cls = '', ph = 'note', morph = '' } = {}) {
  const m = morph ? ` data-morph="${esc(morph)}"` : '';
  if (cover) return `<div class="art ${cls}"${m}><img src="${fileUrl(size === 'l' ? cover.l : cover.s)}" loading="lazy" decoding="async" alt=""></div>`;
  return `<div class="art ${cls}"${m}><div class="ph" style="${phStyle(key)}">${icon(ph)}</div></div>`;
}
function plCovers(pl) {
  const seen = new Set(); const out = [];
  for (const p of pl.paths) {
    const t = S.byPath.get(p);
    if (t && t.cover && !seen.has(t.albumKey)) { seen.add(t.albumKey); out.push(t.cover); if (out.length === 4) break; }
  }
  return out;
}
function plArtHTML(pl, cls = '') {
  const c = plCovers(pl);
  const m = ` data-morph="pl:${esc(pl.id)}"`;
  if (c.length >= 4) return `<div class="art ${cls}"${m}><div class="mosaic">${c.map((x) => `<img src="${fileUrl(x.s)}" class="loaded" alt="">`).join('')}</div></div>`;
  if (c.length) return `<div class="art ${cls}"${m}><img src="${fileUrl(c[0].l)}" loading="lazy" alt=""></div>`;
  return `<div class="art ${cls}"${m}><div class="ph" style="${phStyle(pl.id)}">${icon('playlist')}</div></div>`;
}
document.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') e.target.classList.add('loaded'); }, true);

// ===================== playback (native Android player) =====================
const NP = { pos: 0, at: 0, dur: 0, playing: false, ready: false };
window.S = S;
const audio = {
  get currentTime() { return Math.max(0, (NP.pos + (NP.playing ? performance.now() - NP.at : 0)) / 1000); },
  set currentTime(v) { seekTo(v); },
  get duration() { return NP.dur ? NP.dur / 1000 : (cur() ? cur().duration : 0); },
  get paused() { return !NP.playing; },
  get src() { return S.queue.length ? 'x' : ''; },
};
const itemFor = (t) => ({ id: t.path, uri: t.uri, title: t.title, artist: t.artist, album: t.album_.title, art: t.cover ? t.cover.l : '', dur: Math.round((t.duration || 0) * 1000) });
const J = window.Juke;
function jcall(p) { return p.catch((e) => console.warn('[juke]', e && e.message)); }
function setPos(ms) { NP.pos = ms; NP.at = performance.now(); }
let seekGuard = 0;

function loadTrack(i, { autoplay = true, at = 0, dir = 0 } = {}) {
  if (i < 0 || i >= S.queue.length) return;
  S.dir = dir || (i > S.qi ? 1 : i < S.qi ? -1 : 0);
  const prevT = cur();
  S.qi = i;
  setPos(at * 1000); NP.dur = (cur().duration || 0) * 1000;
  if (autoplay) { NP.playing = true; updatePlayState(); }
  jcall(J.skipTo({ index: i, play: autoplay }));
  onTrackChange(prevT !== cur());
}
function onPlayError() {}

function pushQueue(play = true, positionMs = 0) {
  setPos(positionMs); NP.dur = (cur() ? cur().duration : 0) * 1000;
  NP.playing = play; updatePlayState();
  return jcall(J.loadQueue({ items: S.queue.map(itemFor), index: Math.max(0, S.qi), positionMs, play }));
}

function playList(list, start = 0, { shuffle = null, ctx = null } = {}) {
  if (!list.length) return;
  rj.haptic('tap');
  S.ctx = ctx;
  if (shuffle !== null) S.shuffle = shuffle;
  S.original = list.slice();
  const prevT = cur();
  if (S.shuffle) {
    const first = shuffle === true && start === 0 ? Math.floor(Math.random() * list.length) : start;
    const rest = list.filter((_, k) => k !== first);
    S.queue = [list[first], ...shuffled(rest)];
    S.qi = 0;
  } else {
    S.queue = list.slice();
    S.qi = start;
  }
  S.dir = 1;
  pushQueue(true);
  onTrackChange(prevT !== cur());
  updateModeButtons();
  if (ctx) pushRecent(ctx);
  renderQueues();
  saveState();
}
function playTrackNow(t) { playList([t], 0, { shuffle: false }); }
function playNext(tracks) {
  if (!cur()) return playList(tracks);
  S.queue.splice(S.qi + 1, 0, ...tracks);
  if (S.original) S.original.push(...tracks);
  jcall(J.insert({ index: S.qi + 1, items: tracks.map(itemFor) }));
  renderQueues(); saveState(); bumpMini();
  toast(tracks.length === 1 ? `${T('“{0}” will play next', tracks[0].title)}` : `${T('{0} will play next', plural(tracks.length, T('track'), T('tracks')))}`, tracks[0].cover);
}
function bumpMini() { const l = $('#lcd'); if (!l) return; l.classList.remove('bump'); void l.offsetWidth; l.classList.add('bump'); }
function queueInsertAt(at, tracks) {
  S.queue.splice(at, 0, ...tracks);
  if (S.original) S.original.push(...tracks);
  jcall(J.insert({ index: at, items: tracks.map(itemFor) }));
  renderQueues(); saveState();
}
function playLast(tracks) {
  if (!cur()) return playList(tracks);
  const at = S.queue.length;
  S.queue.push(...tracks);
  if (S.original) S.original.push(...tracks);
  jcall(J.insert({ index: at, items: tracks.map(itemFor) }));
  renderQueues(); saveState(); bumpMini();
  toast(tracks.length === 1 ? `${T('“{0}” added to the queue', tracks[0].title)}` : `${T('{0} added to the queue', plural(tracks.length, T('track'), T('tracks')))}`, tracks[0].cover);
}
function togglePlay() {
  rj.haptic('tap');
  if (!cur()) { if (S.tracks.length) playList(S.tracks, 0, { shuffle: true }); return; }
  if (NP.playing) { setPos(audio.currentTime * 1000); NP.playing = false; updatePlayState(); jcall(J.pause()); }
  else { NP.playing = true; setPos(NP.pos); updatePlayState(); jcall(J.play()); }
}
function next() {
  if (!S.queue.length) return;
  rj.haptic('tick');
  if (S.qi < S.queue.length - 1) loadTrack(S.qi + 1, { dir: 1 });
  else if (S.repeat === 'all') loadTrack(0, { dir: 1 });
}
function prev() {
  if (!S.queue.length) return;
  rj.haptic('tick');
  if (audio.currentTime > 3 || S.qi === 0) { seekTo(0); if (!NP.playing) togglePlay(); return; }
  loadTrack(S.qi - 1, { dir: -1 });
}
function toggleShuffle() {
  const t = cur();
  S.shuffle = !S.shuffle;
  rj.haptic('tick');
  if (t) {
    if (S.shuffle) {
      S.original = S.queue.slice();
      const rest = S.queue.filter((_, k) => k !== S.qi);
      S.queue = [t, ...shuffled(rest)];
      S.qi = 0;
    } else if (S.original) {
      S.queue = S.original.slice();
      S.qi = Math.max(0, S.queue.indexOf(t));
    }
    jcall(J.replaceOthers({ before: S.queue.slice(0, S.qi).map(itemFor), after: S.queue.slice(S.qi + 1).map(itemFor) }));
    jcall(J.setShuffle({ on: false }));
  }
  updateModeButtons(); renderQueues(); saveState();
  toast(S.shuffle ? T('Shuffle on') : T('Shuffle off'));
}
function cycleRepeat() {
  S.repeat = S.repeat === 'off' ? 'all' : S.repeat === 'all' ? 'one' : 'off';
  rj.haptic('tick');
  jcall(J.setRepeat({ mode: S.repeat }));
  updateModeButtons(); saveState();
  toast(S.repeat === 'off' ? T('Repeat off') : S.repeat === 'all' ? T('Repeat all') : T('Repeat this track'));
}
function setVolume() {}
function seekTo(sec) {
  const d = audio.duration;
  const ms = Math.round(clamp(sec, 0, d ? d - 0.3 : sec) * 1000);
  setPos(ms);
  seekGuard = performance.now() + 700;
  jcall(J.seek({ ms }));
}
function queueRemove(i, n = 1) {
  const removed = S.queue.splice(i, n);
  if (S.original) for (const t of removed) { const k = S.original.lastIndexOf(t); if (k >= 0) S.original.splice(k, 1); }
  if (i < S.qi) S.qi -= n;
  jcall(J.remove({ index: i, count: n }));
  renderQueues(); saveState();
}

// sync with the native player
let errSkip = 0;
// the queue can be changed from outside (Android Auto, notification): in that case it's read back from the player
let syncingQueue = false;
async function syncQueueFromNative() {
  if (syncingQueue) return;
  syncingQueue = true;
  try {
    const r = await J.getQueue();
    const q = (r.ids || []).map((p) => S.byPath.get(p)).filter(Boolean);
    if (q.length) {
      const prevT = cur();
      S.queue = q; S.original = q.slice(); S.qi = clamp(r.index || 0, 0, q.length - 1);
      S.shuffle = !!r.shuffle;
      onTrackChange(prevT !== cur());
      updateModeButtons(); renderQueues(); saveState();
    }
  } catch { /* */ }
  syncingQueue = false;
}
function onNativeState(s) {
  if (!s || !s.ready) return;
  if (s.count && (s.count !== S.queue.length || (s.mediaId && !S.queue.some((t) => t.path === s.mediaId)))) { syncQueueFromNative(); }
  NP.ready = true;
  const playing = !!(s.playWhenReady && s.state !== 4 && s.state !== 1);
  if (performance.now() > seekGuard || s.mediaId !== (cur() && cur().path)) setPos(s.positionMs || 0);
  if (s.durationMs) NP.dur = s.durationMs;
  if (s.mediaId && (!cur() || cur().path !== s.mediaId)) {
    let idx = (s.index >= 0 && S.queue[s.index] && S.queue[s.index].path === s.mediaId) ? s.index : S.queue.findIndex((t) => t.path === s.mediaId);
    if (idx >= 0) {
      const prevT = cur();
      S.dir = idx > S.qi ? 1 : -1;
      S.qi = idx;
      NP.dur = s.durationMs || (cur().duration || 0) * 1000;
      onTrackChange(prevT !== cur());
      saveState();
    }
  }
  if (s.repeat && s.repeat !== S.repeat) { S.repeat = s.repeat; updateModeButtons(); }
  if (s.shuffle === true && !S.shuffle) { S.shuffle = true; updateModeButtons(); }
  if (playing !== NP.playing) { NP.playing = playing; updatePlayState(); saveState(); }
  const t = cur();
  if (t && s.durationMs && Math.abs(t.duration - s.durationMs / 1000) > 2) t.duration = s.durationMs / 1000;
}
function bindNative() {
  J.addListener('state', onNativeState);
  J.addListener('progress', (p) => {
    if (NP.playing && performance.now() > seekGuard) setPos(p.positionMs);
    if (p.durationMs) NP.dur = p.durationMs;
  });
  J.addListener('error', (e) => {
    const t = S.queue[e.index] || cur();
    const m = String(e.message || '');
    if (t) toast(`${T('Can\'t play “{0}”. Unsupported format or missing file.', t.title)}`, null, 'err');
    if (e.index < S.queue.length - 1 && errSkip++ < 5) setTimeout(() => loadTrack(e.index + 1), 900);
  });
  setInterval(() => { if (NP.playing) saveState(); }, 5000);
}

function saveState() {
  store.set('state', {
    q: S.queue.map((t) => t.path), o: S.original ? S.original.map((t) => t.path) : null,
    qi: S.qi, time: audio.currentTime || 0, shuffle: S.shuffle, repeat: S.repeat, ctx: S.ctx,
  });
}
async function restoreState() {
  S.volume = 1;
  const st = store.get('state', null);
  S.recent = store.get('recent', []);
  if (!st) return;
  S.shuffle = !!st.shuffle; S.repeat = st.repeat || 'off'; S.ctx = st.ctx || null;
  S.queue = (st.q || []).map((p) => S.byPath.get(p)).filter(Boolean);
  S.original = st.o ? st.o.map((p) => S.byPath.get(p)).filter(Boolean) : null;
  if (!S.queue.length) return;
  S.qi = clamp(st.qi || 0, 0, S.queue.length - 1);
  let ns = null;
  try { ns = await J.ready(); } catch { /* */ }
  // if music is already playing (app reopened), the player's state is adopted
  if (ns && ns.count === S.queue.length && ns.mediaId) {
    const idx = S.queue.findIndex((t) => t.path === ns.mediaId);
    if (idx >= 0) { S.qi = idx; onNativeState(ns); onTrackChange(false); return; }
  }
  await pushQueue(false, Math.round((st.time || 0) * 1000));
  jcall(J.setRepeat({ mode: S.repeat }));
  onTrackChange(false);
}
function pushRecent(ctx) {
  const id = ctx.type + ':' + (ctx.key || ctx.id);
  S.recent = [ctx, ...S.recent.filter((c) => c.type + ':' + (c.key || c.id) !== id)].slice(0, 20);
  store.set('recent', S.recent);
  rj.saveRecent && rj.saveRecent(S.recent);
}

// ===================== player UI updates =====================
function onTrackChange(changed) {
  setTimeout(refreshHero, 0);
  const t = cur();
  updateLCD(changed);
  updateNP(changed);
  refreshPlaying();
  renderQueues();
  loadLyrics(t);
  if (false && t) {
    const meta = { title: t.title, artist: t.artist, album: t.album_.title };
    navigator.mediaSession.metadata = new MediaMetadata(meta);
    if (t.cover) rj.coverData(t.cover.s).then((src) => {
      if (src && cur() === t) navigator.mediaSession.metadata = new MediaMetadata({ ...meta, artwork: [{ src, sizes: '400x400', type: 'image/jpeg' }] });
    });
  }
  sendPlayerState();
}
function sendPlayerState() {
  const t = cur();
  rj.playerState({ playing: S.playing, title: t ? t.title : '', artist: t ? t.artist : '', name: nm() });
}
let shownPlayIcon = null;
function updatePlayState() {
  setTimeout(refreshHero, 0);
  S.playing = NP.playing;
  document.body.classList.toggle('paused', !S.playing);
  const want = S.playing ? 'pause' : 'play';
  if (want !== shownPlayIcon) {
    const first = shownPlayIcon === null;
    shownPlayIcon = want;
    for (const b of [$('#tb-play'), $('#np-play')]) {
      b.innerHTML = icon(want);
      if (!first) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
    }

  }
  if (S.npOpen) npbgKick();
  if (false) navigator.mediaSession.playbackState = S.playing ? 'playing' : 'paused';
  sendPlayerState();
}
function updateModeButtons() {
  for (const id of ['#np-shuffle']) { $(id).innerHTML = icon('shuffle'); $(id).classList.toggle('on', S.shuffle); }
  for (const id of ['#np-repeat']) {
    $(id).innerHTML = icon(S.repeat === 'one' ? 'repeat1' : 'repeat');
    $(id).classList.toggle('on', S.repeat !== 'off');
    $(id).title = S.repeat === 'off' ? T('Repeat: off') : S.repeat === 'all' ? T('Repeat: all') : T('Repeat: one track');
  }
}
function updateVolumeUI() { }
function updateVolumeUIDesktop() {
  const v = S.volume;
  $('#vol-slider .slider-fill').style.width = v * 100 + '%';
  $('#vol-slider .slider-knob').style.left = v * 100 + '%';
  $('#tb-vol .vol-i').innerHTML = icon(v < 0.01 ? 'vol0' : 'vol');
  $('#np-vol .np-slider-fill').style.width = v * 100 + '%';
}
function updateLCD(changed) {
  const t = cur();
  const lcd = $('#lcd');
  lcd.classList.toggle('idle', !t);
  const la = $('#lcd-art');
  la.innerHTML = t ? (t.cover ? `<img src="${fileUrl(t.cover.s)}" alt="">` : `<div class="ph" style="${phStyle(t.albumKey)}">${icon('note')}</div>`) : '';
  if (changed) { la.classList.remove('pop'); void la.offsetWidth; la.classList.add('pop'); }
  const tx = $('#lcd-text');
  tx.innerHTML = t
    ? `<div class="t1">${esc(t.title)}</div><div class="t2">${esc(t.artist)} — ${esc(t.album_.title)}</div>`
    : `<div class="lcd-idle">${logoSVG()}</div>`;
  if (changed) { tx.classList.remove('swap'); void tx.offsetWidth; tx.classList.add('swap'); }
}

let seekPreview = null;
const PL = { last: {}, els: null };
function plSet(key, el, prop, v) {
  if (PL.last[key] === v) return;
  PL.last[key] = v;
  if (prop === 'text') el.textContent = v; else el.style.transform = `scaleX(${v})`;
}
function progressLoop() {
  if (!PL.els) PL.els = { lf: $('#lcd-fill'), lc: $('#lcd-cur'), lr: $('#lcd-rem'), nf: $('#np-fill'), nc: $('#np-cur'), nr: $('#np-rem') };
  const E = PL.els;
  const d = audio.duration || 0, c = seekPreview != null ? seekPreview * d : audio.currentTime;
  const k = d ? Math.round(clamp(c / d, 0, 1) * 4000) / 4000 : 0;
  const cs = fmtTime(c), rs = '-' + fmtTime(d - c);
  plSet('lf', E.lf, 'x', k); plSet('lc', E.lc, 'text', cs); plSet('lr', E.lr, 'text', rs);
  if (S.npOpen) {
    plSet('nf', E.nf, 'x', k); plSet('nc', E.nc, 'text', cs); plSet('nr', E.nr, 'text', rs);
    if (S.npMode === 'lyrics' && (!audio.paused || PL.last.lyT !== c)) { PL.last.lyT = c; lyTick(); }
  }
  requestAnimationFrame(progressLoop);
}

function bindSlider(el, onMove, onEnd) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    el.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    const f = (ev) => { const r = el.getBoundingClientRect(); onMove(clamp((ev.clientX - r.left) / r.width, 0, 1)); };
    f(e);
    const up = (ev) => {
      el.classList.remove('drag');
      el.removeEventListener('pointermove', f); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      const r = el.getBoundingClientRect();
      if (onEnd) onEnd(clamp((ev.clientX - r.left) / r.width, 0, 1));
    };
    el.addEventListener('pointermove', f); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
}

// ===================== router =====================
const TOP = new Set(['home', 'library', 'search']);
const canVT = !!document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches;
let vtRunning = null;
function inView(el) {
  const r = el.getBoundingClientRect(), v = content().getBoundingClientRect();
  return r.width > 0 && r.bottom > v.top + 10 && r.top < v.bottom - 10 && r.right > v.left && r.left < v.right;
}
function withVT(update, morphKey = null) {
  if (!canVT || document.hidden || !S.view) { update(); return; }
  if (vtRunning) { try { vtRunning.skipTransition(); } catch { /* */ } }
  const pick = () => (morphKey ? $$(`[data-morph="${CSS.escape(morphKey)}"]`, content()).find(inView) || null : null);
  const old = pick();
  if (old) old.style.viewTransitionName = 'morph';
  const vt = document.startViewTransition(() => {
    if (old) old.style.viewTransitionName = '';
    update();
    const nu = old ? pick() : null;
    if (nu) {
      nu.style.viewTransitionName = 'morph';
      // the cover that flew in is already in place: no second fade-in animation (bug #7)
      nu.style.animation = 'none';
      nu.classList.add('arrived');
      const rv = nu.closest('.rv'); if (rv) rv.classList.add('in', 'now');
    }
    document.documentElement.classList.toggle('vt-morph', !!nu);
  });
  vtRunning = vt;
  vt.ready.catch(() => {}); vt.updateCallbackDone.catch(() => {});
  vt.finished.finally(() => {
    $$('[data-morph]').forEach((e) => { e.style.viewTransitionName = ''; });
    document.documentElement.classList.remove('vt-morph');
    if (vtRunning === vt) vtRunning = null;
  });
}
function viewMorphKey(v) {
  if (!v) return null;
  if (v.name === 'album') return 'album:' + v.param;
  if (v.name === 'artist') return 'artist:' + v.param;
  if (v.name === 'playlist') return 'pl:' + v.param;
  return null;
}
const TAB_ORDER = { home: 0, library: 1, search: 2 };
function go(name, param = null, { push = true, vt = true, morph = null } = {}) {
  // between the bottom tabs the new page comes from the side of the chosen tab
  const from = S.view && TOP.has(S.view.name) ? S.view.name : S.tab;
  S.navDir = name in TAB_ORDER && from in TAB_ORDER && name !== from ? (TAB_ORDER[name] > TAB_ORDER[from] ? 'from-right' : 'from-left') : null;
  const run = () => {
    if (S.view && push) S.history.push({ ...S.view, scroll: content().scrollTop });
    if (TOP.has(name)) { S.history = []; S.section = name; S.tab = name; }
    if (name === 'playlist') S.section = 'pl:' + param;
    if (name === 'search') S.section = 'search';
    S.view = { name, param };
    render({});
    if (S.queueOpen) toggleQueue(false);
  };
  if (vt) withVT(run, morph); else run();
}
function goBack() {
  const v = S.history[S.history.length - 1];
  if (!v) return;
  const morph = viewMorphKey(S.view);
  withVT(() => {
    S.history.pop();
    S.view = { name: v.name, param: v.param };
    if (v.name === 'playlist') S.section = 'pl:' + v.param;
    else if (TOP.has(v.name)) { S.section = v.name; S.tab = v.name; }
    render({ back: true, scroll: v.scroll });
  }, morph);
}

// element entrance: only those visible on opening are animated, the others are ready at once
let revealIO = null;
function reveal(root, instant = false) {
  const els = $$('.card, .tr, .shelf-head, .stat, .top-result, .disc-h, .set-group, .section-h, .foot-note', root).filter((e) => !e.closest('.vrow, .vgrid') && !e.classList.contains('in'));
  if (!els.length) return;
  if (instant) { els.forEach((e) => e.classList.add('rv', 'in', 'now')); return; }
  const vh = content().clientHeight + 20, vw = innerWidth;
  const anim = [];
  for (const e of els) {
    const r = e.getBoundingClientRect();
    if (anim.length < 18 && r.top < vh && r.bottom > 0 && r.left < vw) anim.push(e);
    else e.classList.add('rv', 'in', 'now');
  }
  anim.forEach((e, k) => { e.classList.add('rv'); e.style.setProperty('--rd', k * 28 + 'ms'); });
  requestAnimationFrame(() => requestAnimationFrame(() => anim.forEach((e) => e.classList.add('in'))));
  setTimeout(() => anim.forEach((e) => e.style.removeProperty('--rd')), 1500);
}
function render({ back = false, scroll = 0, keepScroll = false, noAnim = false } = {}) {
  const c = content();
  const prevScroll = c.scrollTop;
  S.cleanup.forEach((f) => f()); S.cleanup = [];
  const fn = VIEWS[S.view.name] || VIEWS.home;
  let el;
  try { el = fn(S.view.param); } catch (err) { console.error(err); el = h(`<div class="empty-state">${icon('note')}<h3>${T('Something went wrong')}</h3><p>${esc(err.message)}</p></div>`); }
  el.classList.add('view');
  if (!keepScroll && !noAnim) el.classList.add(back ? 'back' : 'enter');
  if (!back && !keepScroll && !noAnim && S.navDir) el.classList.add(S.navDir);
  S.navDir = null;
  c.replaceChildren(el);
  c.scrollTop = keepScroll ? prevScroll : scroll;
  $('#app').classList.toggle('searching', S.view.name === 'search');
  reveal(el, keepScroll || noAnim);
  updateNav();
  refreshPlaying();
}
const rerender = () => S.view && render({ keepScroll: true });

function backBtn() {
  return S.history.length ? `<button class="back-btn" data-act="back">${icon('back')}<span>${T('Back')}</span></button>` : '';
}

function updateNav() {
  const sel = $(`.nav-item[data-view="${S.tab || 'home'}"]`);
  $$('.nav-item').forEach((x) => x.classList.toggle('active', x === sel));
  const ind = $('#nav-ind');
  if (sel) {
    // discreet indicator behind the icon only, centered on it (bug #24)
    const ic = sel.querySelector('.i'), nav = $('#nav');
    const nr = nav.getBoundingClientRect(), r = ic ? ic.getBoundingClientRect() : sel.getBoundingClientRect();
    const cx = r.left - nr.left + r.width / 2, cy = r.top - nr.top + r.height / 2;
    ind.style.transform = `translate(${cx - ind.offsetWidth / 2}px, ${cy - ind.offsetHeight / 2}px)`;
    ind.style.opacity = 1;
  }
}

// ===================== virtual lists and grids (only what is visible is drawn) =====================
const TOUCH = matchMedia('(hover: none)').matches;
function vRowH() { return TOUCH ? 62 : 52; }
function vAttach(host, update) {
  let raf = 0;
  const on = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (host.isConnected) update(); }); };
  const c = content();
  c.addEventListener('scroll', on, { passive: true });
  window.addEventListener('resize', on);
  const ro = new ResizeObserver(on); ro.observe(host);
  const clean = () => { c.removeEventListener('scroll', on); window.removeEventListener('resize', on); ro.disconnect(); cancelAnimationFrame(raf); };
  if (host._vclean) host._vclean();
  host._vclean = clean;
  S.cleanup.push(clean);
  requestAnimationFrame(() => requestAnimationFrame(on));
  return on;
}
function vWindow(host, itemH, n, per = 1) {
  const c = content();
  const top = host.getBoundingClientRect().top - c.getBoundingClientRect().top;
  const r0 = Math.max(0, Math.floor(-top / itemH) - 6);
  const r1 = Math.ceil((-top + c.clientHeight) / itemH) + 6;
  return [Math.min(n, r0 * per), Math.min(n, r1 * per)];
}
// track rows: below the threshold all at once, above it only the visible ones
function fillTracks(tl, list, rowFn, threshold = 50) {
  if (tl._vclean) { tl._vclean(); tl._vclean = null; }
  if (list.length <= threshold) {
    tl.classList.remove('vlist'); tl.style.height = '';
    tl.innerHTML = list.map(rowFn).join('');
    return;
  }
  const ROW = vRowH();
  tl.innerHTML = '';
  tl.classList.add('vlist');
  tl.style.height = list.length * ROW + 'px';
  const rows = new Map();
  let first = true;
  vAttach(tl, () => {
    const [start, end] = vWindow(tl, ROW, list.length);
    for (const [i, r] of rows) if (i < start || i >= end) { r.remove(); rows.delete(i); }
    const p = cur() ? cur().path : null;
    const frag = document.createDocumentFragment();
    let k = 0;
    for (let i = start; i < end; i++) {
      if (rows.has(i)) continue;
      const r = h(`<div class="vrow" style="transform:translateY(${i * ROW}px)">${rowFn(list[i], i)}</div>`);
      if (p && list[i].path === p) r.firstElementChild.classList.add('playing');
      if (first) { r.classList.add('vin'); r.style.setProperty('--rd', Math.min(k++, 14) * 24 + 'ms'); }
      frag.appendChild(r); rows.set(i, r);
    }
    tl.appendChild(frag);
    first = false;
  });
}
// cover grids
function fillGrid(grid, items, cardFn, { artists = false, threshold = 36 } = {}) {
  if (grid._vclean) { grid._vclean(); grid._vclean = null; }
  if (items.length <= threshold) {
    grid.classList.remove('vgrid'); grid.style.height = '';
    grid.innerHTML = items.map(cardFn).join('');
    if (grid.isConnected) reveal(grid);
    return;
  }
  grid.innerHTML = '';
  grid.classList.add('vgrid');
  const cards = new Map();
  let L = null, first = true, extra = artists ? (TOUCH ? 40 : 38) : (TOUCH ? 50 : 52);
  const layout = () => {
    const W = grid.clientWidth;
    let cols, gx, gy;
    if (TOUCH) { cols = W >= 600 ? Math.max(3, Math.floor((W + 14) / 174)) : (artists ? 3 : 2); gx = artists ? 12 : 14; gy = artists ? 18 : 20; }
    else { const min = artists ? 150 : 168; gx = 22; gy = 26; cols = Math.max(1, Math.floor((W + gx) / (min + gx))); }
    const w = (W - gx * (cols - 1)) / cols;
    return { W, cols, gx, gy, w, rowH: w + extra + gy };
  };
  vAttach(grid, () => {
    const nl = layout();
    if (!L || nl.W !== L.W) {
      L = nl;
      cards.forEach((c) => c.remove()); cards.clear();
      grid.style.height = Math.ceil(items.length / L.cols) * L.rowH - L.gy + 'px';
    }
    const [start, end] = vWindow(grid, L.rowH, items.length, L.cols);
    for (const [i, c] of cards) if (i < start || i >= end) { c.remove(); cards.delete(i); }
    const frag = document.createDocumentFragment();
    let k = 0;
    for (let i = start; i < end; i++) {
      if (cards.has(i)) continue;
      const c = h(cardFn(items[i], i));
      const col = i % L.cols, row = Math.floor(i / L.cols);
      c.style.cssText += `;position:absolute;left:0;top:0;width:${L.w}px;transform:translate(${col * (L.w + L.gx)}px,${row * L.rowH}px)`;
      if (first) { c.classList.add('vin'); c.style.setProperty('--rd', Math.min(k++, 14) * 26 + 'ms'); }
      frag.appendChild(c); cards.set(i, c);
    }
    grid.appendChild(frag);
    if (first && cards.size) {
      // measures the real height of a card and fixes the grid if needed
      const real = cards.values().next().value.offsetHeight - L.w;
      if (Math.abs(real - extra) > 2) { extra = real; L = null; first = false; requestAnimationFrame(() => grid.isConnected && grid.dispatchEvent(new Event('vrelayout'))); }
    }
    first = false;
  });
  grid.addEventListener('vrelayout', () => content().dispatchEvent(new Event('scroll')));
}

// ===================== components =====================
function albumCard(a, i = 0) {
  return `<div class="card" data-album="${esc(a.key)}" style="--i:${i}" draggable="true">
    <div class="art-wrap">${artHTML(a.cover, a.key, { ph: 'album', morph: 'album:' + a.key })}
      <div class="card-actions"><button class="card-play" data-act="play-album" title="${T('Play')}">${icon('play')}</button><button class="card-more" data-act="album-menu" title="${T('More')}">${icon('more')}</button></div>
    </div>
    <div class="t1">${esc(a.title)}</div><div class="t2">${esc(a.artist)}${a.year ? ' · ' + a.year : ''}</div></div>`;
}
function artistCard(ar, i = 0) {
  return `<div class="card artist" data-artist="${esc(ar.key)}" style="--i:${i}">
    <div class="art-wrap">${artHTML(ar.cover, ar.key, { cls: 'round', ph: 'person', morph: 'artist:' + ar.key })}</div>
    <div class="t1">${esc(ar.name)}</div></div>`;
}
function plCard(pl, i = 0) {
  const n = pl.paths.filter((p) => S.byPath.has(p)).length;
  return `<div class="card" data-pl="${esc(pl.id)}" style="--i:${i}">
    <div class="art-wrap">${plArtHTML(pl)}
      <div class="card-actions"><button class="card-play" data-act="play-pl" title="${T('Play')}">${icon('play')}</button><button class="card-more" data-act="pl-menu" title="${T('More')}">${icon('more')}</button></div></div>
    <div class="t1">${esc(pl.name)}</div><div class="t2">${T('Playlist · {0}', plural(n, T('track'), T('tracks')))}</div></div>`;
}
const EQ = '<span class="eq"><span></span><span></span><span></span><span></span></span>';
const lyrBadge = (t) => (t.lyrics === 2 ? `<span class="lyr-badge" title="${T('Synced lyrics')}">${icon('lyrics')}</span>` : '');

function trackRow(t, i, { num = null, thumb = false, sub = 'artist', grip = false } = {}) {
  grip = false;
  const n = num != null ? num : i + 1;
  const subTxt = sub === 'artist' ? esc(t.artist) : sub === 'both' ? `${esc(t.artist)} — ${esc(t.album_.title)}` : sub === 'album' ? esc(t.album_.title) : '';
  let cls = thumb ? ' has-thumb' : '';
  let mark = '', taMark = '';
  return `<div class="tr${cls}" data-idx="${i}" data-path="${esc(t.path)}" draggable="true">
    ${grip ? `<span class="grip">${icon('grip')}</span>` : ''}
    ${thumb ? '' : `<div class="n"><span class="num">${n}</span>${EQ}<span class="pbtn">${icon('play')}</span></div>`}
    <div class="ttl">${thumb ? `<div class="thumb-wrap">${artHTML(t.cover, t.albumKey, { cls: 'thumb' })}${EQ}<span class="pbtn">${icon('play')}</span></div>` : ''}<div class="tx"><div class="tt">${esc(t.title)}${lyrBadge(t)}</div>${subTxt ? `<div class="ta">${taMark}${subTxt}</div>` : ''}</div></div>
    <div class="d">${mark}${fmtTime(t.duration)}</div>
    <button class="more" data-act="track-menu" title="${T('More')}">${icon('more')}</button></div>`;
}

function refreshPlaying() {
  const t = cur();
  const p = t ? t.path : null;
  $$('.tr[data-path]').forEach((r) => r.classList.toggle('playing', r.dataset.path === p));
  $$('.q-item[data-qi]').forEach((r) => r.classList.toggle('cur', +r.dataset.qi === S.qi));
}

// track list with delegated events
function bindTracks(container, getList, opts = {}) {
  container.addEventListener('dblclick', (e) => {
    const r = e.target.closest('.tr'); if (!r || e.target.closest('button')) return;
    playList(getList(), +r.dataset.idx, { ctx: opts.ctx && opts.ctx() });
  });
  container.addEventListener('click', (e) => {
    const r = e.target.closest('.tr'); if (!r) return;
    const list = getList();
    const t = list[+r.dataset.idx];
    if (e.target.closest('.pbtn')) { playList(list, +r.dataset.idx, { ctx: opts.ctx && opts.ctx() }); return; }
    if (e.target.closest('[data-act="track-menu"]')) { const b = e.target.closest('button').getBoundingClientRect(); trackMenu(t, b.left, b.bottom + 4, opts.menuExtra && opts.menuExtra(+r.dataset.idx, r)); return; }
    if (e.target.closest('.grip, button')) return;
    playList(list, +r.dataset.idx, { ctx: opts.ctx && opts.ctx() });
  });
  container.addEventListener('contextmenu', (e) => {
    const r = e.target.closest('.tr'); if (!r) return;
    e.preventDefault();
    $$('.tr.sel', container).forEach((x) => x.classList.remove('sel'));
    r.classList.add('sel');
    trackMenu(getList()[+r.dataset.idx], e.clientX, e.clientY, opts.menuExtra && opts.menuExtra(+r.dataset.idx, r));
  });
  container.addEventListener('dragstart', (e) => {
    const r = e.target.closest('.tr'); if (!r) return;
    const t = getList()[+r.dataset.idx];
    e.dataTransfer.setData('application/x-rj-paths', JSON.stringify([t.path]));
    e.dataTransfer.effectAllowed = 'copyMove';
    if (opts.onDragStart) opts.onDragStart(e, r);
  });
}

// card events (delegated on the whole content area)
function bindCards(root) {
  root.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    const card = e.target.closest('.card');
    if (act) {
      const a = act.dataset.act;
      if (a === 'back') return goBack();
      if (!card) return;
      e.stopPropagation();
      if (a === 'play-album') { const al = S.albumMap.get(card.dataset.album); playList(al.tracks, 0, { ctx: { type: 'album', key: al.key } }); return; }
      if (a === 'album-menu') { const b = act.getBoundingClientRect(); albumMenu(S.albumMap.get(card.dataset.album), b.left, b.bottom + 4); return; }
      if (a === 'play-pl') { const pl = S.plMap.get(card.dataset.pl); playList(plTracks(pl), 0, { ctx: { type: 'playlist', id: pl.id } }); return; }
      if (a === 'pl-menu') { const b = act.getBoundingClientRect(); plMenu(S.plMap.get(card.dataset.pl), b.left, b.bottom + 4); return; }
    }
    if (!card) return;
    if (card.dataset.album) go('album', card.dataset.album, { morph: 'album:' + card.dataset.album });
    else if (card.dataset.artist) go('artist', card.dataset.artist, { morph: 'artist:' + card.dataset.artist });
    else if (card.dataset.pl) go('playlist', card.dataset.pl, { morph: 'pl:' + card.dataset.pl });
  });
  root.addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.card'); if (!card) return;
    e.preventDefault();
    if (card.dataset.album) albumMenu(S.albumMap.get(card.dataset.album), e.clientX, e.clientY);
    else if (card.dataset.pl) plMenu(S.plMap.get(card.dataset.pl), e.clientX, e.clientY);
  });
  root.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.card[data-album]'); if (!card) return;
    const al = S.albumMap.get(card.dataset.album);
    e.dataTransfer.setData('application/x-rj-paths', JSON.stringify(al.tracks.map((t) => t.path)));
    e.dataTransfer.effectAllowed = 'copy';
  });
}

function shelf(title, inner, { link = null, cls = '' } = {}) {
  const el = h(`<section class="shelf"><div class="shelf-head"><h2 class="${link ? 'link' : ''}">${esc(title)}${link ? icon('forward') : ''}</h2>
    <div class="shelf-nav"><button data-dir="-1">${icon('back')}</button><button data-dir="1">${icon('forward')}</button></div></div>
    <div class="row ${cls}">${inner}</div></section>`);
  if (link) $('h2', el).addEventListener('click', () => go(link));
  const row = $('.row', el);
  $$('.shelf-nav button', el).forEach((b) => b.addEventListener('click', () => row.scrollBy({ left: +b.dataset.dir * row.clientWidth * 0.8 })));
  return el;
}

// ===================== views =====================
const VIEWS = {};

// the “Good night, <name>!” greeting stays on one line: if it doesn't fit, the text shrinks a little (bug #25)
function fitGreet(h1) {
  if (!h1 || !h1.isConnected) return;
  h1.style.fontSize = '';
  const base = parseFloat(getComputedStyle(h1).fontSize);
  const words = h1.querySelectorAll('.w');
  const oneLine = () => { const f = words[0], l = words[words.length - 1]; return !f || Math.abs(l.offsetTop - f.offsetTop) < 4; };
  let size = base;
  while (!oneLine() && size > 22) { size -= 1; h1.style.fontSize = size + 'px'; }
  if (!oneLine()) h1.style.fontSize = '';
}
// big Home tile: updates itself when the track changes or is paused (bug #51)
function heroEl(rnd = seeded(hashStr(new Date().toDateString()))) {
  const t = cur();
  let heroAlbum, kicker, title, sub, btn;
  if (t) {
    heroAlbum = t.album_; kicker = S.playing ? T('Playing for you') : T('Pick up where you left off');
    title = t.title; sub = `${t.artist} · ${t.album_.title}`; btn = S.playing ? T('Open') : T('Resume');
  } else {
    const pool = S.albums.filter((a) => a.cover);
    heroAlbum = (pool.length ? pool : S.albums)[Math.floor(rnd() * (pool.length || S.albums.length))];
    kicker = T('Album of the day'); title = heroAlbum.title; sub = `${heroAlbum.artist}${heroAlbum.year ? ' · ' + heroAlbum.year : ''}`; btn = T('Play');
  }
  const hero = h(`<div class="hero">
    <div class="hero-bg" style="${heroAlbum.cover ? `background-image:${cssUrl(heroAlbum.cover.s)}` : phStyle(heroAlbum.key)}"></div>
    ${artHTML(heroAlbum.cover, heroAlbum.key, { size: 'l', ph: 'album', morph: 'album:' + heroAlbum.key })}
    <div><div class="hero-kicker">${esc(kicker)}</div><div class="hero-title">${esc(title)}</div><div class="hero-sub">${esc(sub)}</div>
    <button class="btn">${icon(t && S.playing ? 'enlarge' : 'play')}${esc(btn)}</button></div></div>`);
  hero.addEventListener('click', (e) => {
    if (t) { if (!S.playing) togglePlay(); else openNP(); return; }
    if (e.target.closest('.btn')) playList(heroAlbum.tracks, 0, { ctx: { type: 'album', key: heroAlbum.key } });
    else go('album', heroAlbum.key, { morph: 'album:' + heroAlbum.key });
  });
  hero.dataset.k = t ? t.path + '|' + (S.playing ? 1 : 0) : '';
  return hero;
}
function refreshHero() {
  if (!S.view || S.view.name !== 'home') return;
  const old = document.querySelector('.view .hero');
  if (!old) return;
  const t = cur();
  const k = t ? t.path + '|' + (S.playing ? 1 : 0) : '';
  if (old.dataset.k === k) return;
  const nu = heroEl();
  nu.classList.add('swap');
  old.replaceWith(nu);
}

VIEWS.home = () => {
  const name = (S.settings && S.settings.name) || '';
  const g = greeting();
  if (g.bday && !S.confettiDone) { S.confettiDone = true; setTimeout(confetti, 700); }
  const words = `${g.hi},`.split(' ');
  const wordsHTML = words.map((w, i) => `<span class="w" style="--i:${i}">${esc(w)} </span>`).join('') +
    `<span class="nw"><span class="w name" style="--i:${words.length}">${esc(name)}</span><span class="w" style="--i:${words.length + 1}">!</span></span>`;
  const el = h(`<div class="home">
    <header class="greet">
      <button class="avatar" data-settings title="${T('Settings')}">${esc((name || '♪').charAt(0).toUpperCase())}</button>
      <div class="greet-date">${esc(todayLabel())}</div>
      <h1>${wordsHTML}</h1>
      <p class="sub">${esc(g.sub)}</p>
    </header></div>`);
  bindCards(el);
  requestAnimationFrame(() => fitGreet($('.greet h1', el)));
  $('[data-settings]', el).addEventListener('click', () => { rj.haptic('tick'); go('settings'); });

  if (!S.tracks.length) {
    el.appendChild(h(`<div class="empty-state">${icon('note')}<h3>${T('No tracks found')}</h3>
      <p>${T('I couldn\'t find any audio files in <b>{0}</b>. Check the folder in Settings.', esc(S.settings.musicDir))}</p>
      <button class="btn primary" data-go="settings">${T('Open Settings')}</button></div>`));
    $('[data-go]', el).addEventListener('click', () => go('settings'));
    return el;
  }

  const day = new Date().toDateString();
  const rnd = seeded(hashStr(day));
  // hero
  el.appendChild(heroEl(rnd));

  // recently played
  const rec = S.recent.map((c) => {
    if (c.type === 'album' && S.albumMap.has(c.key)) return albumCard(S.albumMap.get(c.key));
    if (c.type === 'playlist' && S.plMap.has(c.id)) return plCard(S.plMap.get(c.id));
    return null;
  }).filter(Boolean).slice(0, 14);
  if (rec.length) el.appendChild(shelf(T('Recently played'), rec.join('')));

  const recentAdded = S.albums.slice().sort((a, b) => b.added - a.added).slice(0, 14);
  el.appendChild(shelf(T('Recently added'), recentAdded.map((a) => albumCard(a)).join(''), { link: 'recent' }));

  const picks = shuffled(S.albums, rnd).slice(0, 14);
  el.appendChild(shelf(name ? `${T('Picked for you, {0}', name)}` : T('Picked for you'), picks.map((a) => albumCard(a)).join('')));

  if (S.playlists.length) el.appendChild(shelf(T('Your playlists'), S.playlists.map((p) => plCard(p)).join('')));

  const arts = shuffled(S.artists.filter((a) => a.cover), rnd).slice(0, 14);
  if (arts.length > 2) el.appendChild(shelf(T('Artists to rediscover'), arts.map((a) => artistCard(a)).join(''), { link: 'artists', cls: 'artists' }));

  const totalSec = S.tracks.reduce((s, x) => s + (x.duration || 0), 0);
  const days = totalSec / 86400;
  el.appendChild(h(`<section class="shelf"><div class="shelf-head"><h2>${name ? `${T('The music of {0}', esc(name))}` : T('Your library')}</h2></div><div class="stats" style="margin-top:0">
    <div class="stat"><b>${nf.format(S.tracks.length)}</b><span>${T('tracks')}</span></div>
    <div class="stat"><b>${nf.format(S.albums.length)}</b><span>${T('albums')}</span></div>
    <div class="stat"><b>${nf.format(S.artists.length)}</b><span>${T('artists')}</span></div>
    <div class="stat"><b>${days >= 1 ? days.toLocaleString(loc(), { maximumFractionDigits: 1 }) : Math.round(totalSec / 3600)}</b><span>${days >= 1 ? T('days of music') : T('hours of music')}</span></div>
  </div></section>`));
  return el;
};

function albumGridView(title, sub, albums, sortable) {
  const el = h(`<div>${backBtn()}<div class="page-head"><div><h1 class="page-title">${esc(title)}</h1><p class="page-sub">${esc(sub)}</p></div><div class="head-tools"></div></div><div class="grid stagger"></div></div>`);
  const grid = $('.grid', el);
  const draw = (list) => fillGrid(grid, list, albumCard);
  if (sortable) {
    const opts = [['title', T('Title')], ['artist', T('Artist')], ['year', T('Year')], ['added', T('Added')]];
    const sort = store.get('albumSort', 'title');
    const seg = segmented(opts, sort, (k) => { store.set('albumSort', k); draw(sortAlbums(albums, k)); });
    $('.head-tools', el).appendChild(seg);
    draw(sortAlbums(albums, sort));
  } else draw(albums);
  bindCards(el);
  return el;
}
function sortAlbums(list, k) {
  const a = list.slice();
  if (k === 'artist') a.sort((x, y) => coll.compare(sortName(x.artist), sortName(y.artist)) || (x.year || 0) - (y.year || 0));
  else if (k === 'year') a.sort((x, y) => (y.year || 0) - (x.year || 0) || coll.compare(x.title, y.title));
  else if (k === 'added') a.sort((x, y) => y.added - x.added);
  else a.sort(byName((x) => x.title));
  return a;
}
function segmented(opts, value, onChange) {
  const el = h(`<div class="seg">${opts.map(([k, l]) => `<button data-k="${k}" class="${k === value ? 'on' : ''}">${esc(l)}</button>`).join('')}<span class="seg-ind"></span></div>`);
  const place = () => { const b = $('button.on', el); if (b) { $('.seg-ind', el).style.left = b.offsetLeft + 'px'; $('.seg-ind', el).style.width = b.offsetWidth + 'px'; } };
  requestAnimationFrame(place);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.classList.contains('on')) return;
    $$('button', el).forEach((x) => x.classList.toggle('on', x === b)); place(); onChange(b.dataset.k);
  });
  return el;
}

// Search page without text: no genres, but random suggestions that change every time the app opens
const OPEN_SEED = (Math.random() * 2 ** 31) >>> 0;
function searchHome() {
  const n = nm();
  const rnd = seeded(OPEN_SEED);
  const albums = shuffled(S.albums, rnd);
  const pls = shuffled(S.playlists.filter((p) => p.paths.some((x) => S.byPath.has(x))), rnd);
  const arts = shuffled(S.artists.filter((a) => a.tracks.length >= 3), rnd);
  // a bit of everything: albums, a playlist, an artist, mixed
  const mix = [
    ...albums.slice(0, 4).map((a) => ({ k: 'a', v: a })),
    ...pls.slice(0, 1).map((p) => ({ k: 'p', v: p })),
    ...arts.slice(0, 1).map((a) => ({ k: 'r', v: a })),
  ];
  const picks = shuffled(mix, rnd).slice(0, 6);
  const used = new Set(picks.filter((x) => x.k === 'a').map((x) => x.v.key));
  const songs = shuffled(S.tracks.filter((t) => !used.has(t.albumKey)), rnd).slice(0, 6);
  const el = h(`<div><h1 class="page-title">${T('Search')}</h1><p class="page-sub">${n ? `${T('What do you want to listen to, {0}?', esc(n))}` : T('What do you want to listen to?')}</p>
    ${picks.length ? `<h2 class="section-h">${T('You might be in the mood for…')}</h2>
    <div class="grid">${picks.map((x, i) => (x.k === 'a' ? albumCard(x.v, i) : x.k === 'p' ? plCard(x.v, i) : artistCard(x.v, i))).join('')}</div>` : ''}
    ${songs.length ? `<h2 class="section-h">${T('…or maybe one of these')}</h2><div class="tracks mood-tracks">${songs.map((t, i) => trackRow(t, i, { thumb: true, sub: 'both' })).join('')}</div>` : ''}
    ${arts.length > 1 ? `<h2 class="section-h">${T('Artists to rediscover')}</h2>
    <div class="grid artists-grid">${arts.slice(1, 7).map((a, i) => artistCard(a, i)).join('')}</div>` : ''}</div>`);
  const tl = $('.mood-tracks', el);
  if (tl) bindTracks(tl, () => songs, { ctx: () => null });
  bindCards(el);
  return el;
}

VIEWS.library = () => {
  const n = nm();
  const links = [
    ['playlists', 'playlist', T('Playlists'), S.playlists.length],
    ['artists', 'mic', T('Artists'), S.artists.length],
    ['albums', 'album', T('Albums'), S.albums.length],
    ['songs', 'note', T('Tracks'), S.tracks.length],
    ['recent', 'clock', T('Recently added'), null],
  ];
  const el = h(`<div><h1 class="page-title">${T('Library')}</h1><p class="page-sub">${n ? `${T('The music of {0}', esc(n))}` : T('Your music')}</p>
    <div class="lib-links">${links.map(([v, ic, l, c]) => `<a class="lib-link" data-v="${v}">${icon(ic)}<span>${l}</span>${c != null ? `<em>${nf.format(c)}</em>` : ''}${icon('forward', 'chev')}</a>`).join('')}</div>
    <h2 class="section-h">${T('Recently added')}</h2>
    <div class="grid">${S.albums.slice().sort((a, b) => b.added - a.added).slice(0, 12).map((a, i) => albumCard(a, i)).join('')}</div></div>`);
  el.addEventListener('click', (e) => { const l = e.target.closest('[data-v]'); if (l) { rj.haptic('tick'); go(l.dataset.v); } });
  bindCards(el);
  return el;
};

VIEWS.playlists = () => {
  const el = h(`<div>${backBtn()}<div class="page-head"><div><h1 class="page-title">${T('Playlists')}</h1><p class="page-sub">${plural(S.playlists.length, T('playlist'), T('playlists'))}</p></div></div>
    <div class="detail-actions" style="margin:0 0 22px"><button class="btn primary" data-a="new">${T('{0}New', icon('plus'))}</button><button class="btn soft" data-a="import">${T('{0}Import .m3u8', icon('import'))}</button></div>
    ${S.playlists.length ? `<div class="grid">${S.playlists.map((p, i) => plCard(p, i)).join('')}</div>`
      : `<div class="empty-state">${icon('playlist')}<h3>${nm() ? `${T('No playlists yet, {0}', esc(nm()))}` : T('No playlists yet')}</h3><p>${T('Create a new one or import your .m3u8 files from the phone.')}</p></div>`}</div>`);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'new') createPlaylist();
    if (b.dataset.a === 'import') importPlaylists();
  });
  bindCards(el);
  return el;
};

VIEWS.albums = () => albumGridView(T('Albums'), (nm() ? `${T('{0}\'s collection ·', nm())} ` : '') + plural(S.albums.length, T('album'), T('albums')), S.albums, true);
VIEWS.recent = () => albumGridView(T('Recently added'), T('The latest albums to land in your folder'), S.albums.slice().sort((a, b) => b.added - a.added).slice(0, 120), false);

VIEWS.artists = () => {
  const el = h(`<div>${backBtn()}<h1 class="page-title">${T('Artists')}</h1><p class="page-sub">${nm() ? `${T('{0}\'s artists ·', esc(nm()))} ` : ''}${plural(S.artists.length, T('artist'), T('artists'))}</p>
    <div class="grid artists-grid"></div></div>`);
  fillGrid($('.grid', el), S.artists, artistCard, { artists: true });
  bindCards(el);
  return el;
};

VIEWS.artist = (key) => {
  const ar = S.artistMap.get(key);
  if (!ar) return h(T('<div class="empty-state"><h3>Artist not found</h3></div>'));
  const tracks = ar.tracks.slice().sort((a, b) => (b.album_.year || 0) - (a.album_.year || 0) || coll.compare(a.album_.title, b.album_.title) || (a.disc || 1) - (b.disc || 1) || (a.track || 0) - (b.track || 0));
  const el = h(`<div>
    <div class="artist-hero">
      <div class="ah-bg" style="${ar.cover ? `background-image:${cssUrl(ar.cover.s)}` : phStyle(ar.key)}"></div>
      ${backBtn()}
      ${artHTML(ar.cover, ar.key, { cls: 'round', size: 'l', ph: 'person', morph: 'artist:' + ar.key })}
      <div><div class="detail-kind" style="color:rgba(255,255,255,.75)">${T('Artist')}</div><h1>${esc(ar.name)}</h1>
        <div class="detail-actions"><button class="btn primary" data-a="play">${T('{0}Play', icon('play'))}</button><button class="btn ghost" data-a="shuffle">${T('{0}Shuffle', icon('shuffle'))}</button></div></div>
    </div>
    <h2 class="section-h" style="margin-top:0">${T('Tracks')}</h2>
    <div class="tracks t-top"></div>
    ${tracks.length > 8 ? T('<button class="btn soft" data-a="all" style="margin-top:10px">Show all tracks</button>') : ''}
    ${ar.albums.length ? `<h2 class="section-h">${T('Albums')}</h2><div class="grid stagger">${ar.albums.map((a, i) => albumCard(a, i)).join('')}</div>` : ''}
    ${ar.appears.length ? `<h2 class="section-h">${T('Appears on')}</h2><div class="grid">${ar.appears.map((a, i) => albumCard(a, i)).join('')}</div>` : ''}
  </div>`);
  const tl = $('.t-top', el);
  let shown = tracks.slice(0, 8);
  const draw = () => { fillTracks(tl, shown, (t, i) => trackRow(t, i, { thumb: true, sub: 'album' })); refreshPlaying(); if (tl.isConnected && !tl.classList.contains('vlist')) reveal(tl); };
  draw();
  bindTracks(tl, () => shown, { ctx: () => null });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'play') playList(tracks, 0, { shuffle: false });
    if (b.dataset.a === 'shuffle') playList(tracks, 0, { shuffle: true });
    if (b.dataset.a === 'all') { shown = tracks; draw(); b.remove(); }
  });
  bindCards(el);
  return el;
};

VIEWS.album = (key) => {
  const a = S.albumMap.get(key);
  if (!a) return h(T('<div class="empty-state"><h3>Album not found</h3></div>'));
  const glow = a.cover && a.cover.colors ? `background:radial-gradient(60% 70% at 20% 30%, ${a.cover.colors[0]}, transparent 70%), radial-gradient(50% 60% at 70% 20%, ${a.cover.colors[1]}, transparent 70%)` : phStyle(a.key);
  const showArtist = a.artist === T('Various artists') || a.tracks.some((t) => norm(t.artist) !== norm(a.artist));
  const el = h(`<div class="has-glow">
    <div class="detail-glow" style="${glow}"></div>
    ${backBtn()}
    <div class="detail-head">
      ${artHTML(a.cover, a.key, { size: 'l', ph: 'album', morph: 'album:' + a.key })}
      <div class="detail-info">
        <div class="detail-kind">${T('Album')}</div>
        <h1 class="detail-title">${esc(a.title)}</h1>
        <div class="detail-artist">${a.artists.length ? artistLinks(a.artist, 'al') : esc(a.artist)}</div>
        <div class="detail-meta">${[a.genre, a.year].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="detail-actions">
          <button class="btn primary" data-a="play">${T('{0}Play', icon('play'))}</button>
          <button class="btn soft" data-a="shuffle">${T('{0}Shuffle', icon('shuffle'))}</button>
          ${dlBtnHTML(a.tracks)}<button class="ibtn" data-a="more" title="${T('More')}">${icon('more')}</button>
        </div>
      </div>
    </div>
    <div class="tracks"></div>
    <div class="foot-note">${plural(a.tracks.length, T('track'), T('tracks'))}, ${fmtLong(a.duration)}</div>
  </div>`);
  const tl = $('.tracks', el);
  let html = '';
  let disc = null;
  // track numbers: if missing or repeated in the tags, the position in the album is used
  const nums = a.tracks.map((t) => (t.disc || 1) * 1000 + (t.track || 0));
  const goodNums = a.tracks.every((t) => t.track) && new Set(nums).size === nums.length;
  a.tracks.forEach((t, i) => {
    if (a.discs > 1 && (t.disc || 1) !== disc) { disc = t.disc || 1; html += `<div class="disc-h">${T('Disc {0}', disc)}</div>`; }
    html += trackRow(t, i, { num: goodNums ? t.track : i + 1, sub: showArtist ? 'artist' : 'none' });
  });
  tl.innerHTML = html;
  bindTracks(tl, () => a.tracks, { ctx: () => ({ type: 'album', key: a.key }) });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (e.target.closest('[data-artist-link]')) { const k = e.target.closest('[data-artist-link]').dataset.artistLink; if (S.artistMap.has(k)) go('artist', k); return; }
    if (e.target.closest('[data-act="back"]')) return goBack();
    if (!b) return;
    if (b.dataset.a === 'play') playList(a.tracks, 0, { shuffle: false, ctx: { type: 'album', key: a.key } });
    if (b.dataset.a === 'shuffle') playList(a.tracks, 0, { shuffle: true, ctx: { type: 'album', key: a.key } });
    if (b.dataset.a === 'more') { const r = b.getBoundingClientRect(); albumMenu(a, r.left, r.bottom + 4); }
  });
  return el;
};

VIEWS.songs = () => {
  const el = h(`<div>${backBtn()}<div class="page-head"><div><h1 class="page-title">${T('Tracks')}</h1><p class="page-sub">${plural(S.tracks.length, T('track'), T('tracks'))} · ${fmtLong(S.tracks.reduce((s, t) => s + (t.duration || 0), 0))}</p></div>
    <div class="head-tools"><button class="btn primary" data-a="shuffle">${T('{0}Shuffle', icon('shuffle'))}</button></div></div>
    <div class="songs-table"><div class="songs-head">
      <button data-k="title">${T('Title {0}', icon('down'))}</button><button data-k="artist">${T('Artist {0}', icon('down'))}</button><button data-k="album">${T('Album {0}', icon('down'))}</button><button data-k="duration" class="r">${icon('clock')}${icon('down')}</button><span></span>
    </div><div class="vlist"></div></div></div>`);
  const sortFns = {
    title: (a, b) => coll.compare(a.title, b.title),
    artist: (a, b) => coll.compare(sortName(a.artist), sortName(b.artist)) || coll.compare(a.album_.title, b.album_.title) || (a.track || 0) - (b.track || 0),
    album: (a, b) => coll.compare(a.album_.title, b.album_.title) || (a.disc || 0) - (b.disc || 0) || (a.track || 0) - (b.track || 0),
    duration: (a, b) => (a.duration || 0) - (b.duration || 0),
  };
  let list = [];
  const vl = $('.vlist', el);
  const ROW = 62;
  const rowHTML = (t, i) => `<div class="tr" data-idx="${i}" data-path="${esc(t.path)}" draggable="true">
      <div class="ttl">${artHTML(t.cover, t.albumKey, { cls: 'thumb' })}<div class="tx"><div class="tt">${esc(t.title)}${lyrBadge(t)}</div><div class="ta">${esc(t.artist)} — ${esc(t.album_.title)}</div></div></div>
      <div class="c">${artistLinks(t.artist)}</div>
      <div class="c link" data-album-link="${esc(t.albumKey)}">${esc(t.album_.title)}</div>
      <div class="d">${fmtTime(t.duration)}</div>
      <button class="more" data-act="track-menu">${icon('more')}</button></div>`;
  const rows = new Map();
  const update = () => {
    const c = content();
    const top = vl.getBoundingClientRect().top - c.getBoundingClientRect().top;
    const start = Math.max(0, Math.floor(-top / ROW) - 10);
    const end = Math.min(list.length, Math.ceil((-top + c.clientHeight) / ROW) + 10);
    for (const [i, r] of rows) if (i < start || i >= end) { r.remove(); rows.delete(i); }
    const t = cur();
    for (let i = start; i < end; i++) {
      if (rows.has(i)) continue;
      const r = h(`<div class="vrow" style="top:${i * ROW}px">${rowHTML(list[i], i)}</div>`);
      if (t && list[i].path === t.path) r.firstElementChild.classList.add('playing');
      vl.appendChild(r); rows.set(i, r);
    }
  };
  const apply = () => {
    const { key, dir } = S.songSort;
    list = S.tracks.slice().sort(sortFns[key]);
    if (dir < 0) list.reverse();
    $$('.songs-head button', el).forEach((b) => { b.classList.toggle('on', b.dataset.k === key); b.classList.toggle('desc', b.dataset.k === key && dir < 0); });
    vl.style.height = list.length * ROW + 'px';
    rows.forEach((r) => r.remove()); rows.clear();
    update();
  };
  $('.songs-head', el).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.songSort = S.songSort.key === b.dataset.k ? { key: b.dataset.k, dir: -S.songSort.dir } : { key: b.dataset.k, dir: 1 };
    apply();
  });
  vl.addEventListener('click', (e) => {
    const ar = e.target.closest('[data-artist-link]'); if (ar && S.artistMap.has(ar.dataset.artistLink)) { e.stopPropagation(); go('artist', ar.dataset.artistLink); }
    const al = e.target.closest('[data-album-link]'); if (al) { e.stopPropagation(); go('album', al.dataset.albumLink); }
  }, true);
  bindTracks(vl, () => list, { ctx: () => null });
  $('[data-a="shuffle"]', el).addEventListener('click', () => playList(S.tracks, 0, { shuffle: true }));
  const c = content();
  c.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  S.cleanup.push(() => { c.removeEventListener('scroll', update); window.removeEventListener('resize', update); });
  requestAnimationFrame(apply);
  return el;
};

const PLQ = { id: null, q: '' };
VIEWS.playlist = (id) => {
  const pl = S.plMap.get(id);
  if (!pl) return h(T('<div class="empty-state"><h3>Playlist not found</h3></div>'));
  const allItems = pl.paths.map((p, i) => ({ t: S.byPath.get(p), i })).filter((x) => x.t);
  let items = allItems;
  let list = items.map((x) => x.t);
  const missing = pl.paths.length - items.length;
  const dur = list.reduce((s, t) => s + (t.duration || 0), 0);
  const covers = plCovers(pl);
  const glow = covers[0] && covers[0].colors ? `background:radial-gradient(60% 70% at 20% 30%, ${covers[0].colors[0]}, transparent 70%), radial-gradient(50% 60% at 70% 20%, ${covers[0].colors[1]}, transparent 70%)` : phStyle(pl.id);
  const el = h(`<div class="has-glow">
    <div class="detail-glow" style="${glow}"></div>
    ${backBtn()}
    <div class="detail-head">
      ${plArtHTML(pl)}
      <div class="detail-info">
        <div class="detail-kind">${T('Playlist')}</div>
        <h1 class="detail-title editable" contenteditable="plaintext-only" spellcheck="false" title="${T('Click to rename')}">${esc(pl.name)}</h1>
        <div class="detail-meta">${plural(list.length, T('track'), T('tracks'))}${list.length ? ' · ' + fmtLong(dur) : ''}</div>
        <div class="detail-actions">
          ${T('<button class="btn primary" data-a="play" {0}>{1}Play', list.length ? '' : 'disabled', icon('play'))}</button>
          ${T('<button class="btn soft" data-a="shuffle" {0}>{1}Shuffle', list.length ? '' : 'disabled', icon('shuffle'))}</button>
          ${dlBtnHTML(list)}<button class="ibtn" data-a="more" title="${T('More')}">${icon('more')}</button>
        </div>
      </div>
    </div>
    ${pl.miss && pl.miss.length ? `<div class="miss-banner"><span class="warn">${icon('warn')}</span><span class="mb-tx">${pl.miss.length === 1 ? T('One track not found in the library') : `${T('{0} tracks not found in the library', pl.miss.length)}`}</span><button class="btn soft" data-a="miss">${T('Review')}</button></div>` : ''}
    ${list.length > 1 ? `<label class="pl-search">${icon('search')}<input type="search" spellcheck="false" autocomplete="off" placeholder="${T('Search this playlist')}"></label>` : ''}
    <div class="tracks pl-tracks"></div>
    ${missing ? `<div class="foot-note">${T('{0} in the library (files moved or removed).', plural(missing, T('track not found'), T('tracks not found')))}</div>` : ''}
  </div>`);
  const tl = $('.tracks', el);
  if (!list.length) {
    tl.innerHTML = `<div class="empty-state">${icon('playlist')}<h3>${T('This playlist is empty')}</h3><p>${T('Add tracks from the {0} menu of any track or album, or drag them here or onto the playlist name in the sidebar.', '⋯')}</p></div>`;
  } else {
    fillTracks(tl, list, (t, i) => trackRow(t, i, { thumb: true, sub: 'both', grip: true }));
  }
  // search within the playlist (it stays even after the playlist is edited)
  let plq = PLQ.id === pl.id ? PLQ.q : '';
  const sInp = $('.pl-search input', el);
  const applyQ = () => {
    PLQ.id = pl.id; PLQ.q = plq;
    const words = norm(plq).split(/\s+/).filter(Boolean);
    items = words.length ? allItems.filter((x) => { const hay = norm(`${x.t.title} ${x.t.artist} ${x.t.album}`); return words.every((w) => hay.includes(w)); }) : allItems;
    list = items.map((x) => x.t);
    tl.classList.toggle('filtered', !!words.length);
    if (!list.length) { if (tl._vclean) { tl._vclean(); tl._vclean = null; } tl.classList.remove('vlist'); tl.style.height = ''; tl.innerHTML = `<div class="empty-state pl-noresult">${icon('search')}<h3>${T('No tracks found')}</h3><p>${T('Nothing in this playlist matches “{0}”.', esc(plq.trim()))}</p></div>`; }
    else fillTracks(tl, list, (t, i) => trackRow(t, i, { thumb: true, sub: 'both', grip: !words.length }));
  };
  if (sInp) {
    sInp.value = plq;
    if (plq) applyQ();
    let tmq = 0;
    sInp.addEventListener('input', () => { clearTimeout(tmq); tmq = setTimeout(() => { plq = sInp.value; applyQ(); }, 120); });
    sInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') sInp.blur(); });
  }
  let dragFrom = null;
  bindTracks(tl, () => list, {
    ctx: () => ({ type: 'playlist', id: pl.id }),
    menuExtra: (idx, row) => [{ sep: true },
      ...(idx > 0 && !plq.trim() ? [{ label: T('Move up'), icon: 'back', action: () => movePlItem(pl, items[idx].i, items[idx - 1].i) }] : []),
      ...(idx < items.length - 1 && !plq.trim() ? [{ label: T('Move down'), icon: 'forward', action: () => movePlItem(pl, items[idx].i, items[idx + 1].i) }] : []),
      { label: T('Remove from playlist'), icon: 'minus', danger: true, action: () => removeFromPlaylist(pl, items[idx].i, row) }],
    onDragStart: (e, r) => { dragFrom = +r.dataset.idx; r.classList.add('dragging'); e.dataTransfer.setData('application/x-rj-plidx', String(dragFrom)); },
  });
  const clearDrop = () => $$('.drop-before,.drop-after,.dragging', tl).forEach((r) => r.classList.remove('drop-before', 'drop-after', 'dragging'));
  tl.addEventListener('dragover', (e) => {
    const types = e.dataTransfer.types;
    if (!types.includes('application/x-rj-paths')) return;
    e.preventDefault();
    const r = e.target.closest('.tr');
    $$('.drop-before,.drop-after', tl).forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    if (r) { const b = r.getBoundingClientRect(); r.classList.add(e.clientY < b.top + b.height / 2 ? 'drop-before' : 'drop-after'); }
    e.dataTransfer.dropEffect = types.includes('application/x-rj-plidx') ? 'move' : 'copy';
  });
  tl.addEventListener('dragleave', (e) => { if (!tl.contains(e.relatedTarget)) $$('.drop-before,.drop-after', tl).forEach((x) => x.classList.remove('drop-before', 'drop-after')); });
  tl.addEventListener('dragend', () => { clearDrop(); dragFrom = null; });
  tl.addEventListener('drop', (e) => {
    e.preventDefault();
    const r = e.target.closest('.tr');
    let to = list.length;
    if (r) { const b = r.getBoundingClientRect(); to = +r.dataset.idx + (e.clientY < b.top + b.height / 2 ? 0 : 1); }
    const toOrig = to < items.length ? items[to].i : pl.paths.length;
    const fromIdx = e.dataTransfer.getData('application/x-rj-plidx');
    clearDrop();
    if (fromIdx !== '' && plq.trim()) return;   // the order can't be changed while searching
    if (fromIdx !== '') {
      const fromOrig = items[+fromIdx].i;
      const [p] = pl.paths.splice(fromOrig, 1);
      pl.paths.splice(toOrig > fromOrig ? toOrig - 1 : toOrig, 0, p);
      savePlaylists(); rerender();
    } else {
      let paths = [];
      try { paths = JSON.parse(e.dataTransfer.getData('application/x-rj-paths')); } catch { /* */ }
      addToPlaylist(pl, paths.map((p) => S.byPath.get(p)).filter(Boolean), toOrig);
    }
  });
  const title = $('.detail-title', el);
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } if (e.key === 'Escape') { title.textContent = pl.name; title.blur(); } });
  title.addEventListener('blur', () => {
    const v = title.textContent.trim();
    if (v && v !== pl.name) { pl.name = v; pl.renamed = true; savePlaylists(); toast(`${T('Playlist renamed to “{0}”', v)}`); } else title.textContent = pl.name;
  });
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="back"]')) return goBack();
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'play') playList(list, 0, { shuffle: false, ctx: { type: 'playlist', id: pl.id } });
    if (b.dataset.a === 'shuffle') playList(list, 0, { shuffle: true, ctx: { type: 'playlist', id: pl.id } });
    if (b.dataset.a === 'miss') reviewMissing([pl]);
    if (b.dataset.a === 'more') { const r = b.getBoundingClientRect(); plMenu(pl, r.left, r.bottom + 4); }
  });
  return el;
};

VIEWS.search = (q) => {
  if (!q || !q.trim()) return searchHome();
  const nq = norm(q).trim();
  const terms = nq.split(/\s+/).filter(Boolean);
  const match = (s) => terms.every((w) => s.includes(w));
  const score = (title) => { const n = norm(title); return n === nq ? 0 : n.startsWith(nq) ? 1 : (' ' + n).includes(' ' + nq) ? 1.5 : n.includes(nq) ? 2 : 3; };
  const tracks = S.tracks.filter((t) => match(t.s)).sort((a, b) => score(a.title) - score(b.title) || coll.compare(a.title, b.title)).slice(0, 60);
  const albums = S.albums.filter((a) => match(a.s)).sort((a, b) => score(a.title) - score(b.title)).slice(0, 24);
  const artists = S.artists.filter((a) => match(a.s)).sort((a, b) => score(a.name) - score(b.name)).slice(0, 18);
  const pls = S.playlists.filter((p) => match(norm(p.name)));
  const el = h(`<div><h1 class="page-title">${T('Results for “{0}”', esc(q))}</h1><p class="page-sub">${tracks.length || albums.length || artists.length ? '' : T('No results. Try another title, artist or album.')}</p></div>`);
  if (!tracks.length && !albums.length && !artists.length && !pls.length) {
    el.appendChild(h(`<div class="empty-state">${icon('search')}<h3>${nm() ? `${T('Nothing here, {0}', esc(nm()))}` : T('No results')}</h3><p>${T('I searched {0} in your library.', plural(S.tracks.length, T('track'), T('tracks')))}</p></div>`));
    return el;
  }
  // top result
  let top = null;
  const best = [
    artists[0] && { kind: T('Artist'), s: score(artists[0].name), html: `${artHTML(artists[0].cover, artists[0].key, { cls: 'round', ph: 'person' })}<div class="t1">${esc(artists[0].name)}</div><div class="t2">${T('Artist')}</div>`, go: () => go('artist', artists[0].key) },
    albums[0] && { kind: T('Album'), s: score(albums[0].title), html: `${artHTML(albums[0].cover, albums[0].key, { ph: 'album' })}<div class="t1">${esc(albums[0].title)}</div><div class="t2">${T('Album · {0}', esc(albums[0].artist))}</div>`, go: () => go('album', albums[0].key) },
    tracks[0] && { kind: T('Track'), s: score(tracks[0].title), html: `${artHTML(tracks[0].cover, tracks[0].albumKey)}<div class="t1">${esc(tracks[0].title)}</div><div class="t2">${T('Track · {0}', esc(tracks[0].artist))}</div>`, go: () => playTrackNow(tracks[0]) },
  ].filter(Boolean).sort((a, b) => a.s - b.s);
  top = best[0];
  const topWrap = h(`<div class="search-top"><div><h2 class="section-h">${T('Top result')}</h2><div class="top-result">${top.html}</div></div>
    <div>${tracks.length ? T('<h2 class="section-h">Tracks</h2><div class="tracks s-tracks"></div>') : ''}</div></div>`);
  $('.top-result', topWrap).addEventListener('click', top.go);
  el.appendChild(topWrap);
  if (tracks.length) {
    const tl = $('.s-tracks', topWrap);
    let shown = tracks.slice(0, 6);
    tl.innerHTML = shown.map((t, i) => trackRow(t, i, { thumb: true, sub: 'both' })).join('');
    bindTracks(tl, () => shown);
    if (tracks.length > 6) {
      const more = h(`<button class="btn soft" style="margin-top:8px">${T('Show all ({0})', tracks.length)}</button>`);
      more.addEventListener('click', () => { shown = tracks; fillTracks(tl, shown, (t, i) => trackRow(t, i, { thumb: true, sub: 'both' })); refreshPlaying(); more.remove(); });
      tl.after(more);
    }
  }
  if (albums.length) el.appendChild(h(`<div><h2 class="section-h">${T('Albums')}</h2><div class="grid stagger">${albums.map((a, i) => albumCard(a, i)).join('')}</div></div>`));
  if (artists.length) el.appendChild(h(`<div><h2 class="section-h">${T('Artists')}</h2><div class="grid stagger" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">${artists.map((a, i) => artistCard(a, i)).join('')}</div></div>`));
  if (pls.length) el.appendChild(h(`<div><h2 class="section-h">${T('Playlists')}</h2><div class="grid">${pls.map((p, i) => plCard(p, i)).join('')}</div></div>`));
  bindCards(el);
  return el;
};

VIEWS.settings = () => {
  const s = S.settings;
  let plusSettings = '';
  const el = h(`<div class="settings">${backBtn()}
    <h1 class="page-title">${T('Settings')}</h1><p class="page-sub">${nm() ? `${T('Made for you, {0}', esc(nm()))}` : T('Customize rJuke')}</p>
    <div class="set-group"><h3>${T('Profile')}</h3><div class="set-card">
      <div class="set-row"><div class="lbl"><b>${T('Your name')}</b><span>${T('I use it to greet you on the Home screen')}</span></div>
        <input class="field" id="set-name" value="${esc(s.name || '')}" maxlength="40" spellcheck="false"></div>
      <div class="set-row"><div class="lbl"><b>${T('Your birthday')}</b><span>${T('Optional: on that day rJuke will wish you a happy birthday 🎂')}</span></div>
        <input class="field" id="set-bday" type="date" value="${s.birthday ? '2000-' + s.birthday : ''}"></div>
    </div></div>
    <div class="set-group"><h3>${T('Library')}</h3><div class="set-card">
      <div class="set-row"><div class="lbl"><b>${T('Music folder')}</b><span id="set-dir">${esc(dirLabel(s.musicDir))}</span></div>
        <button class="btn ghost" data-a="dir">${T('{0}Change…', icon('folder'))}</button></div>
      <div class="set-row"><div class="lbl"><b>${T('Update library')}</b><span id="set-scan-txt">${plural(S.tracks.length, T('track'), T('tracks'))} · ${plural(S.albums.length, T('album'), T('albums'))} · ${plural(S.artists.length, T('artist'), T('artists'))}</span>
        <div class="progress" id="set-prog" hidden><div></div></div></div>
        <button class="btn ghost" data-a="rescan">${T('{0}Scan now', icon('refresh'))}</button></div>
    </div></div>
    ${plusSettings}
    <div class="set-group"><h3>${T('Appearance')}</h3><div class="set-card">
      <div class="set-row"><div class="lbl"><b>${T('Theme')}</b><span>${T('Automatic follows the Android settings')}</span></div><div id="set-theme"></div></div>
      <div class="set-row wrap"><div class="lbl"><b>${T('Language')}</b><span>${T('Automatic follows the Android language')}</span></div><div id="set-lang"></div></div>
    </div></div>
    <div class="set-group"><h3>${T('Playlists')}</h3><div class="set-card">
      <div class="set-row"><div class="lbl"><b>${T('Playlist folder')}</b><span id="set-pltree">${s.plTree ? `${T('{0} · the .m3u8 playlists in here (subfolders included) are imported and kept up to date automatically', esc(s.plTreeName || T('Chosen folder')))}` : T('Choose the folder where you keep your .m3u8 files: I\'ll find them myself, subfolders included')}</span></div>
        <button class="btn ghost" data-a="pltree">${icon('folder')}${s.plTree ? T('Change…') : T('Choose…')}</button></div>
      <div class="set-row"><div class="lbl"><b>${T('Import playlists')}</b><span>${T('Single .m3u8 or .m3u files; the tracks are matched with the ones in your library')}</span></div>
        <button class="btn ghost" data-a="import">${T('{0}Import…', icon('import'))}</button></div>
    </div></div>
    <div class="set-group"><h3>${T('PartyBox')}</h3><div class="set-card">
      <div class="set-row"><div class="lbl"><b>${T('{0}\'s PartyBox', esc(nm() || 'te'))}</b><span>${T('Shows a QR code: your friends scan it and pick the music from their browser, nothing to install. Perfect for a party, or in the car with the phone\'s hotspot.')}</span></div>
        <button class="btn primary" data-a="party">${T('{0}Start PartyBox', icon('party'))}</button></div>
    </div></div>
    <div class="set-group"><h3>${T('rJuke Connect')}</h3><div class="set-card">
      <div class="set-row"><div class="lbl"><b>${T('Listen on another device')}</b><span>${T('Control the music on your PC or move playback, on the same home Wi‑Fi')}</span></div>
        <button class="btn ghost" data-a="connect">${T('{0}Devices…', icon('cast'))}</button></div>
      ${window.connectIdentityHTML ? connectIdentityHTML() : ''}
      <div class="set-row"><div class="lbl"><b>${T('This device')}</b><span id="set-connect-me">${T('Starting…')}</span></div></div>
      <div class="set-row"><div class="lbl"><b>${T('Found at home')}</b><span id="set-connect-devs">${T('Searching…')}</span></div></div>
      <div class="set-row"><div class="lbl"><b>${T('Authorized devices')}</b><span>${Object.keys(s.connectTrusted || {}).length ? esc(Object.values(s.connectTrusted).join(' · ')) : T('None: I\'ll ask you the first time they connect')}</span></div>
        ${Object.keys(s.connectTrusted || {}).length ? `<button class="btn ghost" data-a="connect-forget">${T('{0}Revoke', icon('trash'))}</button>` : ''}</div>
    </div></div>
    <div class="set-group"><h3>${T('About')}</h3><div class="set-card">
      <div class="set-row"><div class="lbl"><b>${T('rJuke {0}', esc(S.info.version || ''))}</b><span>${T('Supported formats: MP3, FLAC, M4A (AAC), OGG, OPUS, WAV. Synced lyrics are read from the track tags (LRC, SYLT). Music keeps playing with the screen off.')}</span></div></div>
      <div class="set-row"><div class="lbl"><b>${T('Gestures')}</b><span>${T('Long-press a track or an album for the menu · swipe the mini player to change track · drag down to close Now playing')}</span></div></div>
    </div></div>
  </div>`);
  $('#set-lang', el).appendChild(segmented([['auto', T('Automatic')], ...I18N.LANGS], s.lang || 'auto', async (k) => {
    S.settings = await rj.setSettings({ lang: k });
    I18N.setLang(k);
    try { sessionStorage.setItem('rj.relang', '1'); } catch { /* */ }
    location.reload();   // every text is redrawn in the new language
  }));
  $('#set-theme', el).appendChild(segmented([['system', T('Automatic')], ['light', T('Light')], ['dark', T('Dark')]], s.theme || 'system', async (k) => {
    S.settings = await rj.setSettings({ theme: k });
    S.info = await rj.info();
    applyTheme();
  }));
  if (window.connectIdentityBind) connectIdentityBind(el);
  const nameIn = $('#set-name', el);
  const bIn = $('#set-bday', el);
  bIn.addEventListener('change', async () => {
    const v = bIn.value ? bIn.value.slice(5) : '';
    S.settings = await rj.setSettings({ birthday: v });
    if (v) toast(isBirthday() ? `${T('It\'s today! Happy birthday, {0}! 🎂', nm())}` : `${T('Noted! See you on {0}, {1} 🎂', new Date('2000-' + v).toLocaleDateString(loc(), { day: 'numeric', month: 'long' }), nm())}`);
  });
  nameIn.addEventListener('change', async () => {
    const v = nameIn.value.trim();
    if (!v) { nameIn.value = s.name; return; }
    S.settings = await rj.setSettings({ name: v });
    applyName();
    connectRename();
    toast(`${T('Nice to see you again, {0}!', v)}`);
  });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'party') { partyStart(); return; }
    if (b.dataset.a === 'connect') { const r = b.getBoundingClientRect(); connectMenu(r.left, r.bottom + 6); return; }
    if (b.dataset.a === 'connect-forget') {
      if (!(await confirmModal({ title: T('Revoke the devices?'), text: T('The other devices will have to ask for permission again to control rJuke.'), ok: T('Revoke'), danger: true }))) return;
      S.settings = await rj.setSettings({ connectTrusted: {}, libTokens: {} }); if (window.libShareSync) libShareSync(true); toast(T('Authorizations revoked')); rerender(); return;
    }
    if (b.dataset.a === 'pltree') {
      const r = await rj.pickPlaylistFolder(); if (!r) return;
      S.settings = await rj.setSettings({ plTree: r.uri, plTreeName: r.name });
      const n = await scanPlaylistFolder(false);
      toast(n ? `${T('Done{0}! Playlists found and imported', nm() ? ', ' + nm() : '')}` : T('No new playlists found in this folder'));
      rerender();
      return;
    }
    if (b.dataset.a === 'dir') {
      const d = await rj.pickFolder(); if (!d) return;
      let extra = {};
      S.settings = await rj.setSettings({ musicDir: d, ...extra });
      $('#set-dir', el).textContent = dirLabel(d);
      await runScan(true);
      rerender();
      return;
    }
    if (b.dataset.a === 'rescan') runScan(true);
    if (b.dataset.a === 'import') importPlaylists();
  });
  setTimeout(connectUIRefresh, 0);
  return el;
};

// ===================== playlist =====================
function plTracks(pl) { return pl.paths.map((p) => S.byPath.get(p)).filter(Boolean); }
const savePlaylistsNow = () => rj.savePlaylists(S.playlists.map(({ id, name, paths, created, source, sourceMtime, renamed, sourceDir, syncSig, nameSync, miss, fixes }) => ({ id, name, paths, created, source, sourceMtime, renamed, sourceDir, syncSig, nameSync, miss, fixes })));
// playlists found in the music folder: new ones added, changed ones updated, never duplicates
const samePath = (a, b) => String(a || '').replace(/\\/g, '/').toLowerCase() === String(b || '').replace(/\\/g, '/').toLowerCase();
function mergeFoundPlaylists(found, { quiet = false } = {}) {
  if (!found) return 0;
  let added = 0, updated = 0, removed = 0, meta = 0;
  const newMiss = [];
  for (const f of found) {
    const ex = S.playlists.find((p) => p.source && samePath(p.source, f.source));
    if (ex) {
      if (f.dir != null) ex.sourceDir = f.dir;
      if (ex.syncSig != null && plSig(ex) !== ex.syncSig) continue;
      const ms = missList(f);
      if (ex.sourceMtime !== f.mtime) {
        const before = (ex.miss || []).length, r = resolveMiss(f.paths, ms, ex.fixes);
        ex.paths = r.paths; ex.miss = r.miss; ex.sourceMtime = f.mtime; updated++;
        if (!ex.renamed) ex.name = f.name;
        if (r.miss.length > before) newMiss.push(ex);
      } else if (ex.miss == null) {
        // playlists imported before this version: I recover the lines not found (only if it hasn't changed meanwhile)
        const synced = ex.syncSig != null && ex.syncSig === plSig(ex);
        const same = ex.paths.length === f.paths.length && ex.paths.every((x, i) => x === f.paths[i]);
        ex.miss = same ? resolveMiss(f.paths, ms, ex.fixes).miss : [];
        if (synced) ex.syncSig = plSig(ex);
        meta++;
        if (ex.miss.length) newMiss.push(ex);
      }
      continue;
    }
    const twin = S.playlists.find((p) => !p.source && p.name === f.name && p.paths.length === f.paths.length && p.paths.every((x, i) => x === f.paths[i]));
    if (twin) { twin.source = f.source; twin.sourceMtime = f.mtime; continue; }
    const r = resolveMiss(f.paths, missList(f), null);
    const np = { id: newId(), name: f.name, paths: r.paths, miss: r.miss, created: 0, source: f.source, sourceMtime: f.mtime, fresh: true };
    if (r.miss.length) newMiss.push(np);
    S.playlists.push(np);
    added++;
  }
  if ((removed || meta) && !added && !updated) { savePlaylists(); if (S.view && ['playlist', 'playlists', 'home', 'library'].includes(S.view.name)) rerender(); }
  if (added || updated) {
    savePlaylists();
    if (!quiet) {
      const n = nm() ? `, ${nm()}` : '';
      if (added) toast(added === 1 ? `${T('I found a new playlist in your folder{0}', n)}` : `${T('I found {0} new playlists in your folder{1}', added, n)}`);
      else toast(updated === 1 ? T('A playlist was updated from its file') : `${T('{0} playlists updated from their files', updated)}`);
    }
  }
  if (newMiss.length) missNotify(newMiss);
  return added + updated;
}
const savePlaylistsDeb = debounce(savePlaylistsNow, 300);
function savePlaylists() {
  S.plMap = new Map(S.playlists.map((p) => [p.id, p])); savePlaylistsDeb(); renderSidebarPlaylists();
}

// playlist signature (name, tracks, lines not found): tells whether it changed
const plSig = (p) => `${p.name}\n${p.paths.join('\n')}${p.miss && p.miss.length ? '\n?' + p.miss.map((m) => m.line).join('\n?') : ''}`;

function newId() { return 'pl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ===================== tracks not found in imported playlists =====================
// Every line of an .m3u8 that matches no track stays in p.miss until the user picks the right track or “Skip”.
// Choices stay in p.fixes (line → path, '' = skipped): if the file is read again they are not asked again.
const missList = (f) => (f.missing || []).map((m) => (typeof m === 'string' ? { line: m, at: f.paths.length, info: '' } : m));
const hasOwn = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
function resolveMiss(paths, missing, fixes) {
  const out = paths.slice(), miss = [];
  let shift = 0;
  for (const m of missing) {
    if (hasOwn(fixes, m.line)) {
      const fx = fixes[m.line];
      if (fx === '') continue;
      if (S.byPath.has(fx)) { out.splice(Math.min(m.at + shift, out.length), 0, fx); shift++; continue; }
    }
    miss.push({ line: m.line, at: m.at + shift, info: m.info || '' });
  }
  return { paths: out, miss };
}
const missCount = (pls) => pls.reduce((s, p) => s + ((p.miss && p.miss.length) || 0), 0);
function missNotify(pls) {
  const n = missCount(pls);
  if (!n) return;
  const msg = pls.length === 1 ? `${T('In “{0}” I couldn\'t find {1}', pls[0].name, plural(n, T('track'), T('tracks')))}` : `${T('In {0} playlists I couldn\'t find {1}', pls.length, plural(n, T('track'), T('tracks')))}`;
  const show = () => {
    if (!$('#setup').hidden || $('.miss-rev')) { setTimeout(show, 2000); return; }
    toast(msg, null, 'err', { label: T('Review'), fn: () => reviewMissing(pls) });
  };
  setTimeout(show, 900);
}
// useful words for comparing file names and titles
const MISS_STOP = new Set(['the', 'and', 'feat', 'ft', 'featuring', 'di', 'il', 'la', 'le', 'lo', 'gli', 'un', 'una', 'of', 'mp3', 'flac', 'm4a', 'ogg', 'wav', 'remaster', 'remastered', 'version', 'versione', 'track', 'traccia']);
const missToks = (s) => norm(s).replace(/\.[a-z0-9]{2,4}$/, '').split(/[^a-z0-9]+/).filter((w) => w && (w.length > 1 || /\d/.test(w)) && !MISS_STOP.has(w));
// a file name without the leading track number (“03 Notte 3.flac” → notte, 3)
const missFileToks = (f) => missToks(String(f || '').replace(/^\s*(\d{1,2}[-.]?)?\d{1,3}[\s._)-]+/, ''));
const missSegs = (line) => String(line).replace(/^file:\/\/\/?/i, '').split(/[\\/]+/).filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
function missLabel(m) {
  if (m.info) return m.info;
  const s = missSegs(m.line);
  return (s[s.length - 1] || m.line).replace(/\.[a-z0-9]{2,4}$/i, '');
}
let missIdx = null;
function missIndex() {
  if (missIdx && missIdx.n === S.tracks.length) return missIdx.map;
  const map = new Map();
  for (const t of S.tracks) {
    const segs = missSegs(t.path);
    const title = new Set(missToks(t.title));
    map.set(t, { title, all: new Set([...title, ...missToks(t.artist), ...missToks(t.album), ...missFileToks(segs[segs.length - 1] || '')]), hay: norm(`${t.title} ${t.artist} ${t.album} ${segs.slice(-2).join(' ')}`) });
  }
  missIdx = { n: S.tracks.length, map };
  return map;
}
// tracks that look like the line not found (file name, “Artist - Title” and folder)
function missSuggest(m, n = 6) {
  const s = missSegs(m.line);
  const q = new Set([...missToks(m.info), ...missFileToks(s[s.length - 1] || '')]);
  const qf = new Set(missToks(s[s.length - 2] || '').filter((w) => !q.has(w)));
  if (!q.size) return [];
  const res = [];
  for (const [t, x] of missIndex()) {
    let hit = 0, ht = 0; for (const w of q) if (x.all.has(w)) { hit++; if (x.title.has(w)) ht++; }
    // at least one word of the title, or almost all the words (e.g. the artist alone is not enough)
    if (!hit || (!ht && hit / q.size < 0.75)) continue;
    let f = 0; for (const w of qf) if (x.all.has(w)) f++;
    let tin = x.title.size > 0; for (const w of x.title) if (!q.has(w)) { tin = false; break; }
    const sc = hit / q.size + (qf.size ? 0.15 * f / qf.size : 0) + (tin ? 0.3 : 0);
    if (sc >= 0.4) res.push([sc, t]);
  }
  return res.sort((a, b) => b[0] - a[0]).slice(0, n).map((r) => r[1]);
}
function missSearch(text, n = 40) {
  const words = norm(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const [t, x] of missIndex()) { if (words.every((w) => x.hay.includes(w))) { out.push(t); if (out.length >= n) break; } }
  return out;
}
// picks the right track ('' = skip) and fixes the playlist
function missApply(p, m, path) {
  p.fixes = { ...(p.fixes || {}), [m.line]: path };
  p.miss = (p.miss || []).filter((x) => x !== m);
  if (path && !p.paths.includes(path)) {
    const at = Math.min(m.at, p.paths.length);
    p.paths.splice(at, 0, path);
    for (const x of p.miss) if (x.at >= at) x.at++;
  }
  savePlaylists();
}
function reviewMissing(pls) {
  const todo = [];
  for (const p of pls) for (const m of (p.miss || [])) todo.push({ p, m });
  if (!todo.length || $('.miss-rev')) return;
  let i = 0, fixed = 0, skipped = 0;
  const touched = new Set();
  return modal('<div class="miss-rev"></div>', (back, close) => {
    back.classList.add('miss-back');
    const box = $('.miss-rev', back);
    const row = (t) => `<button class="mr-row" data-p="${esc(t.path)}">${artHTML(t.cover, t.albumKey)}<span class="tx"><span class="tt">${esc(t.title)}</span><span class="ta">${esc([t.artist, t.album].filter(Boolean).join(' · '))}</span></span><span class="mr-pick">${T('Choose')}</span></button>`;
    const finish = () => close(true);
    const next = () => { i++; if (i >= todo.length) finish(); else draw(); };
    const draw = () => {
      const { p, m } = todo[i];
      let synced = false;
      box.innerHTML = `<div class="mr-top"><h3>${T('Track not found')}</h3><span class="mr-n">${i + 1} di ${todo.length}</span></div>
        <div class="mr-pl">${T('The playlist “{0}” contains:', esc(p.name))}</div>
        <div class="mr-line"><b>${esc(missLabel(m))}</b><span>${esc(m.line)}</span></div>
        <input class="field mr-q" type="search" spellcheck="false" autocomplete="off" placeholder="${T('Search the library for the right track')}">
        <div class="mr-sub"></div>
        <div class="mr-list"></div>
        <div class="mr-note">${synced ? T('The track you choose takes its place in the playlist, on all your devices. “Skip” removes it.') : T('The track you choose takes its place in the playlist. “Skip” removes it.')}</div>
        <div class="modal-actions"><button class="btn ghost" data-later>${T('Later')}</button><button class="btn soft" data-skip>${T('Skip')}</button></div>`;
      const list = $('.mr-list', box), sub = $('.mr-sub', box), q = $('.mr-q', box);
      const sug = missSuggest(m);
      const show = (arr, label, empty) => { sub.textContent = arr.length ? label : ''; list.innerHTML = arr.length ? arr.map(row).join('') : `<div class="mr-empty">${esc(empty)}</div>`; list.scrollTop = 0; };
      const base = () => show(sug, sug.length === 1 ? T('Maybe it\'s this one') : T('Maybe it\'s one of these'), T('I couldn\'t find any similar tracks: search for it above.'));
      base();
      let tm = 0;
      q.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { const v = q.value.trim(); if (!v) base(); else show(missSearch(v), T('Results'), T('No tracks found.')); }, 140); });
      list.addEventListener('click', (e) => {
        const b = e.target.closest('[data-p]'); if (!b || list.dataset.busy) return;
        list.dataset.busy = '1';
        missApply(p, m, b.dataset.p); fixed++; touched.add(p);
        b.classList.add('picked');
        setTimeout(next, 260);
      });
      $('[data-skip]', box).addEventListener('click', () => { missApply(p, m, ''); skipped++; touched.add(p); next(); });
      $('[data-later]', box).addEventListener('click', finish);
    };
    draw();
  }).then(() => {
    if (fixed || skipped) toast(fixed && skipped ? `${T('Playlist fixed: {0}, {1}', plural(fixed, T('track fixed'), T('tracks fixed')), plural(skipped, T('skipped'), T('skipped#n')))}` : fixed ? `${T('Playlist fixed: {0}', plural(fixed, T('track fixed'), T('tracks fixed')))}` : `${T('{0} and {1} from the playlist', plural(skipped, T('line skipped'), T('lines skipped')), skipped === 1 ? 'tolta' : 'tolte')}`);
    if (touched.size && S.view && ((S.view.name === 'playlist' && [...touched].some((p) => p.id === S.view.param)) || ['playlists', 'home', 'library'].includes(S.view.name))) rerender();
  });
}

async function createPlaylist(tracks = [], { open = true } = {}) {
  const name = await promptModal({ title: T('New playlist'), text: tracks.length ? `${T('It will be created with {0}.', plural(tracks.length, T('track'), T('tracks')))}` : T('Give your new playlist a name.'), value: '', placeholder: T('My playlist'), ok: T('Create') });
  if (!name) return null;
  const pl = { id: newId(), name, paths: tracks.map((t) => t.path), created: Date.now(), fresh: true };
  S.playlists.push(pl);
  savePlaylists();
  if (open) go('playlist', pl.id);
  toast(nm() ? `${T('Here\'s your new playlist, {0}: “{1}”', nm(), name)}` : `${T('Playlist “{0}” created', name)}`, tracks[0] && tracks[0].cover);
  return pl;
}
// dialog with several choices: returns the value of the button pressed (null if closed)
function choiceModal({ title, text, buttons }) {
  return modal(`<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="modal-actions">${buttons.map((b, i) => `<button class="btn ${b.primary ? 'primary' : 'ghost'}" data-c="${i}">${esc(b.label)}</button>`).join('')}</div>`, (back, close) => {
    back.classList.add('solid-back');
    $$('[data-c]', back).forEach((b) => b.addEventListener('click', () => close(buttons[+b.dataset.c].value)));
    setTimeout(() => { const p = $('.btn.primary', back); if (p) p.focus(); }, 60);
  });
}
async function addToPlaylist(pl, tracks, at = null) {
  if (!tracks.length) return;
  const existing = new Set(pl.paths);
  let fresh = tracks.filter((t) => !existing.has(t.path));
  const dup = tracks.length - fresh.length;
  // tracks already present: ask before adding them a second time
  if (dup) {
    const one = tracks.length === 1;
    const choice = await choiceModal(fresh.length
      ? { title: T('Some tracks are already there'), text: `${T('{0} in “{1}”.', dup === 1 ? T('One of these tracks is already') : `${T('{0} of these tracks are already', dup)}`, pl.name)}`, buttons: [{ label: T('Add all'), value: 'all' }, { label: `${T('Only the new ones ({0})', fresh.length)}`, value: 'new', primary: true }] }
      : { title: one ? T('Track already there') : T('Tracks already there'), text: one ? `${T('“{0}” is already in “{1}”. Add it again?', tracks[0].title, pl.name)}` : `${T('All these tracks are already in “{0}”. Add them again?', pl.name)}`, buttons: [{ label: T('Don\'t add'), value: null }, { label: T('Add anyway'), value: 'all', primary: true }] });
    if (!choice) return;
    if (choice === 'all') fresh = tracks.slice();
  }
  if (at == null) pl.paths.push(...fresh.map((t) => t.path));
  else pl.paths.splice(at, 0, ...fresh.map((t) => t.path));
  savePlaylists();
  const pre = nm() ? `${T('Done, {0}!', nm())} ` : '';
  toast(fresh.length === 1 ? `${T('{0}Added to “{1}”', pre, pl.name)}` : `${pre}${plural(fresh.length, T('track added'), T('tracks added'))} a «${pl.name}»`, fresh[0].cover);
  if (S.view.name === 'playlist' && S.view.param === pl.id) rerender();
}
function movePlItem(pl, from, to) {
  const [p] = pl.paths.splice(from, 1);
  pl.paths.splice(to, 0, p);
  savePlaylists(); rerender();
  rj.haptic('tick');
}
function removeFromPlaylist(pl, origIdx, row) {
  const t = S.byPath.get(pl.paths[origIdx]);
  const done = () => { pl.paths.splice(origIdx, 1); for (const m of (pl.miss || [])) if (m.at > origIdx) m.at--; savePlaylists(); rerender(); };
  if (row) { row.classList.add('removing'); setTimeout(done, 300); } else done();
  if (t) toast(`${T('Removed from “{0}”', pl.name)}`, t.cover);
}
async function deletePlaylist(pl) {
  let synced = false;
  let text = T('The playlist will be deleted from rJuke. Your music files won\'t be touched.');
  const ok = await confirmModal({ title: `${T('Delete “{0}”?', pl.name)}`, text, ok: T('Delete'), danger: true });
  if (!ok) return;
  S.playlists = S.playlists.filter((p) => p !== pl);
  savePlaylists();
  if (S.view.name === 'playlist' && S.view.param === pl.id) go('home');
  toast(T('Playlist deleted'));
}
async function renamePlaylist(pl) {
  const name = await promptModal({ title: T('Rename playlist'), value: pl.name, ok: T('Save') });
  if (!name || name === pl.name) return;
  pl.name = name; pl.renamed = true; savePlaylists();
  if (S.view.name === 'playlist' && S.view.param === pl.id) rerender();
}
async function exportPlaylist(pl) {
  const r = await rj.exportPlaylist({ name: pl.name, tracks: plTracks(pl).map((t) => ({ path: t.path, title: t.title, artist: t.artist, duration: t.duration })) });
  if (r) toast(`${T('Exported to {0}', r)}`);
}
async function importPlaylists() {
  const res = await rj.importPlaylists();
  if (!res || !res.length) return;
  let last = null;
  const missed = [];
  for (const r of res) {
    const rm = resolveMiss(r.paths, missList(r), null);
    const pl = { id: newId(), name: r.name, paths: rm.paths, miss: rm.miss, created: Date.now(), fresh: true };
    if (rm.miss.length) missed.push(pl);
    S.playlists.push(pl);
    last = pl;
    const miss = r.missing.length ? ` (${plural(r.missing.length, T('not found'), T('not found#n'))})` : '';
    const firstT = S.byPath.get(r.paths[0]);
    toast(`${T('Imported “{0}”: {1}{2}', r.name, plural(r.paths.length, T('track'), T('tracks')), miss)}`, firstT && firstT.cover);
  }
  savePlaylists();
  if (last) go('playlist', last.id);
  if (missed.length) missNotify(missed);
}

function renderSidebarPlaylists() {
  const box = $('#pl-list');
  box.innerHTML = S.playlists.map((p) => {
    const c = plCovers(p)[0];
    return `<a class="nav-item pl-item ${p.fresh ? 'enter' : ''}" data-pl="${esc(p.id)}"><span class="pl-thumb ${c ? '' : 'noart'}">${c ? `<img src="${fileUrl(c.s)}" alt="">` : icon('playlist')}</span><span>${esc(p.name)}</span></a>`;
  }).join('') || T('<div style="padding:6px 10px;color:var(--text-3);font-size:12.5px">No playlists. Create one with + or import an .m3u8 file</div>');
  S.playlists.forEach((p) => { delete p.fresh; });
  updateNav();
}

// ===================== context menus =====================
let menuStack = [];
function closeMenus() {
  const back = $('.sheet-back');
  if (back) { back.classList.add('out'); setTimeout(() => back.remove(), 320); }
  menuStack = [];
}
function showMenu(items, x, y, { header = '' } = {}) {
  rj.haptic('long');
  let back = $('.sheet-back');
  const fresh = !back;
  if (fresh) {
    back = h('<div class="sheet-back"><div class="sheet"><div class="sheet-grab"></div><div class="sheet-body"></div></div></div>');
    back.addEventListener('click', (e) => { if (e.target === back) closeMenus(); });
    bindSheetDrag($('.sheet', back), closeMenus);
    $('#menu-root').appendChild(back);
  }
  const body = h(`<div class="sheet-page">${header}</div>`);
  let k = 0;
  items.forEach((it) => {
    k++;
    if (it.sep) { const s = h('<div class="msep"></div>'); s.style.setProperty('--k', k); body.appendChild(s); return; }
    const el = h(`<div class="mi ${it.danger ? 'danger' : ''} ${it.disabled ? 'disabled' : ''}">${icon(it.icon || 'note')}<span>${esc(it.label)}</span>${it.sub ? icon('forward', 'sub-ar') : ''}</div>`);
    el.style.setProperty('--k', k);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (it.sub) {
        const subItems = typeof it.sub === 'function' ? it.sub() : it.sub;
        showMenu([{ label: T('Back'), icon: 'back', action: () => showMenu(items, x, y, { header }), keep: true }, { sep: true }, ...subItems], x, y, { header });
        return;
      }
      if (it.keep) { it.action(); return; }
      closeMenus(); it.action && it.action();
    });
    body.appendChild(el);
  });
  const host = $('.sheet-body', back);
  const old = host.firstElementChild;
  if (old && !fresh) { old.classList.add('leave'); setTimeout(() => old.remove(), 200); body.classList.add('arrive'); }
  host.appendChild(body);
  menuStack = [back];
  return back;
}
function bindSheetDrag(sheet, onClose) {
  let y0 = null, dy = 0;
  sheet.addEventListener('touchstart', (e) => {
    const sc = e.target.closest('.sheet-body');
    if (sc && sc.scrollTop > 0) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0; sheet.style.transition = 'none';
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sheet.addEventListener('touchend', () => {
    if (y0 == null) return;
    sheet.style.transition = '';
    if (dy > 110) onClose(); else sheet.style.transform = '';
    y0 = null;
  });
}

function artistMenuItem(names) {
  const ok = names.filter((n) => S.artistMap.has(norm(n)));
  if (ok.length <= 1) return { label: T('Go to artist'), icon: 'mic', action: () => ok[0] && go('artist', norm(ok[0])), disabled: !ok.length };
  return { label: T('Go to artists'), icon: 'mic', sub: ok.map((n) => ({ label: n, icon: 'person', action: () => go('artist', norm(n)) })) };
}
function plSubmenu(tracks) {
  return () => [
    { label: T('New playlist…'), icon: 'plus', action: () => createPlaylist(tracks) },
    ...(S.playlists.length ? [{ sep: true }] : []),
    ...S.playlists.map((p) => ({ label: p.name, icon: 'playlist', action: () => addToPlaylist(p, tracks) })),
  ];
}
function menuHeader(cover, key, t1, t2) {
  return `<div class="mhead">${artHTML(cover, key)}<div class="tx"><div class="tt">${esc(t1)}</div><div class="ta">${esc(t2)}</div></div></div>`;
}
function trackMenu(t, x, y, extra = null) {
  const items = [
    { label: T('Play'), icon: 'play', action: () => playTrackNow(t) },
    { label: T('Play next'), icon: 'playnext', action: () => playNext([t]) },
    { label: T('Add to queue'), icon: 'playlast', action: () => playLast([t]) },
    { sep: true },
    { label: T('Add to playlist'), icon: 'playlist', sub: plSubmenu([t]) },
    { sep: true },
    { label: T('Go to album'), icon: 'album', action: () => go('album', t.albumKey) },
    artistMenuItem(t.artists || splitArtists(t.artist)),
  ];
  items.push(...dlMenuItem([t], `${T('The track “{0}”', t.title)}`));
  if (extra) items.push(...extra);
  showMenu(items, x, y, { header: menuHeader(t.cover, t.albumKey, t.title, t.artist) });
}
function albumMenu(a, x, y) {
  showMenu([
    { label: T('Play'), icon: 'play', action: () => playList(a.tracks, 0, { shuffle: false, ctx: { type: 'album', key: a.key } }) },
    { label: T('Shuffle play'), icon: 'shuffle', action: () => playList(a.tracks, 0, { shuffle: true, ctx: { type: 'album', key: a.key } }) },
    { label: T('Play next'), icon: 'playnext', action: () => playNext(a.tracks) },
    { label: T('Add to queue'), icon: 'playlast', action: () => playLast(a.tracks) },
    { sep: true },
    { label: T('Add to playlist'), icon: 'playlist', sub: plSubmenu(a.tracks) },
    { sep: true },
    artistMenuItem(a.artists || []),
    ...dlMenuItem(a.tracks, `${T('The album “{0}”', a.title)}`),
  ], x, y, { header: menuHeader(a.cover, a.key, a.title, a.artist) });
}
function plMenu(pl, x, y) {
  const tracks = plTracks(pl);
  showMenu([
    { label: T('Play'), icon: 'play', disabled: !tracks.length, action: () => playList(tracks, 0, { shuffle: false, ctx: { type: 'playlist', id: pl.id } }) },
    { label: T('Shuffle play'), icon: 'shuffle', disabled: !tracks.length, action: () => playList(tracks, 0, { shuffle: true, ctx: { type: 'playlist', id: pl.id } }) },
    { label: T('Add to queue'), icon: 'playlast', disabled: !tracks.length, action: () => playLast(tracks) },
    { sep: true },
    { label: T('Rename…'), icon: 'edit', action: () => renamePlaylist(pl) },
    { label: T('Export as .m3u8…'), icon: 'export', disabled: !tracks.length, action: () => exportPlaylist(pl) },
    ...dlMenuItem(tracks, `${T('The playlist “{0}”', pl.name)}`),
    { sep: true },
    { label: T('Delete playlist'), icon: 'trash', danger: true, action: () => deletePlaylist(pl) },
  ], x, y);
}

// ===================== modali e toast =====================
function modal(inner, onReady) {
  return new Promise((resolve) => {
    const back = h(`<div class="modal-back"><div class="modal">${inner}</div></div>`);
    const close = (v) => { back.classList.add('out'); setTimeout(() => back.remove(), 200); document.removeEventListener('keydown', key, true); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    document.addEventListener('keydown', key, true);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(null); });
    $('#modal-root').appendChild(back);
    onReady(back, close);
  });
}
function promptModal({ title, text = '', value = '', placeholder = '', ok = 'OK' }) {
  return modal(`<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}<input class="field" maxlength="80" spellcheck="false" placeholder="${esc(placeholder)}" value="${esc(value)}">
    <div class="modal-actions"><button class="btn ghost" data-r="0">${T('Cancel')}</button><button class="btn primary" data-r="1">${esc(ok)}</button></div>`, (back, close) => {
    const inp = $('input', back);
    setTimeout(() => { inp.focus(); inp.select(); }, 60);
    const submit = () => { const v = inp.value.trim(); if (v) close(v); else inp.focus(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    $('[data-r="0"]', back).addEventListener('click', () => close(null));
    $('[data-r="1"]', back).addEventListener('click', submit);
  });
}
function confirmModal({ title, text, ok = 'OK', danger = false }) {
  return modal(`<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="modal-actions"><button class="btn ghost" data-r="0">${T('Cancel')}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div>`, (back, close) => {
    $('[data-r="0"]', back).addEventListener('click', () => close(false));
    $('[data-r="1"]', back).addEventListener('click', () => close(true));
    setTimeout(() => $('[data-r="1"]', back).focus(), 60);
  });
}
// kind 'err': warning about a problem (orange icon with “!” instead of the green check)
function toast(msg, cover = null, kind = '', action = null) {
  const root = $('#toast-root');
  const err = kind === 'err';
  const el = h(`<div class="toast${err ? ' err' : ''}" role="${err ? 'alert' : 'status'}">${cover && !err ? artHTML(cover, '') : err ? `<span class="warn">${icon('warn')}</span>` : `<span class="ok">${icon('check')}</span>`}<span>${esc(msg)}</span>${action ? `<button class="toast-act">${esc(action.label)}</button>` : ''}</div>`);
  if (action) $('.toast-act', el).addEventListener('click', () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); action.fn(); });
  root.appendChild(el);
  while (root.children.length > 3) root.firstElementChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, action ? 9000 : 3200);
}

// ===================== coda =====================
function queueHTML() {
  const t = cur();
  if (!t) return `<div class="empty-state" style="padding:40px 10px">${icon('queue')}<h3>${nm() ? `${T('What are we listening to, {0}?', esc(nm()))}` : T('The queue is empty')}</h3><p>${T('Play an album, a playlist or a track.')}</p></div>`;
  const item = (x, i) => `<div class="q-item" data-qi="${i}">${artHTML(x.cover, x.albumKey)}<div class="tx"><div class="tt">${esc(x.title)}</div><div class="ta">${esc(x.artist)}</div></div>${i !== S.qi ? `<button class="x" data-rm="${i}" title="Rimuovi">${icon('close')}</button>` : ''}</div>`;
  const up = S.queue.slice(S.qi + 1, S.qi + 151);
  return `<div class="q-sec">${T('Now playing')}</div>${item(t, S.qi)}
    <div class="q-sec"><span>${T('Up next{0}{1}', S.shuffle ? ' ' + T('· shuffle') : '', S.repeat !== 'off' ? ' ' + T('· repeat') : '')}</span>${up.length ? T('<button data-clear>Clear</button>') : ''}</div>
    ${up.map((x, k) => item(x, S.qi + 1 + k)).join('') || T('<div style="padding:6px 10px;opacity:.6;font-size:12.5px">No other tracks in the queue.</div>')}
    ${S.queue.length - S.qi - 1 > 150 ? `<div style="padding:6px 10px;opacity:.6;font-size:12.5px">${T('and {0} more…', nf.format(S.queue.length - S.qi - 151))}</div>` : ''}`;
}
function bindQueue(box) {
  box.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      queueRemove(+rm.dataset.rm); return;
    }
    if (e.target.closest('[data-clear]')) { const n = S.queue.length - S.qi - 1; if (n > 0) queueRemove(S.qi + 1, n); return; }
    const it = e.target.closest('.q-item');
    if (it && +it.dataset.qi !== S.qi) loadTrack(+it.dataset.qi);
  });
}
function renderQueues() {
  if (S.queueOpen) { $('#queue .q-body').innerHTML = queueHTML(); }
  if (S.npOpen && S.npMode === 'queue') $('#np-queue').innerHTML = `<h3>${T('Queued')}</h3>${queueHTML()}`;
}
function toggleQueue(force) {
  S.queueOpen = false;
  if (force === false) return;
  openNP('queue');
}

// ===================== Now Playing =====================
// ===================== Now Playing animated background =====================
// Drawn on a tiny canvas (about 72 px) and scaled up by the screen: same blur effect, minimal cost.
const NPBG = { cv: null, g: null, scenes: [], raf: 0, last: 0 };
const hexA = (hex, a) => { const v = parseInt(hex.slice(1), 16); return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`; };
function npbgSize() {
  if (!NPBG.cv) return;
  const M = 72, k = M / Math.max(innerWidth, innerHeight);
  NPBG.cv.width = Math.max(12, Math.round(innerWidth * k));
  NPBG.cv.height = Math.max(12, Math.round(innerHeight * k));
  npbgDraw(performance.now());
}
function npbgEnsure() {
  if (NPBG.cv) return;
  NPBG.cv = document.createElement('canvas');
  NPBG.cv.className = 'np-canvas';
  NPBG.g = NPBG.cv.getContext('2d', { alpha: false });
  $('#np-bg').appendChild(NPBG.cv);
  npbgSize();
  window.addEventListener('resize', npbgSize);
}
function npbgDraw(now) {
  const g = NPBG.g; if (!g) return;
  const W = NPBG.cv.width, H = NPBG.cv.height, M = Math.max(W, H);
  const sc = NPBG.scenes;
  if (!sc.length) return;
  const newest = sc[sc.length - 1];
  const fade = clamp((now - newest.born) / 1300, 0, 1);
  if (fade >= 1 && sc.length > 1) sc.splice(0, sc.length - 1);
  sc.forEach((s, idx) => {
    const a = idx === sc.length - 1 && sc.length > 1 ? fade : 1;
    g.globalAlpha = a;
    g.globalCompositeOperation = 'source-over';
    g.filter = 'none';
    g.fillStyle = s.base; g.fillRect(0, 0, W, H);
    const t = (now - s.t0) / 1000;
    if (s.img && s.img.complete && s.img.naturalWidth) {
      g.save();
      g.filter = `blur(${(M * 0.07).toFixed(1)}px) saturate(1.7)`;
      g.globalAlpha = a * 0.9;
      g.translate(W / 2, H / 2);
      g.rotate((t / 70) * Math.PI * 2);
      const z = M * 1.5;
      g.drawImage(s.img, -z / 2, -z / 2, z, z);
      g.restore();
    }
    g.globalCompositeOperation = 'screen';
    g.filter = 'none';
    const B = [[0.15, 0.1, 22, 0], [0.9, 0.45, 28, 2], [0.35, 0.95, 25, 4]];
    B.forEach(([bx, by, per, ph], k) => {
      const ang = (t / per) * Math.PI * 2 + ph;
      const cx = W * (bx + 0.22 * Math.sin(ang)), cy = H * (by + 0.18 * Math.cos(ang * 0.8));
      const r = M * (0.42 + 0.06 * Math.sin(ang * 1.3));
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, hexA(s.colors[k] || '#2fbf71', 0.62));
      gr.addColorStop(1, hexA(s.colors[k] || '#2fbf71', 0));
      g.globalAlpha = a;
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    });
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = a;
    g.fillStyle = `rgba(0,0,0,${s.shade})`;
    g.fillRect(0, 0, W, H);
  });
  g.globalAlpha = 1;
}
function npbgLoop(now) {
  NPBG.raf = 0;
  if (!S.npOpen || document.hidden) return;
  const fading = NPBG.scenes.length > 1;
  if (now - NPBG.last >= 33) { NPBG.last = now; npbgDraw(now); }
  if (S.playing || fading) NPBG.raf = requestAnimationFrame(npbgLoop);
}
function npbgKick() {
  npbgEnsure();
  npbgDraw(performance.now());
  if (!NPBG.raf) NPBG.raf = requestAnimationFrame(npbgLoop);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.npOpen) npbgKick(); });

function setNPBackground(t) {
  const cv = t && t.cover;
  const colors = cv && cv.colors ? cv.colors : ['#2fbf71', '#0f6b5c', '#a2f7a1', '#333333'];
  const avg = cv && cv.avg ? cv.avg : '#3a2a40';
  const base = mixHex(avg, '#000000', 0.55);
  S.npBase = base;
  $('#np').style.setProperty('--np-base', base);
  npbgEnsure();
  const scene = { base, colors, shade: cv && cv.light ? 0.42 : 0.26, img: null, born: performance.now(), t0: performance.now() - Math.random() * 20000 };
  if (cv) { const im = new Image(); im.decoding = 'async'; im.src = fileUrl(cv.s); im.onload = () => npbgDraw(performance.now()); scene.img = im; }
  NPBG.scenes.push(scene);
  if (NPBG.scenes.length > 3) NPBG.scenes.splice(0, NPBG.scenes.length - 3);
  if (S.npOpen) { updateChrome(); npbgKick(); } else { scene.born -= 2000; npbgDraw(performance.now()); }
}
let npTrackPath = null;
function updateNP(changed) {
  const t = cur();
  if (!t) return;
  if (npTrackPath !== t.path) {
    npTrackPath = t.path;
    const art = $('#np-art');
    art.innerHTML = t.cover ? `<img src="${fileUrl(t.cover.l)}" alt="">` : `<div class="ph" style="${phStyle(t.albumKey)}">${icon('note')}</div>`;
    $('#np-thumb').innerHTML = t.cover ? `<img src="${fileUrl(t.cover.s)}" alt="">` : `<div class="ph" style="${phStyle(t.albumKey)}">${icon('note')}</div>`;
    if (changed && S.npOpen) {
      art.classList.remove('swap', 'swap-n', 'swap-p'); void art.offsetWidth;
      art.classList.add(S.dir > 0 ? 'swap-n' : S.dir < 0 ? 'swap-p' : 'swap');
      const tt = $('.np-titles'); tt.classList.remove('swap'); void tt.offsetWidth; tt.classList.add('swap');
    }
    $('#np-title').textContent = t.title;
    $('#np-artist').textContent = `${t.artist} — ${t.album_.title}`;
    const c = (t.codec || '').toUpperCase() + ' ' + t.path.split('.').pop().toUpperCase();
    $('#np-quality').textContent = /FLAC|ALAC|PCM|WAV/.test(c) ? T('Lossless') : /OPUS/.test(c) ? T('Opus') : /MPEG|MP3/.test(c) ? 'MP3' : /MP4|AAC|M4A/.test(c) ? 'AAC' : /OGG|VORBIS/.test(c) ? T('Ogg') : '';
    setNPBackground(t);
  }
}
function openNP(mode) {
  if (!cur()) { toast(T('Play something to open the Now playing screen')); return; }
  if (mode) S.npMode = mode;
  S.npOpen = true;
  closeMenus();
  updateNP(false);
  const np = $('#np');
  const show = () => {
    np.classList.add('open');
    np.setAttribute('aria-hidden', 'false');
    applyNPMode();
    updateChrome();
    npbgKick();
  };
  npMorph(show, $('#lcd-art'), $('#np-art'));
  requestAnimationFrame(() => layoutLyrics(false));
}
function closeNP(swipe = false) {
  if (!S.npOpen) return;
  S.npOpen = false;
  const np = $('#np');
  if (swipe) {
    np.classList.remove('open');
    np.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('np-on');
    updateChrome();
    return;
  }
  npMorph(() => {
    np.classList.remove('open');
    np.setAttribute('aria-hidden', 'true');
    updateChrome();
  }, $('#np-art'), $('#lcd-art'));
}
function npMorph(update, from, to) {
  const np = $('#np');
  // on the phone the panel slides up and down with its own animation: no fade transition
  if (TOUCH) { update(); document.body.classList.toggle('np-on', S.npOpen); return; }
  if (!canVT || document.hidden || !from.firstElementChild) { update(); return; }
  if (vtRunning) { try { vtRunning.skipTransition(); } catch { /* */ } }
  np.classList.add('instant');
  from.style.viewTransitionName = 'npart';
  const vt = document.startViewTransition(() => {
    from.style.viewTransitionName = '';
    update();
    to.style.viewTransitionName = 'npart';
  });
  vtRunning = vt;
  vt.ready.catch(() => {}); vt.updateCallbackDone.catch(() => {});
  vt.finished.finally(() => {
    to.style.viewTransitionName = ''; from.style.viewTransitionName = '';
    np.classList.remove('instant');
    if (vtRunning === vt) vtRunning = null;
  });
}
function applyNPMode() {
  const t = cur();
  const hasLyrics = !!(S.lyrics && S.lyrics.path === (t && t.path) && S.lyrics.data);
  const loading = !!(S.lyrics && S.lyrics.loading);
  const mode = S.npMode;
  const solo = mode === null || (mode === 'lyrics' && !hasLyrics && !loading);
  $('#np-body').classList.toggle('solo', solo);
  $('#lyrics').classList.toggle('hide', mode !== 'lyrics');
  $('#np-queue').classList.toggle('hide', mode !== 'queue');
  $('#np-lyrics-toggle').innerHTML = `${T('{0}Lyrics', icon('lyrics'))}`;
  $('#np-lyrics-toggle').classList.toggle('on', mode === 'lyrics' && !solo);
  $('#np-lyrics-toggle').style.opacity = hasLyrics || loading ? 1 : .45;
  $('#np-queue-toggle').innerHTML = `${T('{0}Queue', icon('queue'))}`;
  $('#np-queue-toggle').classList.toggle('on', mode === 'queue');
  if (mode === 'queue') $('#np-queue').innerHTML = `<h3>${T('Queued')}</h3>${queueHTML()}`;
  if (mode === 'lyrics') requestAnimationFrame(() => layoutLyrics(false));
}

// ---------- synced lyrics ----------
const LY = { items: [], els: [], active: -2, follow: true, manualY: 0, timer: 0, inner: null };
let lyricsToken = 0;
async function loadLyrics(t) {
  const tok = ++lyricsToken;
  if (!t) { S.lyrics = null; renderLyrics(); return; }
  S.lyrics = { path: t.path, data: null, loading: true };
  renderLyrics();
  let data = null;
  try { data = await rj.lyrics(t.path); } catch { data = null; }
  if (tok !== lyricsToken) return;
  S.lyrics = { path: t.path, data, loading: false };
  const flag = data ? (data.synced ? 2 : 1) : 0;
  if (t.lyrics !== flag) t.lyrics = flag;
  renderLyrics();
  if (S.npOpen) applyNPMode();
}
function renderLyrics() {
  const box = $('#lyrics');
  LY.items = []; LY.els = []; LY.active = -2; LY.follow = true; LY.inner = null;
  box.classList.remove('manual');
  const t = cur();
  const L = S.lyrics;
  if (!t || !L || L.loading) { box.innerHTML = ''; return; }
  const d = L.data;
  if (!d) { box.innerHTML = `<div class="ly-empty">${T('{0}<b>No lyrics available', icon('lyrics'))}</b><span>${T('This track has no embedded lyrics and no .lrc file.')}</span></div>`; return; }
  if (!d.synced) { box.innerHTML = `<div class="ly-plain"><div class="note">${T('LYRICS NOT SYNCED')}</div>${esc(d.text)}</div>`; return; }
  const lines = d.lines;
  const durMs = (t.duration || audio.duration || 0) * 1000;
  const items = [];
  if (lines.length && lines[0].t > 3500) items.push({ t: 0, end: lines[0].t, dots: true });
  lines.forEach((l, i) => {
    const nx = lines[i + 1];
    const end = nx ? nx.t : Math.max(l.t + 4000, durMs);
    if (!l.text) { if (end - l.t >= 3500 && nx) items.push({ t: l.t, end, dots: true }); return; }
    items.push({ t: l.t, end, text: l.text, words: l.words && l.words.length > 1 ? l.words : null });
  });
  LY.items = items;
  const inner = h('<div class="ly-inner"></div>');
  items.forEach((it, i) => {
    let el;
    if (it.dots) el = h(`<div class="ly-line dots" data-i="${i}"><i></i><i></i><i></i></div>`);
    else if (it.words) el = h(`<div class="ly-line" data-i="${i}">${it.words.map((w) => `<span class="wd">${esc(w.w)}</span>`).join('')}</div>`);
    else el = h(`<div class="ly-line" data-i="${i}">${esc(it.text)}</div>`);
    inner.appendChild(el);
    LY.els.push(el);
  });
  inner.addEventListener('click', (e) => {
    const l = e.target.closest('.ly-line'); if (!l) return;
    const it = LY.items[+l.dataset.i];
    LY.follow = true; box.classList.remove('manual'); clearTimeout(LY.timer);
    seekTo(it.t / 1000 + 0.01);
    if (audio.paused) togglePlay();
  });
  box.replaceChildren(inner);
  LY.inner = inner;
  LY.active = -2;
  lyTick(true);
}
function lyFind(ms) {
  const it = LY.items;
  let lo = 0, hi = it.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (it[mid].t <= ms) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}
function lyTick(force) {
  if (!LY.items.length) return;
  const now = audio.currentTime * 1000 + 160;
  const i = lyFind(now);
  if (i !== LY.active || force === true) setLyActive(i, force !== true);
  if (i < 0) return;
  const it = LY.items[i], el = LY.els[i];
  if (it.dots) {
    const p = (now - it.t) / Math.max(1, it.end - it.t);
    $$('i', el).forEach((d, k) => d.classList.toggle('on', p > (k + 1) / 3.6));
  } else if (it.words) {
    const spans = el.children;
    for (let k = 0; k < it.words.length; k++) {
      const w = it.words[k];
      const e = k + 1 < it.words.length ? it.words[k + 1].t : it.end;
      const p = clamp((now - w.t) / Math.max(80, e - w.t), 0, 1);
      spans[k].style.setProperty('--wp', p.toFixed(3));
      spans[k].classList.toggle('done', p >= 1);
    }
  }
}
function setLyActive(i, animate) {
  const prev = LY.active;
  LY.active = i;
  // only the affected lines change, not all of them
  const touch = new Set([prev, i]);
  if (prev === -2 || Math.abs(i - prev) > 1) LY.els.forEach((el, j) => { el.classList.toggle('act', j === i); el.classList.toggle('past', j < i); });
  else touch.forEach((j) => { const el = LY.els[j]; if (el) { el.classList.toggle('act', j === i); el.classList.toggle('past', j < i); } });
  if (LY.follow) layoutLyrics(animate);
}
// the text moves as a single block: one transform, no line-by-line recalculation
function lyMove(y, mode) {
  const inner = LY.inner; if (!inner) return;
  inner.style.transition = mode === 'anim' ? 'transform .7s cubic-bezier(.32, .72, 0, 1)' : 'none';
  inner.style.transform = `translate3d(0, ${y}px, 0)`;
  LY.y = y;
}
function lyBounds() {
  const box = $('#lyrics');
  const anchor = box.clientHeight * 0.3;
  const last = LY.els[LY.els.length - 1];
  return { max: anchor, min: anchor - (last ? last.offsetTop : 0) };
}
function layoutLyrics(animate) {
  const box = $('#lyrics');
  if (!LY.els.length || !box.clientHeight || !LY.inner) return;
  if (!LY.follow) return;
  const i = Math.max(LY.active, 0);
  const y = box.clientHeight * 0.3 - LY.els[i].offsetTop;
  LY.manualY = y;
  lyMove(y, animate ? 'anim' : 'now');
}
function lyResume(delay = 2600) {
  clearTimeout(LY.timer);
  LY.timer = setTimeout(() => { LY.follow = true; $('#lyrics').classList.remove('manual'); layoutLyrics(true); }, delay);
}
function bindLyricsScroll() {
  const box = $('#lyrics');
  let ty = null, lastT = 0, vel = 0, inertia = 0, pending = null, raf = 0;
  const stopInertia = () => { cancelAnimationFrame(inertia); inertia = 0; };
  const flush = () => { raf = 0; if (pending != null) { lyMove(pending, 'now'); pending = null; } };
  const moveTo = (y) => { const b = lyBounds(); LY.manualY = clamp(y, b.min, b.max); pending = LY.manualY; if (!raf) raf = requestAnimationFrame(flush); };
  box.addEventListener('wheel', (e) => {
    if (!LY.els.length) return;
    e.preventDefault();
    stopInertia();
    LY.follow = false; box.classList.add('manual');
    moveTo(LY.manualY - e.deltaY);
    lyResume();
  }, { passive: false });
  box.addEventListener('touchstart', (e) => {
    if (!LY.els.length) return;
    stopInertia(); clearTimeout(LY.timer);
    ty = e.touches[0].clientY; lastT = performance.now(); vel = 0;
    if (!LY.follow) return;
    // starts from the current position, even mid-animation
    const m = new DOMMatrixReadOnly(getComputedStyle(LY.inner).transform);
    LY.manualY = m.m42;
  }, { passive: true });
  box.addEventListener('touchmove', (e) => {
    if (ty == null) return;
    const y = e.touches[0].clientY, now = performance.now(), d = y - ty;
    if (LY.follow) { LY.follow = false; box.classList.add('manual'); }
    vel = 0.8 * (d / Math.max(1, now - lastT)) + 0.2 * vel;
    ty = y; lastT = now;
    moveTo(LY.manualY + d);
  }, { passive: true });
  box.addEventListener('touchend', () => {
    if (ty == null) return;
    ty = null;
    if (LY.follow) return;
    // inertia on release
    let v = vel * 16, prevT = performance.now();
    const step = (now) => {
      const dt = Math.min(48, now - prevT) / 16; prevT = now;
      v *= Math.pow(0.94, dt);
      moveTo(LY.manualY + v * dt);
      if (Math.abs(v) > 0.3) inertia = requestAnimationFrame(step); else inertia = 0;
    };
    if (Math.abs(v) > 0.5) inertia = requestAnimationFrame(step);
    lyResume();
  });
  let rro = 0;
  new ResizeObserver(() => { cancelAnimationFrame(rro); rro = requestAnimationFrame(() => layoutLyrics(false)); }).observe(box);
}

// ===================== initial setup =====================
function runSetup() {
  return new Promise((resolve) => {
    const root = $('#setup');
    root.hidden = false;
    root.innerHTML = `<div class="setup-bg"><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div><div class="grain"></div></div>
      <div class="drag-strip drag"></div><div class="step-host"></div><div class="dots-nav">${'<i></i>'.repeat(5)}</div>`;
    updateChrome();
    const host = $('.step-host', root);
    const data = { name: '', dir: '' };
    let lib = null;
    const show = (idx, html, bind) => {
      $$('.dots-nav i', root).forEach((d, k) => d.classList.toggle('on', k === idx));
      const old = host.firstElementChild;
      const mount = () => {
        const st = h(`<div class="step in">${html}</div>`);
        host.replaceChildren(st);
        bind(st);
      };
      if (old) { old.classList.remove('in'); old.classList.add('out'); setTimeout(mount, 360); } else mount();
    };
    const welcome = () => show(0, `<div class="logo-big">${logoSVG()}</div>
      <h1>${T('Welcome to <b>rJuke')}</b></h1>
      <p>${T('Your personal jukebox: all your music, offline, with synced lyrics and playlists.')}</p>
      <div><button class="btn big" data-n>${T('Let\'s start')}</button></div>`, (st) => { $('[data-n]', st).addEventListener('click', askName); setTimeout(() => $('[data-n]', st).focus(), 300); });
    const askName = () => show(1, `<h1>${T('What\'s your name?')}</h1>
      <p>${T('I\'ll use your name to welcome you every time you open rJuke.')}</p>
      <input class="name-input" placeholder="Il tuo nome" maxlength="40" spellcheck="false" value="${esc(data.name)}">
      <div><button class="btn big" data-n disabled>${T('Continue')}</button></div>`, (st) => {
      const inp = $('input', st), btn = $('[data-n]', st);
      setTimeout(() => inp.focus(), 400);
      const upd = () => { btn.disabled = !inp.value.trim(); };
      inp.addEventListener('input', upd); upd();
      const go2 = () => { if (!inp.value.trim()) return; data.name = inp.value.trim().replace(/^./, (c) => c.toUpperCase()); askFolder(); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go2(); });
      btn.addEventListener('click', go2);
    });
    const askFolder = () => {
      let intro = T('Where do you keep your music? Choose the main folder: I\'ll read all the subfolders too.');
      let where = T('On the phone'), dirIcon = 'folder';
      show(2, `<h1>${T('Hi, <b>{0}</b>!', esc(data.name))}</h1>
      <p>${intro}</p>
      <div class="folder-box ${data.dir ? 'set' : ''}" data-pick><div class="fi">${icon(dirIcon)}</div><div><b>${data.dir ? T('Folder selected') : T('Choose a folder…')}</b><span>${esc(data.dir ? dirLabel(data.dir) : where)}</span></div></div>
      <div class="row-btns"><button class="btn big glass" data-b>${T('Back')}</button>${T('<button class="btn big" data-n {0}>Scan my music', data.dir ? '' : 'disabled')}</button></div>`, (st) => {
      $('[data-pick]', st).addEventListener('click', async () => {
        const d = await rj.pickFolder();
        if (d) { data.dir = d; askFolder(); }
      });
      $('[data-b]', st).addEventListener('click', askName);
      $('[data-n]', st).addEventListener('click', scan);
      });
    };
    const scan = () => show(3, `<div class="scan-vis">${'<span></span>'.repeat(7)}</div>
      <div class="scan-num">0</div><div class="scan-lbl">${T('Looking for your music…')}</div>
      <div class="scan-bar"><div></div></div><div class="scan-file"></div>`, async (st) => {
      $$('.scan-vis span', st).forEach((s, k) => { s.style.animationDelay = `${-k * 0.17}s`; s.style.animationDuration = `${0.8 + (k % 3) * 0.18}s`; });
      const num = $('.scan-num', st), lbl = $('.scan-lbl', st), bar = $('.scan-bar div', st), file = $('.scan-file', st);
      scanListener = (p) => {
        if (p.phase === 'walk') lbl.textContent = T('Exploring the folders…');
        if (p.phase === 'read') { num.textContent = nf.format(p.done); lbl.textContent = `${T('tracks read out of {0}', nf.format(p.total))}`; bar.style.width = (p.total ? p.done / p.total * 85 : 0) + '%'; file.textContent = p.current || ''; }
        if (p.phase === 'covers') { lbl.textContent = T('Preparing the album covers…'); bar.style.width = (85 + (p.total ? p.done / p.total * 15 : 15)) + '%'; file.textContent = ''; }
      };
      let pickName;
      try { lib = await rj.scan(data.dir, pickName); } catch (err) {
        lib = { tracks: [], covers: {} };
      }
      scanListener = null;
      bar.style.width = '100%';
      setTimeout(done, 500);
    });
    const done = () => {
      buildLibrary(lib);
      const n = S.tracks.length;
      let doneMsg = n ? T('Your library is ready. Do you have .m3u8 playlists? Show me the folder where you keep them and I\'ll find them myself, subfolders included.') : (data.err || T('I couldn\'t find any audio files in this folder. You can choose another one.'));
      let plBtns = T('<button class="btn big glass" data-i>Import a file…</button><button class="btn big glass" data-t>Find my playlists</button>');
      show(4, `<div class="logo-big">${logoSVG()}</div>
        <h1>${n ? `${T('All set, <b>{0}</b>!', esc(data.name))}` : T('No tracks found')}</h1>
        <p>${doneMsg}</p>
        ${n ? `<div class="done-stats"><div><b>${nf.format(n)}</b><span>${T('tracks')}</span></div><div><b>${nf.format(S.albums.length)}</b><span>${T('albums')}</span></div><div><b>${nf.format(S.artists.length)}</b><span>${T('artists')}</span></div></div>` : ''}
        <div class="row-btns">${n ? plBtns + T('<button class="btn big" data-n>Start listening</button>') : T('<button class="btn big" data-r>Choose another folder</button>')}</div>`, (st) => {
        const imp = $('[data-i]', st);
        if (imp) imp.addEventListener('click', async () => {
          const res = await rj.importPlaylists();
          if (res && res.length) {
            mergeFoundPlaylists(res.map((r) => ({ ...r, mtime: 0 })), { quiet: true });
            imp.textContent = `${plural(res.length, T('playlist imported'), T('playlists imported'))} ✓`;
          }
        });
        const tr = $('[data-t]', st);
        if (tr) tr.addEventListener('click', async () => {
          const r = await rj.pickPlaylistFolder(); if (!r) return;
          data.plTree = r.uri; data.plTreeName = r.name;
          tr.textContent = T('Looking for playlists…');
          let found = [];
          try { found = await rj.findPlaylists(r.uri); } catch { found = []; }
          mergeFoundPlaylists(found, { quiet: true });
          tr.textContent = found.length ? `${plural(found.length, T('playlist found'), T('playlists found'))} ✓` : T('No playlists in this folder');
        });
        const fin = $('[data-n]', st);
        if (fin) fin.addEventListener('click', async () => {
          let extra = {};
          S.settings = await rj.setSettings({ name: data.name, musicDir: data.dir, ...extra, theme: (S.settings && S.settings.theme) || 'system', setupDone: true, ...(data.plTree ? { plTree: data.plTree, plTreeName: data.plTreeName } : {}) });
          if (S.playlists.length) await savePlaylistsNow();
          root.style.transition = 'opacity .7s ease, transform .7s var(--ease)';
          root.style.opacity = '0'; root.style.transform = 'scale(1.04)';
          setTimeout(() => { root.hidden = true; root.innerHTML = ''; root.style.cssText = ''; updateChrome(); resolve(); }, 700);
        });
        const re = $('[data-r]', st);
        if (re) re.addEventListener('click', () => { data.dir = ''; askFolder(); });
      });
    };
    welcome();
  });
}

// ===================== scan =====================
let scanListener = null;
rj.onScanProgress((p) => {
  if (scanListener) scanListener(p);
  const pill = $('#scan-pill');
  if (S.scanning) {
    const pct = p.phase === 'read' && p.total ? Math.round(p.done / p.total * 90) : p.phase === 'covers' ? 90 + Math.round((p.total ? p.done / p.total : 1) * 10) : 0;
    $('.scan-txt', pill).textContent = p.phase === 'walk' ? T('Looking for new tracks…') : `${T('Updating library… {0}%', pct)}`;
    const sp = $('#set-prog');
    if (sp) { sp.hidden = false; $('div', sp).style.width = pct + '%'; }
  }
});
async function scanPlaylistFolder(quiet) {
  if (!S.settings || !S.settings.plTree) return 0;
  let found = [];
  try { found = await rj.findPlaylists(S.settings.plTree); } catch (e) {
    if (String(e && e.message).includes('no-access') && !quiet) toast(T('I no longer have access to the playlist folder: choose it again in Settings'));
    return 0;
  }
  return mergeFoundPlaylists(found, { quiet });
}
async function runScan(loud) {
  if (S.scanning || !S.settings || !S.settings.musicDir) return;
  S.lastScan = Date.now();
  S.scanning = true;
  $('#scan-pill').hidden = false;
  const before = S.tracks.map((t) => t.path + t.mtime).join('|');
  let lib = null;
  try { lib = await rj.scan(S.settings.musicDir, undefined, !!loud); } catch (e) {
    console.error(e);
  }
  S.scanning = false;
  $('#scan-pill').hidden = true;
  if (!lib) return;
  const after = lib.tracks.map((t) => t.path + t.mtime).join('|');
  const changed = before !== after || loud;
  if (changed) {
    const prevCount = S.tracks.length;
    buildLibrary(lib);
    renderSidebarPlaylists();
    if (S.view) rerender();
    updateLCD(false);
    const diff = S.tracks.length - prevCount;
    if (loud) toast(`${T('Library updated: {0}', plural(S.tracks.length, T('track'), T('tracks')))}`);
    else if (diff > 0) toast(`${T('{0} in your library', plural(diff, T('new track'), T('new tracks')))}`);
    else if (diff < 0) toast(-diff === 1 ? T('A track is no longer in your folder') : `${T('{0} tracks are no longer in your folder', -diff)}`);
  }
  if (lib.unchanged) {
    if ((lib.plChanged || S.playlists.some((p) => p.source && p.miss == null)) && await scanPlaylistFolder(true) && S.view && ['library', 'playlists', 'home', 'playlist'].includes(S.view.name)) rerender();
    return;
  }
  if (await scanPlaylistFolder(false) && S.view && ['library', 'playlists', 'home'].includes(S.view.name)) rerender();
}

// ===================== startup =====================
function bindScrolled() {
  const c = content(); let raf = 0;
  const upd = () => { raf = 0; document.body.classList.toggle('scrolled', c.scrollTop > 6); };
  c.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(upd); }, { passive: true });
  new MutationObserver(() => requestAnimationFrame(upd)).observe(c, { childList: true });
}
function bindChrome() {
  bindScrolled();
  $('.search-i').innerHTML = icon('search');
  $$('.nav-item[data-icon]').forEach((a) => a.insertAdjacentHTML('afterbegin', icon(a.dataset.icon)));
  $('#tb-next').innerHTML = icon('next');
  $('#np-prev').innerHTML = icon('prev'); $('#np-next').innerHTML = icon('next');
  $('#np-close').innerHTML = icon('down'); $('#np-more').innerHTML = icon('more');

  // bottom tabs
  $('#nav').addEventListener('click', (e) => {
    const a = e.target.closest('.nav-item'); if (!a) return;
    rj.haptic('tick');
    if (S.tab === a.dataset.view && S.history.length === 0 && a.dataset.view !== 'search') { content().scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (a.dataset.view === 'search') { go('search', $('#search').value.trim()); setTimeout(() => $('#search').focus(), 350); return; }
    go(a.dataset.view);
  });

  // search
  const si = $('#search');
  const doSearch = debounce(() => {
    const q = si.value.trim();
    // the animation starts only when you begin typing (or clear the field); on the following letters the results update in place (bug #27)
    if (!q && !(S.view && S.view.name === 'search')) return; // meanwhile the user went somewhere else
    if (S.view && S.view.name === 'search') { const was = !!(S.view.param || '').trim(); S.view.param = q; render({ noAnim: was && !!q }); }
    else go('search', q);
  }, 160);
  si.addEventListener('input', doSearch);
  si.addEventListener('keydown', (e) => { if (e.key === 'Enter') si.blur(); });
  $('#search-clear').innerHTML = icon('close');
  $('#search-clear').addEventListener('click', () => { si.value = ''; doSearch(); si.focus(); });

  // controls
  const on = (id, fn) => $(id).addEventListener('click', fn);
  const ripple = (e) => { const b = e.currentTarget; b.classList.remove('ripple'); void b.offsetWidth; b.classList.add('ripple'); };
  on('#tb-play', (e) => { e.stopPropagation(); ripple(e); togglePlay(); });
  on('#np-play', (e) => { ripple(e); togglePlay(); });
  on('#tb-next', (e) => { e.stopPropagation(); next(); }); on('#np-next', () => next());
  on('#np-prev', prev);
  on('#np-shuffle', toggleShuffle);
  on('#np-repeat', cycleRepeat);
  on('#lcd', () => openNP());
  on('#np-close', closeNP);
  on('#np-lyrics-toggle', () => { rj.haptic('tick'); S.npMode = S.npMode === 'lyrics' ? null : 'lyrics'; applyNPMode(); });
  on('#np-queue-toggle', () => { rj.haptic('tick'); S.npMode = S.npMode === 'queue' ? null : 'queue'; applyNPMode(); });
  $('#np-connect').innerHTML = `${T('{0}Devices', icon('cast'))}`;
  on('#np-connect', (e) => { const r = e.currentTarget.getBoundingClientRect(); connectMenu(r.left, r.top - 8); });
  on('#np-artist', () => { const t = cur(); if (!t) return; closeNP(); go('album', t.albumKey); });
  on('#np-more', (e) => { const t = cur(); if (!t) return; trackMenu(t, 0, 0); });
  bindQueue($('#np-queue'));
  bindNPSwipe();
  bindMiniSwipe();

  const seekMove = (x) => { seekPreview = x; };
  const seekEnd = (x) => { seekPreview = null; rj.haptic('tick'); if (audio.duration) seekTo(x * audio.duration); };
  bindSlider($('#np-bar'), seekMove, seekEnd);

  bindLongPress();
  window.CapApp.addListener('backButton', onBack);
  // new music is looked for at startup, when the app is reopened and with “Refresh library”
  window.CapApp.addListener('resume', () => {
    let wait = 15 * 60 * 1000;
    if (S.settings && Date.now() - (S.lastScan || 0) > wait) runScan(false);
  });
  rj.onThemeChanged((dark) => { S.info.dark = dark; applyTheme(); });
  bindLyricsScroll();
  window.addEventListener('resize', () => updateNav());
}

function onBack() {
  if (window.cancelLongPress) cancelLongPress();
  if ($('.modal-back')) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return; }
  if ($('.sheet-back')) { closeMenus(); return; }
  if (window.connectClose && connectClose()) return;
  if (S.npOpen) { closeNP(); return; }
  if (document.activeElement === $('#search')) { $('#search').blur(); return; }
  if (S.history.length) { goBack(); return; }
  if (S.tab !== 'home') { go('home'); return; }
  window.Juke.moveToBack();
}

// long press = context menu
function bindLongPress() {
  let lp = null;
  const SEL = '.tr, .card, .q-item, #lcd, .pl-row';
  document.addEventListener('touchstart', (e) => {
    const t = e.target.closest(SEL);
    if (!t || e.target.closest('.sheet-back, .np-bar') || e.touches.length > 1) return;
    const p = e.touches[0];
    // the screen edges belong to Android's “Back” gesture: no long press there (bug #13)
    if (p.clientX < 28 || p.clientX > innerWidth - 28) return;
    lp = { t, x: p.clientX, y: p.clientY, fired: false };
    t.classList.add('pressing');
    const mine = lp;
    lp.timer = setTimeout(() => {
      if (lp !== mine || !t.isConnected || document.hidden) return;
      lp.fired = true;
      t.classList.remove('pressing');
      t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: lp.x, clientY: lp.y }));
    }, 450);
  }, { passive: true });
  const cancel = () => { if (lp) { clearTimeout(lp.timer); lp.t.classList.remove('pressing'); } };
  document.addEventListener('touchmove', (e) => {
    if (!lp) return;
    const p = e.touches[0];
    if (Math.abs(p.clientX - lp.x) + Math.abs(p.clientY - lp.y) > 12) { cancel(); lp = null; }
  }, { passive: true });
  const abort = () => { if (lp) { cancel(); lp = null; } };
  window.cancelLongPress = abort;
  document.addEventListener('touchcancel', abort, { passive: true });
  document.addEventListener('scroll', abort, { passive: true, capture: true });
  document.addEventListener('visibilitychange', abort);
  window.addEventListener('blur', abort);
  document.addEventListener('touchend', () => {
    if (!lp) return;
    cancel();
    if (lp.fired) {
      const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      document.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', stop, { capture: true }), 400);
    }
    lp = null;
  });
  document.addEventListener('contextmenu', (e) => { if (e.isTrusted) { e.preventDefault(); e.stopPropagation(); } }, true);
  // mini player menu
  $('#lcd').addEventListener('contextmenu', (e) => { const t = cur(); if (t) { e.preventDefault(); trackMenu(t, 0, 0); } });
}

// drag down to close Now Playing
function bindNPSwipe() {
  const np = $('#np');
  let y0 = null, x0 = 0, dy = 0, t0 = 0, active = false;
  np.addEventListener('touchstart', (e) => {
    if (e.target.closest('.np-right, .np-bar, button')) { y0 = null; return; }
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; dy = 0; t0 = performance.now(); active = false;
  }, { passive: true });
  np.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const d = e.touches[0].clientY - y0;
    if (!active && Math.abs(e.touches[0].clientX - x0) > Math.abs(d)) { y0 = null; return; }
    if (d > 6) active = true;
    if (!active) return;
    dy = Math.max(0, d);
    np.style.transition = 'none';
    np.style.transform = `translateY(${dy}px)`;
    np.style.borderRadius = Math.min(28, dy / 6) + 'px';
  }, { passive: true });
  np.addEventListener('touchend', () => {
    if (y0 == null || !active) { y0 = null; return; }
    const v = dy / Math.max(1, performance.now() - t0);
    np.style.transition = ''; np.style.borderRadius = '';
    if (dy > 140 || v > 0.6) { np.style.transform = ''; closeNP(true); }
    else np.style.transform = '';
    y0 = null;
  });
}
// swipe the mini player to change track, up to open it
function bindMiniSwipe() {
  const el = $('#lcd');
  let x0 = null, y0 = 0, dx = 0;
  el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (x0 == null) return;
    dx = e.touches[0].clientX - x0;
    const dy = e.touches[0].clientY - y0;
    if (dy < -40 && Math.abs(dy) > Math.abs(dx)) { x0 = null; el.querySelector('.lcd-mid').style.transform = ''; openNP(); return; }
    el.querySelector('.lcd-mid').style.transform = `translateX(${dx * 0.6}px)`;
    el.querySelector('.lcd-mid').style.opacity = 1 - Math.min(0.7, Math.abs(dx) / 260);
  }, { passive: true });
  el.addEventListener('touchend', () => {
    if (x0 == null) return;
    const mid = el.querySelector('.lcd-mid');
    mid.style.transform = ''; mid.style.opacity = '';
    if (dx < -70) next(); else if (dx > 70) prev();
    x0 = null;
  });
}

// music folder choice
async function pickMusicFolder() {
  const perm = await window.rjEnsurePermission();
  let data;
  try { data = perm ? await rj.musicFolders() : { total: 0, folders: [] }; } catch { data = { total: 0, folders: [] }; }
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; closeMenus(); resolve(v); };
    const rel = (d) => d.replace(/^\/storage\/emulated\/\d+\/?/, '').replace(/^\/storage\/([^/]+)\/?/, T('SD card ·') + ' ') || T('Internal storage');
    const list = data.folders.filter((f) => f.depth <= 2).sort((x, y) => x.dir.localeCompare(y.dir));
    const head = `<div class="sheet-title">${T('Where do you keep your music?')}<span>${T('Subfolders are included')}</span></div>`;
    const items = [];
    if (perm) items.push({ label: `${T('All the music on the phone · {0}', plural(data.total, T('track'), T('tracks')))}`, icon: 'sparkle', action: () => finish('*') }, { sep: true });
    for (const f of list) items.push({ label: `${f.depth === 2 ? '   ' : ''}${rel(f.dir)} · ${nf.format(f.count)}`, icon: 'folder', action: () => finish(f.dir) });
    if (!perm) items.push({ label: T('Music on the phone: permission needed (Android settings)'), icon: 'warn', disabled: true });
    else if (!data.total) items.push({ label: T('No tracks found on the phone'), icon: 'note', disabled: true });
    showMenu(items, 0, 0, { header: head });
    const back = $('.sheet-back');
    const obs = new MutationObserver(() => { if (!back.isConnected || back.classList.contains('out')) { obs.disconnect(); finish(null); } });
    obs.observe(back, { attributes: true });
    obs.observe($('#menu-root'), { childList: true });
  });
}

// music folder label
function dirLabel(d, name) {
  return d === '*' ? T('All the music on the phone') : (d || '');
}

const dlBtnHTML = () => '';
const dlMenuItem = () => [];
window.rjPickFolder = pickMusicFolder;

function applyName() {
  const n = nm();
  $('#search').placeholder = n ? `${T('Find something, {0}', n)}` : T('Search');
  sendPlayerState();
}

function showSplash() {
  const n = nm();
  const bday = isBirthday();
  const words = (bday ? T('Happy birthday,') : T('Welcome back,')).split(' ');
  const el = h(`<div class="splash"><div class="splash-glow"></div><div class="splash-logo">${logoSVG()}</div>
    <div class="splash-title">${words.map((w, i) => `<span class="w" style="--i:${i}">${esc(w)} </span>`).join('')}<span class="w name" style="--i:${words.length}">${esc(n)}</span>${bday ? `<span class="w" style="--i:${words.length + 1}"> 🎂</span>` : ''}</div>
    <div class="splash-sub">${T('{0}! Your music is ready.', esc(greeting().hi))}</div></div>`);
  document.body.appendChild(el);
  el.addEventListener('click', () => el.classList.add('out'));
  return () => { el.classList.add('out'); setTimeout(() => el.remove(), 800); };
}

function confetti() {
  const cv = h('<canvas class="confetti"></canvas>');
  document.body.appendChild(cv);
  const dpr = devicePixelRatio || 1;
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const cols = ['#a2f7a1', '#2fbf71', '#ffd166', '#ff7aa2', '#7ab8ff', '#ffffff', '#c2fbc0'];
  const P = Array.from({ length: 170 }, () => ({
    x: innerWidth * (0.25 + Math.random() * 0.5), y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 15 - 5,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
    w: 6 + Math.random() * 7, hh: 4 + Math.random() * 5, c: cols[(Math.random() * cols.length) | 0],
  }));
  const t0 = performance.now();
  const step = (now) => {
    const el = now - t0;
    g.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of P) {
      p.vy += 0.38; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.globalAlpha = Math.max(0, 1 - el / 3800);
      g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.hh / 2, p.w, p.hh * Math.abs(Math.cos(p.r * 2))); g.restore();
    }
    if (el < 3800) requestAnimationFrame(step); else cv.remove();
  };
  requestAnimationFrame(step);
}

function bindTilt() {
  if (matchMedia('(hover: none)').matches) return;
  const c = content();
  let card = null, raf = 0, ev = null;
  const reset = (cd) => {
    cd.classList.remove('tilting');
    const w = $('.art-wrap', cd);
    if (w) ['--rx', '--ry', '--mx', '--my'].forEach((p) => w.style.removeProperty(p));
  };
  c.addEventListener('pointermove', (e) => {
    const cd = e.target.closest('.card');
    if (cd !== card) { if (card) reset(card); card = cd; if (card) card.classList.add('tilting'); }
    if (!card) return;
    ev = e;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!card) return;
      const w = $('.art-wrap', card); if (!w) return;
      const r = w.getBoundingClientRect();
      const x = clamp((ev.clientX - r.left) / r.width, 0, 1), y = clamp((ev.clientY - r.top) / r.height, 0, 1);
      w.style.setProperty('--ry', ((x - 0.5) * 16).toFixed(2) + 'deg');
      w.style.setProperty('--rx', ((0.5 - y) * 16).toFixed(2) + 'deg');
      w.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
      w.style.setProperty('--my', (y * 100).toFixed(1) + '%');
    });
  }, { passive: true });
  c.addEventListener('pointerleave', () => { if (card) reset(card); card = null; });
}

async function boot() {
  S.info = await rj.info();
  if (S.info.mica) document.documentElement.classList.add('mica');
  S.settings = await rj.getSettings();
  // the language chosen in Settings: the interface was drawn with the one saved last time, redraw if it changed
  if (((S.settings && S.settings.lang) || 'auto') !== I18N.pref) {
    I18N.setLang((S.settings && S.settings.lang) || 'auto');
    let again = false;
    try { again = !sessionStorage.getItem('rj.relang'); sessionStorage.setItem('rj.relang', '1'); } catch { /* */ }
    if (again) { location.reload(); return; }
  }
  applyTheme();
  bindChrome();
  bindTilt();
  updateModeButtons();
  const needSetup = !S.settings || !S.settings.setupDone || !S.settings.musicDir;
  const t0 = performance.now();
  const hideSplash = needSetup ? null : showSplash();
  S.playlists = (await rj.getPlaylists()) || [];
  S.plMap = new Map(S.playlists.map((p) => [p.id, p]));

  let fresh = false;
  if (!S.settings || !S.settings.setupDone || !S.settings.musicDir) {
    await runSetup();
    fresh = true;
    S.plMap = new Map(S.playlists.map((p) => [p.id, p]));
  } else {
    const lib = await rj.loadLibrary();
    if (lib) buildLibrary(lib);
    else {
      buildLibrary({ tracks: [], covers: {} });
    }
  }
  bindNative();
  await restoreState();
  updatePlayState();
  updateModeButtons();
  updateLCD(false);
  if (!S.queue.length) updateLCD(false);
  renderSidebarPlaylists();
  applyName();
  if (hideSplash) await new Promise((r) => setTimeout(r, Math.max(0, 1500 - (performance.now() - t0))));
  const app = $('#app');
  app.hidden = false;
  app.classList.add('ready');
  go('home', null, { vt: false });
  if (hideSplash) hideSplash();
  requestAnimationFrame(progressLoop);
  setTimeout(connectInit, 900);
  // PartyBox started or stopped from the Android Auto buttons
  if (rj.onAuto) rj.onAuto((cmd) => { if (cmd === 'party-start') partyStart({ auto: true }); else if (cmd === 'party-stop' && PB.on) partyStop(); });
  if (!fresh) setTimeout(() => runScan(false), S.tracks.length ? 1500 : 0);
  else S.lastScan = Date.now();
}
// started by loader.js when all the scripts are loaded
window.rjBoot = boot;
