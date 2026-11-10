'use strict';
// rJuke — main process
const { app, BrowserWindow, ipcMain, dialog, nativeTheme, nativeImage, shell, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const crypto = require('crypto');
// translations (the same files the interface uses)
require('./renderer/lang-it.js');   // dictionaries first: the language is picked when i18n.js loads
const { I18N } = require('./renderer/i18n.js');

app.setName('rJuke');
if (process.env.RJ_USERDATA) app.setPath('userData', process.env.RJ_USERDATA);
if (process.platform === 'win32') app.setAppUserModelId('io.github.ruoccos.rjuke');

const LIB_VERSION = 3;
const AUDIO_EXT = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.webm']);
const COVER_NAMES = ['cover', 'folder', 'front', 'album', 'albumart', 'albumartsmall'];
const SKIP_DIRS = new Set(['$recycle.bin', 'system volume information']);

const isWin = process.platform === 'win32';
const winBuild = isWin ? parseInt((os.release().split('.')[2]) || '0', 10) : 0;
const useMica = isWin && winBuild >= 22621;

let win = null;
let library = null;       // { version, root, tracks, covers }
let scanning = null;      // Promise of the scan in progress

// ---------- data paths ----------
const dataDir = () => app.getPath('userData');
const fileIn = (n) => path.join(dataDir(), n);
const coversDir = () => path.join(dataDir(), 'covers');

function readJSON(name, fallback) {
  try { return JSON.parse(fs.readFileSync(fileIn(name), 'utf8')); } catch { return fallback; }
}
async function writeJSON(name, data) {
  const target = fileIn(name);
  const tmp = target + '.tmp';
  await fsp.mkdir(dataDir(), { recursive: true });
  await fsp.writeFile(tmp, JSON.stringify(data));
  await fsp.rename(tmp, target);
}

let mmPromise = null;
const getMM = () => (mmPromise ||= import('music-metadata'));

// ---------- lyrics (LRC / SYLT / USLT) ----------
const TS = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TS = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
const toMs = (m, s, f) => (parseInt(m, 10) * 60 + parseInt(s, 10)) * 1000 + (f ? parseInt(f.padEnd(3, '0').slice(0, 3), 10) : 0);

function parseLRC(src) {
  if (typeof src !== 'string' || !/\[\d{1,3}:\d{1,2}/.test(src)) return null;
  const lines = [];
  let offset = 0;
  for (const raw of src.split(/\r\n|\r|\n/)) {
    const off = raw.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
    if (off) { offset = parseInt(off[1], 10) || 0; continue; }
    const lead = raw.match(/^\s*(?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]\s*)+/);
    if (!lead) continue;
    const stamps = [];
    let m; TS.lastIndex = 0;
    while ((m = TS.exec(lead[0]))) stamps.push(toMs(m[1], m[2], m[3]));
    let body = raw.slice(lead[0].length);
    // "enhanced" LRC: <mm:ss.xx> per word
    let words = null;
    if (WORD_TS.test(body)) {
      WORD_TS.lastIndex = 0;
      words = [];
      const parts = body.split(/(<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>)/);
      let cur = null;
      for (const p of parts) {
        const wm = p.match(/^<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>$/);
        if (wm) cur = toMs(wm[1], wm[2], wm[3]);
        else if (p) words.push({ t: cur, w: p });
      }
      words = words.filter((w) => w.w.length);
      if (words.length && words[0].t == null) words[0].t = stamps[0];
      for (let i = 1; i < words.length; i++) if (words[i].t == null) words[i].t = words[i - 1].t;
      body = body.replace(WORD_TS, '');
      if (!words.some((w) => w.w.trim())) words = null;
    }
    const text = body.replace(/\s+/g, ' ').trim();
    for (const t of stamps) {
      const line = { t: Math.max(0, t - offset), text };
      if (words && stamps.length === 1) line.words = words.map((w) => ({ t: Math.max(0, w.t - offset), w: w.w }));
      lines.push(line);
    }
  }
  if (!lines.length) return null;
  lines.sort((a, b) => a.t - b.t);
  return { synced: true, lines };
}

function fromSyncText(arr) {
  // SYLT: sometimes one entry per line, sometimes per syllable with "\n" at the start of a line
  const startsWithNl = arr.filter((x) => /^[\r\n]/.test(x.text || '')).length;
  let lines;
  if (startsWithNl > arr.length * 0.3 && startsWithNl < arr.length) {
    lines = [];
    for (const x of arr) {
      const txt = x.text || '';
      if (/^[\r\n]/.test(txt) || !lines.length) lines.push({ t: x.timestamp || 0, text: txt.trim(), words: [{ t: x.timestamp || 0, w: txt.replace(/^[\r\n]+/, '') }] });
      else { const l = lines[lines.length - 1]; l.text += txt; l.words.push({ t: x.timestamp || 0, w: txt }); }
    }
    lines.forEach((l) => { l.text = l.text.replace(/\s+/g, ' ').trim(); });
  } else {
    lines = arr.map((x) => ({ t: x.timestamp || 0, text: String(x.text || '').replace(/\s+/g, ' ').trim() }));
  }
  lines.sort((a, b) => a.t - b.t);
  return lines.length ? { synced: true, lines } : null;
}

function extractLyrics(meta) {
  let plain = null;
  const consider = (v) => {
    if (!v) return null;
    if (typeof v === 'object' && Array.isArray(v.syncText) && v.syncText.length) {
      const r = fromSyncText(v.syncText);
      if (r) return r;
    }
    const s = typeof v === 'string' ? v : (typeof v.text === 'string' ? v.text : null);
    if (s) {
      const r = parseLRC(s);
      if (r) return r;
      if (!plain && s.trim()) plain = s.trim();
    }
    return null;
  };
  for (const tags of Object.values(meta.native || {})) {
    for (const t of tags) {
      const id = String(t.id).toUpperCase();
      if (id === 'USLT' || id === 'SYLT' || id === 'ULT' || id === 'SLT' || id === '©LYR' || id.includes('LYRIC')) {
        const r = consider(t.value);
        if (r) return r;
      }
    }
  }
  for (const l of meta.common.lyrics || []) {
    const r = consider(l);
    if (r) return r;
  }
  return plain ? { synced: false, text: plain } : null;
}

// list of .lrc files per folder, read only once (avoids two empty attempts for every track)
const lrcDirCache = new Map();
async function lrcNames(dir) {
  let p = lrcDirCache.get(dir);
  if (!p) {
    p = fsp.readdir(dir).then((n) => new Set(n.filter((x) => /\.lrc$/i.test(x)).map((x) => x.toLowerCase()))).catch(() => new Set());
    lrcDirCache.set(dir, p);
  }
  return p;
}
async function sidecarLyrics(file, { scanning = false } = {}) {
  const base = file.slice(0, file.length - path.extname(file).length);
  if (scanning) {
    const names = await lrcNames(path.dirname(file));
    if (!names.has(path.basename(base).toLowerCase() + '.lrc')) return null;
  }
  for (const ext of ['.lrc', '.LRC']) {
    try {
      const s = await fsp.readFile(base + ext, 'utf8');
      const r = parseLRC(s);
      if (r) return r;
      if (s.trim()) return { synced: false, text: s.trim() };
    } catch { /* no file */ }
  }
  return null;
}

// ---------- covers and colors ----------
function hex(r, g, b) { return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''); }

function paletteFrom(img) {
  const small = img.resize({ width: 32, height: 32, quality: 'good' });
  const bmp = small.toBitmap(); // BGRA
  const buckets = new Map();
  let tr = 0, tg = 0, tb = 0, n = 0;
  for (let i = 0; i < bmp.length; i += 4) {
    const b = bmp[i], g = bmp[i + 1], r = bmp[i + 2];
    tr += r; tg += g; tb += b; n++;
    const key = (r >> 5) << 6 | (g >> 5) << 3 | (b >> 5);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const e = buckets.get(key) || { r: 0, g: 0, b: 0, c: 0, s: 0 };
    e.r += r; e.g += g; e.b += b; e.c++; e.s += sat;
    buckets.set(key, e);
  }
  const avg = [tr / n, tg / n, tb / n];
  const list = [...buckets.values()].map((e) => ({ r: e.r / e.c, g: e.g / e.c, b: e.b / e.c, c: e.c, s: e.s / e.c }))
    .sort((a, b) => (b.c * (0.6 + b.s)) - (a.c * (0.6 + a.s)));
  const picked = [];
  for (const c of list) {
    if (picked.every((p) => Math.abs(p.r - c.r) + Math.abs(p.g - c.g) + Math.abs(p.b - c.b) > 70)) picked.push(c);
    if (picked.length === 4) break;
  }
  while (picked.length < 4) picked.push(picked[picked.length - 1] || { r: avg[0], g: avg[1], b: avg[2] });
  const lum = (0.2126 * avg[0] + 0.7152 * avg[1] + 0.0722 * avg[2]) / 255;
  return { colors: picked.map((c) => hex(c.r, c.g, c.b)), avg: hex(...avg), light: lum > 0.6 };
}

// ---------- covers processed in the window (in parallel, without blocking the main process) ----------
const coverJobsPending = new Map();
let coverJobSeq = 0;
let coverWorkerReady = false;
function coverViaRenderer(buf) {
  if (!coverWorkerReady || !win || win.isDestroyed()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const id = ++coverJobSeq;
    const timer = setTimeout(() => { coverJobsPending.delete(id); resolve(null); }, 20000);
    coverJobsPending.set(id, (r) => { clearTimeout(timer); resolve(r); });
    win.webContents.send('cover:job', { id, buf });
  });
}
async function saveCover(albumKey, buf) {
  const id = crypto.createHash('md5').update(albumKey).digest('hex');
  await fsp.mkdir(coversDir(), { recursive: true });
  const s = path.join(coversDir(), id + '_s.jpg');
  const l = path.join(coversDir(), id + '_l.jpg');
  const r = await coverViaRenderer(buf);
  if (r && r.ok) {
    await Promise.all([fsp.writeFile(s, Buffer.from(r.s)), fsp.writeFile(l, Buffer.from(r.l))]);
    return { s, l, ...r.pal };
  }
  return saveCoverNative(albumKey, buf);
}
async function saveCoverNative(albumKey, buf) {
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) return null;
  const { width } = img.getSize();
  const id = crypto.createHash('md5').update(albumKey).digest('hex');
  await fsp.mkdir(coversDir(), { recursive: true });
  const s = path.join(coversDir(), id + '_s.jpg');
  const l = path.join(coversDir(), id + '_l.jpg');
  await fsp.writeFile(s, (width > 400 ? img.resize({ width: 400, quality: 'best' }) : img).toJPEG(88));
  await fsp.writeFile(l, (width > 1200 ? img.resize({ width: 1200, quality: 'best' }) : img).toJPEG(90));
  return { s, l, ...paletteFrom(img) };
}

async function folderCover(dir) {
  let entries;
  try { entries = await fsp.readdir(dir); } catch { return null; }
  const imgs = entries.filter((e) => /\.(jpe?g|png|webp|bmp)$/i.test(e));
  const pick = imgs.find((e) => COVER_NAMES.includes(path.parse(e).name.toLowerCase()))
    || imgs.find((e) => /cover|front|folder/i.test(e));
  if (!pick) return null;
  try { return await fsp.readFile(path.join(dir, pick)); } catch { return null; }
}

// ---------- scan ----------
const PLAYLIST_EXT = new Set(['.m3u8', '.m3u']);
async function walk(dir, out, lists = null) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name.toLowerCase())) await walk(p, out, lists); }
    else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (AUDIO_EXT.has(ext)) out.push(p);
      else if (lists && PLAYLIST_EXT.has(ext)) lists.push(p);
    }
  }
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k); }
  }));
}

function albumKeyFor(c, file) {
  const album = (c.album || '').trim().toLowerCase();
  if (c.albumartist) return 'aa:' + c.albumartist.trim().toLowerCase() + '|' + album;
  return 'dir:' + path.dirname(file).toLowerCase() + '|' + album;
}

async function scanLibrary(root, { onProgress } = {}) {
  const old = readJSON('library.json', null);
  const prev = new Map();
  if (old && old.version === LIB_VERSION && old.root === root) for (const t of old.tracks) prev.set(t.path, t);
  const covers = (old && old.version === LIB_VERSION && old.covers) || {};

  let last = 0;
  const emit = (data, force) => {
    const now = Date.now();
    if (force || now - last > 80) { last = now; onProgress && onProgress(data); }
  };

  emit({ phase: 'walk', done: 0, total: 0 }, true);
  const files = [];
  const listFiles = [];
  await walk(root, files, listFiles);
  emit({ phase: 'read', done: 0, total: files.length }, true);

  const mm = await getMM();
  const tracks = new Array(files.length);
  const coverJobs = new Map();
  let done = 0;

  lrcDirCache.clear();
  await pool(files, 12, async (file, idx) => {
    let st;
    try { st = await fsp.stat(file); } catch { done++; return; }
    const p = prev.get(file);
    if (p && p.size === st.size && p.mtime === st.mtimeMs) {
      tracks[idx] = p;
    } else {
      let meta = null;
      try { meta = await mm.parseFile(file, { skipCovers: true, duration: false }); } catch { meta = null; }
      const c = (meta && meta.common) || {};
      let duration = meta && meta.format && meta.format.duration;
      // no duration in the tags: estimate from the bitrate instead of reading the whole file again (bug #5)
      if (meta && !duration && meta.format.bitrate) duration = (st.size * 8) / meta.format.bitrate;
      if (meta && !duration) {
        try { duration = (await mm.parseFile(file, { skipCovers: true, duration: true })).format.duration; } catch { /* */ }
      }
      let lyr = meta ? extractLyrics(meta) : null;
      if (!lyr) lyr = await sidecarLyrics(file, { scanning: true });
      const artist = c.artist || (c.artists && c.artists.join(', ')) || T('Unknown artist');
      tracks[idx] = {
        path: file,
        size: st.size,
        mtime: st.mtimeMs,
        added: (st.birthtimeMs && st.birthtimeMs > 0 ? Math.min(st.birthtimeMs, st.mtimeMs) : st.mtimeMs),
        title: (c.title || path.basename(file, path.extname(file))).trim(),
        artist: artist.trim(),
        albumArtist: (c.albumartist || '').trim(),
        album: (c.album || '').trim(),
        albumKey: albumKeyFor(c, file),
        year: c.year || null,
        genre: (c.genre && c.genre[0]) || '',
        track: (c.track && c.track.no) || null,
        disc: (c.disk && c.disk.no) || null,
        duration: duration || 0,
        lyrics: lyr ? (lyr.synced ? 2 : 1) : 0,
        codec: (meta && meta.format && (meta.format.codec || meta.format.container)) || '',
      };
    }
    const key = tracks[idx].albumKey;
    const cv = covers[key];
    if ((!cv || !fs.existsSync(cv.s)) && !coverJobs.has(key)) coverJobs.set(key, file);
    done++;
    emit({ phase: 'read', done, total: files.length, current: path.basename(file) });
  });

  // missing covers (one per album)
  const jobs = [...coverJobs.entries()];
  let cdone = 0;
  emit({ phase: 'covers', done: 0, total: jobs.length }, true);
  await pool(jobs, coverWorkerReady ? 6 : 3, async ([key, file]) => {
    let buf = null;
    try {
      const meta = await mm.parseFile(file, { skipCovers: false, duration: false });
      const pics = meta.common.picture || [];
      const pic = mm.selectCover ? mm.selectCover(pics) : pics[0];
      if (pic && pic.data) buf = Buffer.from(pic.data);
    } catch { /* */ }
    if (!buf) buf = await folderCover(path.dirname(file));
    if (buf) {
      try { const r = await saveCover(key, buf); if (r) covers[key] = r; } catch { /* */ }
    } else covers[key] = null;
    cdone++;
    emit({ phase: 'covers', done: cdone, total: jobs.length });
  });

  const list = tracks.filter(Boolean);
  const usedKeys = new Set(list.map((t) => t.albumKey));
  for (const k of Object.keys(covers)) if (!usedKeys.has(k)) delete covers[k];
  library = { version: LIB_VERSION, root, scannedAt: Date.now(), tracks: list, covers };
  await writeJSON('library.json', library);
  // playlists found in subfolders: the UI merges them, without duplicates
  let found = [];
  try {
    found = await importPlaylists(listFiles);
    for (const f of found) { try { f.mtime = (await fsp.stat(f.source)).mtimeMs; } catch { f.mtime = 0; } }
    found = found.filter((f) => f.paths.length);
  } catch { found = []; }
  emit({ phase: 'done', done: list.length, total: list.length }, true);
  return { ...library, found };
}

// ---------- playlist m3u8 ----------
const normPath = (p) => path.normalize(p).replace(/[\\/]+$/, '').toLowerCase();
const tailKey = (p) => p.split(/[\\/]+/).slice(-2).join('/').toLowerCase();

function decodeText(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
  const s = buf.toString('utf8');
  if (!s.includes('�')) return s;
  return buf.toString('latin1');
}

function resolveEntry(line, baseDir) {
  let p = line.trim();
  if (/^file:\/\//i.test(p)) {
    try { p = require('url').fileURLToPath(p); } catch { p = decodeURIComponent(p.replace(/^file:\/\/\/?/i, '')); }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) return null; // remote stream
  if (!path.isAbsolute(p) && !/^[a-zA-Z]:[\\/]/.test(p) && !p.startsWith('\\\\')) p = path.join(baseDir, p);
  return p;
}

async function importPlaylists(files) {
  const tracks = (library && library.tracks) || [];
  const byPath = new Map(tracks.map((t) => [normPath(t.path), t.path]));
  const byTail = new Map();
  for (const t of tracks) { const k = tailKey(t.path); if (!byTail.has(k)) byTail.set(k, t.path); }
  const out = [];
  for (const f of files) {
    const text = decodeText(await fsp.readFile(f));
    let name = path.basename(f, path.extname(f));
    const paths = [];
    const missing = [];
    let info = '';
    for (const raw of text.split(/\r\n|\r|\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#')) {
        const m = line.match(/^#PLAYLIST:\s*(.+)$/i);
        if (m) name = m[1].trim();
        const x = line.match(/^#EXTINF:[^,]*,(.*)$/i); if (x) info = x[1].trim();
        continue;
      }
      const p = resolveEntry(line, path.dirname(f));
      if (!p) { info = ''; continue; }
      const hit = byPath.get(normPath(p)) || byTail.get(tailKey(p));
      // track not found: the line, where it was in the playlist and “Artist - Title” from the #EXTINF
      if (hit) paths.push(hit); else missing.push({ line, at: paths.length, info });
      info = '';
    }
    out.push({ name, paths, missing, source: f });
  }
  return out;
}

// ---------- rJuke Connect: server on the home network + device discovery ----------
const http = require('http');
let connect = { server: null, port: 0, bonjour: null, browser: null, published: null, me: { id: '', name: '' }, devices: new Map() };
const connectPending = new Map();
let connectSeq = 0;
function isPrivateIp(ip) {
  if (process.env.RJ_TEST_ANYNET) return true; // test harness only
  ip = String(ip || '').replace(/^::ffff:/, '');
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip) || ip === '::1' || /^f[cd]/i.test(ip) || /^fe80/i.test(ip);
}
function localIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal && isPrivateIp(a.address)) out.push(a.address);
  return out;
}
function sendDevices() {
  if (win && !win.isDestroyed()) win.webContents.send('connect:devices', [...connect.devices.values()]);
}
// Forwards network requests to the UI (Connect and PartyBox use the same mechanism)
function bridgeHandler(kind) {
  return (req, res) => {
    const ip = req.socket.remoteAddress;
    const reply = (status, type, data) => {
      if (res.headersSent || res.destroyed) return;
      const h = { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(data) };
      if (kind === 'connect') { h['Access-Control-Allow-Origin'] = '*'; h['Access-Control-Allow-Headers'] = '*'; }
      // PartyBox: no reused connections, each request has its own (phone browsers kept retrying forever, bug #30)
      if (kind === 'party') h.Connection = 'close';
      res.writeHead(status, h); res.end(data);
    };
    if (!isPrivateIp(ip)) return reply(403, 'text/plain; charset=utf-8', T('rJuke only answers on the home network'));
    if (req.method === 'OPTIONS') return reply(204, 'text/plain', '');
    if (kind === 'party' && (req.url === '/favicon.ico' || req.url.startsWith('/apple-touch-icon'))) return reply(204, 'image/png', '');
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size < 4e6) chunks.push(c); });
    req.on('error', () => {});
    req.on('end', async () => {
      const id = ++connectSeq;
      let name = '';
      try { name = decodeURIComponent(req.headers['x-rj-name'] || ''); } catch { /* */ }
      const r = await new Promise((resolve) => {
        const t = setTimeout(() => { connectPending.delete(id); resolve({ status: 503, body: { error: 'occupato' } }); }, req.url.startsWith('/rj/lib/index') ? 40000 : 7000);
        connectPending.set(id, (x) => { clearTimeout(t); resolve(x); });
        if (!win || win.isDestroyed()) { connectPending.get(id)({ status: 503, body: { error: 'window closed' } }); return; }
        win.webContents.send('connect:req', { id, kind, method: req.method, path: req.url, body: Buffer.concat(chunks).toString('utf8'), device: { id: req.headers['x-rj-id'] || '', name }, ip });
      });
      try {
        if (r.text != null) return reply(r.status || 200, r.type || 'text/html; charset=utf-8', String(r.text));
        if (r.stream) return streamFile(req, res, r.stream, r.type);
        if (r.file) {
          try {
            const data = /^https?:/.test(r.file) ? await httpBuffer(r.file) : await fsp.readFile(r.file);
            if (r.cache && !res.headersSent) { res.writeHead(200, { 'Content-Type': r.type || 'image/jpeg', 'Content-Length': data.length, 'Cache-Control': 'max-age=604800', 'Access-Control-Allow-Origin': '*' }); return res.end(data); }
            return reply(200, r.type || 'image/jpeg', data);
          } catch { return reply(404, 'application/json', '{}'); }
        }
        reply(r.status || 200, 'application/json; charset=utf-8', typeof r.body === 'string' ? r.body : JSON.stringify(r.body || {}));
      } catch { try { res.destroy(); } catch { /* */ } }
    });
  };
}
// sending a track in chunks (“Range”): the other device's player can start right away and seek back and forth
async function streamFile(req, res, file, type) {
  let st;
  try { st = await fsp.stat(file); } catch { res.writeHead(404); return res.end(); }
  const size = st.size;
  let start = 0, end = size - 1, partial = false;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
  if (m && (m[1] || m[2])) {
    partial = true;
    if (m[1]) { start = +m[1]; if (m[2]) end = Math.min(+m[2], size - 1); }
    else { start = Math.max(0, size - +m[2]); }
    if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
  }
  const h = { 'Content-Type': type || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
  if (partial) h['Content-Range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(partial ? 206 : 200, h);
  if (req.method === 'HEAD') return res.end();
  const rs = fs.createReadStream(file, { start, end });
  rs.on('error', () => res.destroy());
  res.on('close', () => rs.destroy());
  rs.pipe(res);
}

function httpBuffer(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 8000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('http ' + res.statusCode)); }
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks))); res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
// ---------- “speaker” PC: the phone's tracks kept in a temporary cache ----------
const pc = { dir: '', index: null, inflight: new Map() };
function pcDir() { if (!pc.dir) { pc.dir = path.join(dataDir(), 'phone-cache'); fs.mkdirSync(pc.dir, { recursive: true }); } return pc.dir; }
function pcIndex() {
  if (!pc.index) {
    pc.index = readJSON('phone-cache.json', {}) || {};
    for (const [k, v] of Object.entries(pc.index)) if (!v || !fs.existsSync(v.file)) delete pc.index[k];
  }
  return pc.index;
}
let pcSaveT = 0;
const pcSave = () => { clearTimeout(pcSaveT); pcSaveT = setTimeout(() => writeJSON('phone-cache.json', pc.index).catch(() => {}), 400); };
function pcLimit() { const s = readJSON('settings.json', {}) || {}; return Math.max(0.25, +s.phoneCacheGB || 2) * 1024 ** 3; }
function pcTrim(keep) {
  const idx = pcIndex();
  let total = Object.values(idx).reduce((n, v) => n + (v.size || 0), 0);
  const limit = pcLimit();
  if (total <= limit) return;
  for (const [k, v] of Object.entries(idx).sort((a, b) => a[1].at - b[1].at)) {
    if (total <= limit) break;
    if (k === keep) continue;
    try { fs.unlinkSync(v.file); } catch { /* */ }
    total -= v.size || 0; delete idx[k];
  }
  pcSave();
}
function pcFetch({ url, key, ext }) {
  const idx = pcIndex();
  if (idx[key] && fs.existsSync(idx[key].file)) { idx[key].at = Date.now(); pcSave(); return Promise.resolve(idx[key].file); }
  if (pc.inflight.has(key)) return pc.inflight.get(key);
  const name = crypto.createHash('sha1').update(key).digest('hex') + '.' + String(ext || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 5);
  const dest = path.join(pcDir(), name), tmp = dest + '.part';
  const p = new Promise((resolve) => {
    const req = http.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const ws = fs.createWriteStream(tmp);
      res.pipe(ws);
      ws.on('finish', () => {
        try {
          fs.renameSync(tmp, dest);
          idx[key] = { file: dest, size: fs.statSync(dest).size, at: Date.now() };
          pcSave(); pcTrim(key); resolve(dest);
        } catch { resolve(null); }
      });
      ws.on('error', () => { try { fs.unlinkSync(tmp); } catch { /* */ } resolve(null); });
      res.on('error', () => { ws.destroy(); try { fs.unlinkSync(tmp); } catch { /* */ } resolve(null); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve(null));
  }).finally(() => pc.inflight.delete(key));
  pc.inflight.set(key, p);
  return p;
}

// ---------- PartyBox: dedicated server, on only during the party ----------
const party = { server: null, port: 0, sockets: new Set() };
async function partyServe(on) {
  if (!on) {
    if (party.server) {
      const srv = party.server; party.server = null; party.port = 0;
      srv.close();
      for (const so of party.sockets) so.destroy();
      party.sockets.clear();
    }
    return { port: 0 };
  }
  if (party.server) return { port: party.port };
  const srv = http.createServer(bridgeHandler('party'));
  srv.keepAliveTimeout = 0;
  srv.headersTimeout = 15000;
  srv.requestTimeout = 20000;
  srv.on('connection', (so) => { party.sockets.add(so); so.on('close', () => party.sockets.delete(so)); so.setNoDelay(true); });
  // an HTTPS attempt (byte 0x16) is closed right away instead of hanging
  srv.on('clientError', (err, so) => { try { so.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); } catch { /* */ } so.destroy(); });
  for (let p = 47150; p <= 47170; p++) {
    const ok = await new Promise((resolve) => {
      const onErr = () => resolve(false);
      srv.once('error', onErr);
      srv.listen(p, '0.0.0.0', () => { srv.removeListener('error', onErr); resolve(true); });
    });
    if (ok) { party.server = srv; party.port = p; return { port: p }; }
  }
  throw new Error(T('No free port for PartyBox'));
}

// Windows: is the network “Public” or does the firewall block rJuke? (phones can't connect to the PC)
function netCheck() {
  if (process.platform !== 'win32') return Promise.resolve({ ok: true });
  const exe = process.execPath.replace(/'/g, "''");
  const ps = `$ErrorActionPreference='SilentlyContinue';
$cat = @(Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' } | ForEach-Object { [string]$_.NetworkCategory });
$rules = @(Get-NetFirewallApplicationFilter -Program '${exe}' | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Enabled -eq 'True' } | ForEach-Object { @{ action = [string]$_.Action; profile = [string]$_.Profile } });
@{ categories = $cat; rules = $rules } | ConvertTo-Json -Compress -Depth 4`;
  return new Promise((resolve) => {
    require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true, timeout: 15000 }, (err, out) => {
      if (err) return resolve({ ok: true, unknown: true });
      let j = {};
      try { j = JSON.parse(String(out).trim() || '{}'); } catch { return resolve({ ok: true, unknown: true }); }
      const cats = [].concat(j.categories || []).map((c) => (/^2|Domain/i.test(c) ? 'Domain' : /^1|Private/i.test(c) ? 'Private' : 'Public'));
      const rules = [].concat(j.rules || []);
      const covers = (r, c) => /Any|^0$/i.test(r.profile) || new RegExp(c, 'i').test(r.profile);
      const blocked = cats.some((c) => rules.some((r) => /Block|^4$/i.test(r.action) && covers(r, c)));
      const allowed = cats.length && cats.every((c) => rules.some((r) => /Allow|^2$/i.test(r.action) && covers(r, c)));
      resolve({ ok: !blocked && !!allowed, public: cats.includes('Public'), blocked, allowed: !!allowed, categories: cats });
    });
  });
}
// With a single “Yes” (Windows prompt) rJuke is allowed on the home network, whatever the network type
function netFix() {
  if (process.platform !== 'win32') return Promise.resolve({ ok: true });
  const exe = process.execPath.replace(/'/g, "''");
  const inner = `Get-NetFirewallApplicationFilter -Program '${exe}' | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' } | Remove-NetFirewallRule; Remove-NetFirewallRule -DisplayName 'rJuke (rete di casa)','rJuke (home network)' -ErrorAction SilentlyContinue; New-NetFirewallRule -DisplayName 'rJuke (home network)' -Direction Inbound -Action Allow -Program '${exe}' -Profile Any -RemoteAddress LocalSubnet | Out-Null`;
  const b64 = Buffer.from(inner, 'utf16le').toString('base64');
  const outer = `Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${b64}'`;
  return new Promise((resolve) => {
    require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', outer], { windowsHide: true, timeout: 120000 }, async () => resolve(await netCheck()));
  });
}

async function connectStart(info) {
  connect.me = info;
  if (!connect.server) {
    connect.server = http.createServer(bridgeHandler('connect'));
    connect.server.keepAliveTimeout = 4000;
    for (let p = 47123; p <= 47135; p++) {
      const ok = await new Promise((resolve) => {
        connect.server.once('error', () => resolve(false));
        connect.server.listen(p, '0.0.0.0', () => resolve(true));
      });
      if (ok) { connect.port = p; break; }
    }
  }
  try {
    const { Bonjour } = require('bonjour-service');
    if (!connect.bonjour) connect.bonjour = new Bonjour();
    if (connect.published) { try { connect.published.stop(); } catch { /* */ } }
    connect.published = connect.bonjour.publish({ name: `${info.name} · ${info.id.slice(0, 4)}`, type: 'rjuke', port: connect.port, txt: { id: info.id, name: info.name, platform: 'windows', ...(info.icon ? { icon: info.icon } : {}) } });
    if (!connect.browser) {
      connect.browser = connect.bonjour.find({ type: 'rjuke' });
      const up = (svc) => {
        const txt = svc.txt || {};
        if (!txt.id || txt.id === connect.me.id) return;
        const host = (svc.addresses || []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) || (svc.addresses || [])[0] || svc.host;
        connect.devices.set(txt.id, { id: txt.id, name: txt.name || svc.name, platform: txt.platform || '', tv: String(txt.tv) === '1', icon: txt.icon || '', host, port: svc.port, service: svc.name });
        sendDevices();
      };
      connect.browser.on('up', up);
      connect.browser.on('txt-update', up);   // name, icon or state changed
      connect.browser.on('down', (svc) => { for (const [k, d] of connect.devices) if (d.service === svc.name) connect.devices.delete(k); sendDevices(); });
      setInterval(() => { try { connect.browser.update(); } catch { /* */ } }, 15000);
    }
  } catch (e) { console.warn(T('mDNS not available'), e && e.message); }
  return { ip: localIps()[0] || '', port: connect.port };
}
function connectFetch({ host, port, path: p, method = 'GET', body = null, binary = false, timeout = 8000 }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, path: p, method, timeout,
      headers: { 'X-RJ-Id': connect.me.id, 'X-RJ-Name': encodeURIComponent(connect.me.name), ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve(binary ? { status: res.statusCode, base64: buf.toString('base64') } : { status: res.statusCode, body: buf.toString('utf8') });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// direct scan of the home network, if mDNS doesn't find the other device
let connectScanning = null;
function connectScan() {
  if (connectScanning) return connectScanning;
  const net = require('net');
  const prefixes = [...new Set(localIps().filter((ip) => !/^(127\.|169\.254\.)/.test(ip)).map((ip) => ip.replace(/\d+$/, '')))].slice(0, 3);
  const mine = new Set(process.env.RJ_TEST_ANYNET ? [] : localIps()); // in the test harness both PCs have the same address
  const hosts = [];
  for (const pre of prefixes) for (let h = 1; h < 255; h++) if (!mine.has(pre + h)) hosts.push(pre + h);
  const probe = (host, port) => new Promise((res) => {
    const so = net.connect({ host, port });
    const end = (ok) => { so.destroy(); res(ok); };
    so.setTimeout(450, () => end(false)); so.once('connect', () => end(true)); so.once('error', () => end(false));
  });
  const one = async (host) => {
    for (let port = 47123; port <= 47126; port++) {
      if (!(await probe(host, port))) continue;
      try {
        const r = await connectFetch({ host, port, path: '/rj/info' });
        const info = JSON.parse(r.body || '{}');
        if (r.status !== 200 || !info.id || info.id === (connect.me && connect.me.id)) continue;
        const old = connect.devices.get(info.id);
        connect.devices.set(info.id, { id: info.id, name: info.name || host, platform: info.platform || '', tv: !!info.tv, icon: info.icon || '', host, port, service: old && old.service });
        sendDevices();
      } catch { /* */ }
    }
  };
  connectScanning = (async () => {
    let i = 0;
    await Promise.all(Array.from({ length: 64 }, async () => { while (i < hosts.length) await one(hosts[i++]); }));
  })().finally(() => { connectScanning = null; });
  return connectScanning;
}

// ---------- window ----------
function chromeColors(dark) {
  return dark ? { color: '#1f1f22', symbolColor: '#f5f5f7' } : { color: '#f7f7f8', symbolColor: '#1d1d1f' };
}

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  const overlay = process.platform !== 'darwin' ? { ...chromeColors(dark), height: 52 } : undefined;
  win = new BrowserWindow({
    width: 1340, height: 880, minWidth: 980, minHeight: 640,
    show: false,
    title: 'rJuke',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: overlay,
    backgroundColor: useMica ? '#00000000' : (dark ? '#1c1c1e' : '#ffffff'),
    backgroundMaterial: useMica ? 'mica' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!process.env.RJ_HEADLESS) win.show(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => { win = null; });
}

function setThumbar(playing) {
  if (!win || !isWin) return;
  const icon = (n) => nativeImage.createFromPath(path.join(__dirname, 'assets', n + '.png'));
  try {
    win.setThumbarButtons([
      { tooltip: T('Previous'), icon: icon('tb-prev'), click: () => win.webContents.send('media:cmd', 'prev') },
      { tooltip: playing ? T('Pause') : T('Play'), icon: icon(playing ? 'tb-pause' : 'tb-play'), click: () => win.webContents.send('media:cmd', 'toggle') },
      { tooltip: T('Next'), icon: icon('tb-next'), click: () => win.webContents.send('media:cmd', 'next') },
    ]);
  } catch { /* */ }
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('app:info', () => ({
    platform: process.platform, mica: useMica, version: app.getVersion(),
    dark: nativeTheme.shouldUseDarkColors,
  }));
  ipcMain.handle('settings:get', () => readJSON('settings.json', null));
  ipcMain.handle('settings:set', async (_e, patch) => {
    const s = { ...(readJSON('settings.json', {}) || {}), ...patch };
    await writeJSON('settings.json', s);
    if (patch.theme) nativeTheme.themeSource = patch.theme;
    return s;
  });
  ipcMain.handle('dialog:folder', async () => {
    const r = await dialog.showOpenDialog(win, { title: T('Choose your music folder'), properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('library:load', () => {
    const l = readJSON('library.json', null);
    if (l && l.version === LIB_VERSION) { library = l; return l; }
    return null;
  });
  ipcMain.handle('library:scan', async (_e, root, opts = {}) => {
    if (scanning) return scanning;
    const onProgress = (p) => win && !win.isDestroyed() && win.webContents.send('scan:progress', p);
    scanning = null;
    if (!scanning) scanning = scanLibrary(root, { onProgress });
    scanning = scanning.finally(() => { scanning = null; });
    return scanning;
  });
  ipcMain.handle('lyrics:get', async (_e, file) => {
    try {
      const mm = await getMM();
      const meta = await mm.parseFile(file, { skipCovers: true, duration: false });
      return extractLyrics(meta) || (await sidecarLyrics(file));
    } catch { return sidecarLyrics(file); }
  });
  ipcMain.handle('playlists:get', () => readJSON('playlists.json', []));
  ipcMain.handle('playlists:save', (_e, lists) => writeJSON('playlists.json', lists));
  ipcMain.handle('playlists:import', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: T('Import playlists'), properties: ['openFile', 'multiSelections'],
      filters: [{ name: T('Playlists'), extensions: ['m3u8', 'm3u'] }],
    });
    if (r.canceled || !r.filePaths.length) return [];
    return importPlaylists(r.filePaths);
  });
  ipcMain.handle('playlists:export', async (_e, { name, tracks }) => {
    const r = await dialog.showSaveDialog(win, {
      title: T('Export playlist'), defaultPath: (name || T('Playlists')).replace(/[\\/:*?"<>|]/g, '_') + '.m3u8',
      filters: [{ name: T('M3U8 playlist'), extensions: ['m3u8'] }],
    });
    if (r.canceled || !r.filePath) return false;
    const lines = ['#EXTM3U', '#PLAYLIST:' + name];
    for (const t of tracks) {
      lines.push(`#EXTINF:${Math.round(t.duration || 0)},${t.artist} - ${t.title}`);
      lines.push(t.path);
    }
    await fsp.writeFile(r.filePath, '﻿' + lines.join('\r\n') + '\r\n', 'utf8');
    return r.filePath;
  });
  ipcMain.handle('shell:show', (_e, p) => { shell.showItemInFolder(p); });
  ipcMain.on('cover:ready', () => { coverWorkerReady = true; });
  ipcMain.handle('connect:start', (_e, info) => connectStart(info));
  ipcMain.handle('connect:fetch', (_e, o) => connectFetch(o));
  ipcMain.handle('connect:scan', () => connectScan());
  ipcMain.handle('party:serve', (_e, on) => partyServe(!!on));
  ipcMain.handle('pcache:list', () => { const idx = pcIndex(); const out = {}; for (const [k, v] of Object.entries(idx)) out[k] = v.file; return out; });
  ipcMain.handle('pcache:fetch', (_e, o) => pcFetch(o));
  ipcMain.handle('pcache:stats', () => { const idx = pcIndex(); return { count: Object.keys(idx).length, bytes: Object.values(idx).reduce((n, v) => n + (v.size || 0), 0) }; });
  ipcMain.handle('pcache:trim', () => { pcTrim(null); return true; });
  ipcMain.handle('pcache:clear', async () => { const idx = pcIndex(); for (const v of Object.values(idx)) { try { fs.unlinkSync(v.file); } catch { /* */ } } pc.index = {}; await writeJSON('phone-cache.json', {}); return true; });
  ipcMain.handle('library:save', async (_e, lib) => { library = { ...lib, version: LIB_VERSION }; await writeJSON('library.json', library); return true; });
  ipcMain.handle('net:check', () => netCheck());
  ipcMain.handle('net:fix', () => netFix());
  ipcMain.handle('connect:ips', () => {
    const out = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || !isPrivateIp(a.address) || /^169\.254\./.test(a.address)) continue;
      if (/vEthernet|WSL|VirtualBox|VMware|Hyper-V|Loopback|vboxnet|docker|br-/i.test(name)) continue;
      out.push({ ip: a.address, name: /wi-?fi|wlan|wireless/i.test(name) ? T('Wi‑Fi') : /ethernet|eth/i.test(name) ? T('Network cable') : name });
    }
    return out;
  });
  ipcMain.on('connect:res', (_e, r) => { const f = connectPending.get(r.id); if (f) { connectPending.delete(r.id); f(r); } });
  ipcMain.on('connect:devices?', () => sendDevices());
  ipcMain.on('cover:done', (_e, r) => { const f = coverJobsPending.get(r.id); if (f) { coverJobsPending.delete(r.id); f(r); } });
  ipcMain.handle('file:exists', (_e, p) => fs.existsSync(p));
  ipcMain.handle('cover:data', async (_e, p) => {
    try { return 'data:image/jpeg;base64,' + (/^https?:/.test(p) ? await httpBuffer(p) : await fsp.readFile(p)).toString('base64'); } catch { return null; }
  });
  ipcMain.on('chrome:colors', (_e, c) => {
    if (win && process.platform !== 'darwin') { try { win.setTitleBarOverlay({ ...c, height: 52 }); } catch { /* */ } }
  });
  ipcMain.on('player:state', (_e, s) => {
    setThumbar(!!s.playing);
    if (win) win.setTitle(s.title ? `${T('{0} — {1} · rJuke', s.title, s.artist)}` : (s.name ? `${T('rJuke — Welcome back, {0}', s.name)}` : 'rJuke'));
  });
}

// ---------- startup ----------
// language: the one chosen in Settings, otherwise the system's; Chromium follows it too
// (e.g. the birthday date field showed «mm/dd/yyyy» on an Italian interface)
{
  const s = readJSON('settings.json', null) || {};
  const l = I18N.setLang(s.lang || 'auto');
  app.commandLine.appendSwitch('lang', l === 'it' ? 'it-IT' : 'en-GB');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    const s = readJSON('settings.json', null);
    if (s && s.theme) nativeTheme.themeSource = s.theme;
    registerIpc();
    createWindow();
    nativeTheme.on('updated', () => win && win.webContents.send('theme:changed', nativeTheme.shouldUseDarkColors));
    if (process.env.RJ_TEST && fs.existsSync(path.join(__dirname, 'tools', 'harness.js'))) {
      require('./tools/harness.js')(win);
    }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { partyServe(false).catch(() => {}); });
  app.on('before-quit', () => { try { connect.bonjour && connect.bonjour.unpublishAll(); connect.bonjour && connect.bonjour.destroy(); } catch { /* */ } });
}
