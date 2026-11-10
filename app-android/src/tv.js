'use strict';
/* rJuke for Android TV — UI designed for the remote (arrows, OK, Back) */

// ===================== utilities =====================
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const coll = new Intl.Collator('it', { sensitivity: 'base', numeric: true });
const sortName = (s) => String(s || '').replace(/^(the|il|lo|la|i|gli|le)\s+/i, '');
const nf = new Intl.NumberFormat(loc());
// «3 tracks» — a word repeated identical in English carries a «#n» mark for the plural (e.g. «skipped#n»)
const plural = (n, one, many) => `${nf.format(n)} ${(n === 1 ? one : many).replace(/#n$/, "")}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fmtLong(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return m === 1 ? T('1 minute') : `${T('{0} minutes', m)}`;
  const hh = Math.floor(m / 60), mm = m % 60;
  return `${hh === 1 ? T('1 hour') : hh + ' ore'}${mm ? ` ${T('and {0} min', mm)}` : ''}`;
}
function hashStr(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
function seeded(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffled(arr, rnd = Math.random) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const store = {
  get(k, d) { try { const v = localStorage.getItem('rjtv.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rjtv.' + k, JSON.stringify(v)); } catch { /* */ } },
};
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
  const out = rest.split(/\s*(?:,|;|\s\/\s|\s+(?:feat\.?|ft\.?|featuring)\s+)\s*/i).map((x) => x.replace(/\u0001/g, () => keep[k++] || '').trim()).filter(Boolean);
  const seen = new Set();
  return out.filter((x) => { const n = norm(x); if (seen.has(n)) return false; seen.add(n); return true; });
}
const imgSrc = (p) => (!p ? '' : /^https?:\/\//.test(p) ? p : window.rjFileSrc(p));
function phStyle(key) {
  const r = seeded(hashStr(String(key || 'x')));
  const hue = Math.floor(r() * 360);
  return `background:linear-gradient(135deg,hsl(${hue} 42% 34%),hsl(${(hue + 40) % 360} 46% 18%))`;
}
// covers: those of another device are downloaded natively (and kept on the TV),
// and all of them load only when they come into view: no freezes with big libraries
const isRemote = (p) => /^https?:\/\//.test(p || '');
function imgAttrs(p) {
  if (!p) return '';
  return isRemote(p) ? `data-rs="${esc(p)}"` : `src="${esc(imgSrc(p))}"`;
}
// blurred background: underneath there's always a gradient with the cover's colors,
// which stays alone on low-powered TVs (light mode: no blur)
function bgAttrs(cover, key) {
  const c = cover && cover.colors;
  const base = c && c[0] ? `background:linear-gradient(135deg,${c[0]},${c[1] || c[0]} 60%,#0b0e0c)` : phStyle(key);
  const p = cover && cover.l;
  if (!p || LITE.on) return ` style="${base}"`;
  return isRemote(p) ? ` style="${base}" data-rbg="${esc(p)}"` : ` style="${base};background-image:url('${esc(imgSrc(p))}')"`;
}
// low-powered TVs: no blur or heavy animations. It turns on by itself if the TV struggles
const LITE = { on: true, slow: 0 };
function liteSet(on, save) {
  LITE.on = on;
  const tv = $('#tv'); if (tv) tv.classList.toggle('lite', on);
  if (save && rj.setSettings) rj.setSettings({ lite: on }).then((st) => { S.settings = st; }).catch(() => {});
}
// on the TV the effects are always the light ones: no blur or heavy animations
function liteInit() { liteSet(true, false); }
const IMG = { mem: new Map() };
function imgKey(u) {
  try { const x = new URL(u); x.searchParams.delete('t'); return `${(S.settings.phone && S.settings.phone.id) || x.host}${x.pathname}?${x.searchParams}`; } catch { return u; }
}
function remoteSrc(u) {
  const k = imgKey(u);
  let p = IMG.mem.get(k);
  if (p) return p;
  const J = window.Juke;
  p = J && J.coverGet
    ? J.coverGet({ url: u, key: k }).then((r) => (r && r.file ? window.rjFileSrc(r.file) : null)).catch(() => null)
    : Promise.resolve(u);
  IMG.mem.set(k, p);
  p.then((v) => { if (!v) setTimeout(() => IMG.mem.delete(k), 20000); });
  return p;
}
function imgLoad(el) {
  const img = el.tagName === 'IMG';
  const u = img ? el.dataset.rs : el.dataset.rbg;
  if (!u) return;
  remoteSrc(u).then((src) => {
    if (!el.isConnected && !el.closest) return;
    if (!src) { if (img && el.parentNode) el.parentNode.classList.add('noimg'); return; }
    if (img) el.src = src;
    else { const pre = new Image(); pre.onload = () => { el.style.backgroundImage = `url("${src}")`; el.classList.add('ld'); }; pre.src = src; }
  });
}
const imgIO = 'IntersectionObserver' in window
  ? new IntersectionObserver((ents) => { for (const e of ents) if (e.isIntersecting) { imgIO.unobserve(e.target); imgLoad(e.target); } }, { rootMargin: '30% 25%' })
  : null;
function imgWatch(root) {
  if (!root || root.nodeType !== 1) return;
  const list = root.matches('[data-rs],[data-rbg]') ? [root] : [];
  list.push(...root.querySelectorAll('[data-rs],[data-rbg]'));
  for (const el of list) { if (el.__w) continue; el.__w = 1; if (imgIO) imgIO.observe(el); else imgLoad(el); }
}
new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) imgWatch(n); }).observe(document.documentElement, { childList: true, subtree: true });

function artHTML(cover, key, { size = 's', round = false, glyph = 'note' } = {}) {
  const p = cover ? (size === 'l' ? cover.l : cover.s) : '';
  return p
    ? `<div class="art${round ? ' round' : ''}" style="${phStyle(key)}"><img ${imgAttrs(p)} alt="" decoding="async" onload="this.classList.add('ld')" onerror="this.parentNode.classList.add('noimg')"></div>`
    : `<div class="art ph${round ? ' round' : ''}" style="${phStyle(key)}">${icon(glyph)}</div>`;
}

// ===================== state =====================
const S = {
  info: {}, settings: {}, tracks: [], byPath: new Map(), albums: [], albumMap: new Map(), artists: [], artistMap: new Map(),
  playlists: [], plMap: new Map(), queue: [], original: null, qi: -1, ctx: null, shuffle: false, repeat: 'off', playing: false,
  recent: [], lyrics: null, stack: [], view: null, npOpen: false,
};
window.S = S;
const cur = () => S.queue[S.qi] || null;
const nm = () => S.settings.name || '';
const tvAutoName = () => (nm() ? `${T('{0}\'s TV', nm())}` : 'TV');
const tvName = () => String(S.settings.connectName || '').trim() || tvAutoName();
const tvIcon = () => (DEVICE_ICONS.some(([k]) => k === S.settings.connectIcon) ? S.settings.connectIcon : '');
const tvMe = () => {
  const me = { id: S.settings.deviceId, name: tvName(), icon: tvIcon() };
  return me;
};
async function tvAnnounce() {
  if (!S.settings.deviceId) return;
  RC.me = tvMe();
  if (RC.started) { try { await rj.connectStart(RC.me); } catch { /* */ } }
}

function buildLibrary(lib) {
  const covers = lib.covers || {};
  const tracks = (lib.tracks || []).map((t) => ({ ...t }));
  const albumMap = new Map();
  for (const t of tracks) {
    let a = albumMap.get(t.albumKey);
    if (!a) { a = { key: t.albumKey, title: t.album || T('Unknown album'), tracks: [], cover: covers[t.albumKey] || null, year: null, added: 0, duration: 0, aa: '' }; albumMap.set(t.albumKey, a); }
    a.tracks.push(t);
    if (t.albumArtist && !a.aa) a.aa = t.albumArtist;
    if (t.year && (!a.year || t.year > a.year)) a.year = t.year;
    a.added = Math.max(a.added, t.added || 0);
    a.duration += t.duration || 0;
    t.album_ = a; t.cover = a.cover;
  }
  const albums = [...albumMap.values()];
  for (const a of albums) {
    a.tracks.sort((x, y) => (x.disc || 1) - (y.disc || 1) || (x.track || 999) - (y.track || 999) || coll.compare(x.title, y.title));
    const ars = new Set(a.tracks.map((t) => t.artist));
    a.artist = a.aa || (ars.size === 1 ? a.tracks[0].artist : T('Various artists'));
    a.s = norm(a.title + ' ' + a.artist);
  }
  albums.sort((a, b) => coll.compare(sortName(a.title), sortName(b.title)));
  const artistMap = new Map();
  const getA = (name) => { const k = norm(name); let ar = artistMap.get(k); if (!ar) { ar = { key: k, name, albums: [], tracks: [] }; artistMap.set(k, ar); } return ar; };
  for (const a of albums) if (a.artist !== T('Various artists')) for (const n of splitArtists(a.artist)) getA(n).albums.push(a);
  for (const t of tracks) for (const n of splitArtists(t.artist)) { const ar = getA(n); ar.tracks.push(t); if (!ar.albums.includes(t.album_) && !ar.appears) ar.appears = []; if (!ar.albums.includes(t.album_)) { if (!ar.appears.includes(t.album_)) ar.appears.push(t.album_); } }
  const artists = [...artistMap.values()];
  for (const ar of artists) {
    ar.appears = ar.appears || [];
    ar.albums.sort((x, y) => (y.year || 0) - (x.year || 0));
    const wc = ar.albums.find((x) => x.cover) || ar.appears.find((x) => x.cover);
    ar.cover = wc ? wc.cover : null;
    ar.s = norm(ar.name);
  }
  artists.sort((a, b) => coll.compare(sortName(a.name), sortName(b.name)));
  for (const t of tracks) t.s = norm(`${t.title} ${t.artist} ${t.album_.title}`);
  S.tracks = tracks; S.byPath = new Map(tracks.map((t) => [t.path, t]));
  S.albums = albums; S.albumMap = albumMap; S.artists = artists; S.artistMap = artistMap;
  S.queue = S.queue.map((t) => S.byPath.get(t.path)).filter(Boolean);
  if (S.original) S.original = S.original.map((t) => S.byPath.get(t.path)).filter(Boolean);
  if (S.qi >= S.queue.length) S.qi = S.queue.length - 1;
}
function setPlaylists(list) {
  S.playlists = list || [];
  S.plMap = new Map(S.playlists.map((p) => [p.id, p]));
}
const plTracks = (p) => p.paths.map((x) => S.byPath.get(x)).filter(Boolean);

// ===================== music from another device (phone or PC) =====================
const PH = { online: null, busy: false, pending: false, timer: 0, stamp: '', cached: new Map(), fetching: new Set(), lyrics: new Map() };
const phoneMode = () => !!(S.settings.source === 'phone' && S.settings.phone && S.settings.phone.token);
const phoneDev = () => S.settings.phone;
const phoneName = () => (S.settings.phone && S.settings.phone.name) || T('The phone');
function phoneUrl(kind, q, d = phoneDev()) { return `http://${d.host}:${d.port}/rj/lib/${kind}?${new URLSearchParams({ t: d.token, ...q })}`; }
const phoneKey = (t) => `${t.path}|${t.mtime || 0}|${t.size || 0}`;
const phoneIsCached = (t) => phoneMode() && PH.cached.has(phoneKey(t));
function phoneLibFrom(idx, d = phoneDev()) {
  const covers = {};
  for (const [k, c] of Object.entries((idx && idx.covers) || {})) if (c) covers[k] = { colors: c.colors || null, s: phoneUrl('cover', { a: k, size: 's' }, d), l: phoneUrl('cover', { a: k, size: 'l' }, d) };
  return { tracks: ((idx && idx.tracks) || []).map((t) => ({ ...t, remote: true })), covers };
}
async function phoneSaveIndex(idx) {
  const index = { tracks: idx.tracks || [], covers: idx.covers || {}, playlists: idx.playlists || [] };
  PH.stamp = idx.stamp || '';
  await Juke.saveText({ name: 'phone-library.json', text: JSON.stringify({ id: phoneDev().id, stamp: PH.stamp, index }) });
  return index;
}
async function phoneLoadIndex() {
  try { const { text } = await Juke.loadText({ name: 'phone-library.json' }); const j = text ? JSON.parse(text) : null; return j || null; } catch { return null; }
}
function phoneApplyIndex(index) {
  buildLibrary(phoneLibFrom(index));
  setPlaylists((index.playlists || []).map((p) => ({ id: 'ph_' + p.id, name: p.name, paths: p.paths || [] })));
}
async function phoneCacheRefresh() { try { const r = await Juke.pcacheList(); PH.cached = new Map(Object.entries((r && r.map) || {})); } catch { /* */ } }
function phoneSchedule(ms) { clearTimeout(PH.timer); PH.timer = setTimeout(() => phoneSync(), ms); }
async function phoneSync({ loud = false } = {}) {
  if (!phoneMode() || PH.busy) return false;
  if (!RC.started) { phoneSchedule(1500); return false; }
  PH.busy = true; srcUI();
  const p = phoneDev();
  const cands = [];
  const live = RC.devices.get(p.id);
  if (live) cands.push({ host: live.host, port: live.port });
  if (!cands.some((c) => c.host === p.host && c.port === p.port)) cands.push({ host: p.host, port: p.port });
  // device reinstalled: new code, same name
  for (const d of RC.devices.values()) if (d.id !== p.id && d.name === p.name && !cands.some((c) => c.host === d.host && c.port === d.port)) cands.push({ host: d.host, port: d.port });
  let res = null, used = null, pending = false, newId = p.id;
  for (const c of cands) {
    try {
      const info = await rc(c, '/rj/info', { timeout: 4000 });
      if (info.id !== p.id && !(info.name && info.name === p.name)) continue;
      used = c; newId = info.id;
      res = await rc(c, `/rj/lib/index${PH.stamp ? '?since=' + encodeURIComponent(PH.stamp) : ''}`, { timeout: 45000 });
      break;
    } catch (e) { if (e.pending) { pending = true; break; } if (used) break; }
  }
  PH.busy = false;
  if (!res) {
    PH.online = false; PH.pending = pending; srcUI();
    phoneSchedule(pending ? 4000 : 15000);
    if (loud) toast(pending ? `${T('On {0} tap “Allow”', phoneName())}` : `${T('{0} isn\'t responding. Keep rJuke open, on the same Wi‑Fi as the TV.', phoneName())}`, 'err');
    return false;
  }
  const moved = used.host !== p.host || used.port !== p.port || (res.token && res.token !== p.token);
  S.settings = await rj.setSettings({ phone: { ...p, id: newId, host: used.host, port: used.port, name: res.name || p.name, token: res.token || p.token } });
  if (newId !== p.id) { PH.lyrics.clear(); toast(`${T('Connected again to {0}', phoneName())}`); }
  PH.online = true; PH.pending = false;
  if (!res.same) {
    const prev = S.tracks.length;
    phoneApplyIndex(await phoneSaveIndex(res));
    refreshView();
    if (loud) toast(`${T('Library updated: {0}', plural(S.tracks.length, T('track'), T('tracks')))}`);
    else if (prev && S.tracks.length > prev) toast(`${plural(S.tracks.length - prev, T('new track'), T('new tracks'))} da ${phoneName()}`);
  } else {
    if (moved) { for (const a of S.albums) if (a.cover) { a.cover.s = phoneUrl('cover', { a: a.key, size: 's' }); a.cover.l = phoneUrl('cover', { a: a.key, size: 'l' }); } refreshView(); }
    if (loud) toast(T('The library is already up to date'));
  }
  srcUI();
  phoneSchedule(60000);
  return true;
}
async function phonePrefetch(i) {
  if (!phoneMode()) return;
  const list = [S.queue[i], S.queue[i + 1], S.queue[i + 2]].filter((t) => t && t.remote && !phoneIsCached(t));
  for (const t of list) {
    if (PH.online === false) break;
    const key = phoneKey(t);
    if (PH.fetching.has(key)) continue;
    PH.fetching.add(key);
    let f = null;
    try { const r = await Juke.pcacheFetch({ url: phoneUrl('file', { p: t.path }), key, ext: (t.path.split('.').pop() || 'bin').toLowerCase() }); f = r && r.file; } catch { f = null; }
    PH.fetching.delete(key);
    if (f) {
      PH.cached.set(key, f);
      // track just arrived on the TV: if it's the one playing and the lyrics were missing, I read them from the file
      const c = cur();
      if (c && phoneKey(c) === key && !S.lyrics) { PH.lyrics.delete(key); loadLyrics(c); }
    }
  }
}
async function phoneLyrics(t) {
  const key = phoneKey(t);
  if (PH.lyrics.has(key)) return PH.lyrics.get(key);
  let data = null;
  // track already on the TV: I read the lyrics from the file, even if the device is off or locked
  if (PH.cached.has(key)) { try { data = await rj.lyrics(PH.cached.get(key)); } catch { data = null; } }
  if (!data) {
    try {
      const d = await rc(phoneDev(), `/rj/lib/lyrics?${new URLSearchParams({ t: phoneDev().token, p: t.path })}`, { timeout: 6000 });
      data = d && Object.keys(d).length ? d : null;
    } catch { data = undefined; }
  }
  if (data !== undefined) PH.lyrics.set(key, data);
  // if the track isn't on the TV yet, I retry the lyrics when it arrives (see phonePrefetch)
  if (!data && !PH.cached.has(key)) PH.lyrics.delete(key);
  return data || null;
}

// ===================== playback (native player) =====================
const J = window.Juke;
const NP = { pos: 0, at: 0, dur: 0, playing: false };
const jcall = (p) => p.catch((e) => console.warn('[juke]', e && e.message));
const posSec = () => Math.max(0, (NP.pos + (NP.playing ? performance.now() - NP.at : 0)) / 1000);
const durSec = () => (NP.dur ? NP.dur / 1000 : (cur() ? cur().duration : 0) || 0);
function setPos(ms) { NP.pos = ms; NP.at = performance.now(); }
let seekGuard = 0;
function itemFor(t) {
  let uri = t.uri;
  if (t.remote) { const f = PH.cached.get(phoneKey(t)); uri = f ? 'file://' + f : phoneUrl('file', { p: t.path }); }
  return { id: t.path, uri, title: t.title, artist: t.artist, album: t.album_.title, art: t.cover ? t.cover.l : '', dur: Math.round((t.duration || 0) * 1000) };
}
function pushQueue(play = true, positionMs = 0) {
  setPos(positionMs); NP.dur = (cur() ? cur().duration : 0) * 1000;
  NP.playing = play; playStateUI();
  return jcall(J.loadQueue({ items: S.queue.map(itemFor), index: Math.max(0, S.qi), positionMs, play }));
}
function playList(list, start = 0, { shuffle = null, ctx = null } = {}) {
  if (!list.length) return;
  S.ctx = ctx;
  if (shuffle !== null) S.shuffle = shuffle;
  S.original = list.slice();
  const prevT = cur();
  if (S.shuffle) {
    const first = shuffle === true && start === 0 ? Math.floor(Math.random() * list.length) : start;
    S.queue = [list[first], ...shuffled(list.filter((_, k) => k !== first))];
    S.qi = 0;
  } else { S.queue = list.slice(); S.qi = start; }
  pushQueue(true);
  onTrackChange(prevT !== cur());
  if (ctx) pushRecent(ctx);
  saveState();
}
function loadTrack(i, autoplay = true) {
  if (i < 0 || i >= S.queue.length) return;
  const prevT = cur();
  S.qi = i;
  setPos(0); NP.dur = (cur().duration || 0) * 1000;
  if (autoplay) { NP.playing = true; playStateUI(); }
  jcall(J.skipTo({ index: i, play: autoplay }));
  onTrackChange(prevT !== cur());
}
function togglePlay() {
  if (!cur()) { if (S.tracks.length) playList(S.tracks, 0, { shuffle: true }); return; }
  if (NP.playing) { setPos(posSec() * 1000); NP.playing = false; playStateUI(); jcall(J.pause()); }
  else { NP.playing = true; setPos(NP.pos); playStateUI(); jcall(J.play()); }
}
function next() { if (!S.queue.length) return; if (S.qi < S.queue.length - 1) loadTrack(S.qi + 1); else if (S.repeat === 'all') loadTrack(0); }
function prev() { if (!S.queue.length) return; if (posSec() > 3 || S.qi === 0) { seekTo(0); if (!NP.playing) togglePlay(); return; } loadTrack(S.qi - 1); }
function seekTo(sec) {
  const d = durSec();
  const ms = Math.round(clamp(sec, 0, d ? d - 0.3 : sec) * 1000);
  setPos(ms); seekGuard = performance.now() + 700;
  jcall(J.seek({ ms }));
  progressUI(true);
}
function toggleShuffle() {
  const t = cur();
  S.shuffle = !S.shuffle;
  if (t) {
    if (S.shuffle) { S.original = S.queue.slice(); S.queue = [t, ...shuffled(S.queue.filter((_, k) => k !== S.qi))]; S.qi = 0; }
    else if (S.original) { S.queue = S.original.slice(); S.qi = Math.max(0, S.queue.indexOf(t)); }
    jcall(J.replaceOthers({ before: S.queue.slice(0, S.qi).map(itemFor), after: S.queue.slice(S.qi + 1).map(itemFor) }));
    jcall(J.setShuffle({ on: false }));
  }
  modeUI(); saveState(); upNextUI();
  toast(S.shuffle ? T('Shuffle on') : T('Shuffle off'));
}
function cycleRepeat() {
  S.repeat = S.repeat === 'off' ? 'all' : S.repeat === 'all' ? 'one' : 'off';
  jcall(J.setRepeat({ mode: S.repeat }));
  modeUI(); saveState();
  toast(S.repeat === 'off' ? T('Repeat off') : S.repeat === 'all' ? T('Repeat all') : T('Repeat this track'));
}
function playNext(tracks) {
  if (!cur()) return playList(tracks);
  S.queue.splice(S.qi + 1, 0, ...tracks);
  if (S.original) S.original.push(...tracks);
  jcall(J.insert({ index: S.qi + 1, items: tracks.map(itemFor) }));
  saveState(); upNextUI();
  toast(tracks.length === 1 ? `${T('“{0}” will play next', tracks[0].title)}` : `${T('{0} will play next', plural(tracks.length, T('track'), T('tracks')))}`);
}
function playLast(tracks) {
  if (!cur()) return playList(tracks);
  const at = S.queue.length;
  S.queue.push(...tracks);
  if (S.original) S.original.push(...tracks);
  jcall(J.insert({ index: at, items: tracks.map(itemFor) }));
  saveState(); upNextUI();
  toast(tracks.length === 1 ? `${T('“{0}” added to the queue', tracks[0].title)}` : `${T('{0} added to the queue', plural(tracks.length, T('track'), T('tracks')))}`);
}
let syncingQueue = false;
async function syncQueueFromNative() {
  if (syncingQueue) return;
  syncingQueue = true;
  try {
    const r = await J.getQueue();
    const q = (r.ids || []).map((p) => S.byPath.get(p)).filter(Boolean);
    if (q.length) { const prevT = cur(); S.queue = q; S.original = q.slice(); S.qi = clamp(r.index || 0, 0, q.length - 1); onTrackChange(prevT !== cur()); saveState(); }
  } catch { /* */ }
  syncingQueue = false;
}
function onNativeState(s) {
  if (!s || !s.ready) return;
  if (s.count && (s.count !== S.queue.length || (s.mediaId && !S.queue.some((t) => t.path === s.mediaId)))) syncQueueFromNative();
  const playing = !!(s.playWhenReady && s.state !== 4 && s.state !== 1);
  if (performance.now() > seekGuard || s.mediaId !== (cur() && cur().path)) setPos(s.positionMs || 0);
  if (s.durationMs) NP.dur = s.durationMs;
  if (s.mediaId && (!cur() || cur().path !== s.mediaId)) {
    const idx = (s.index >= 0 && S.queue[s.index] && S.queue[s.index].path === s.mediaId) ? s.index : S.queue.findIndex((t) => t.path === s.mediaId);
    if (idx >= 0) { const prevT = cur(); S.qi = idx; NP.dur = s.durationMs || (cur().duration || 0) * 1000; onTrackChange(prevT !== cur()); saveState(); }
  }
  if (s.repeat && s.repeat !== S.repeat) { S.repeat = s.repeat; modeUI(); }
  if (playing !== NP.playing) { NP.playing = playing; playStateUI(); saveState(); }
}
let errSkip = 0;
function bindNative() {
  J.addListener('state', onNativeState);
  J.addListener('progress', (p) => { if (NP.playing && performance.now() > seekGuard) setPos(p.positionMs); if (p.durationMs) NP.dur = p.durationMs; });
  J.addListener('error', (e) => {
    const t = S.queue[e.index] || cur();
    if (t && t.remote && !phoneIsCached(t)) {
      PH.online = false; srcUI(); phoneSchedule(2500);
      for (let j = (e.index || 0) + 1; j < S.queue.length; j++) {
        if (!S.queue[j].remote || phoneIsCached(S.queue[j])) { toast(`${T('{0} isn\'t responding: switching to a track already on the TV', phoneName())}`, 'err'); setTimeout(() => loadTrack(j), 600); return; }
      }
      toast(`${T('{0} isn\'t responding. Keep rJuke open, on the same Wi‑Fi as the TV.', phoneName())}`, 'err');
      return;
    }
    if (t) toast(`${T('Can\'t play “{0}”', t.title)}`, 'err');
    if (e.index < S.queue.length - 1 && errSkip++ < 5) setTimeout(() => loadTrack(e.index + 1), 900);
  });
  setInterval(() => { if (NP.playing) saveState(); }, 5000);
}
function saveState() {
  store.set('state', { q: S.queue.map((t) => t.path), o: S.original ? S.original.map((t) => t.path) : null, qi: S.qi, time: posSec(), shuffle: S.shuffle, repeat: S.repeat, ctx: S.ctx });
}
async function restoreState() {
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
}

// ===================== remote navigation =====================
const FOC = '[data-f]';
const isVis = (el) => {
  if (!el.isConnected || el.disabled || el.closest('[hidden], [aria-hidden="true"], .gone')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
function scopeEl() {
  const m = $('#tv-modal .tv-modal:last-child');
  if (m) return m;
  if (!$('#tv-setup').hidden) return $('#tv-setup');
  if (S.npOpen) return $('#tv-np');
  return $('#tv');
}
function inScope(el, scope) {
  if (!scope.contains(el)) return false;
  if (scope.id === 'tv') return !el.closest('#tv-np, #tv-setup, #tv-modal');
  return true;
}
function focusEl(el, { scroll = true } = {}) {
  if (!el) return;
  el.focus({ preventScroll: true });
  if (scroll) keepVisible(el);
}
function defaultFocus() {
  const sc = scopeEl();
  const want = sc.querySelector('[data-autofocus]');
  const list = $$(FOC, sc).filter((e) => isVis(e) && inScope(e, sc));
  if (sc.id === 'tv') {
    const mainFirst = list.find((e) => e.closest('#tv-main'));
    focusEl(want && isVis(want) ? want : mainFirst || list[0]);
  } else focusEl(want && isVis(want) ? want : list[0]);
}
function move(dir) {
  const sc = scopeEl();
  const a = document.activeElement;
  if (!a || !a.matches(FOC) || !inScope(a, sc) || !isVis(a)) { defaultFocus(); return; }
  // from the sidebar to the right: back to where I was on the page
  if (dir === 'right' && a.closest('#tv-rail')) {
    const back = NAV.lastMain && NAV.lastMain.isConnected && isVis(NAV.lastMain) ? NAV.lastMain : $$(FOC, $('#tv-main')).find(isVis);
    if (back) { focusEl(back); return; }
  }
  if (a.closest('#tv-rail') && (dir === 'up' || dir === 'down')) {
    const items = $$('#tv-rail [data-f]').filter(isVis);
    const i = items.indexOf(a) + (dir === 'down' ? 1 : -1);
    if (items[i]) focusEl(items[i]);
    return;
  }
  // progress bar in the Player: left/right seek the track
  if (a.dataset.seek && (dir === 'left' || dir === 'right')) { seekTo(posSec() + (dir === 'right' ? 10 : -10)); npWake(); return; }
  const cr = a.getBoundingClientRect();
  const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
  const myRow = a.closest('[data-row]');
  let best = null, bestScore = Infinity, alt = null, altScore = Infinity;
  const fromRail = !!a.closest('#tv-rail');
  for (const el of $$(FOC, sc)) {
    if (el === a || !inScope(el, sc) || !isVis(el)) continue;
    // the sidebar is reached only by going left
    if (!fromRail && (dir === 'up' || dir === 'down') && el.closest('#tv-rail')) continue;
    const r = el.getBoundingClientRect();
    const ex = r.left + r.width / 2, ey = r.top + r.height / 2;
    let prim, orth;
    if (dir === 'right' || dir === 'left') {
      if (dir === 'right' ? ex <= cx + 2 : ex >= cx - 2) continue;
      prim = dir === 'right' ? Math.max(0, r.left - cr.right) : Math.max(0, cr.left - r.right);
      orth = r.bottom < cr.top ? cr.top - r.bottom : r.top > cr.bottom ? r.top - cr.bottom : 0;
      // in horizontal rows I stay in the same row
      if (myRow && el.closest('[data-row]') !== myRow && orth > 0) continue;
      const score = prim + orth * 4 + Math.abs(ey - cy) * 0.15;
      if (score < bestScore) { bestScore = score; best = el; }
    } else {
      if (dir === 'down' ? ey <= cy + 2 : ey >= cy - 2) continue;
      prim = dir === 'down' ? Math.max(0, r.top - cr.bottom) : Math.max(0, cr.top - r.bottom);
      orth = r.right < cr.left ? cr.left - r.right : r.left > cr.right ? r.left - cr.right : 0;
      // elements of other rows hidden past the edge don't count
      if (r.right < 0 || r.left > innerWidth) continue;
      const score = prim * 1.2 + orth * 2 + Math.abs(ex - cx) * 0.08;
      // a tall element beside (e.g. the PartyBox QR code) is neither “below” nor “above”: I use it only if there's nothing else
      if (dir === 'down' ? r.top < cy - 2 : r.bottom > cy + 2) { if (score < altScore) { altScore = score; alt = el; } continue; }
      if (score < bestScore) { bestScore = score; best = el; }
    }
  }
  if (!best && alt) best = alt;
  if (best && (dir === 'up' || dir === 'down')) {
    const row = best.closest('[data-row]');
    if (row && row !== myRow && row.__last && row.__last.isConnected && isVis(row.__last) && inScope(row.__last, sc)) best = row.__last;
  }
  // entering the sidebar starts from the page you're on
  if (best && best.closest('#tv-rail') && !a.closest('#tv-rail')) best = $('#tv-rail .rail-item.on') || best;
  if (best) focusEl(best);
  else if (dir === 'left' && sc.id === 'tv' && !a.closest('#tv-rail')) { const r = $('#tv-rail .rail-item.on') || $('#tv-rail [data-f]'); if (r) focusEl(r); }
  else bump(a, dir);
}
function bump(el, dir) {
  el.classList.remove('bump-l', 'bump-r', 'bump-u', 'bump-d');
  void el.offsetWidth;
  el.classList.add('bump-' + dir[0]);
  setTimeout(() => el.classList.remove('bump-' + dir[0]), 260);
}
// smooth scrolling to keep the selected element in view
function keepVisible(el) {
  const row = el.closest('[data-row]');
  if (row) {
    row.__last = el;
    const pad = row.clientWidth * 0.06;
    const left = el.offsetLeft, right = left + el.offsetWidth;
    let target = row.scrollLeft;
    if (left - row.scrollLeft < pad) target = left - pad;
    else if (right - row.scrollLeft > row.clientWidth - pad) target = right - row.clientWidth + pad;
    // short rows of buttons (letters) and TV in light mode: no animated scrolling that piles up when pressing quickly
    if (Math.abs(target - row.scrollLeft) > 1) row.scrollTo({ left: Math.max(0, target), behavior: row.classList.contains('letters') ? 'auto' : 'smooth' });
  }
  const sc = el.closest('[data-scroll]');
  if (!sc) return;
  if (el.classList.contains('pb-qrcard')) { if (sc.scrollTop > 1) sc.scrollTo({ top: 0, behavior: LITE.on ? 'auto' : 'smooth' }); return; }
  const sr = sc.getBoundingClientRect();
  const sec = el.closest('[data-sec]');
  const box = (row && sec ? sec : el).getBoundingClientRect();
  const er = el.getBoundingClientRect();
  const top = sr.top + sr.height * 0.14, bottom = sr.bottom - sr.height * 0.14;
  let dy = 0;
  // near the top of the page it goes right back to the top (title and greeting included)
  const absBottom = er.bottom - sr.top + sc.scrollTop;
  if (absBottom < sr.height * 0.82) { if (sc.scrollTop > 1) sc.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (row && sec) {
    // rows of covers align to the top, with the section title visible
    if (box.top < sr.top + sr.height * 0.08 || box.bottom > sr.bottom - sr.height * 0.04) dy = box.top - (sr.top + sr.height * 0.1);
  } else if (er.top < top) dy = er.top - top;
  else if (er.bottom > bottom) dy = er.bottom - bottom;
  if (Math.abs(dy) > 1) sc.scrollTo({ top: Math.max(0, sc.scrollTop + dy), behavior: 'smooth' });
}
const NAV = { lastMain: null };
// the “now playing” box at the top right hides when the page scrolls, so it doesn't cover the content
function chipScrolled() {
  const page = $('#tv-main .page'), chip = $('#tv-chip');
  if (!chip) return;
  const sc = !!(page && page.scrollTop > 24);
  if (chip.classList.contains('gone') === sc) return;
  chip.classList.toggle('gone', sc);
  if (sc && document.activeElement === chip) defaultFocus();
}
document.addEventListener('scroll', (e) => { if (e.target && e.target.classList && e.target.classList.contains('page')) chipScrolled(); }, true);
document.addEventListener('input', (e) => { if (e.target && e.target.tagName === 'INPUT') e.target.__editing = true; });
document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (el.closest && el.closest('#tv-main')) NAV.lastMain = el;
  $('#tv').classList.toggle('rail-open', !!(el.closest && el.closest('#tv-rail')));
});

// OK, OK held down (actions), Back
let okDown = 0, okTimer = 0, okLong = false;
document.addEventListener('keydown', (e) => {
  const k = e.key;
  // Player idle: the first key only wakes it up
  if (S.npOpen && $('#tv-np').classList.contains('idle') && !MODALS.length) { e.preventDefault(); npWake(); return; }
  npWake();
  const a = document.activeElement;
  const typing = a && a.tagName === 'INPUT';
  if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') {
    if (typing && (k === 'ArrowLeft' || k === 'ArrowRight') && a.value) return;
    e.preventDefault();
    move(k.slice(5).toLowerCase());
    return;
  }
  if (k === 'Enter' || k === ' ') {
    if (typing) {
      // first OK: the keyboard opens; OK (or “Search”) after typing: moves to the results
      if (k === 'Enter') { if (a.__editing) { a.__editing = false; e.preventDefault(); move('down'); } else a.__editing = true; }
      return;
    }
    if (!a || !a.matches(FOC)) { e.preventDefault(); defaultFocus(); return; }
    e.preventDefault();
    if (e.repeat) return;
    okDown = performance.now(); okLong = false;
    a.classList.add('pressed');
    clearTimeout(okTimer);
    const tl = a.classList.contains('trow') && a.closest('.tlist');
    const long = a.__long || (tl && tl.__longRow ? () => tl.__longRow(a) : null);
    if (long) okTimer = setTimeout(() => { okLong = true; a.classList.remove('pressed'); long(); }, 600);
    return;
  }
  if (k === 'Escape' || k === 'GoBack' || k === 'BrowserBack' || k === 'Backspace') {
    if (typing && k === 'Backspace') return;
    e.preventDefault(); onBack();
    return;
  }
  if (k === 'MediaPlayPause' || k === 'MediaPlay' || k === 'MediaPause') { /* handled by the system player */ }
});
document.addEventListener('keyup', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const a = document.activeElement;
  if (!a || a.tagName === 'INPUT') return;
  clearTimeout(okTimer);
  a.classList.remove('pressed');
  if (okLong || !okDown) { okDown = 0; return; }
  okDown = 0;
  if (a.matches(FOC)) a.click();
});

// ===================== components =====================
function toast(msg, kind = '') {
  const root = $('#tv-toasts');
  const el = h(`<div class="tv-toast${kind === 'err' ? ' err' : ''}">${kind === 'err' ? `<span class="tt-i warn">${icon('warn')}</span>` : `<span class="tt-i">${icon('check')}</span>`}<span>${esc(msg)}</span></div>`);
  root.appendChild(el);
  while (root.children.length > 2) root.firstElementChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, 3600);
}
function modal({ title, text = '', buttons = [], input = null, cls = '' }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const el = h(`<div class="tv-modal ${cls}"><div class="tm-card">
      <h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}
      ${input ? `<input class="tm-in" data-f data-autofocus value="${esc(input.value || '')}" placeholder="${esc(input.placeholder || '')}" maxlength="40" spellcheck="false">` : ''}
      <div class="tm-btns">${buttons.map((b, i) => `<button class="tbtn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}" data-f data-i="${i}" ${b.primary && !input ? 'data-autofocus' : ''}>${b.icon ? icon(b.icon) : ''}${esc(b.label)}</button>`).join('')}</div>
    </div></div>`);
    const close = (v) => {
      el.classList.add('out');
      MODALS.splice(MODALS.indexOf(close), 1);
      setTimeout(() => { el.remove(); if (prevFocus && prevFocus.isConnected) focusEl(prevFocus, { scroll: false }); else defaultFocus(); }, 220);
      resolve(v);
    };
    MODALS.push(close);
    $$('[data-i]', el).forEach((b) => b.addEventListener('click', () => {
      const bt = buttons[+b.dataset.i];
      close(input ? (bt.value === false ? null : $('.tm-in', el).value.trim()) : bt.value);
    }));
    $('#tv-modal').appendChild(el);
    requestAnimationFrame(() => defaultFocus());
  });
}
const MODALS = [];
const confirmModal = ({ title, text, ok = 'OK', danger = false }) => modal({ title, text, buttons: [{ label: T('Cancel'), value: false }, { label: ok, value: true, primary: true, danger }] });
function actions(title, sub, items) {
  return modal({ title, text: sub, cls: 'actions', buttons: [...items.map((x, i) => ({ label: x.label, icon: x.icon, value: i, primary: i === 0 })), { label: T('Cancel'), value: -1 }] })
    .then((i) => { if (i != null && i >= 0) items[i].action(); });
}

function cardHTML({ cls = '', attrs = '', cover, key, title, sub, round = false, glyph = 'album' }) {
  return `<button class="card ${cls}${round ? ' artist' : ''}" data-f ${attrs}>${artHTML(cover, key, { round, glyph })}<span class="c-t">${esc(title)}</span>${sub ? `<span class="c-s">${esc(sub)}</span>` : ''}</button>`;
}
const albumCard = (a) => cardHTML({ attrs: `data-album="${esc(a.key)}"`, cover: a.cover, key: a.key, title: a.title, sub: `${a.artist}${a.year ? ' · ' + a.year : ''}` });
const artistCard = (ar) => cardHTML({ attrs: `data-artist="${esc(ar.key)}"`, cover: ar.cover, key: ar.key, title: ar.name, sub: plural(ar.tracks.length, T('track'), T('tracks')), round: true, glyph: 'person' });
function plCover(p) { const t = plTracks(p).find((x) => x.cover); return t ? t.cover : null; }
const plCard = (p) => cardHTML({ attrs: `data-pl="${esc(p.id)}"`, cover: plCover(p), key: 'pl' + p.id, title: p.name, sub: plural(plTracks(p).length, T('track'), T('tracks')), glyph: 'playlist' });
function shelf(title, cards, { id = '' } = {}) {
  return `<section class="shelf" data-sec${id ? ` id="${id}"` : ''}><h2>${esc(title)}</h2><div class="row" data-row>${cards}</div></section>`;
}
function trackRowHTML(t, i, { num = null, showArtist = true } = {}) {
  const playing = cur() && cur().path === t.path;
  const eq = '<span class="eq"><i></i><i></i><i></i></span>';
  return `<button class="trow${playing ? ' playing' : ''}${num == null ? ' with-art' : ''}" data-f data-ti="${i}" data-path="${esc(t.path)}"${num != null ? ` data-num="${num}"` : ''}>
    ${num != null ? `<span class="tn">${playing ? eq : num}</span>` : `<span class="ta-wrap">${artHTML(t.cover, t.albumKey)}<span class="art-eq">${eq}</span></span>`}
    <span class="tx"><span class="tt">${esc(t.title)}</span>${showArtist ? `<span class="ta">${esc(t.artist)}${num == null ? ' · ' + esc(t.album_.title) : ''}</span>` : ''}</span>
    <span class="td">${fmtTime(t.duration)}</span></button>`;
}
function bindTracks(box, list, ctxFor) {
  box.addEventListener('click', (e) => {
    const r = e.target.closest('.trow'); if (!r) return;
    const i = +r.dataset.ti;
    playList(list, i, { shuffle: false, ctx: ctxFor ? ctxFor() : null });
    openNP();
  });
  box.__longRow = (r) => { const t = list[+r.dataset.ti]; if (t) trackActions(t); };
}
function trackActions(t) {
  actions(t.title, `${t.artist} · ${t.album_.title}`, [
    { label: T('Play'), icon: 'play', action: () => { playList([t], 0, { shuffle: false }); openNP(); } },
    { label: T('Play next'), icon: 'playnext', action: () => playNext([t]) },
    { label: T('Add to queue'), icon: 'playlast', action: () => playLast([t]) },
    { label: T('Go to album'), icon: 'album', action: () => go('album', t.albumKey) },
  ]);
}
function bindCards(root) {
  root.addEventListener('click', (e) => {
    const c = e.target.closest('.card'); if (!c) return;
    if (c.dataset.album) go('album', c.dataset.album);
    else if (c.dataset.artist) go('artist', c.dataset.artist);
    else if (c.dataset.pl) go('playlist', c.dataset.pl);
    else if (c.dataset.play) playQuick(c.dataset.play);
  });
  armCards(root);
}
function armCards(root) {
  $$('.card[data-album]', root).forEach((c) => { if (!c.__long) c.__long = () => { const a = S.albumMap.get(c.dataset.album); if (a) albumActions(a); }; });
}
// draws the first elements right away and the others only when you scroll near them:
// no background work slowing down the remote
function progressive(page, box, items, html, { first = 40, chunk = 40, after = null } = {}) {
  let n = 0, sent = null, io = null;
  const step = (count) => {
    if (n >= items.length) return false;
    const end = Math.min(items.length, n + count);
    box.insertAdjacentHTML('beforeend', items.slice(n, end).map((x, k) => html(x, n + k)).join(''));
    n = end;
    if (after) after(box);
    if (n >= items.length && sent) { io && io.disconnect(); sent.remove(); }
    return n < items.length;
  };
  step(first);
  if (n < items.length) {
    sent = document.createElement('div');
    sent.className = 'more-sent';
    box.after(sent);
    const near = () => { if (!sent.isConnected) return false; const r = sent.getBoundingClientRect(), pr = page.getBoundingClientRect(); return r.top < pr.bottom + pr.height * 1.2; };
    const pump = () => { if (near() && step(chunk)) requestAnimationFrame(() => setTimeout(pump, 0)); };
    io = 'IntersectionObserver' in window ? new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) pump(); }, { root: page, rootMargin: '0px 0px 120% 0px' }) : null;
    if (io) io.observe(sent); else page.addEventListener('scroll', pump, { passive: true });
  }
  const prevFill = page.__fillUntil;
  page.__fillUntil = (sel) => { if (prevFill) prevFill(sel); while (!$(sel, page) && step(400)); };
  return { stop() { if (io) io.disconnect(); if (sent) sent.remove(); n = items.length; } };
}
function albumActions(a) {
  actions(a.title, a.artist, [
    { label: T('Play'), icon: 'play', action: () => { playList(a.tracks, 0, { shuffle: false, ctx: { type: 'album', key: a.key } }); openNP(); } },
    { label: T('Shuffle play'), icon: 'shuffle', action: () => { playList(a.tracks, 0, { shuffle: true, ctx: { type: 'album', key: a.key } }); openNP(); } },
    { label: T('Play next'), icon: 'playnext', action: () => playNext(a.tracks) },
    { label: T('Add to queue'), icon: 'playlast', action: () => playLast(a.tracks) },
  ]);
}
function playQuick(id) {
  if (id === 'all') { playList(S.tracks, 0, { shuffle: true }); openNP(); }
}

// ===================== pages =====================
const VIEWS = {};
function greeting() {
  const hr = new Date().getHours();
  if (hr >= 5 && hr < 12) return T('Good morning');
  if (hr >= 12 && hr < 18) return T('Good afternoon');
  if (hr >= 18 && hr < 24) return T('Good evening');
  return T('Good night');
}
function emptyLibrary() {
  const el = h(`<div class="page empty" data-scroll><div class="empty-box">${icon('note')}<h2>${phoneMode() ? `${T('No tracks from {0}', esc(phoneName()))}` : T('No tracks found')}</h2>
    <p>${phoneMode() ? (PH.online === false ? `${T('{0} isn\'t responding: keep rJuke open, on the same Wi‑Fi as the TV.', esc(phoneName()))}` : T('Add music on the device and then update the library.')) : T('I couldn\'t find any music on this TV. You can use the music on your phone or PC.')}</p>
    <div class="btns"><button class="tbtn primary" data-f data-autofocus data-a="settings">${T('{0}Open Settings', icon('settings'))}</button></div></div></div>`);
  $('[data-a]', el).addEventListener('click', () => go('settings'));
  return el;
}
VIEWS.home = () => {
  if (!S.tracks.length) return emptyLibrary();
  const rnd = seeded(hashStr(new Date().toDateString()));
  const t = cur();
  const pool = S.albums.filter((a) => a.cover);
  const dayAlbum = (pool.length ? pool : S.albums)[Math.floor(rnd() * (pool.length || S.albums.length))];
  const heroA = t ? t.album_ : dayAlbum;
  const rec = S.recent.map((c) => (c.type === 'album' && S.albumMap.has(c.key) ? albumCard(S.albumMap.get(c.key)) : c.type === 'playlist' && S.plMap.has(c.id) ? plCard(S.plMap.get(c.id)) : null)).filter(Boolean).slice(0, 14);
  const added = S.albums.slice().sort((a, b) => b.added - a.added).slice(0, 14);
  const picks = shuffled(S.albums, rnd).slice(0, 14);
  const arts = shuffled(S.artists.filter((a) => a.cover), rnd).slice(0, 14);
  const el = h(`<div class="page home" data-scroll>
    <header class="greet"><h1>${esc(greeting())}${nm() ? `, <b>${esc(nm())}</b>` : ''}</h1></header>
    <section class="hero" data-sec>
      <div class="hero-bg"${bgAttrs(heroA.cover, heroA.key)}></div>
      ${artHTML(heroA.cover, heroA.key, { size: 'l', glyph: 'album' })}
      <div class="hero-tx">
        <div class="kicker">${t ? (S.playing ? T('Now playing') : T('Pick up where you left off')) : T('Album of the day')}</div>
        <div class="h-title">${esc(t ? t.title : heroA.title)}</div>
        <div class="h-sub">${esc(t ? `${t.artist} · ${t.album_.title}` : `${heroA.artist}${heroA.year ? ' · ' + heroA.year : ''}`)}</div>
        <div class="btns">
          ${t ? `<button class="tbtn primary" data-f data-autofocus data-a="np">${icon(S.playing ? 'enlarge' : 'play')}${S.playing ? T('Open the player') : T('Resume')}</button>`
    : `<button class="tbtn primary" data-f data-autofocus data-a="playday">${T('{0}Play', icon('play'))}</button><button class="tbtn" data-f data-a="openday">${T('{0}Open the album', icon('album'))}</button>`}
          <button class="tbtn" data-f data-a="shuffleall">${T('{0}Shuffle everything', icon('shuffle'))}</button>
        </div>
      </div>
    </section>
    ${rec.length ? shelf(T('Recently played'), rec.join('')) : ''}
    ${shelf(T('Recently added'), added.map(albumCard).join(''))}
    ${shelf(nm() ? `${T('Picked for you, {0}', nm())}` : T('Picked for you'), picks.map(albumCard).join(''))}
    ${S.playlists.length ? shelf(T('Your playlists'), S.playlists.map(plCard).join('')) : ''}
    ${arts.length ? shelf(T('Artists'), arts.map(artistCard).join('')) : ''}
  </div>`);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'np') { if (!S.playing) togglePlay(); openNP(); }
    if (b.dataset.a === 'playday') { playList(dayAlbum.tracks, 0, { shuffle: false, ctx: { type: 'album', key: dayAlbum.key } }); openNP(); }
    if (b.dataset.a === 'openday') go('album', dayAlbum.key);
    if (b.dataset.a === 'shuffleall') { playList(S.tracks, 0, { shuffle: true }); openNP(); }
  });
  bindCards(el);
  return el;
};
// ---------- all tracks, A to Z, with letters to jump ----------
const letterOf = (t) => { const c = norm(sortName(t.title)).trim().charAt(0).toUpperCase(); return c >= 'A' && c <= 'Z' ? c : '#'; };
function allTracks() {
  if (!S.tracksSorted || S.tracksSorted.src !== S.tracks) {
    const list = S.tracks.slice().sort((a, b) => coll.compare(sortName(a.title), sortName(b.title)) || coll.compare(a.artist, b.artist));
    list.src = S.tracks;
    S.tracksSorted = list;
  }
  return S.tracksSorted;
}
VIEWS.tracks = () => {
  if (!S.tracks.length) return emptyLibrary();
  const list = allTracks();
  const first = new Map();
  list.forEach((t, i) => { const l = letterOf(t); if (!first.has(l)) first.set(l, i); });
  const letters = [...first.keys()].sort((a, b) => (b === '#') - (a === '#') || a.localeCompare(b));
  const el = h(`<div class="page tracks-page" data-scroll>
    <header class="ph"><h1>${T('Tracks')}</h1><p>${plural(list.length, T('track'), T('tracks'))}, ${fmtLong(list.reduce((n, t) => n + (t.duration || 0), 0))}</p></header>
    <div class="btns" data-sec><button class="tbtn primary" data-f data-autofocus data-a="all-play">${T('{0}Play all', icon('play'))}</button><button class="tbtn" data-f data-a="all-shuffle">${T('{0}Shuffle', icon('shuffle'))}</button></div>
    ${letters.length > 1 ? `<section class="shelf letters-sec" data-sec><div class="row letters" data-row>${letters.map((l) => `<button class="letter" data-f data-a="letter:${l}">${l}</button>`).join('')}</div></section>` : ''}
    <section class="tracks" data-sec><div class="tlist"></div></section>
  </div>`);
  // the list starts from the top or from the chosen letter: only nearby tracks are drawn, even with thousands of tracks
  const box = $('.tlist', el);
  let prog = null;
  const showFrom = (start) => {
    if (prog) prog.stop();
    el.__fillUntil = null;
    box.innerHTML = '';
    prog = progressive(el, box, start ? list.slice(start) : list, (t, k) => trackRowHTML(t, start + k), { first: 30, chunk: 60 });
  };
  showFrom(0);
  bindTracks(box, list, () => null);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const [a, arg] = b.dataset.a.split(/:(.*)/s);
    if (a === 'all-play') { playList(list, 0, { shuffle: false }); openNP(); }
    if (a === 'all-shuffle') { playList(list, 0, { shuffle: true }); openNP(); }
    if (a === 'letter') {
      const i = first.get(arg); if (i == null) return;
      showFrom(i);
      const r = $(`.trow[data-ti="${i}"]`, el); if (r) focusEl(r);
    }
  });
  return el;
};
function gridPage(title, sub, items, card) {
  const el = h(`<div class="page" data-scroll><header class="ph"><h1>${esc(title)}</h1><p>${esc(sub)}</p></header><div class="grid"></div></div>`);
  bindCards(el);
  progressive(el, $('.grid', el), items, card, { first: 36, chunk: 36, after: armCards });
  return el;
}
VIEWS.albums = () => (S.tracks.length ? gridPage(T('Albums'), plural(S.albums.length, T('album'), T('albums')), S.albums, albumCard) : emptyLibrary());
VIEWS.artists = () => (S.tracks.length ? gridPage(T('Artists'), plural(S.artists.length, T('artist'), T('artists')), S.artists, artistCard) : emptyLibrary());
VIEWS.playlists = () => (S.playlists.length
  ? gridPage(T('Playlists'), plural(S.playlists.length, T('playlist'), T('playlists')), S.playlists, plCard)
  : (() => { const el = h(`<div class="page empty" data-scroll><div class="empty-box">${icon('playlist')}<h2>${T('No playlists')}</h2><p>${phoneMode() ? `${T('{0}\'s playlists show up here automatically.', esc(phoneName()))}` : T('The playlists you create on the phone or PC show up here when you use their music.')}</p></div></div>`); return el; })());
function detailPage({ kind, key, cover, title, sub, tracks, ctx, round = false, extra = '' }) {
  const el = h(`<div class="page detail" data-scroll>
    <div class="d-bg"${bgAttrs(cover, key)}></div>
    <header class="d-head" data-sec>
      ${artHTML(cover, key, { size: 'l', round, glyph: kind === 'artist' ? 'person' : kind === 'playlist' ? 'playlist' : 'album' })}
      <div class="d-tx">
        <div class="kicker">${kind === 'album' ? T('Album') : kind === 'artist' ? T('Artist') : T('Playlist')}</div>
        <h1>${esc(title)}</h1><p>${esc(sub)}</p>
        <div class="btns">
          <button class="tbtn primary" data-f data-autofocus data-a="play">${T('{0}Play', icon('play'))}</button>
          <button class="tbtn" data-f data-a="shuffle">${T('{0}Shuffle', icon('shuffle'))}</button>
        </div>
      </div>
    </header>
    ${extra}
    <section class="tracks" data-sec>${kind === 'artist' ? T('<h2>Tracks</h2>') : ''}<div class="tlist"></div></section>
  </div>`);
  progressive(el, $('.tlist', el), tracks, (t, i) => trackRowHTML(t, i, { num: kind === 'album' ? (t.track || i + 1) : null, showArtist: kind !== 'album' || splitArtists(t.artist).join() !== splitArtists(title === t.album_.title ? t.album_.artist : '').join() }), { first: 30, chunk: 50 });
  $('[data-a="play"]', el).addEventListener('click', () => { playList(tracks, 0, { shuffle: false, ctx }); openNP(); });
  $('[data-a="shuffle"]', el).addEventListener('click', () => { playList(tracks, 0, { shuffle: true, ctx }); openNP(); });
  bindTracks($('.tlist', el), tracks, () => ctx);
  bindCards(el);
  return el;
}
VIEWS.album = (key) => {
  const a = S.albumMap.get(key); if (!a) return VIEWS.home();
  return detailPage({ kind: 'album', key: a.key, cover: a.cover, title: a.title, sub: `${a.artist}${a.year ? ' · ' + a.year : ''} · ${plural(a.tracks.length, T('track'), T('tracks'))}, ${fmtLong(a.duration)}`, tracks: a.tracks, ctx: { type: 'album', key: a.key } });
};
VIEWS.artist = (key) => {
  const ar = S.artistMap.get(key); if (!ar) return VIEWS.home();
  const albs = [...ar.albums, ...ar.appears];
  return detailPage({ kind: 'artist', key: ar.key, cover: ar.cover, round: true, title: ar.name, sub: `${plural(ar.albums.length, T('album'), T('albums'))} · ${plural(ar.tracks.length, T('track'), T('tracks'))}`, tracks: ar.tracks.slice(0, 60), ctx: null,
    extra: albs.length ? shelf(T('Albums'), albs.map(albumCard).join('')) : '' });
};
VIEWS.playlist = (id) => {
  const p = S.plMap.get(id); if (!p) return VIEWS.playlists();
  const tr = plTracks(p);
  return detailPage({ kind: 'playlist', key: 'pl' + p.id, cover: plCover(p), title: p.name, sub: `${plural(tr.length, T('track'), T('tracks'))}, ${fmtLong(tr.reduce((n, t) => n + (t.duration || 0), 0))}`, tracks: tr, ctx: { type: 'playlist', id: p.id } });
};
VIEWS.search = () => {
  const el = h(`<div class="page search" data-scroll>
    <header class="ph"><h1>${T('Search')}</h1></header>
    <label class="sbox">${icon('search')}<input id="tv-q" data-f data-autofocus placeholder="${T('Tracks, albums or artists')}" spellcheck="false" autocomplete="off" enterkeyhint="search" value="${esc(S.lastQuery || '')}"></label>
    <div class="sres"></div>
  </div>`);
  const inp = $('#tv-q', el), res = $('.sres', el);
  const run = () => {
    const q = inp.value.trim(); S.lastQuery = q;
    const nq = norm(q);
    if (!nq) {
      const rnd = Math.random;
      const al = shuffled(S.albums, rnd).slice(0, 12), ar = shuffled(S.artists.filter((a) => a.cover), rnd).slice(0, 12);
      res.innerHTML = S.tracks.length ? `<p class="hint">${T('You might be in the mood for…')}</p>${shelf(T('Albums'), al.map(albumCard).join(''))}${ar.length ? shelf(T('Artists'), ar.map(artistCard).join('')) : ''}` : '';
      return;
    }
    const terms = nq.split(/\s+/);
    const hit = (s) => terms.every((w) => s.includes(w));
    const score = (s) => { const n = norm(s); return n === nq ? 0 : n.startsWith(nq) ? 1 : n.includes(nq) ? 2 : 3; };
    const ars = S.artists.filter((a) => hit(a.s)).sort((a, b) => score(a.name) - score(b.name)).slice(0, 12);
    const als = S.albums.filter((a) => hit(a.s)).sort((a, b) => score(a.title) - score(b.title)).slice(0, 14);
    const trs = S.tracks.filter((t) => hit(t.s)).sort((a, b) => score(a.title) - score(b.title)).slice(0, 40);
    if (!ars.length && !als.length && !trs.length) { res.innerHTML = `<p class="hint">${T('No results for “{0}”', esc(q))}</p>`; return; }
    res.innerHTML = `${trs.length ? `<section class="tracks" data-sec><h2>${T('Tracks')}</h2><div class="tlist">${trs.map((t, i) => trackRowHTML(t, i)).join('')}</div></section>` : ''}
      ${als.length ? shelf(T('Albums'), als.map(albumCard).join('')) : ''}${ars.length ? shelf(T('Artists'), ars.map(artistCard).join('')) : ''}`;
    const tl = $('.tlist', res);
    if (tl) {
      tl.addEventListener('click', (e) => { const r = e.target.closest('.trow'); if (!r) return; const t = trs[+r.dataset.ti]; const a = t.album_; playList(a.tracks, Math.max(0, a.tracks.indexOf(t)), { shuffle: false, ctx: { type: 'album', key: a.key } }); openNP(); });
      $$('.trow', tl).forEach((r) => { r.__long = () => trackActions(trs[+r.dataset.ti]); });
    }
  };
  inp.addEventListener('input', debounce(run, 220));
  bindCards(res);
  run();
  return el;
};
VIEWS.settings = () => {
  const s = S.settings;
  let musicRows = phoneMode() ? `<div class="srow static" data-f tabindex="-1"><span class="sl"><b>${T('Music from {0}', esc(phoneName()))}</b><span id="tv-src-st"></span></span></div>
      <button class="srow" data-f data-a="sync"><span class="sl"><b>${T('Update the library')}</b><span>${T('Gets the track list again from {0}', esc(phoneName()))}</span></span>${icon('refresh')}</button>
      <div class="srow static" data-f tabindex="-1"><span class="sl"><b>${T('Tracks kept on the TV')}</b><span id="tv-cache-st">…</span></span></div>
      <button class="srow" data-f data-a="clear"><span class="sl"><b>${T('Clear the tracks on the TV')}</b><span>${T('They\'ll be fetched again from {0} when you play them again', esc(phoneName()))}</span></span>${icon('trash')}</button>`
    : `<div class="srow static" data-f tabindex="-1"><span class="sl"><b>${T('Music on this TV')}</b><span>${plural(S.tracks.length, T('track'), T('tracks'))} · ${plural(S.albums.length, T('album'), T('albums'))} · ${plural(S.artists.length, T('artist'), T('artists'))}</span></span></div>
      <button class="srow" data-f data-a="rescan"><span class="sl"><b>${T('Look for music again')}</b><span>${T('TV storage and USB drives')}</span></span>${icon('refresh')}</button>`;
  let srcTitle = phoneMode() ? T('Change where the music comes from') : T('Use the music on another device');
  let srcSub = phoneMode() ? T('Phone or PC, or the music on this TV') : T('Phone or PC with rJuke on the same Wi‑Fi');
  const el = h(`<div class="page settings" data-scroll>
    <header class="ph"><h1>${T('Settings')}</h1><p>${nm() ? `${T('Made for you, {0}', esc(nm()))}` : T('Customize rJuke')}</p></header>
    <h2>${T('Profile')}</h2>
    <div class="slist">
      <button class="srow" data-f data-a="name"><span class="sl"><b>${T('Your name')}</b><span>${esc(nm() || T('Not set'))}</span></span>${icon('edit')}</button>
      <button class="srow" data-f data-a="lang"><span class="sl"><b>${T('Language')}</b><span>${esc((I18N.LANGS.find(([k]) => k === s.lang) || [, T('Automatic')])[1])}</span></span>${icon('forward')}</button>
    </div>
    <h2>${T('Music')}</h2>
    <div class="slist">
      ${musicRows}
      <button class="srow" data-f data-a="source"><span class="sl"><b>${srcTitle}</b><span>${srcSub}</span></span>${icon('forward')}</button>
    </div>
    <h2>${T('rJuke Connect')}</h2>
    <div class="slist">
      <div class="srow static" data-f tabindex="-1"><span class="sl"><b>${T('Control the TV from your phone')}</b><span id="tv-me-how">${T('On the phone open rJuke › Devices › {0}', esc(tvName()))}</span></span></div>
      <button class="srow" data-f data-a="cname"><span class="sl"><b>${T('Name for other devices')}</b><span>${esc(tvName())}${String(s.connectName || '').trim() ? '' : ' ' + T('· automatic')}</span></span>${icon('edit')}</button>
      <div class="srow static tv-ic-head" tabindex="-1"><span class="sl"><b>${T('Icon')}</b><span>${T('The one shown next to the name on the phone and the PC')}</span></span></div>
      <div class="tv-icons">${DEVICE_ICONS.map(([k, l]) => `<button class="tv-ic${k === (tvIcon() || 'tv') ? ' on' : ''}" data-f data-ic="${k}">${icon(k)}<span>${l}</span></button>`).join('')}</div>
      <div class="srow static" data-f tabindex="-1"><span class="sl"><b>${T('This TV')}</b><span id="tv-me">${esc(tvName())}${RC.ip ? ` ${T('· address {0}:{1}', esc(RC.ip), RC.port)}` : ''}</span></span></div>
      ${Object.keys(s.connectTrusted || {}).length ? `<button class="srow" data-f data-a="revoke"><span class="sl"><b>${T('Authorized devices')}</b><span>${esc(Object.values(s.connectTrusted).join(' · '))}</span></span>${icon('trash')}</button>` : ''}
    </div>
    <h2>${T('About')}</h2>
    <div class="slist"><div class="srow static" data-f tabindex="-1"><span class="sl"><b>${T('rJuke {0} for Android TV', esc(S.info.version || ''))}</b><span>${T('Use the remote\'s arrows to move, OK to choose, and hold OK on a track or an album for more actions.')}</span></span></div></div>
  </div>`);
  el.addEventListener('click', async (e) => {
    const ic = e.target.closest('[data-ic]');
    if (ic) {
      el.querySelectorAll('.tv-ic').forEach((x) => x.classList.toggle('on', x === ic));
      S.settings = await rj.setSettings({ connectIcon: ic.dataset.ic });
      await tvAnnounce();
      return;
    }
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'name') {
      const v = await modal({ title: T('What\'s your name?'), input: { value: nm(), placeholder: T('Your name') }, buttons: [{ label: T('Cancel'), value: false }, { label: T('Save'), primary: true }] });
      if (v) { S.settings = await rj.setSettings({ name: v.replace(/^./, (c) => c.toUpperCase()) }); await tvAnnounce(); refreshView(); toast(`${T('Nice to see you again, {0}!', nm())}`); }
    }
    if (a === 'lang') {
      const v = await modal({ title: T('Language'), buttons: [['auto', T('Automatic')], ...I18N.LANGS].map(([k, l]) => ({ label: l, value: k, primary: k === (s.lang || 'auto') })) });
      if (v && v !== (s.lang || 'auto')) {
        S.settings = await rj.setSettings({ lang: v });
        I18N.setLang(v);
        try { sessionStorage.setItem('rj.relang', '1'); } catch { /* */ }
        location.reload();
      }
      return;
    }
    if (a === 'cname') {
      const v = await modal({ title: T('Name for other devices'), text: `${T('Leave it empty to use “{0}”.', tvAutoName())}`, input: { value: String(s.connectName || ''), placeholder: tvAutoName() }, buttons: [{ label: T('Cancel'), value: false }, { label: T('Save'), primary: true }] });
      if (v !== false && v != null) { S.settings = await rj.setSettings({ connectName: String(v).trim().replace(/\s+/g, ' ').slice(0, 32) }); await tvAnnounce();
        // I update only the affected rows: redrawing would send the page back to the top
        $('.sl > span', b).textContent = tvName() + (String(S.settings.connectName || '').trim() ? '' : ' ' + T('· automatic'));
        const how = $('#tv-me-how', el); if (how) how.textContent = `${T('On the phone open rJuke › Devices › {0}', tvName())}`;
        const me = $('#tv-me', el); if (me) me.textContent = `${tvName()}${RC.ip ? ` ${T('· address {0}:{1}', RC.ip, RC.port)}` : ''}`;
        toast(`${T('Other devices now see “{0}”', tvName())}`); }
    }
    if (a === 'sync') phoneSync({ loud: true });
    if (a === 'clear') { if (await confirmModal({ title: T('Clear the tracks on the TV?'), text: `${T('They\'ll be fetched again from {0} when you play them. The music on the device isn\'t touched.', phoneName())}`, ok: T('Clear'), danger: true })) { await Juke.pcacheClear(); PH.cached.clear(); cacheUI(); toast(T('Tracks on the TV deleted')); } }
    if (a === 'rescan') runScan(true);
    if (a === 'source') chooseSource();
    if (a === 'revoke') { if (await confirmModal({ title: T('Revoke the devices?'), text: T('The other devices will have to ask for permission again to control the TV.'), ok: T('Revoke'), danger: true })) { S.settings = await rj.setSettings({ connectTrusted: {} }); refreshView(); toast(T('Authorizations revoked')); } }
  });
  setTimeout(() => { srcUI(); cacheUI(); }, 0);
  return el;
};
async function cacheUI() {
  const el = $('#tv-cache-st'); if (!el) return;
  let st = { count: 0, bytes: 0 };
  try { st = await Juke.pcacheStats(); } catch { /* */ }
  const used = st.bytes >= 1024 ** 3 ? (st.bytes / 1024 ** 3).toLocaleString(loc(), { maximumFractionDigits: 1 }) + ' GB' : Math.round(st.bytes / 1024 ** 2) + ' MB';
  el.textContent = st.count ? `${T('{0} · {1} of 1 GB. Played tracks start right away, even if {2} isn\'t responding.', plural(st.count, T('track'), T('tracks')), used, phoneName())}` : `${T('None for now. The tracks you play stay here (up to 1 GB) and start right away.')}`;
}
function srcStatus() {
  if (!phoneMode()) return null;
  if (PH.busy) return { cls: 'busy', txt: T('Updating…'), long: `${T('Updating {0}\'s library…', phoneName())}` };
  if (PH.pending) return { cls: 'off', txt: T('Confirm on the device'), long: `${T('On {0} tap “Allow” to use its music', phoneName())}` };
  if (PH.online === false) return { cls: 'off', txt: T('Not responding'), long: `${T('{0} isn\'t responding: keep rJuke open, on the same Wi‑Fi as the TV. Meanwhile the tracks already on the TV keep playing.', phoneName())}` };
  if (PH.online) return { cls: 'on', txt: T('Connected'), long: `${T('Connected to {0} · {1}', phoneName(), plural(S.tracks.length, T('track'), T('tracks')))}` };
  return { cls: 'busy', txt: T('Connecting…'), long: `${T('Connecting to {0}…', phoneName())}` };
}
function srcUI() {
  const st = srcStatus();
  const pill = $('#tv-src');
  pill.hidden = !st;
  if (st) { pill.className = 'src ' + st.cls; pill.innerHTML = `<span class="dot"></span><span class="src-n">${esc(phoneName())}</span><span class="src-s">${esc(st.txt)}</span>`; }
  const row = $('#tv-src-st'); if (row && st) row.textContent = st.long;
}

// ===================== PartyBox on the TV =====================
// Friends scan the QR code on the TV and pick the music from their phone's browser.
const PB = {
  on: false, token: '', ips: [], ip: '', port: 0,
  guests: new Map(), reqs: [], labels: new Map(), timer: 0, lastCur: '', sig: '',
};
window.PB = PB;
function partyName() { return nm() ? `${T('{0}\'s PartyBox', nm())}` : T('PartyBox'); }
const partyCfg = () => ({ mode: 'free', limit: 3, ...(S.settings.party || {}) });
async function partySaveCfg(patch) { S.settings = await rj.setSettings({ party: { ...partyCfg(), ...patch } }); }
const partyUrl = () => `http://${PB.ip}:${PB.port}/party?k=${PB.token}`;
const PB_LIMITS = [1, 3, 5, 0];
const pbLimitTxt = (n) => (n > 0 ? plural(n, T('track'), T('tracks')) : T('No limit'));

async function partyStart() {
  if (!RC.started) { try { await connectInit(); } catch { /* */ } }
  PB.ips = (rj.connectIps ? await rj.connectIps().catch(() => []) : []).filter((x) => x && x.ip);
  if (!PB.ips.length && RC.ip) PB.ips = [{ ip: RC.ip, name: T('Wi‑Fi') }];
  if (!PB.ips.length) { toast(T('Connect the TV to your home network to use PartyBox'), 'err'); return; }
  const token = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
  let port = 0;
  try { port = (await rj.partyServe(true, { token, page: partyGuestPage({ ended: false }), ended: partyGuestPage({ ended: true }) })).port; } catch { port = 0; }
  if (!port) { toast(T('I can\'t start PartyBox: no free network port'), 'err'); return; }
  Object.assign(PB, { on: true, token, port, ip: PB.ips[0].ip, sig: '', check: 'wait' });
  PB.guests.clear(); PB.reqs = []; PB.labels.clear(); PB.lastCur = cur() ? cur().path : '';
  clearInterval(PB.timer); PB.timer = setInterval(partyTick, 1000);
  railParty();
  if (S.view && S.view.name === 'party') render({ focus: true, anim: false });
  toast(`${T('{0} has started: have them scan the QR code', partyName())}`);
  if (rj.partyStats) rj.partyStats(true).catch(() => {});
  partySelfTest();
}
// the TV tries to connect to its own PartyBox, as a phone would: so it's clear right away if the network is the problem
async function partySelfTest() {
  if (!PB.on || !rj.connectFetch) return;
  PB.check = 'wait'; pbCheckUI();
  let ok = false;
  for (let i = 0; i < 2 && !ok && PB.on; i++) {
    try {
      const r = await rj.connectFetch({ host: PB.ip, port: PB.port, path: `/party?k=${PB.token}`, method: 'GET', body: null, binary: false, timeout: 6000 });
      ok = r && r.status === 200 && /<html/i.test(r.body || '');
    } catch { ok = false; }
  }
  if (!PB.on) return;
  PB.check = ok ? 'ok' : 'fail';
  pbCheckUI();
}
// diagnostics: how many requests really arrive from the phones and how they end
async function pbDiagUI() {
  const el = $('#pb-diag'); if (!el || !rj.partyStats) return;
  let d = null;
  try { d = await rj.partyStats(false); } catch { d = null; }
  if (!d || d.conn == null) { el.textContent = T('Information not available'); return; }
  const parts = [`${plural(d.conn, T('connection'), T('connections'))}`, `${plural(d.page, T('page sent'), T('pages sent'))}`, `${T('{0} of the app', plural(d.api, T('request'), T('requests')))}`];
  if (d.tls) parts.push(`${T('{0} over HTTPS (refused)', d.tls)}`);
  if (d.empty) parts.push(`${T('{0} with no data', d.empty)}`);
  if (d.err) parts.push(`${plural(d.err, T('error'), T('errors'))}${d.lastErr ? ` (${d.lastErr})` : ''}`);
  el.textContent = `${T('{0}{1} · port {2}', parts.join(' · '), d.from ? ` ${T('· last one from {0}', String(d.from).replace(/^\//, ''))}` : '', d.port || PB.port)}`;
}
setInterval(() => { if (PB.on && $('#pb-diag')) pbDiagUI(); }, 2000);
function pbCheckUI() {
  const el = $('#pb-check'); if (!el) return;
  el.className = 'pb-check ' + (PB.check || 'wait');
  el.innerHTML = PB.check === 'ok' ? `${icon('check')}<span>${T('PartyBox is ready on this network')}</span>`
    : PB.check === 'fail' ? `${icon('warn')}<span>${T('The TV isn\'t responding at the QR code address: try ending and restarting PartyBox')}</span>`
      : T('<span>Checking the network…</span>');
}
function partyStop() {
  PB.on = false; PB.token = '';
  rj.partyServe(false).catch(() => {});
  clearInterval(PB.timer);
  railParty();
  if (S.view && S.view.name === 'party') render({ focus: true, anim: false });
  toast(`${T('{0} is over. Thanks for the music!', partyName())}`);
}
function partyTick() {
  const p = cur() ? cur().path : '';
  if (p !== PB.lastCur) {
    for (const r of PB.reqs) {
      if (r.status === 'playing' && r.path !== p) r.status = 'played';
      if (r.status === 'queued' && r.path === p) r.status = 'playing';
    }
    for (const [path] of PB.labels) if (path === PB.lastCur && path !== p && !PB.reqs.some((r) => r.path === path && (r.status === 'queued' || r.status === 'playing'))) PB.labels.delete(path);
    PB.lastCur = p;
  }
  partyRefresh();
}

// ---------- guest requests ----------
const tOut = (t) => ({ id: t.path, title: t.title, artist: t.artist, album: t.album_.title, dur: Math.round(t.duration || 0), cover: t.cover ? t.albumKey : '' });
const htmlResp = (text, status = 200) => ({ status, text, type: 'text/html; charset=utf-8' });
const cleanName = (s) => String(s || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 24) || T('Guest');
// cover as a file on the TV (including those coming from another device)
async function coverFile(cover, size = 's') {
  const p = cover ? (size === 'l' ? cover.l : cover.s) : '';
  if (!p) return null;
  if (!isRemote(p)) return p;
  if (!window.Juke || !Juke.coverGet) return null;
  try { const r = await Juke.coverGet({ url: p, key: imgKey(p) }); return (r && r.file) || null; } catch { return null; }
}
async function partyHandle(req, url) {
  if (!PB.on || url.searchParams.get('k') !== PB.token) {
    if (url.pathname === '/party') return htmlResp(partyGuestPage({ ended: true }), 410);
    return { status: 410, body: { error: 'finito' } };
  }
  let b = {};
  try { b = req.body ? JSON.parse(req.body) : {}; } catch { b = {}; }
  const q = (k) => url.searchParams.get(k) || '';
  switch (url.pathname) {
    case '/party': return htmlResp(partyGuestPage({ ended: false }));
    case '/party/api/hello': { const g = partyGuest(b.c, b.name); return g ? okR({ ok: true, kicked: g.kicked }) : { status: 400, body: {} }; }
    case '/party/api/state': return okR(partyState(q('c')));
    case '/party/api/search': {
      const s = norm(q('q')).trim();
      if (!s) return okR({ tracks: [], albums: [] });
      const terms = s.split(/\s+/);
      const hit = (x) => terms.every((w) => x.includes(w));
      return okR({
        albums: S.albums.filter((a) => hit(a.s)).slice(0, 8).map((a) => ({ key: a.key, title: a.title, artist: a.artist, year: a.year || null, cover: a.cover ? a.key : '' })),
        tracks: S.tracks.filter((t) => hit(t.s)).slice(0, 50).map(tOut),
      });
    }
    case '/party/api/albums': return okR({ albums: S.albums.slice().sort((x, y) => (y.added || 0) - (x.added || 0)).slice(0, 600).map((a) => ({ key: a.key, title: a.title, artist: a.artist, year: a.year || null, cover: a.cover ? a.key : '' })) });
    case '/party/api/album': {
      const a = S.albumMap.get(q('key'));
      return a ? okR({ title: a.title, artist: a.artist, year: a.year || null, cover: a.cover ? a.key : '', tracks: a.tracks.map(tOut) }) : { status: 404, body: {} };
    }
    case '/party/api/cover': {
      const a = S.albumMap.get(q('a'));
      const f = a && a.cover ? await coverFile(a.cover, q('size') === 'l' ? 'l' : 's') : null;
      return f ? { file: f, type: 'image/jpeg' } : { status: 404, body: {} };
    }
    case '/party/api/request': return okR(partyRequest(b));
    case '/party/api/leave': return okR(partyLeave(b.c));
    default: return { status: 404, body: {} };
  }
}
function partyLeave(c) {
  const g = PB.guests.get(String(c || ''));
  if (!g) return { ok: true };
  if (g.kicked) return { ok: true, kicked: true };
  // requests still to approve leave with the guest; those already queued stay
  PB.reqs = PB.reqs.filter((r) => !(r.c === g.id && r.status === 'pending'));
  PB.guests.delete(g.id);
  toast(`${T('{0} left the {1}', g.name, partyName())}`);
  partyRefresh();
  return { ok: true };
}
function partyGuest(c, name) {
  c = String(c || '').slice(0, 40);
  if (!c) return null;
  let g = PB.guests.get(c);
  if (!g) {
    g = { id: c, name: cleanName(name), seen: Date.now(), kicked: false, joined: Date.now() };
    PB.guests.set(c, g);
    toast(`${T('{0} joined the {1} 🎉', g.name, partyName())}`);
  }
  if (name) g.name = cleanName(name);
  g.seen = Date.now();
  partyRefresh();
  return g;
}
function partyState(c) {
  const g = PB.guests.get(c);
  if (g) g.seen = Date.now();
  const t = cur();
  const cfg = partyCfg();
  const shown = new Set();
  const upcoming = S.queue.slice(S.qi + 1, S.qi + 21).map((x) => {
    const by = (!shown.has(x.path) && PB.labels.get(x.path)) || '';
    shown.add(x.path);
    return { ...tOut(x), by };
  });
  return {
    name: partyName(), host: nm(), mode: cfg.mode, limit: cfg.limit, kicked: !!(g && g.kicked),
    now: t ? { ...tOut(t), by: PB.labels.get(t.path) || '', pos: posSec(), playing: !!NP.playing, dur: durSec() } : null,
    next: upcoming,
    mine: PB.reqs.filter((r) => r.c === c).slice(-20).reverse().map((r) => { const x = S.byPath.get(r.path); return x ? { rid: r.rid, status: r.status, ...tOut(x) } : null; }).filter(Boolean),
    guests: [...PB.guests.values()].filter((x) => !x.kicked).length,
  };
}
function partyRequest(b) {
  const g = PB.guests.get(String(b.c || ''));
  if (!g) return { ok: false, message: T('Write your name first') };
  if (g.kicked) return { ok: false, kicked: true, message: T('You\'ve been removed from the PartyBox') };
  const t = S.byPath.get(b.id);
  if (!t) return { ok: false, message: T('Track not found') };
  const cfg = partyCfg();
  const active = PB.reqs.filter((r) => r.c === g.id && (r.status === 'pending' || r.status === 'queued'));
  if (cfg.limit > 0 && active.length >= cfg.limit) return { ok: false, message: `${T('You can have at most {0} waiting. Wait for one to play!', plural(cfg.limit, T('track'), T('tracks')))}` };
  if (PB.reqs.some((r) => r.path === t.path && (r.status === 'pending' || r.status === 'queued'))) return { ok: false, message: T('This track has already been requested') };
  if (cur() && cur().path === t.path) return { ok: false, message: T('It\'s already playing!') };
  const r = { rid: Math.random().toString(36).slice(2, 10), c: g.id, name: g.name, path: t.path, status: 'pending', at: Date.now() };
  PB.reqs.push(r);
  if (cfg.mode === 'free') {
    partyEnqueue(r);
    toast(`${T('{0} queued “{1}”', g.name, t.title)}`);
    partyRefresh();
    return { ok: true, status: 'queued', message: T('Queued! 🎶') };
  }
  toast(`${T('{0} wants to hear “{1}”: approve it in PartyBox', g.name, t.title)}`);
  partyRefresh();
  return { ok: true, status: 'pending', message: `${T('Request sent to {0}', nm() || T('the person in charge of the music'))}` };
}
// guests' tracks play after the current one, in the order they were requested
function partyEnqueue(r) {
  const t = S.byPath.get(r.path);
  if (!t) { r.status = 'rejected'; return; }
  r.status = 'queued';
  PB.labels.set(t.path, r.name);
  if (!cur()) {
    const rest = shuffled(S.tracks.filter((x) => x !== t)).slice(0, 150);
    playList([t, ...rest], 0, { shuffle: false });
    r.status = 'playing';
    PB.lastCur = t.path;
    return;
  }
  let at = S.qi + 1;
  for (let i = S.qi + 1; i < S.queue.length; i++) if (PB.labels.has(S.queue[i].path) && PB.reqs.some((x) => x !== r && x.path === S.queue[i].path && x.status === 'queued')) at = i + 1;
  S.queue.splice(at, 0, t);
  if (S.original) S.original.push(t);
  jcall(J.insert({ index: at, items: [itemFor(t)] }));
  saveState(); upNextUI();
}
function partyDecide(rid, yes) {
  const r = PB.reqs.find((x) => x.rid === rid);
  if (!r || r.status !== 'pending') return;
  if (yes) partyEnqueue(r); else r.status = 'rejected';
  partyRefresh();
}

// ---------- QR code ----------
function qrSVG(text, { fg = '#0b1f10' } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const finder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!qr.isDark(r, c) || finder(r, c)) continue;
    path += `M${c},${r}h1.02v1.02h-1.02z`;
  }
  const eye = (x, y) => `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.8" fill="none" stroke="${fg}" stroke-width="1"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.9" fill="${fg}"/>`;
  return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision"><path d="${path}" fill="${fg}"/>${eye(0, 0)}${eye(n - 7, 0)}${eye(0, n - 7)}</svg>`;
}

// ---------- PartyBox page ----------
const PB_ST = { pending: T('To approve'), queued: T('Queued'), playing: T('Playing'), played: T('Already played'), rejected: T('Declined') };
function pbSub() {
  const pending = PB.reqs.filter((r) => r.status === 'pending').length;
  const g = [...PB.guests.values()].filter((x) => !x.kicked).length;
  return `${plural(g, T('guest'), T('guests'))} · ${partyCfg().mode === 'free' ? T('open queue') : T('with approval')}${pending ? ` ${T('· {0} to approve', plural(pending, T('request'), T('requests')))}` : ''}`;
}
function pbSetRows() {
  const cfg = partyCfg();
  return `<button class="srow" data-f data-a="pb-mode"><span class="sl"><b>${T('How tracks arrive')}</b><span>${cfg.mode === 'free' ? T('The tracks picked by guests go straight into the queue') : T('You decide which requests go into the queue')}</span></span><span class="sval">${cfg.mode === 'free' ? T('Open queue') : T('With approval')}</span></button>
    <button class="srow" data-f data-a="pb-limit"><span class="sl"><b>${T('Waiting tracks per person')}</b><span>${T('How many tracks each guest can have in the queue')}</span></span><span class="sval">${esc(pbLimitTxt(cfg.limit))}</span></button>`;
}
function pbReqsHTML() {
  const list = PB.reqs.slice().sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.at - a.at).slice(0, 60);
  const pend = list.filter((r) => r.status === 'pending').length;
  if (!list.length) return `<div class="pb-empty" data-f tabindex="-1">${icon('sparkle')}<span><b>${T('No requests for now</b>{0}', partyCfg().mode === 'free' ? T('The tracks picked by guests go straight into the queue, after the one that\'s playing.') : T('When someone picks a track, you\'ll find it here to approve.'))}</span></div>`;
  return `${pend > 1 ? `<button class="tbtn pb-all" data-f data-a="pb-all">${T('{0}Approve all ({1})', icon('check'), pend)}</button>` : ''}${list.map((r) => {
    const t = S.byPath.get(r.path); if (!t) return '';
    return `<div class="pb-row ${r.status}">${artHTML(t.cover, t.albumKey)}<span class="tx"><span class="tt">${esc(t.title)}</span><span class="ta">${esc(t.artist)} · <b>${esc(r.name)}</b></span></span>
      ${r.status === 'pending' ? `<button class="pb-ic yes" data-f data-a="pb-yes:${r.rid}" aria-label="${T('Approve')}">${icon('check')}</button><button class="pb-ic no" data-f data-a="pb-no:${r.rid}" aria-label="${T('Decline')}">${icon('close')}</button>` : `<span class="pb-st">${PB_ST[r.status]}</span>`}</div>`;
  }).join('')}`;
}
function pbGuestsHTML() {
  const list = [...PB.guests.values()].sort((a, b) => b.joined - a.joined);
  if (!list.length) return `<div class="pb-empty" data-f tabindex="-1">${icon('person')}<span><b>${T('No guests yet</b>Whoever scans the QR code and writes their name shows up here.')}</span></div>`;
  return list.map((g) => {
    const n = PB.reqs.filter((r) => r.c === g.id && r.status !== 'rejected').length;
    return `<div class="pb-row${g.kicked ? ' kicked' : ''}"><span class="pb-av" style="${phStyle(g.id)}">${esc(g.name.slice(0, 1).toUpperCase())}</span><span class="tx"><span class="tt">${esc(g.name)}</span><span class="ta">${g.kicked ? T('Removed') : plural(n, T('track picked'), T('tracks picked'))}</span></span>
      <button class="tbtn sm" data-f data-a="pb-${g.kicked ? 'unkick' : 'kick'}:${esc(g.id)}">${g.kicked ? T('Let back in') : T('Remove')}</button></div>`;
  }).join('');
}
VIEWS.party = () => {
  if (!PB.on) {
    const el = h(`<div class="page party" data-scroll>
      <header class="ph"><h1>${T('PartyBox')}</h1><p>${T('Friends pick the music playing on the TV from their phones, nothing to install.')}</p></header>
      <div class="pb-how" data-sec>
        <div class="pb-step"><i>${T('1</i><b>Start PartyBox')}</b><span>${T('A QR code appears on the TV')}</span></div>
        <div class="pb-step"><i>${T('2</i><b>Friends scan it')}</b><span>${T('With the phone camera, on the same Wi‑Fi as the TV')}</span></div>
        <div class="pb-step"><i>${T('3</i><b>They pick the tracks')}</b><span>${T('They go into the queue after the one that\'s playing')}</span></div>
      </div>
      <div class="btns" data-sec><button class="tbtn primary" data-f data-autofocus data-a="pb-start">${T('{0}Start PartyBox', icon('party'))}</button></div>
      <h2>${T('Party rules')}</h2>
      <div class="slist" data-sec>${pbSetRows()}</div>
    </div>`);
    el.addEventListener('click', pbClick);
    return el;
  }
  const net = PB.ips.find((x) => x.ip === PB.ip);
  const el = h(`<div class="page party on" data-scroll>
    <header class="ph"><h1>${esc(partyName())}</h1><p id="pb-sub">${esc(pbSub())}</p></header>
    <div class="pb-grid">
      <div class="pb-qrcard" data-f data-autofocus tabindex="-1">
        <div class="pb-qr">${qrSVG(partyUrl())}</div>
        <b>${T('Scan with the camera to pick the music')}</b>
        <span class="pb-url">${esc(partyUrl().replace(/^http:\/\//, ''))}</span>
        <span class="pb-net">${T('Phone and TV on the same home network')}</span>
        <span id="pb-check"></span>
      </div>
      <div class="pb-side">
        <section data-sec><h2>${T('Requests')}</h2><div class="pb-list" id="pb-reqs">${pbReqsHTML()}</div></section>
        <section data-sec><h2>${T('Guests')}</h2><div class="pb-list" id="pb-guests">${pbGuestsHTML()}</div></section>
        <section data-sec><h2>${T('If a phone can\'t connect')}</h2><div class="slist"><div class="srow static" data-f tabindex="-1"><span class="sl"><b>${T('Check the phone\'s network')}</b><span>${T('It must be connected to the TV\'s home network (not the “guest” one, nor mobile data), with no VPN or ad-blocking app turned on. Then scan the QR code again')}</span></span></div>
          <div class="srow static" data-f tabindex="-1"><span class="sl"><b>${T('Chrome says “This site can\'t be reached”')}</b><span>${T('On the phone open Settings → Apps → Chrome → Permissions → Nearby devices and choose “Allow”. Or open the link with another browser')}</span></span></div>
          <div class="srow static" data-f tabindex="-1"><span class="sl"><b>${T('What the TV receives')}</b><span id="pb-diag">…</span></span></div></div></section>
        <section data-sec><h2>${T('Party rules')}</h2><div class="slist">${pbSetRows()}${PB.ips.length > 1 ? `<button class="srow" data-f data-a="pb-ip"><span class="sl"><b>${T('Network for guests')}</b><span>${T('The QR code uses this network')}</span></span><span class="sval">${esc(net ? net.name : PB.ip)}</span></button>` : ''}
          <button class="srow danger" data-f data-a="pb-stop"><span class="sl"><b>${T('End PartyBox')}</b><span>${T('Guests won\'t be able to pick tracks anymore. The ones already queued stay')}</span></span>${icon('close')}</button></div></section>
      </div>
    </div>
  </div>`);
  el.addEventListener('click', pbClick);
  PB.sig = pbSig();
  setTimeout(pbCheckUI, 0);
  return el;
};
const pbSig = () => PB.reqs.map((r) => r.rid + r.status).join() + '|' + [...PB.guests.values()].map((g) => g.id + g.name + g.kicked).join() + '|' + PB.reqs.length;
async function pbClick(e) {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const [a, arg] = b.dataset.a.split(/:(.*)/s);
  if (a === 'pb-start') partyStart();
  if (a === 'pb-stop') { if (await confirmModal({ title: `${T('End the {0}?', partyName())}`, text: T('Guests won\'t be able to pick tracks anymore. The ones already queued stay.'), ok: T('End'), danger: true })) partyStop(); }
  if (a === 'pb-mode') { await partySaveCfg({ mode: partyCfg().mode === 'free' ? 'approve' : 'free' }); pbRefreshSet(); }
  if (a === 'pb-limit') { const l = partyCfg().limit; await partySaveCfg({ limit: PB_LIMITS[(PB_LIMITS.indexOf(l) + 1) % PB_LIMITS.length] }); pbRefreshSet(); }
  if (a === 'pb-ip') { const i = PB.ips.findIndex((x) => x.ip === PB.ip); PB.ip = PB.ips[(i + 1) % PB.ips.length].ip; refreshView(); }
  if (a === 'pb-yes' || a === 'pb-no') partyDecide(arg, a === 'pb-yes');
  if (a === 'pb-all') { PB.reqs.filter((r) => r.status === 'pending').forEach((r) => partyEnqueue(r)); partyRefresh(); }
  if (a === 'pb-kick' || a === 'pb-unkick') {
    const g = PB.guests.get(arg); if (!g) return;
    g.kicked = a === 'pb-kick';
    if (g.kicked) { PB.reqs.filter((r) => r.c === g.id && r.status === 'pending').forEach((r) => { r.status = 'rejected'; }); toast(`${T('{0} has been removed', g.name)}`); }
    partyRefresh();
  }
}
function pbRefreshSet() {
  const page = $('#tv-main .page.party'); if (!page) return;
  const a = document.activeElement && document.activeElement.dataset.a;
  for (const k of ['pb-mode', 'pb-limit']) {
    const old = $(`[data-a="${k}"]`, page); if (!old) continue;
    const tmp = document.createElement('div'); tmp.innerHTML = pbSetRows();
    const nw = $(`[data-a="${k}"]`, tmp);
    old.replaceWith(nw);
    if (a === k) focusEl(nw, { scroll: false });
  }
  const sub = $('#pb-sub'); if (sub) sub.textContent = pbSub();
}
// I update only the lists, keeping the selection where it is (or on the nearby element)
function partyRefresh() {
  railParty();
  const page = $('#tv-main .page.party.on');
  if (!page) return;
  const sub = $('#pb-sub'); if (sub) sub.textContent = pbSub();
  const sig = pbSig();
  if (sig === PB.sig) return;
  PB.sig = sig;
  for (const [id, fn] of [['#pb-reqs', pbReqsHTML], ['#pb-guests', pbGuestsHTML]]) {
    const box = $(id, page); if (!box) continue;
    const a = document.activeElement;
    const had = a && box.contains(a);
    const idx = had ? $$('[data-f]', box).indexOf(a) : -1;
    const key = had ? a.dataset.a : null;
    box.innerHTML = fn();
    if (had) {
      const all = $$('[data-f]', box);
      const t = (key && all.find((x) => x.dataset.a === key)) || all[Math.min(idx, all.length - 1)];
      if (t) focusEl(t); else { const nx = $$('[data-f]', page).find((x) => !box.contains(x)); if (nx) focusEl(nx); }
    }
  }
}
function railParty() {
  const r = $('#tv-rail .rail-item[data-view="party"]'); if (!r) return;
  r.classList.toggle('live', PB.on);
  const pending = PB.on ? PB.reqs.filter((x) => x.status === 'pending').length : 0;
  let d = $('.rail-badge', r);
  r.classList.toggle('has-badge', !!pending);
  if (!pending) { if (d) d.remove(); return; }
  if (!d) { d = document.createElement('i'); d.className = 'rail-badge'; r.appendChild(d); }
  d.textContent = pending;
}

// ---------- page navigation ----------
const RAIL = [['home', 'home', T('Home')], ['search', 'search', T('Search')], ['tracks', 'note', T('Tracks')], ['albums', 'album', T('Albums')], ['artists', 'mic', T('Artists')], ['playlists', 'playlist', T('Playlists')], ['party', 'party', T('PartyBox')], ['settings', 'settings', T('Settings')]];
function go(name, param = null, { replace = false, focus = true } = {}) {
  if (S.view && !replace) S.stack.push({ ...S.view, scroll: ($('#tv-main .page') || {}).scrollTop || 0, focusKey: focusKeyOf(document.activeElement) });
  S.view = { name, param };
  render({ focus });
}
function focusKeyOf(el) {
  if (!el || !el.closest || !el.closest('#tv-main')) return null;
  for (const k of ['album', 'artist', 'pl', 'path', 'a']) if (el.dataset[k]) return `[data-${k === 'pl' ? 'pl' : k}="${CSS.escape(el.dataset[k])}"]`;
  return null;
}
function render({ focus = true, restore = null, anim = true } = {}) {
  const main = $('#tv-main');
  let el;
  try { el = (VIEWS[S.view.name] || VIEWS.home)(S.view.param); } catch (e) { console.error(e); el = h(`<div class="page empty" data-scroll><div class="empty-box">${icon('note')}<h2>${T('Something went wrong')}</h2><p>${esc(e.message)}</p></div></div>`); }
  if (anim) el.classList.add('enter');
  main.replaceChildren(el);
  requestAnimationFrame(chipScrolled);
  $$('#tv-rail .rail-item').forEach((r) => r.classList.toggle('on', r.dataset.view === S.view.name || (S.view.name === 'album' && r.dataset.view === 'albums' && !S.stack.length)));
  if (restore) {
    if (restore.focusKey && el.__fillUntil) el.__fillUntil(restore.focusKey);
    el.scrollTop = restore.scroll || 0;
    const t = restore.focusKey && $(restore.focusKey, el);
    if (focus) { if (t) focusEl(t); else defaultFocus(); }
  } else if (focus) requestAnimationFrame(() => defaultFocus());
}
function refreshView() {
  if (!S.view) return;
  const page = $('#tv-main .page');
  const keep = { scroll: page ? page.scrollTop : 0, focusKey: focusKeyOf(document.activeElement) };
  const inMain = document.activeElement && document.activeElement.closest('#tv-main');
  render({ focus: !!inMain, restore: keep, anim: false });
}
function goBack() {
  const v = S.stack.pop();
  if (!v) return false;
  S.view = { name: v.name, param: v.param };
  render({ restore: v });
  return true;
}
// on Home: Back goes to the sidebar, a second Back asks whether to exit
let exitAsking = false;
async function askExit() {
  if (exitAsking) return;
  exitAsking = true;
  const yes = await confirmModal({ title: T('Quit the app?'), text: NP.playing ? T('The music will stop.') : T('You can reopen rJuke whenever you want from the TV\'s home screen.'), ok: T('Sign out') });
  exitAsking = false;
  if (!yes) return;
  saveState();
  if (PB.on) { PB.on = false; try { await rj.partyServe(false); } catch { /* */ } }
  if (J.exitApp) J.exitApp().catch(() => J.moveToBack && J.moveToBack());
  else if (J.moveToBack) J.moveToBack();
}
function onBack() {
  if (MODALS.length) { MODALS[MODALS.length - 1](null); return; }
  if (!$('#tv-setup').hidden) { if (SETUP.back) SETUP.back(); return; }
  if (S.npOpen) { closeNP(); return; }
  const a = document.activeElement;
  if (a && a.closest('#tv-rail')) { if (S.view.name !== 'home') go('home'); else askExit(); return; }
  if (goBack()) return;
  if (S.view.name !== 'home') { go('home'); return; }
  // on Home: first back to the sidebar, then exit
  const r = $('#tv-rail .rail-item.on');
  if (r) focusEl(r);
}

// ===================== full-screen Player =====================
function openNP() {
  if (!cur()) return;
  S.npOpen = true;
  const np = $('#tv-np');
  np.hidden = false;
  np.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => np.classList.add('on'));
  npRender(true);
  setTimeout(() => focusEl($('#np-play')), 60);
  npWake();
}
function closeNP() {
  S.npOpen = false;
  const np = $('#tv-np');
  np.classList.remove('on', 'idle');
  np.setAttribute('aria-hidden', 'true');
  setTimeout(() => { if (!S.npOpen) np.hidden = true; }, 420);
  const back = NAV.lastMain && NAV.lastMain.isConnected && isVis(NAV.lastMain) ? NAV.lastMain : null;
  if (back) focusEl(back, { scroll: false }); else defaultFocus();
}
let npIdleT = 0;
function npWake() {
  const np = $('#tv-np');
  if (!np) return;
  if (np.classList.contains('idle')) { np.classList.remove('idle'); upFit(); }
  clearTimeout(npIdleT);
  if (S.npOpen) npIdleT = setTimeout(() => { if (S.npOpen && !MODALS.length) np.classList.add('idle'); }, 12000);
}
let npShown = '';
function npRender(force) {
  const t = cur();
  if (!t || (!force && npShown === t.path)) { upNextUI(); return; }
  npShown = t.path;
  const big = t.cover ? t.cover.l : '';
  const art = $('#np-art');
  const bg = $('#np-bg');
  art.classList.add('swap');
  setTimeout(() => {
    art.innerHTML = big ? `<img ${imgAttrs(big)} alt="" onload="this.classList.add('ld')">` : `<div class="ph" style="${phStyle(t.albumKey)}">${icon('note')}</div>`;
    art.classList.remove('swap');
  }, force ? 0 : 180);
  const nbg = h(`<div class="np-bgimg"${bgAttrs(t.cover, t.albumKey)}></div>`);
  bg.appendChild(nbg);
  requestAnimationFrame(() => { nbg.classList.add('on'); [...bg.children].forEach((c) => { if (c !== nbg) c.classList.remove('on'); }); });
  while (bg.children.length > 2) bg.firstElementChild.remove();
  const cols = (t.cover && t.cover.colors) || null;
  $('#tv-np').style.setProperty('--np-c', cols && cols[0] ? cols[0] : '#1d5a3a');
  const by = PB.on && PB.labels.get(t.path);
  $('#np-kicker').textContent = by ? `${T('Picked by {0} · PartyBox', by)}` : S.ctx && S.ctx.type === 'playlist' && S.plMap.get(S.ctx.id) ? `${T('From the playlist “{0}”', S.plMap.get(S.ctx.id).name)}` : `${T('From the album “{0}”', t.album_.title)}`;
  $('#np-title').textContent = t.title;
  $('#np-artist').textContent = t.artist;
  upNextUI();
  progressUI(true);
}
function upNextUI() {
  const box = $('#np-up');
  if (!box) return;
  const up = S.queue.slice(S.qi + 1, S.qi + 4);
  box.innerHTML = up.length ? `<div class="up-h">${T('Up next')}</div>${up.map((x) => `<div class="up">${artHTML(x.cover, x.albumKey)}<span class="tx"><span class="tt">${esc(x.title)}</span><span class="ta">${esc(x.artist)}</span></span></div>`).join('')}` : T('<div class="up-h">Last track in the queue</div>');
  upFit();
}
// “Up next” shows only the tracks that fit, without ending up over the title or the bar
function upFit() {
  const box = $('#np-up');
  if (!box || !S.npOpen) return;
  requestAnimationFrame(() => {
    const items = $$('.up', box);
    items.forEach((x) => { x.hidden = false; });
    for (let i = items.length - 1; i >= 0 && box.scrollHeight > box.clientHeight + 1; i--) items[i].hidden = true;
    const h = $('.up-h', box);
    if (h) h.hidden = box.scrollHeight > box.clientHeight + 1;
  });
}
function playStateUI() {
  const p = $('#np-play');
  if (p) { p.innerHTML = icon(NP.playing ? 'pause' : 'play'); p.setAttribute('aria-label', NP.playing ? T('Pause') : T('Play')); }
  S.playing = NP.playing;
  $('#tv').classList.toggle('playing', NP.playing);
  chipUI();
  const k = $('.home .hero .kicker');
  if (k && cur()) { k.textContent = NP.playing ? T('Now playing') : T('Pick up where you left off'); }
  const hb = $('.home .hero [data-a="np"]');
  if (hb) hb.innerHTML = `${icon(NP.playing ? 'enlarge' : 'play')}${NP.playing ? T('Open the player') : T('Resume')}`;
}
function modeUI() {
  const sh = $('#np-shuffle'), re = $('#np-repeat');
  if (sh) { sh.classList.toggle('on', S.shuffle); }
  if (re) { re.classList.toggle('on', S.repeat !== 'off'); re.innerHTML = icon(S.repeat === 'one' ? 'repeat1' : 'repeat'); }
}
let lastProg = '';
function progressUI(force) {
  const d = durSec(), p = Math.min(posSec(), d || Infinity);
  const k = `${Math.floor(p)}|${Math.floor(d)}`;
  const fill = $('#np-fill');
  if (fill) fill.style.transform = `scaleX(${d ? clamp(p / d, 0, 1) : 0})`;
  const cf = $('#chip-fill');
  if (cf) cf.style.transform = `scaleX(${d ? clamp(p / d, 0, 1) : 0})`;
  if (!force && k === lastProg) return;
  lastProg = k;
  $('#np-cur').textContent = fmtTime(p);
  $('#np-rem').textContent = '-' + fmtTime(Math.max(0, d - p));
}
function chipUI() {
  const t = cur();
  const chip = $('#tv-chip');
  chip.hidden = !t;
  if (!t) return;
  if (chip.dataset.k !== t.path) {
    chip.dataset.k = t.path;
    $('.chip-art', chip).innerHTML = t.cover ? `<img ${imgAttrs(t.cover.s)} alt="" onload="this.classList.add('ld')">` : `<div class="ph" style="${phStyle(t.albumKey)}">${icon('note')}</div>`;
    $('.chip-t', chip).textContent = t.title;
    $('.chip-a', chip).textContent = t.artist;
  }
}
function onTrackChange(changed) {
  const t = cur();
  chipUI();
  if (S.npOpen) npRender(false);
  $$('.trow').forEach((r) => {
    const on = !!t && r.dataset.path === t.path;
    if (on === r.classList.contains('playing')) return;
    r.classList.toggle('playing', on);
    const n = $('.tn', r);
    if (n) n.innerHTML = on ? '<span class="eq"><i></i><i></i><i></i></span>' : esc(r.dataset.num || '');
  });
  if (S.view && S.view.name === 'home' && changed) refreshHomeHero();
  loadLyrics(t);
  if (t && t.remote) phonePrefetch(S.qi);
  ambient(t);
}
function refreshHomeHero() {
  const old = $('.home .hero');
  if (!old) return;
  const fresh = VIEWS.home();
  const nh = $('.hero', fresh);
  if (!nh) return;
  const hadFocus = old.contains(document.activeElement);
  nh.classList.add('swap');
  old.replaceWith(nh); // clicks are handled by the page, so the new buttons already work
  if (hadFocus) focusEl($('[data-f]', nh), { scroll: false });
}
function ambient(t) {
  const c = (t && t.cover && t.cover.colors) || null;
  $('#tv').style.setProperty('--amb', c && c[0] ? c[0] : '#173d2a');
}

// ---------- synced lyrics ----------
let lyrTok = 0;
async function loadLyrics(t) {
  const tok = ++lyrTok;
  S.lyrics = null; lyricsUI();
  if (!t) return;
  // an Android phone's track list doesn't say which ones have lyrics: I always look for them
  let data = null;
  try { data = t.remote ? await phoneLyrics(t) : await rj.lyrics(t.path); } catch { data = null; }
  if (data && !(data.synced ? (data.lines || []).length : String(data.text || '').trim())) data = null;
  if (tok !== lyrTok) return;
  S.lyrics = data;
  lyricsUI();
}
let lyrIdx = -2;
function lyricsUI() {
  const box = $('#np-lyrics');
  const np = $('#tv-np');
  const d = S.lyrics;
  lyrIdx = -2;
  np.classList.toggle('has-lyrics', !!d);
  if (!d) { box.innerHTML = ''; return; }
  if (d.synced) box.innerHTML = `<div class="ly-in">${d.lines.map((l, i) => `<p data-l="${i}">${esc(l.text || '♪')}</p>`).join('')}</div>`;
  else box.innerHTML = `<div class="ly-in plain">${String(d.text || '').split(/\n+/).slice(0, 60).map((l) => `<p>${esc(l)}</p>`).join('')}</div>`;
  lyricsTick(true);
}
function lyricsTick(force) {
  const d = S.lyrics;
  if (!d || !d.synced || !S.npOpen) return;
  const ms = posSec() * 1000 + 150;
  let i = -1;
  for (let k = 0; k < d.lines.length; k++) { if (d.lines[k].t <= ms) i = k; else break; }
  if (i === lyrIdx && !force) return;
  lyrIdx = i;
  const box = $('#np-lyrics'), inner = $('.ly-in', box);
  if (!inner) return;
  $$('p', inner).forEach((p, k) => { p.classList.toggle('on', k === i); p.classList.toggle('past', k < i); });
  const p = $(`p[data-l="${Math.max(0, i)}"]`, inner);
  if (p) inner.style.transform = `translateY(${-(p.offsetTop - box.clientHeight * 0.3)}px)`;
}

// ---------- frame: progress and lyrics ----------
function loop() {
  if (NP.playing || S.npOpen) {
    if (S.npOpen || !$('#tv-chip').hidden) progressUI(false);
    lyricsTick(false);
  }
  // paused and with no Player open, checking now and then is enough
  if (NP.playing || S.npOpen) requestAnimationFrame(loop); else setTimeout(() => requestAnimationFrame(loop), 250);
}

// ===================== rJuke Connect on the TV =====================
const RC = { me: null, started: false, devices: new Map(), ip: '', port: 0, asked: new Set() };
async function rc(d, path, { method = 'GET', body = null, timeout = 8000 } = {}) {
  const r = await rj.connectFetch({ host: d.host, port: d.port, path, method, body: body ? JSON.stringify(body) : null, binary: false, timeout });
  let data = {};
  try { data = JSON.parse(r.body || '{}'); } catch { data = {}; }
  if (r.status === 403 && data.error === 'pending') { const e = new Error('pending'); e.pending = true; throw e; }
  if (r.status >= 400) throw new Error(data.error || 'errore ' + r.status);
  return data;
}
async function probeDevice(host, port) {
  const info = await rc({ host, port }, '/rj/info', { timeout: 5000 });
  if (!info.id || info.id === RC.me.id) throw new Error(T('This is your own device'));
  const d = { id: info.id, name: info.name, platform: info.platform, tv: !!info.tv, icon: info.icon || '', host, port, manual: true };
  RC.devices.set(d.id, d);
  devicesChanged();
  return d;
}
function devicesChanged() {
  if (PAIR.refresh) PAIR.refresh();
  if (phoneMode() && PH.online === false && !PH.busy && [...RC.devices.values()].some((d) => d.id === phoneDev().id || d.name === phoneDev().name)) phoneSync();
}
function connectInit() {
  if (!RC.startP) RC.startP = connectStartNow();
  return RC.startP;
}
async function connectStartNow() {
  if (!S.settings.deviceId) {
    const id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, '');
    S.settings = await rj.setSettings({ deviceId: id });
  }
  RC.me = tvMe();
  rj.onConnectRequest(connectHandle);
  rj.onConnectDevices((list) => {
    for (const [k, d] of RC.devices) if (!d.manual) RC.devices.delete(k);
    for (const d of list) if (d.id !== RC.me.id) RC.devices.set(d.id, d);
    devicesChanged();
  });
  try { const r = await rj.connectStart(RC.me); RC.ip = r.ip; RC.port = r.port; RC.started = true; } catch (e) { console.warn(T('Connect not started'), e); RC.startP = null; }
  for (const m of S.settings.connectManual || []) probeDevice(m.host, m.port).catch(() => {});
  setTimeout(() => { if (!RC.devices.size) rj.connectScan().catch(() => {}); }, 5000);
  const me = $('#tv-me'); if (me && RC.ip) me.textContent = `${T('{0} · address {1}:{2}', tvName(), RC.ip, RC.port)}`;
}
const okR = (body) => ({ status: 200, body });
const trackMeta = (t) => ({ title: t.title, artist: t.artist, album: t.album_.title, duration: t.duration || 0 });
function connectState() {
  const t = cur();
  return {
    id: RC.me.id, name: RC.me.name, platform: 'android',
    playing: !!NP.playing, position: posSec(), duration: durSec(),
    track: t ? { ...trackMeta(t), key: t.path } : null,
    cover: !!(t && t.cover), coverColors: t && t.cover ? t.cover.colors : null,
    qStart: S.qi, total: S.queue.length, queue: S.queue.slice(Math.max(0, S.qi), S.qi + 300).map(trackMeta),
    shuffle: !!S.shuffle, repeat: S.repeat, volume: null,
  };
}
function askTrust(dev) {
  if (RC.asked.has(dev.id)) return;
  RC.asked.add(dev.id);
  confirmModal({ title: `${T('Connect “{0}”?', dev.name || 'dispositivo')}`, text: `${T('{0} wants to control the music on this TV with rJuke Connect. Only allow your own devices.', dev.name || T('A device'))}`, ok: T('Allow') })
    .then(async (yes) => {
      if (yes) { S.settings = await rj.setSettings({ connectTrusted: { ...(S.settings.connectTrusted || {}), [dev.id]: dev.name || T('Device') } }); toast(`${T('{0} can now control the TV', dev.name)}`); }
      else setTimeout(() => RC.asked.delete(dev.id), 60000);
    });
}
function fileOut(p) { return /^https?:/.test(p || '') ? null : p; }
async function connectHandle(req) {
  const url = new URL(req.path, 'http://rj');
  const dev = req.device || {};
  if (req.kind === 'party') return url.pathname === '/party' || url.pathname.startsWith('/party/') ? partyHandle(req, url) : { status: 404, body: {} };
  if (url.pathname.startsWith('/party') || url.pathname.startsWith('/rj/lib/')) return { status: 404, body: { error: T('not available on the TV') } };
  if (url.pathname !== '/rj/info') {
    const trusted = S.settings.connectTrusted || {};
    if (!dev.id) return { status: 403, body: { error: 'unknown device' } };
    if (!trusted[dev.id]) { askTrust(dev); return { status: 403, body: { error: 'pending' } }; }
  }
  let b = {};
  try { b = req.body ? JSON.parse(req.body) : {}; } catch { b = {}; }
  switch (url.pathname) {
    case '/rj/info': {
      const info = { id: RC.me.id, name: RC.me.name, platform: 'android', tv: true, icon: tvIcon(), version: S.info.version || '' };
      return okR(info);
    }
    case '/rj/state': return okR(connectState());
    case '/rj/cover': { const t = cur(); const f = t && t.cover ? await coverFile(t.cover, 'l') : null; return f ? { file: f, type: 'image/jpeg' } : { status: 404, body: {} }; }
    case '/rj/albumcover': { const a = S.albumMap.get(url.searchParams.get('key')); const f = a && a.cover ? await coverFile(a.cover, 's') : null; return f ? { file: f, type: 'image/jpeg' } : { status: 404, body: {} }; }
    case '/rj/library': return okR({
      albums: S.albums.map((a) => ({ key: a.key, title: a.title, artist: a.artist, year: a.year || null, cover: !!a.cover })),
      playlists: S.playlists.map((p) => ({ id: p.id, name: p.name, count: plTracks(p).length })),
    });
    case '/rj/search': {
      const nq = norm(url.searchParams.get('q') || '').trim();
      if (!nq) return okR({ tracks: [], albums: [], artists: [] });
      const terms = nq.split(/\s+/); const hit = (s) => terms.every((w) => s.includes(w));
      return okR({
        artists: S.artists.filter((a) => hit(a.s)).slice(0, 6).map((a) => ({ key: a.key, name: a.name, count: a.tracks.length, cover: ((a.albums.find((x) => x.cover) || a.appears.find((x) => x.cover)) || {}).key || '' })),
        albums: S.albums.filter((a) => hit(a.s)).slice(0, 8).map((a) => ({ key: a.key, title: a.title, artist: a.artist, year: a.year || null, cover: !!a.cover })),
        tracks: S.tracks.filter((t) => hit(t.s)).slice(0, 40).map((t) => ({ id: t.path, title: t.title, artist: t.artist, album: t.album_.title, duration: t.duration || 0, cover: t.cover ? t.albumKey : '' })),
      });
    }
    case '/rj/cmd': {
      switch (b.cmd) {
        case 'toggle': togglePlay(); break;
        case 'play': if (!NP.playing) togglePlay(); break;
        case 'pause': if (NP.playing) togglePlay(); break;
        case 'next': next(); break;
        case 'prev': prev(); break;
        case 'seek': seekTo(+b.pos || 0); break;
        case 'shuffle': toggleShuffle(); break;
        case 'repeat': cycleRepeat(); break;
        case 'skip': if (b.i >= 0 && b.i < S.queue.length) loadTrack(+b.i); break;
        case 'album': { const a = S.albumMap.get(b.key); if (a) playList(a.tracks, +b.index || 0, { shuffle: !!b.shuffle, ctx: { type: 'album', key: a.key } }); break; }
        case 'playlist': { const p = S.plMap.get(b.id); if (p) playList(plTracks(p), 0, { shuffle: !!b.shuffle, ctx: { type: 'playlist', id: p.id } }); break; }
        case 'shuffleAll': if (S.tracks.length) playList(S.tracks, 0, { shuffle: true }); break;
        case 'track': { const t = S.byPath.get(b.id); if (t) { const a = t.album_; playList(a.tracks, Math.max(0, a.tracks.indexOf(t)), { shuffle: false, ctx: { type: 'album', key: a.key } }); } break; }
        case 'enqueue': { const t = S.byPath.get(b.id); if (t) { if (cur()) playNext([t]); else playList([t], 0, { shuffle: false }); } break; }
        case 'artist': { const ar = S.artistMap.get(b.key); if (ar && ar.tracks.length) playList(ar.tracks, 0, { shuffle: true }); break; }
        default: break;
      }
      await sleep(180);
      return okR(connectState());
    }
    case '/rj/handoff': {
      const q = Array.isArray(b.queue) ? b.queue.slice(0, 500) : [];
      const k1 = new Map();
      for (const t of S.tracks) { const a = norm(t.title) + '|' + norm(t.artist); if (!k1.has(a)) k1.set(a, t); }
      const m = q.map((x) => k1.get(norm(x.title) + '|' + norm(x.artist)) || null);
      const found = m.filter(Boolean);
      if (!found.length) return okR({ ok: false, error: T('None of these tracks is in the TV\'s library') });
      playList(found, 0, { shuffle: false });
      if (m[0] && b.position > 1) setTimeout(() => seekTo(+b.position), 450);
      toast(`${T('Music moved here from {0}', dev.name || T('another device'))}`);
      openNP();
      return okR({ ok: true, matched: found.length, total: q.length, exact: !!m[0] });
    }
    default: return { status: 404, body: { error: T('not found') } };
  }
}

// ===================== pairing with the phone or the PC =====================
const PAIR = { refresh: null };
function pairUI(box, onDone) {
  box.innerHTML = `<div class="pair-list"></div>
    <div class="pair-man"><button class="tbtn ghost" data-f data-a="addr">${T('{0}Connect with an address', icon('plus'))}</button><span class="pair-hint">${T('You\'ll find it on the phone in Settings › rJuke Connect › This device')}</span></div>`;
  const list = $('.pair-list', box);
  const st = new Map();
  let alive = true, active = null, t0 = Date.now();
  const devs = () => [...RC.devices.values()].sort((a, b) => (a.platform === 'android' ? 0 : 1) - (b.platform === 'android' ? 0 : 1) || coll.compare(a.name, b.name));
  const draw = () => {
    if (!alive) return;
    const keep = document.activeElement && list.contains(document.activeElement) ? document.activeElement.dataset.id : null;
    const ds = devs();
    if (!ds.length) {
      const late = Date.now() - t0 > 10000;
      list.innerHTML = late
        ? `<div class="pair-empty"><span>${T('No devices found. Open rJuke on your phone or PC, on the same Wi‑Fi as the TV.')}</span><button class="tbtn" data-f data-a="retry">${T('{0}Search again', icon('refresh'))}</button></div>`
        : `<div class="pair-empty"><span class="spin"></span><span>${T('Looking for your devices on the network…')}</span></div>`;
      const r = $('[data-a="retry"]', list);
      if (r) r.addEventListener('click', () => { t0 = Date.now(); rj.connectScan().catch(() => {}); draw(); defaultFocus(); });
      return;
    }
    list.innerHTML = ds.map((d) => {
      const s = st.get(d.id) || { state: 'idle' };
      const sub = s.state === 'wait' ? (d.platform === 'android' ? T('On the phone tap “Allow”') : `${T('On {0} tap “Allow”', d.name)}`) : s.state === 'load' ? (s.msg || T('Receiving the library…')) : s.state === 'err' ? s.msg : d.tv ? T('Use the music on this TV') : d.platform === 'android' ? T('Use the music on this phone') : T('Use the music on this PC');
      const busy = s.state === 'wait' || s.state === 'load';
      return `<button class="pdev ${s.state}" data-f data-id="${esc(d.id)}" ${active && active !== d.id ? 'disabled' : ''}><span class="pd-i">${icon(devIcon(d))}</span><span class="pd-tx"><b>${esc(d.name)}</b><span>${esc(sub)}</span></span><span class="pd-go">${busy ? '<span class="spin"></span>' : icon('forward')}</span></button>`;
    }).join('');
    const back = keep && $(`[data-id="${CSS.escape(keep)}"]`, list);
    if (back) focusEl(back, { scroll: false });
    else if (!document.activeElement || !document.activeElement.matches(FOC) || !document.activeElement.isConnected) defaultFocus();
  };
  const pair = async (d) => {
    const rowId = d.id;
    if (active) return;
    active = rowId;
    st.set(rowId, { state: 'load', msg: T('Connecting…') }); draw();
    try { const info = await rc(d, '/rj/info', { timeout: 5000 }); if (info.id) d = { ...d, id: info.id, name: info.name || d.name }; } catch { st.set(rowId, { state: 'err', msg: T('Not responding. Check that rJuke is open and try again') }); active = null; draw(); return; }
    st.set(rowId, { state: 'load' }); draw();
    const until = Date.now() + 120000;
    while (alive) {
      try {
        const idx = await rc(d, '/rj/lib/index', { timeout: 45000 });
        if (!alive) return;
        if (!idx.token || !Array.isArray(idx.tracks)) throw new Error(T('Invalid response from the device'));
        await onDone(d, idx);
        return;
      } catch (e) {
        if (!alive) return;
        if (e.pending && Date.now() < until) { st.set(rowId, { state: 'wait' }); draw(); await sleep(1500); continue; }
        st.set(rowId, { state: 'err', msg: e.pending ? T('No confirmation. Try again') : /timeout|ECONN|EHOST|ENET|failed|connect/i.test(e.message) ? T('Not responding. Try again') : e.message }); active = null; draw();
        return;
      }
    }
  };
  list.addEventListener('click', (e) => { const b = e.target.closest('.pdev'); if (!b || b.disabled) return; const d = RC.devices.get(b.dataset.id); if (d) pair(d); });
  $('[data-a="addr"]', box).addEventListener('click', async () => {
    const v = await modal({ title: T('Device address'), text: T('For example 192.168.1.20'), input: { placeholder: '192.168.1.20' }, buttons: [{ label: T('Cancel'), value: false }, { label: T('Connect'), primary: true }] });
    if (!v) return;
    const [host, port] = v.replace(/^https?:\/\//, '').replace(/\/.*$/, '').split(':');
    try {
      const d = await probeDevice(host, +port || 47123);
      S.settings = await rj.setSettings({ connectManual: [...(S.settings.connectManual || []).filter((x) => x.host !== d.host), { host: d.host, port: d.port }] });
      draw(); pair(d);
    } catch (e) { toast(/stesso dispositivo/.test(e.message) ? e.message : `${T('No response from {0}', host)}`, 'err'); }
  });
  PAIR.refresh = draw;
  const tick = setInterval(draw, 3000);
  draw();
  setTimeout(() => { if (alive && !RC.devices.size) rj.connectScan().catch(() => {}); }, 2500);
  return () => { alive = false; clearInterval(tick); if (PAIR.refresh === draw) PAIR.refresh = null; };
}
async function adoptPhone(d, idx) {
  S.settings = await rj.setSettings({ source: 'phone', phone: { id: d.id, name: idx.name || d.name, platform: idx.platform || d.platform || 'android', host: d.host, port: d.port, token: idx.token } });
  PH.online = true; PH.pending = false; PH.lyrics.clear();
  await phoneCacheRefresh();
  phoneApplyIndex(await phoneSaveIndex(idx));
}

// ===================== music scan on the TV =====================
async function runScan(loud) {
  if (phoneMode()) return phoneSync({ loud });
  if (S.scanning) return;
  S.scanning = true;
  let lib = null, err = '';
  try {
    let root = '*', name;
    lib = await rj.scan(root, name, !!loud);
  } catch (e) { lib = null; err = String((e && e.message) || e); }
  S.scanning = false;
  if (!lib) {
    if (loud) toast(T('I can\'t read the TV\'s music'), 'err');
    console.warn('scan', err);
    return;
  }
  buildLibrary(lib);
  refreshView();
  if (loud) toast(`${T('Library updated: {0}', plural(S.tracks.length, T('track'), T('tracks')))}`);
}


// ===================== setup and change of source =====================
const SETUP = { back: null };
function setupShow(html, bind, dots = -1) {
  const root = $('#tv-setup');
  root.hidden = false;
  const host = $('.su-host', root);
  const old = host.firstElementChild;
  const mount = () => {
    const st = h(`<div class="su-step">${html}</div>`);
    host.replaceChildren(st);
    $$('.su-dots i', root).forEach((d, k) => d.classList.toggle('on', k === dots));
    $('.su-dots', root).hidden = dots < 0;
    bind(st);
    requestAnimationFrame(() => defaultFocus());
  };
  if (old) { old.classList.add('out'); setTimeout(mount, 300); } else mount();
}
function runSetup({ fromSettings = false } = {}) {
  return new Promise((resolve) => {
    const root = $('#tv-setup');
    root.innerHTML = `<div class="su-bg"><i class="b1"></i><i class="b2"></i><i class="b3"></i></div><div class="su-host"></div><div class="su-dots">${'<i></i>'.repeat(4)}</div>`;
    root.hidden = false;
    let stopPair = null;
    const data = { name: nm() };
    const finish = () => {
      if (stopPair) { stopPair(); stopPair = null; }
      root.classList.add('closing');
      setTimeout(() => { root.hidden = true; root.classList.remove('closing'); root.innerHTML = ''; SETUP.back = null; resolve(); }, 450);
    };
    const welcome = () => {
      SETUP.back = null;
      setupShow(`<div class="su-logo">${logoSVG()}</div><h1>${T('Welcome to <b>rJuke')}</b></h1><p>${T('Your personal jukebox, now on the TV too. Use the remote\'s arrows and OK to choose.')}</p>
        <div class="btns"><button class="tbtn primary big" data-f data-autofocus data-n>${T('Let\'s start')}</button></div>`, (st) => { $('[data-n]', st).addEventListener('click', askName); }, 0);
    };
    const askName = () => {
      SETUP.back = welcome;
      setupShow(`<h1>${T('What\'s your name?')}</h1><p>${T('I\'ll use your name to greet you and to name this TV on your home network.')}</p>
        <input class="su-in" data-f data-autofocus placeholder="Il tuo nome" maxlength="40" spellcheck="false" value="${esc(data.name)}">
        <div class="btns"><button class="tbtn big" data-f data-b>${T('Back')}</button><button class="tbtn primary big" data-f data-n>${T('Continue')}</button></div>`, (st) => {
        const inp = $('input', st);
        const ok = () => { const v = inp.value.trim(); if (!v) { toast(T('Write your name to continue'), 'err'); focusEl(inp); return; } data.name = v.replace(/^./, (c) => c.toUpperCase()); askSource(); };
        $('[data-n]', st).addEventListener('click', ok);
        $('[data-b]', st).addEventListener('click', welcome);
      }, 1);
    };
    const askSource = () => {
      SETUP.back = fromSettings ? finish : askName;
      let extraCard = '';
      setupShow(`<h1>${fromSettings ? T('Where should I get the music from?') : `${T('Hi, <b>{0}</b>!', esc(data.name))}`}</h1><p>${fromSettings ? T('You can change it whenever you want.') : T('Where do you keep your music?')}</p>
        <div class="su-cards${extraCard ? ' three' : ''}">
          <button class="su-card" data-f data-autofocus data-src="phone"><span class="fi">${icon('phone')}</span><b>${T('On another device')}</b><span>${T('Phone or PC with rJuke: the music stays there, the TV fetches the tracks when needed.')}</span></button>
          ${extraCard}
          <button class="su-card" data-f data-src="tv"><span class="fi">${icon('folder')}</span><b>${T('On this TV')}</b><span>${T('TV storage or a connected USB drive.')}</span></button>
        </div>
        <div class="btns"><button class="tbtn big" data-f data-b>${T('Back')}</button></div>`, (st) => {
        $('[data-src="phone"]', st).addEventListener('click', askPhone);
        $('[data-src="tv"]', st).addEventListener('click', scanTV);
        $('[data-b]', st).addEventListener('click', () => SETUP.back());
      }, 2);
    };
    const askPhone = async () => {
      S.settings = await rj.setSettings({ name: data.name });
      await connectInit();
      await tvAnnounce();
      SETUP.back = () => { if (stopPair) { stopPair(); stopPair = null; } askSource(); };
      setupShow(`<h1>${T('Connect the device')}</h1><p>${T('Open rJuke on your phone or PC, on the same Wi‑Fi as the TV. The music stays there: the TV only keeps the tracks you play (up to 1 GB).')}</p>
        <div class="pair"></div>
        <div class="btns"><button class="tbtn big" data-f data-b>${T('Back')}</button></div>`, (st) => {
        if (stopPair) stopPair();
        stopPair = pairUI($('.pair', st), async (d, idx) => { await adoptPhone(d, idx); if (stopPair) { stopPair(); stopPair = null; } done(true); });
        $('[data-b]', st).addEventListener('click', () => SETUP.back());
      }, 3);
    };
    const scanTV = () => {
      SETUP.back = null;
      setupShow(`<div class="su-eq">${'<i></i>'.repeat(7)}</div><h1>${T('Looking for your music…')}</h1><p class="su-prog">${T('TV storage and USB drives')}</p>`, async () => {
        let lib = null;
        try { lib = await rj.scan('*'); } catch { lib = null; }
        if (lib) {
          S.settings = await rj.setSettings({ name: data.name, source: 'tv' });
          clearTimeout(PH.timer);
          buildLibrary(lib); setPlaylists([]);
        }
        done(false, !lib);
      }, 3);
    };
    const done = (phone, failed = false, err = '') => {
      const n = S.tracks.length;
      let msg = n ? (phone ? `${T('You\'ll listen to the music on {0}. Keep it on with rJuke open: the TV fetches the tracks when needed.', esc(phoneName()))}` : T('Your music is ready.'))
        : phone ? `${T('There are no tracks on {0} yet.', esc(phoneName()))}` : T('I couldn\'t find any audio files on this TV. You can use the music on your phone or PC.');
      SETUP.back = n ? null : askSource;
      setupShow(`<div class="su-logo">${logoSVG()}</div>
        <h1>${n ? `${T('All set, <b>{0}</b>!', esc(data.name))}` : failed ? T('I can\'t read the music') : T('No tracks found')}</h1>
        <p>${msg}</p>
        ${n ? `<div class="su-stats"><div><b>${nf.format(n)}</b><span>${T('tracks')}</span></div><div><b>${nf.format(S.albums.length)}</b><span>${T('albums')}</span></div><div><b>${nf.format(S.artists.length)}</b><span>${T('artists')}</span></div>${S.playlists.length ? `<div><b>${nf.format(S.playlists.length)}</b><span>${T('playlists')}</span></div>` : ''}</div>` : ''}
        <div class="btns">${n ? T('<button class="tbtn primary big" data-f data-autofocus data-n>Start listening</button>') : T('<button class="tbtn primary big" data-f data-autofocus data-r>Choose again</button>')}</div>`, (st) => {
        const fin = $('[data-n]', st);
        if (fin) fin.addEventListener('click', async () => { S.settings = await rj.setSettings({ name: data.name, setupDone: true }); finish(); });
        const re = $('[data-r]', st);
        if (re) re.addEventListener('click', askSource);
      }, -1);
    };
    if (fromSettings) askSource(); else welcome();
  });
}
async function chooseSource() {
  await runSetup({ fromSettings: true });
  if (phoneMode()) { srcUI(); phoneSchedule(60000); }
  else srcUI();
  S.stack = [];
  go('home', null, { replace: true });
}

// ===================== startup =====================
function buildChrome() {
  document.getElementById('app').remove();
  ['np', 'setup', 'menu-root', 'modal-root', 'toast-root'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); });
  document.body.classList.add('tv-body');
  document.body.appendChild(h(`<div id="tv" class="tv">
    <div class="tv-amb"></div>
    <div class="rail-shade"></div>
    <nav class="rail" id="tv-rail">
      <div class="rail-logo">${logoSVG()}<span>r<b>Juke</b></span></div>
      ${RAIL.map(([v, ic, l]) => `<button class="rail-item" data-f data-view="${v}">${icon(ic)}<span>${l}</span></button>`).join('')}
      <div class="src" id="tv-src" hidden></div>
    </nav>
    <main class="tv-main" id="tv-main"></main>
    <button class="chip" id="tv-chip" data-f hidden><span class="chip-art"></span><span class="chip-tx"><span class="chip-t"></span><span class="chip-a"></span></span><span class="chip-eq"><i></i><i></i><i></i></span><span class="chip-bar"><span id="chip-fill"></span></span></button>
    <section class="tv-np" id="tv-np" hidden aria-hidden="true">
      <div class="np-bg" id="np-bg"></div><div class="np-shade"></div>
      <div class="np-wrap">
        <div class="np-art" id="np-art"></div>
        <div class="np-side">
          <div class="np-kicker" id="np-kicker"></div>
          <div class="np-title" id="np-title"></div>
          <div class="np-artist" id="np-artist"></div>
          <div class="np-mid"><div class="np-lyrics" id="np-lyrics"></div><div class="np-up" id="np-up"></div></div>
          <div class="np-prog"><span id="np-cur">0:00</span><button class="np-bar" data-f data-seek="1" aria-label="${T('Progress: left and right to move')}"><span class="np-fill" id="np-fill"></span></button><span id="np-rem">-0:00</span></div>
          <div class="np-ctrl">
            <button class="cbtn sm" data-f id="np-shuffle" aria-label="${T('Shuffle')}">${icon('shuffle')}</button>
            <button class="cbtn" data-f id="np-prev" aria-label="${T('Previous')}">${icon('prev')}</button>
            <button class="cbtn play" data-f id="np-play" aria-label="${T('Play')}">${icon('play')}</button>
            <button class="cbtn" data-f id="np-next" aria-label="${T('Next')}">${icon('next')}</button>
            <button class="cbtn sm" data-f id="np-repeat" aria-label="${T('Repeat')}">${icon('repeat')}</button>
          </div>
        </div>
      </div>
    </section>
    <div class="tv-toasts" id="tv-toasts"></div>
    <div id="tv-modal"></div>
    <section class="tv-setup" id="tv-setup" hidden></section>
  </div>`));
  $('#tv-rail').addEventListener('click', (e) => { const r = e.target.closest('.rail-item'); if (!r) return; S.stack = []; go(r.dataset.view, null, { replace: true }); });
  $('#tv-chip').addEventListener('click', openNP);
  $('#np-play').addEventListener('click', togglePlay);
  $('#np-prev').addEventListener('click', prev);
  $('#np-next').addEventListener('click', next);
  $('#np-shuffle').addEventListener('click', toggleShuffle);
  $('#np-repeat').addEventListener('click', cycleRepeat);
  $('.np-bar').addEventListener('click', togglePlay);
}

async function bootTV() {
  buildChrome();
  S.info = await rj.info();
  S.settings = (await rj.getSettings()) || {};
  // the language chosen in Settings: the interface was drawn with the one saved last time, redraw if it changed
  if (((S.settings && S.settings.lang) || 'auto') !== I18N.pref) {
    I18N.setLang((S.settings && S.settings.lang) || 'auto');
    let again = false;
    try { again = !sessionStorage.getItem('rj.relang'); sessionStorage.setItem('rj.relang', '1'); } catch { /* */ }
    if (again) { location.reload(); return; }
  }
  liteInit();
  bindNative();
  window.CapApp && window.CapApp.addListener('backButton', onBack);
  modeUI();
  const needSetup = !S.settings.setupDone;
  if (needSetup) {
    connectInit();
    await runSetup();
  } else if (phoneMode()) {
    const saved = await phoneLoadIndex();
    if (saved) { PH.stamp = saved.stamp || ''; phoneApplyIndex(saved.index); }
    await phoneCacheRefresh();
  } else {
    const lib = await rj.loadLibrary();
    if (lib) buildLibrary(lib);
  }
  await restoreState();
  modeUI(); playStateUI(); chipUI(); ambient(cur());
  S.view = null;
  go('home', null, { replace: true });
  $('#tv').classList.add('ready');
  requestAnimationFrame(loop);
  connectInit();
  srcUI();
  if (phoneMode()) phoneSchedule(1200);
  else if (!needSetup) setTimeout(() => runScan(false), 2500);
}
window.bootTV = bootTV;
