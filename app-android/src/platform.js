// rJuke Android — bridge between the UI and the system (replaces Electron's preload)
import { Capacitor, registerPlugin, SystemBars } from '@capacitor/core';
import { App } from '@capacitor/app';
import { parseWebStream } from 'music-metadata';

const Juke = window.__JUKE_MOCK || registerPlugin('Juke');
window.Juke = Juke;
window.CapApp = App;

const fileSrc = (p) => (p ? Capacitor.convertFileSrc(p) : '');
window.rjFileSrc = fileSrc;

// ---------- app storage ----------
async function loadJSON(name, fallback) {
  try {
    const { text } = await Juke.loadText({ name });
    return text ? JSON.parse(text) : fallback;
  } catch { return fallback; }
}
const saveJSON = (name, data) => Juke.saveText({ name, text: JSON.stringify(data) });

// ---------- permissions ----------
async function ensureAudioPermission() {
  const info = await Juke.info();
  const alias = info.sdk >= 33 ? 'audio' : 'storage';
  let st = await Juke.checkPermissions();
  if (st[alias] === 'granted') return true;
  st = await Juke.requestPermissions({ permissions: [alias] });
  return st[alias] === 'granted';
}
window.rjEnsurePermission = ensureAudioPermission;

// ---------- library ----------
function normalizeLibrary(lib) {
  if (!lib) return null;
  const covers = {};
  const genres = {};
  for (const [k, c] of Object.entries(lib.covers || {})) {
    covers[k] = c && c.s ? c : null;
    if (c && c.genre) genres[k] = c.genre;
  }
  for (const t of lib.tracks) {
    if (!t.genre && genres[t.albumKey]) t.genre = genres[t.albumKey];
  }
  lib.covers = covers;
  return lib;
}

// folders with music, grouped for the choice in the setup
async function musicFolders() {
  const { folders } = await Juke.folders();
  const ROOT_RE = /^(\/storage\/emulated\/\d+|\/storage\/[^/]+|\/sdcard)/;
  const tree = new Map();
  let total = 0;
  for (const f of folders) {
    total += f.count;
    const m = f.dir.match(ROOT_RE);
    const root = m ? m[1] : '';
    const rest = f.dir.slice(root.length).split('/').filter(Boolean);
    // aggregates for each ancestor up to 3 levels
    for (let d = 1; d <= Math.min(3, rest.length); d++) {
      const key = root + '/' + rest.slice(0, d).join('/');
      const e = tree.get(key) || { dir: key, count: 0, depth: d, storage: root };
      e.count += f.count;
      tree.set(key, e);
    }
  }
  return { total, folders: [...tree.values()] };
}

// ---------- playlist ----------
function decodeText(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  let s;
  try { s = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { s = new TextDecoder('windows-1252').decode(bytes); }
  return s.replace(/^﻿/, '');
}
const segs = (p) => p.replace(/^file:\/\/\/?/i, '').split(/[\\/]+/).filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
const keyN = (arr, n) => arr.slice(-n).join('/').toLowerCase();

function matchPlaylist(name, text, tracks) {
  const byTail2 = new Map(), byTail1 = new Map(), byFull = new Map();
  for (const t of tracks) {
    const s = segs(t.path);
    byFull.set(s.join('/').toLowerCase(), t.path);
    const k2 = keyN(s, 2); if (!byTail2.has(k2)) byTail2.set(k2, t.path);
    const k1 = keyN(s, 1); if (!byTail1.has(k1)) byTail1.set(k1, t.path);
  }
  let title = name.replace(/\.(m3u8?|txt)$/i, '');
  const paths = [], missing = [];
  let info = '';
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) { const m = line.match(/^#PLAYLIST:\s*(.+)$/i); if (m) title = m[1].trim(); const x = line.match(/^#EXTINF:[^,]*,(.*)$/i); if (x) info = x[1].trim(); continue; }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(line) && !/^file:/i.test(line)) { info = ''; continue; }
    const s = segs(line).filter((x) => x !== '..' && x !== '.');
    const hit = byFull.get(s.join('/').toLowerCase()) || byTail2.get(keyN(s, 2)) || byTail1.get(keyN(s, 1));
    // track not found: the line as it is, where it was in the playlist and the file's “Artist - Title” name (if any)
    if (hit) paths.push(hit); else missing.push({ line, at: paths.length, info });
    info = '';
  }
  return { name: title, paths, missing };
}

// ---------- lyrics (same logic as the Windows version) ----------
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

const MIME = { mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', webm: 'audio/webm' };

async function readLyrics(path) {
  let fromTags = null;
  try {
    const ctl = new AbortController();
    const res = await fetch(fileSrc(path), { signal: ctl.signal });
    if (res.ok && res.body) {
      const ext = (path.split('.').pop() || '').toLowerCase();
      const meta = await parseWebStream(res.body, { mimeType: MIME[ext] || res.headers.get('content-type') || undefined, size: Number(res.headers.get('content-length')) || undefined }, { skipCovers: true, duration: false, skipPostHeaders: true });
      try { ctl.abort(); } catch { /* */ }
      fromTags = extractLyrics(meta);
    }
  } catch { /* unreadable file */ }
  if (fromTags && fromTags.synced) return fromTags;
  if (dt) return fromTags;
  // .lrc file next to the track (readable only on some Android versions)
  try {
    const base = path.slice(0, path.length - (path.split('.').pop() || '').length - 1);
    const r = await fetch(fileSrc(base + '.lrc'));
    if (r.ok) {
      const s = await r.text();
      const p = parseLRC(s);
      if (p) return p;
      if (!fromTags && s.trim()) return { synced: false, text: s.trim() };
    }
  } catch { /* */ }
  return fromTags;
}

// ---------- system bars ----------
let lastBars = '';
function chromeColors(c) {
  const hex = (c && c.color) || '#000000';
  const v = parseInt(hex.slice(1), 16);
  const lum = (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
  const style = lum < 0.5 ? 'DARK' : 'LIGHT';
  if (style === lastBars) return;
  lastBars = style;
  try { SystemBars.setStyle({ style }); } catch { /* */ }
}

// ---------- API compatible with the Windows version ----------
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
let infoCache = null;

window.rj = {
  info: async () => {
    if (!infoCache) { try { infoCache = await Juke.info(); } catch { infoCache = {}; } }
    return { platform: 'android', mica: false, version: infoCache.version || '', dark: darkMQ.matches, sdk: infoCache.sdk };
  },
  getSettings: () => loadJSON('settings.json', null),
  setSettings: async (patch) => {
    const s = { ...((await loadJSON('settings.json', {})) || {}), ...patch };
    await saveJSON('settings.json', s);
    return s;
  },
  pickFolder: async () => (window.rjPickFolder ? window.rjPickFolder() : null),
  musicFolders,
  loadLibrary: async () => normalizeLibrary(await loadJSON('library.json', null)),
  scan: async (root, name, full = false) => {
    if (!(await ensureAudioPermission())) throw new Error(T('permission denied'));
    const { json } = await Juke.scan({ root: root === '*' ? '' : root });
    return normalizeLibrary(JSON.parse(json));
  },
  onScanProgress: (fn) => { Juke.addListener('scan', fn); },
  lyrics: readLyrics,
  getPlaylists: () => loadJSON('playlists.json', []),
  savePlaylists: (lists) => saveJSON('playlists.json', lists),
  importPlaylists: async () => {
    const { files } = await Juke.pickText();
    const tracks = (window.S && window.S.tracks) || [];
    return (files || []).map((f) => matchPlaylist(f.name, decodeText(f.base64), tracks));
  },
  exportPlaylist: async ({ name, tracks }) => {
    const lines = ['#EXTM3U', '#PLAYLIST:' + name];
    for (const t of tracks) { lines.push(`#EXTINF:${Math.round(t.duration || 0)},${t.artist} - ${t.title}`); lines.push(t.path); }
    const r = await Juke.saveDocument({ name: (name || T('Playlists')).replace(/[\\/:*?"<>|]/g, '_') + '.m3u8', text: '﻿' + lines.join('\r\n') + '\r\n' });
    return r && r.saved ? r.name : false;
  },
  pickPlaylistFolder: async () => { const r = await Juke.pickTree(); return r && r.uri ? r : null; },
  findPlaylists: async (uri) => {
    const tracks = (window.S && window.S.tracks) || [];
    const { files } = await Juke.findPlaylists({ uri });
    return (files || []).map((f) => ({ ...matchPlaylist(f.name, decodeText(f.base64), tracks), source: f.uri, mtime: f.mtime })).filter((x) => x.paths.length);
  },
  saveRecent: (list) => Juke.saveText({ name: 'recent.json', text: JSON.stringify(list) }).catch(() => {}),
  connectStart: (info) => Juke.connectStart(info),
  onConnectRequest: (fn) => {
    Juke.addListener('connectRequest', async (req) => {
      let r;
      try { r = await fn(req); } catch (e) { r = { status: 500, body: { error: String(e && e.message) } }; }
      const out = { id: req.id, status: r.status || 200 };
      if (r.stream) { out.stream = r.stream; out.type = r.type || 'application/octet-stream'; } else if (r.file) { out.file = r.file; out.type = r.type || 'image/jpeg'; out.cache = !!r.cache; } else if (r.text != null) { out.text = String(r.text); out.type = r.type || 'text/html; charset=utf-8'; } else out.body = JSON.stringify(r.body || {});
      Juke.connectRespond(out).catch(() => {});
    });
  },
  onConnectDevices: (fn) => { Juke.addListener('connectDevices', (e) => fn(e.devices || [])); },
  connectFetch: (o) => Juke.connectFetch(o),
  libShare: (data) => Juke.libShare({ data }).catch(() => {}),
  batteryStatus: () => Juke.batteryStatus().then((r) => !!(r && r.exempt)).catch(() => true),
  batteryExempt: () => Juke.batteryExempt().catch(() => {}),
  connectScan: () => Juke.connectScan(),
  connectIps: () => Juke.connectIps().then((r) => r.ips || []),
  partyStats: (reset = false) => Juke.partyStats({ reset }),
  partyServe: (on, extra = {}) => Juke.partyServe({ on: !!on, ...extra }),
  netCheck: () => Promise.resolve({ ok: true }),
  showInFolder: () => {},
  exists: async () => true,
  coverData: async () => null,
  chromeColors,
  playerState: () => {},
  onMediaCmd: () => {},
  onThemeChanged: (fn) => darkMQ.addEventListener('change', (e) => fn(e.matches)),
  // ---------- PartyBox da Android Auto ----------
  partyAuto: (o) => Juke.partyAuto(o).catch(() => {}),
  onAuto: (fn) => {
    Juke.addListener('auto', (e) => fn(e && e.cmd));
    try { Juke.autoPending().then((r) => { if (r && r.cmd) fn(r.cmd); }).catch(() => {}); } catch { /* */ }
  },
  haptic: (kind = 'tick') => { try { Juke.haptic({ kind }); } catch { /* */ } },
};
