'use strict';
/* rJuke Connect — control the music of another device at home and move the listening (Windows ⇄ Android) */

const RC = { scanning: false, lastScan: 0, me: null, devices: new Map(), ip: '', port: 0, started: false, asked: new Set(), panel: null, greeted: new Set() };
const RC_DESKTOP = () => S.info.platform !== 'android';

function deviceName() {
  // name chosen in settings; empty = the automatic one
  return String(S.settings.connectName || '').trim() || deviceAutoName();
}
function deviceAutoName() {
  const n = nm();
  return RC_DESKTOP() ? (n ? `${T('{0}\'s PC', n)}` : 'PC') : (n ? `${T('{0}\'s phone', n)}` : T('Phone'));
}
const myIcon = () => (DEVICE_ICONS.some(([k]) => k === S.settings.connectIcon) ? S.settings.connectIcon : '');

// ---------- startup ----------
async function connectInit() {
  if (!rj.connectStart || RC.started || RC.starting) return;
  RC.starting = true;
  if (!S.settings.deviceId) {
    const id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, '');
    S.settings = await rj.setSettings({ deviceId: id });
  }
  RC.me = { id: S.settings.deviceId, name: deviceName(), icon: myIcon() };
  rj.onConnectRequest(connectHandle);
  rj.onConnectDevices((list) => {
    for (const [k, d] of RC.devices) if (!d.manual) RC.devices.delete(k);
    for (const d of list) if (d.id !== RC.me.id) RC.devices.set(d.id, d);
    connectUIRefresh();
    if (window.phoneDevicesChanged) phoneDevicesChanged();
  });
  try { const r = await rj.connectStart(RC.me); RC.ip = r.ip; RC.port = r.port; RC.started = true; } catch (e) { console.warn(T('Connect not started'), e); }
  RC.starting = false;
  if (rj.libShare) { setTimeout(() => libShareSync(true), 1500); setInterval(() => libShareSync(false), 15000); }
  for (const m of S.settings.connectManual || []) probeDevice(m.host, m.port, true).catch(() => {});
  connectUIRefresh();
  setTimeout(() => { if (!RC.devices.size) scanHome(); }, 6000);
}
// if automatic discovery (mDNS) finds nothing, I scan the home network directly
async function scanHome() {
  if (!rj.connectScan || RC.scanning || !RC.started) return;
  RC.scanning = true; RC.lastScan = Date.now();
  const before = RC.devices.size;
  connectUIRefresh();
  try { await rj.connectScan(); } catch { /* */ }
  RC.scanning = false;
  connectUIRefresh();
  if (menuStack.length && document.querySelector('.rc-menu-title') && RC.devices.size !== before) connectMenu(RC.mx, RC.my, true);
}
async function connectRename() {
  if (!RC.started) return;
  RC.me = { id: S.settings.deviceId, name: deviceName(), icon: myIcon() };
  try { await rj.connectStart(RC.me); } catch { /* */ }
}
window.connectInit = connectInit;
window.connectRename = connectRename;

// settings: the name and icon other devices see for this one
function connectIdentityHTML() {
  const cur = myIcon() || (RC_DESKTOP() ? 'pc' : 'phone');
  return `<div class="set-row"><div class="lbl"><b>${T('Name for other devices')}</b><span>${T('How others see you in the “Listen on…” menu. Empty: “{0}”', esc(deviceAutoName()))}</span></div>
        <input class="field" id="set-cname" value="${esc(S.settings.connectName || '')}" placeholder="${esc(deviceAutoName())}" maxlength="32" spellcheck="false"></div>
      <div class="set-row set-row-top"><div class="lbl"><b>${T('Icon')}</b><span>${T('The one shown next to the name')}</span></div></div>
      <div class="dev-icons" role="radiogroup" aria-label="${T('Icon')}">${DEVICE_ICONS.map(([k, l]) => `<button class="dev-ic${k === cur ? ' on' : ''}" data-ic="${k}" role="radio" aria-checked="${k === cur}">${icon(k)}<span>${l}</span></button>`).join('')}</div>`;
}
function connectIdentityBind(el) {
  const inp = el.querySelector('#set-cname');
  if (inp) inp.addEventListener('change', async () => {
    const v = inp.value.trim().replace(/\s+/g, ' ');
    inp.value = v;
    if (v === String(S.settings.connectName || '')) return;
    S.settings = await rj.setSettings({ connectName: v });
    await connectRename(); connectUIRefresh();
    toast(`${T('Other devices now see you as “{0}”', deviceName())}`);
  });
  const box = el.querySelector('.dev-icons');
  if (box) box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ic]'); if (!b) return;
    box.querySelectorAll('.dev-ic').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); });
    S.settings = await rj.setSettings({ connectIcon: b.dataset.ic });
    await connectRename();
  });
}
window.connectIdentityHTML = connectIdentityHTML;
window.connectIdentityBind = connectIdentityBind;

// ---------- incoming requests (this device is being controlled) ----------
const okR = (body) => ({ status: 200, body });
async function connectHandle(req) {
  const url = new URL(req.path, 'http://rj');
  const dev = req.device || {};
  // PartyBox has its own server (own port, on only during the party); Connect doesn't serve the guest pages
  if (req.kind === 'party') {
    if (url.pathname === '/party' || url.pathname.startsWith('/party/')) return window.partyHandle ? partyHandle(req, url) : { status: 404, body: {} };
    return { status: 404, text: T('Page not found'), type: 'text/plain; charset=utf-8' };
  }
  if (url.pathname === '/party' || url.pathname.startsWith('/party/')) return { status: 404, body: {} };
  // library shared with a “speaker” PC: files, covers and lyrics are requested with the code given to the authorized device
  if (url.pathname.startsWith('/rj/lib/') && (S.settings.source === 'phone' || !S.tracks.length)) return { status: 404, body: { error: T('There\'s no library to share on this device') } };
  if (url.pathname.startsWith('/rj/lib/') && url.pathname !== '/rj/lib/index') return libServe(url);
  if (url.pathname !== '/rj/info') {
    const trusted = S.settings.connectTrusted || {};
    if (!dev.id) return { status: 403, body: { error: 'unknown device' } };
    if (!trusted[dev.id]) { askTrust(dev, url.pathname === '/rj/lib/index'); return { status: 403, body: { error: 'pending' } }; }
  }
  let body = {};
  try { body = req.body ? JSON.parse(req.body) : {}; } catch { body = {}; }
  switch (url.pathname) {
    case '/rj/info': return okR({ id: RC.me.id, name: RC.me.name, platform: S.info.platform || 'windows', tv: !!S.info.tv, icon: myIcon(), version: S.info.version || '' });
    case '/rj/state': return okR(connectState());
    case '/rj/cover': { const t = cur(); return t && t.cover ? { file: t.cover.l, type: 'image/jpeg' } : { status: 404, body: {} }; }
    case '/rj/albumcover': { const a = S.albumMap.get(url.searchParams.get('key')); return a && a.cover ? { file: a.cover.s, type: 'image/jpeg' } : { status: 404, body: {} }; }
    case '/rj/library': return okR({
      albums: S.albums.map((a) => ({ key: a.key, title: a.title, artist: a.artist, year: a.year || null, cover: !!a.cover })),
      playlists: S.playlists.map((p) => ({ id: p.id, name: p.name, count: p.paths.filter((x) => S.byPath.has(x)).length })),
    });
    case '/rj/search': return okR(remoteSearch(url.searchParams.get('q') || ''));
    case '/rj/lib/index': return okR(await libIndex(dev, url.searchParams.get('since') || ''));
    case '/rj/cmd': greet(dev); return okR(await connectCmd(body));
    case '/rj/handoff': return okR(await connectReceive(body, dev));
    default: return { status: 404, body: { error: T('not found') } };
  }
}
function greet(dev) {
  if (RC.greeted.has(dev.id)) return;
  RC.greeted.add(dev.id);
  toast(`${T('{0} is controlling your music', dev.name || T('A device'))}`);
}
function askTrust(dev, lib) {
  if (RC.asked.has(dev.id)) return;
  RC.asked.add(dev.id);
  confirmModal({
    title: `${T('Connect “{0}”?', dev.name || 'dispositivo')}`,
    text: lib
      ? `${T('{0} wants to use your music as a speaker: it will see your library and fetch the tracks from here when needed, without copying it all. Only allow your own devices.', dev.name || T('A device'))}`
      : `${T('{0} wants to control the music on {1} with rJuke Connect. Only allow your own devices.', dev.name || T('A device'), RC.me.name)}`,
    ok: T('Allow'),
  }).then(async (yes) => {
    if (yes) {
      const tr = { ...(S.settings.connectTrusted || {}), [dev.id]: dev.name || T('Device') };
      S.settings = await rj.setSettings({ connectTrusted: tr });
      libShareSync(false);
      toast(lib ? `${T('{0} can now use your music', dev.name)}` : `${T('{0} can now control rJuke', dev.name)}`);
    } else setTimeout(() => RC.asked.delete(dev.id), 60000);
  });
}
const trackMeta = (t) => ({ title: t.title, artist: t.artist, album: t.album_.title, duration: t.duration || 0 });
function connectState() {
  const t = cur();
  return {
    id: RC.me.id, name: RC.me.name, platform: S.info.platform || 'windows', tv: !!S.info.tv,
    playing: !!S.playing, position: audio.currentTime || 0, duration: audio.duration || (t ? t.duration : 0) || 0,
    track: t ? { ...trackMeta(t), key: t.path } : null,
    cover: !!(t && t.cover), coverColors: t && t.cover ? t.cover.colors : null,
    qStart: S.qi, total: S.queue.length,
    queue: S.queue.slice(Math.max(0, S.qi), S.qi + 300).map(trackMeta),
    shuffle: !!S.shuffle, repeat: S.repeat,
    volume: RC_DESKTOP() ? S.volume : null,
  };
}
// ---------- shared library: a PC uses this device's music without copying it ----------
const libStamp = () => `${S.tracks.length}:${S.tracks.reduce((m, t) => Math.max(m, t.mtime || t.added || 0), 0)}:${S.playlists.length}:${S.playlists.reduce((n, p) => n + p.paths.length, 0)}`;
async function libToken(dev) {
  const all = { ...(S.settings.libTokens || {}) };
  if (!all[dev.id]) {
    all[dev.id] = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    S.settings = await rj.setSettings({ libTokens: all });
    setTimeout(() => { libShareSync(true); batteryAsk(dev); }, 300);
  }
  return all[dev.id];
}
function libBody() {
  const covers = {};
  for (const a of S.albums) if (a.cover) covers[a.key] = { colors: a.cover.colors || null, avg: a.cover.avg || null, light: !!a.cover.light };
  return {
    tracks: S.tracks.map((t) => ({ path: t.path, title: t.title, artist: t.artist, albumArtist: t.albumArtist || '', album: t.album || '', albumKey: t.albumKey, year: t.year || null, genre: t.genre || '', track: t.track || null, disc: t.disc || null, duration: t.duration || 0, lyrics: t.lyrics || 0, codec: t.codec || '', size: t.size || 0, added: t.added || 0, mtime: t.mtime || 0 })),
    covers,
    playlists: S.playlists.map((p) => ({ id: p.id, name: p.name, paths: p.paths.filter((x) => S.byPath.has(x)) })),
  };
}
// Android: the library is copied into the native server, which answers the PC even with the screen locked (bug #50)
let libShareSig = '';
async function libShareSync(force) {
  if (!rj.libShare || !RC.started || !S.tracks.length || S.settings.source === 'phone') return;
  const toks = S.settings.libTokens || {}, trusted = S.settings.connectTrusted || {};
  const devTokens = {}, devNames = {};
  for (const [id, t] of Object.entries(toks)) if (trusted[id]) { devTokens[id] = t; devNames[id] = trusted[id]; }
  if (!Object.keys(devTokens).length) { if (libShareSig !== 'none') { libShareSig = 'none'; rj.libShare(JSON.stringify({ name: RC.me.name, devTokens: {} })); } return; }
  const stamp = libStamp();
  const sig = `${stamp}|${RC.me.name}|${JSON.stringify(devTokens)}`;
  if (!force && sig === libShareSig) return;
  libShareSig = sig;
  const isAndroid = S.info.platform === 'android';
  await rj.libShare(JSON.stringify({
    name: RC.me.name, platform: S.info.platform || 'android', version: S.info.version || '', stamp, devTokens, devNames,
    body: JSON.stringify(libBody()),
    files: S.tracks.map((t) => [t.path, isAndroid ? t.uri : t.path, AUDIO_MIME[(t.path.split('.').pop() || '').toLowerCase()] || 'application/octet-stream']),
    covers: S.albums.filter((a) => a.cover).map((a) => [a.key, a.cover.s, a.cover.l]),
  }));
}
window.libShareSync = libShareSync;
// the first time a PC uses this phone's music: I ask not to restrict the app with battery saver
async function batteryAsk(dev) {
  if (!rj.batteryStatus || S.settings.batteryAsked) return;
  if (await rj.batteryStatus()) return;
  S.settings = await rj.setSettings({ batteryAsked: true });
  const yes = await confirmModal({
    title: T('Music even with the screen locked'),
    text: `${T('So that {0} can use your music even when you lock the phone, Android has to exempt rJuke from battery saving. On the next screen tap “Allow”.', dev.name || T('the PC'))}`,
    ok: T('Continue'),
  });
  if (yes) rj.batteryExempt();
}
async function libIndex(dev, since) {
  const token = await libToken(dev);
  const stamp = libStamp();
  const head = { name: RC.me.name, platform: S.info.platform || 'windows', stamp, token };
  if (since && since === stamp) return { ...head, same: true };
  return { ...head, ...libBody() };
}
const AUDIO_MIME = { mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav' };
async function libServe(url) {
  const tok = url.searchParams.get('t') || '';
  const trusted = S.settings.connectTrusted || {};
  const ok = tok && Object.entries(S.settings.libTokens || {}).some(([id, t]) => t === tok && trusted[id]);
  if (!ok) return { status: 403, body: { error: T('invalid code') } };
  const p = url.searchParams.get('p') || '';
  switch (url.pathname) {
    case '/rj/lib/file': {
      const t = S.byPath.get(p); if (!t) return { status: 404, body: {} };
      const ext = (t.path.split('.').pop() || '').toLowerCase();
      let stream = S.info.platform === 'android' ? t.uri : t.path;
  return { stream, type: AUDIO_MIME[ext] || 'application/octet-stream' };
    }
    case '/rj/lib/cover': {
      const a = S.albumMap.get(url.searchParams.get('a') || '');
      if (!a || !a.cover) return { status: 404, body: {} };
      return { file: url.searchParams.get('size') === 'l' ? a.cover.l : a.cover.s, type: 'image/jpeg', cache: true };
    }
    case '/rj/lib/lyrics': {
      const t = S.byPath.get(p); if (!t) return { status: 404, body: {} };
      let data = null;
      try { data = await rj.lyrics(t.path); } catch { data = null; }
      return okR(data || {});
    }
    default: return { status: 404, body: {} };
  }
}

// search in this device's library, for whoever controls it remotely
function remoteSearch(q) {
  const nq = norm(q).trim();
  if (!nq) return { tracks: [], albums: [], artists: [] };
  const terms = nq.split(/\s+/);
  const hit = (s) => terms.every((w) => s.includes(w));
  const score = (t) => { const n = norm(t); return n === nq ? 0 : n.startsWith(nq) ? 1 : n.includes(nq) ? 2 : 3; };
  return {
    artists: S.artists.filter((a) => hit(a.s)).sort((a, b) => score(a.name) - score(b.name)).slice(0, 6).map((a) => ({ key: a.key, name: a.name, count: a.tracks.length, cover: ((a.albums.find((x) => x.cover) || a.appears.find((x) => x.cover)) || {}).key || '' })),
    albums: S.albums.filter((a) => hit(a.s)).sort((a, b) => score(a.title) - score(b.title)).slice(0, 8).map((a) => ({ key: a.key, title: a.title, artist: a.artist, year: a.year || null, cover: !!a.cover })),
    tracks: S.tracks.filter((t) => hit(t.s)).sort((a, b) => score(a.title) - score(b.title)).slice(0, 40).map((t) => ({ id: t.path, title: t.title, artist: t.artist, album: t.album_.title, duration: t.duration || 0, cover: t.cover ? t.albumKey : '' })),
  };
}
async function connectCmd(b) {
  switch (b.cmd) {
    case 'toggle': togglePlay(); break;
    case 'play': if (!S.playing) togglePlay(); break;
    case 'pause': if (S.playing) togglePlay(); break;
    case 'next': next(); break;
    case 'prev': prev(); break;
    case 'seek': seekTo(+b.pos || 0); break;
    case 'volume': if (RC_DESKTOP()) setVolume(+b.v); break;
    case 'shuffle': toggleShuffle(); break;
    case 'repeat': cycleRepeat(); break;
    case 'skip': if (b.i >= 0 && b.i < S.queue.length) loadTrack(+b.i); break;
    case 'album': { const a = S.albumMap.get(b.key); if (a) playList(a.tracks, +b.index || 0, { shuffle: !!b.shuffle, ctx: { type: 'album', key: a.key } }); break; }
    case 'playlist': { const p = S.plMap.get(b.id); if (p) playList(plTracks(p), 0, { shuffle: !!b.shuffle, ctx: { type: 'playlist', id: p.id } }); break; }
    case 'shuffleAll': if (S.tracks.length) playList(S.tracks, 0, { shuffle: true }); break;
    case 'track': { const t = S.byPath.get(b.id); if (t) { const a = t.album_; playList(a.tracks, Math.max(0, a.tracks.indexOf(t)), { shuffle: false, ctx: { type: 'album', key: a.key } }); } break; }
    case 'enqueue': { const t = S.byPath.get(b.id); if (t) { if (cur()) queueInsertAt(S.qi + 1, [t]); else playList([t], 0, { shuffle: false }); } break; }
    case 'artist': { const ar = S.artistMap.get(b.key); if (ar && ar.tracks.length) playList(ar.tracks, 0, { shuffle: true }); break; }
    default: break;
  }
  await new Promise((r) => setTimeout(r, 180));
  return connectState();
}

// matches another device's tracks to this library's (title + artist, then title + album)
function matchTracks(list) {
  const k1 = new Map(), k2 = new Map(), k3 = new Map();
  for (const t of S.tracks) {
    const a = norm(t.title) + '|' + norm(t.artist);
    if (!k1.has(a)) k1.set(a, t);
    const b = norm(t.title) + '|' + norm(t.album_.title);
    if (!k2.has(b)) k2.set(b, t);
    const c = norm(t.title).replace(/\s*[([].*$/, '');
    if (!k3.has(c)) k3.set(c, t);
  }
  return list.map((m) => k1.get(norm(m.title) + '|' + norm(m.artist)) || k2.get(norm(m.title) + '|' + norm(m.album)) || k3.get(norm(m.title).replace(/\s*[([].*$/, '')) || null);
}
async function connectReceive(b, dev) {
  const q = Array.isArray(b.queue) ? b.queue.slice(0, 500) : [];
  const m = matchTracks(q);
  const found = m.filter(Boolean);
  if (!found.length) return { ok: false, error: T('None of these tracks is in the library of') + ' ' + RC.me.name };
  const firstOk = m[0] != null;
  playList(found, 0, { shuffle: false });
  if (firstOk && b.position > 1) setTimeout(() => seekTo(+b.position), 450);
  toast(`${T('Music moved here from {0}', dev.name || T('another device'))}`, found[0].cover);
  return { ok: true, matched: found.length, total: q.length, exact: firstOk };
}

// ---------- this device controls the others ----------
async function rc(d, path, { method = 'GET', body = null, binary = false, timeout = 8000 } = {}) {
  const r = await rj.connectFetch({ host: d.host, port: d.port, path, method, body: body ? JSON.stringify(body) : null, binary, timeout });
  if (binary) return r.status === 200 ? r.base64 : null;
  let data = {};
  try { data = JSON.parse(r.body || '{}'); } catch { data = {}; }
  if (r.status === 403 && data.error === 'pending') { const e = new Error('pending'); e.pending = true; throw e; }
  if (r.status >= 400) throw new Error(data.error || 'errore ' + r.status);
  return data;
}
async function probeDevice(host, port, manual) {
  const info = await rc({ host, port }, '/rj/info');
  if (!info.id || info.id === RC.me.id) throw new Error(T('This is your own device'));
  const d = { id: info.id, name: info.name, platform: info.platform, tv: !!info.tv, icon: info.icon || '', host, port, manual: !!manual };
  RC.devices.set(d.id, d);
  connectUIRefresh();
  if (window.phoneDevicesChanged) phoneDevicesChanged();
  return d;
}

function connectMenu(x = 0, y = 0, refresh = false) {
  RC.mx = x; RC.my = y;
  if (!refresh && Date.now() - RC.lastScan > 15000) setTimeout(scanHome, 50);
  if (!refresh) refreshDevInfo();
  const devs = [...RC.devices.values()].sort((a, b) => a.name.localeCompare(b.name));
  const items = [{ label: `${T('{0} · in use', RC.me ? RC.me.name : T('This device'))}`, icon: 'check', keep: true, action: () => {} }];
  if (devs.length) items.push({ sep: true });
  for (const d of devs) {
    const sub = [
      { label: T('Control from here'), icon: 'enlarge', action: () => openRemote(d) },
      { label: T('Listen here'), icon: 'import', action: () => pullFrom(d) },
    ];
    if (cur()) sub.push({ label: `${T('Move the music to {0}', d.name)}`, icon: 'export', action: () => pushTo(d) });
    items.push({ label: d.name, icon: devIcon(d), sub });
  }
  if (!devs.length) {
    items.push({ label: RC.scanning || Date.now() - RC.lastScan < 1000 ? T('Looking for your devices at home…') : T('No devices found at home'), icon: 'cast', disabled: true });
    items.push({ label: T('Can\'t find it? What to check'), icon: 'sparkle', action: connectHelp });
  }
  items.push({ sep: true }, { label: window.PB && PB.on ? `${T('{0} · active', partyName())}` : T('Start PartyBox'), icon: 'party', action: () => partyStart() });
  items.push({ label: T('Connect with an address…'), icon: 'plus', action: addByAddress });
  showMenu(items, x, y, { header: `<div class="sheet-title rc-menu-title">${T('Listen on…')}<span>${T('rJuke Connect · same Wi‑Fi')}</span></div>` });
}
window.connectMenu = connectMenu;
// name, icon and state asked again from each device: the network announcement may arrive late
async function refreshDevInfo() {
  const key = (d) => {
    if (!d) return '';
    let k = [d.name, d.icon].join('|');
    return k;
  };
  const before = new Map([...RC.devices].map(([k, d]) => [k, key(d)]));
  await Promise.all([...RC.devices.values()].map((d) => rc(d, '/rj/info', { timeout: 2500 }).then((info) => {
    if (!info || info.id !== d.id) return;
    Object.assign(d, { name: info.name || d.name, icon: info.icon || '' });
  }).catch(() => {})));
  const changed = [...RC.devices].some(([k, d]) => before.get(k) !== key(d));
  if (!changed) return;
  connectUIRefresh();
  // menu still open on the list (not inside a device): I redraw it
  const open = [...document.querySelectorAll('.mi')].some((e) => e.textContent.includes(T('Connect with an address')));
  if (open) connectMenu(RC.mx, RC.my, true);
}

async function connectHelp() {
  // Windows: if the firewall or a “Public” network blocks rJuke, it can be fixed with one click
  if (rj.netCheck && rj.netFix) {
    const n = await rj.netCheck().catch(() => ({ ok: true }));
    if (!n.ok) {
      const yes = await confirmModal({ title: T('Windows is blocking rJuke'), text: `${T('{0} the phone can\'t see the PC. Press “Allow” and answer “Yes” to the Windows prompt: rJuke will be allowed only for the devices on your home network.', n.public ? T('This network is set as “Public”, so') : T('The Windows firewall doesn\'t let the other devices in:'))}`, ok: T('Allow') });
      if (yes) { const r = await rj.netFix(); toast(r.ok ? T('Done! Other devices can now find this PC') : T('Windows didn\'t confirm: try again and answer “Yes”')); }
      return;
    }
  }
  confirmModal({
    title: T('Can\'t find a device?'),
    text: `${T('Check that: 1) rJuke is open on both; 2) they\'re on the same home Wi‑Fi (not the guest one); 3) on the PC the Wi‑Fi network is set as “Private” (Windows Settings → Network & Internet → Wi‑Fi → your network) and that in “Windows Defender Firewall → Allow an app” rJuke is ticked for Private. Otherwise use “Connect with an address…” with the address you find in Settings → rJuke Connect on the other device.')}`,
    ok: T('Search again'),
  }).then((yes) => { if (yes) { RC.lastScan = 0; scanHome(); toast(T('Looking for your devices at home…')); } });
}

async function addByAddress() {
  const v = await promptModal({ title: T('Connect a device'), text: `${T('Write the address you find in rJuke\'s Settings on the other device (for example 192.168.1.20:47123).')}`, placeholder: '192.168.1.20:47123', ok: T('Connect') });
  if (!v) return;
  const m = v.trim().match(/^\[?([0-9a-fA-F.:]+?)\]?(?::(\d+))?$/);
  if (!m) { toast(T('Invalid address')); return; }
  try {
    const d = await probeDevice(m[1], +(m[2] || 47123), true);
    const list = (S.settings.connectManual || []).filter((x) => x.host !== d.host);
    S.settings = await rj.setSettings({ connectManual: [...list, { host: d.host, port: d.port }] });
    toast(`${T('Connected to {0}', d.name)}`);
    openRemote(d);
  } catch (e) { toast(`${T('I can\'t reach {0}. Check that rJuke is open and on the same network.', m[1])}`, null, 'err'); }
}

async function pullFrom(d) {
  try {
    const st = await rc(d, '/rj/state');
    if (!st.track) { toast(`${T('Nothing is playing on {0}', d.name)}`); return; }
    const m = matchTracks(st.queue);
    const found = m.filter(Boolean);
    if (!found.length) { toast(`${T('“{0}” isn\'t in this device\'s library', st.track.title)}`, null, 'err'); return; }
    playList(found, 0, { shuffle: false });
    if (m[0] && st.position > 1) setTimeout(() => seekTo(st.position), 450);
    rc(d, '/rj/cmd', { method: 'POST', body: { cmd: 'pause' } }).catch(() => {});
    if (RC.panel && RC.panel.d.id === d.id) closeRemote();
    toast(m[0] ? `${T('Now playing here: “{0}”', st.track.title)}` : `${T('“{0}” isn\'t here: starting from the next track you have', st.track.title)}`, found[0].cover);
  } catch (e) { toast(e.pending ? `${T('Confirm the access on {0}, then try again', d.name)}` : `${T('I can\'t reach {0}', d.name)}`, null, e.pending ? '' : 'err'); }
}

async function pushTo(d) {
  if (!cur()) return;
  try {
    const r = await rc(d, '/rj/handoff', { method: 'POST', body: { queue: S.queue.slice(S.qi, S.qi + 400).map(trackMeta), position: audio.currentTime, playing: true } });
    if (!r.ok) { toast(r.error || `${T('{0} doesn\'t have these tracks', d.name)}`); return; }
    if (S.playing) togglePlay();
    toast(r.exact ? `${T('Music moved to {0}', d.name)}` : `${T('Moved to {0}: the current track isn\'t there, starting from the next one', d.name)}`);
    openRemote(d);
  } catch (e) { toast(e.pending ? `${T('Confirm the access on {0}, then try again', d.name)}` : `${T('I can\'t reach {0}', d.name)}`, null, e.pending ? '' : 'err'); }
}


// ---------- remote control panel ----------
function openRemote(d) {
  closeRemote(true);
  const el = h(`<div class="rc-back"><div class="rc">
    <div class="rc-bg"></div>
    <div class="rc-head">
      <div class="rc-dev">${icon(devIcon(d))}<div><span>${T('Now controlling')}</span><b>${esc(d.name)}</b></div></div>
      <button class="ibtn rc-x" title="${T('Close')}">${icon(TOUCH ? 'down' : 'close')}</button>
    </div>
    <div class="rc-body">
      <div class="rc-main">
        <div class="rc-art"><div class="ph" style="${phStyle(d.id)}">${icon('note')}</div></div>
        <div class="rc-info"><div class="rc-title">${T('Connecting…')}</div><div class="rc-artist">${esc(d.name)}</div></div>
        <div class="rc-progress"><div class="rc-bar"><div class="rc-fill"></div></div><div class="rc-times"><span class="rc-cur">0:00</span><span class="rc-rem">-0:00</span></div></div>
        <div class="rc-ctrls">
          <button class="ibtn rc-sm" data-c="shuffle">${icon('shuffle')}</button>
          <button class="ibtn rc-skip" data-c="prev">${icon('prev')}</button>
          <button class="ibtn rc-play" data-c="toggle">${icon('play')}</button>
          <button class="ibtn rc-skip" data-c="next">${icon('next')}</button>
          <button class="ibtn rc-sm" data-c="repeat">${icon('repeat')}</button>
        </div>
        <div class="rc-vol" hidden>${icon('vol0')}<div class="rc-slider"><div class="rc-sfill"></div></div>${icon('vol')}</div>
        <div class="rc-actions"><button class="btn primary" data-pull>${T('{0}Listen here', icon('import'))}</button></div>
        <div class="rc-msg" hidden></div>
      </div>
      <div class="rc-side">
        <label class="rc-search">${icon('search')}<input type="search" placeholder="${T('Search {0}', esc(d.name))}" autocomplete="off" spellcheck="false"><button class="rc-sclear" type="button" hidden>${icon('close')}</button></label>
        <div class="rc-tabs"></div>
        <div class="rc-list"></div>
      </div>
    </div>
  </div></div>`);
  document.body.appendChild(el);
  const P = RC.panel = { d, el, st: null, key: null, at: 0, tab: 'queue', lib: null, timer: 0, raf: 0, busy: false, seek: null };
  const q = (s) => el.querySelector(s);
  rcFit(P); setTimeout(() => rcFit(P), 650);
  q('.rc-x').addEventListener('click', () => closeRemote());
  el.addEventListener('mousedown', (e) => { if (e.target === el) closeRemote(); });
  q('[data-pull]').addEventListener('click', () => pullFrom(d));
  el.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => { rj.haptic && rj.haptic('tick'); send({ cmd: b.dataset.c }); }));
  const tabs = segmented([['queue', T('Queued')], ['albums', T('Albums')], ['playlists', T('Playlists')]], 'queue', (k) => { P.tab = k; drawList(); });
  q('.rc-tabs').appendChild(tabs);
  bindSlider(q('.rc-bar'), (x) => { P.seek = x; }, (x) => { P.seek = null; if (P.st) send({ cmd: 'seek', pos: x * P.st.duration }); });
  bindSlider(q('.rc-slider'), (x) => { q('.rc-sfill').style.width = x * 100 + '%'; }, (x) => send({ cmd: 'volume', v: x }));
  // search in the other device's library
  const sIn = q('.rc-search input'), sClr = q('.rc-sclear');
  let sTo = 0;
  sIn.addEventListener('input', () => {
    const v = sIn.value.trim();
    sClr.hidden = !v;
    clearTimeout(sTo);
    if (!v) { P.query = ''; q('.rc-side').classList.remove('searching'); P.qsig = ''; drawList(); return; }
    q('.rc-side').classList.add('searching');
    sTo = setTimeout(async () => {
      P.query = v;
      try { const r = await rc(d, '/rj/search?q=' + encodeURIComponent(v)); if (P.query === v) drawSearch(r); }
      catch (e) { if (P.query === v) q('.rc-list').innerHTML = `<div class="rc-empty">${e.pending ? `${T('Confirm the access on {0}', esc(d.name))}` : T('Search not available: update rJuke on the other device too')}</div>`; }
    }, 220);
  });
  sClr.addEventListener('click', () => { sIn.value = ''; sIn.dispatchEvent(new Event('input')); sIn.focus(); });
  function drawSearch(r) {
    const box = q('.rc-list');
    const n = r.tracks.length + r.albums.length + r.artists.length;
    if (!n) { box.innerHTML = `<div class="rc-empty">${T('Nothing on {0} for “{1}”', esc(d.name), esc(P.query))}</div>`; return; }
    let html = '';
    if (r.artists.length) html += `<div class="rc-h">${T('Artists')}</div>` + r.artists.map((a) => `<div class="rc-row" data-artist="${esc(a.key)}"><div class="rc-thumb round" data-cover="${esc(a.cover || '')}" style="${phStyle(a.key)}">${a.cover ? '' : icon('person')}</div><div class="tx"><div class="tt">${esc(a.name)}</div><div class="ta">${T('{0} · shuffle play', plural(a.count, T('track'), T('tracks')))}</div></div>${icon('shuffle', 'rc-go')}</div>`).join('');
    if (r.albums.length) html += `<div class="rc-h">${T('Albums')}</div>` + r.albums.map((x) => `<div class="rc-row" data-album="${esc(x.key)}"><div class="rc-thumb" data-cover="${x.cover ? esc(x.key) : ''}" style="${phStyle(x.key)}"></div><div class="tx"><div class="tt">${esc(x.title)}</div><div class="ta">${esc(x.artist)}${x.year ? ' · ' + x.year : ''}</div></div>${icon('play', 'rc-go')}</div>`).join('');
    if (r.tracks.length) html += `<div class="rc-h">${T('Tracks')}</div>` + r.tracks.map((t) => `<div class="rc-row" data-track="${esc(t.id)}"><div class="rc-thumb" data-cover="${esc(t.cover)}" style="${phStyle(t.album)}"></div><div class="tx"><div class="tt">${esc(t.title)}</div><div class="ta">${esc(t.artist)} · ${esc(t.album)}</div></div><button class="ibtn rc-add" data-enqueue="${esc(t.id)}" title="${T('Play next')}">${icon('playnext')}</button></div>`).join('');
    box.innerHTML = html;
    box.scrollTop = 0;
    lazyCovers(P);
  }
  q('.rc-list').addEventListener('click', (e) => {
    const add = e.target.closest('[data-enqueue]');
    if (add) { rj.haptic && rj.haptic('tick'); send({ cmd: 'enqueue', id: add.dataset.enqueue }); add.classList.add('done'); add.innerHTML = icon('check'); toast(`${T('It will play next on {0}', d.name)}`); return; }
    const it = e.target.closest('[data-i], [data-album], [data-pl], [data-track], [data-artist]'); if (!it) return;
    rj.haptic && rj.haptic('tap');
    if (it.dataset.track) send({ cmd: 'track', id: it.dataset.track });
    else if (it.dataset.artist) send({ cmd: 'artist', key: it.dataset.artist });
    else if (it.dataset.i != null) send({ cmd: 'skip', i: +it.dataset.i });
    else if (it.dataset.album) send({ cmd: 'album', key: it.dataset.album });
    else if (it.dataset.pl) send({ cmd: 'playlist', id: it.dataset.pl });
  });
  // first the panel slides up, then the animated background and other effects turn on (bug #28)
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('open')));
  const rbox = q('.rc');
  let isReady = false;
  const ready = () => { if (isReady) return; isReady = true; el.classList.add('ready'); if (RC.panel === P) poll(); };
  rbox.addEventListener('transitionend', (e) => { if (e.target === rbox && e.propertyName === 'transform') ready(); }, { once: true });
  setTimeout(ready, 700);
  const tick = () => {
    P.raf = requestAnimationFrame(tick);
    const st = P.st; if (!st) return;
    const pos = P.seek != null ? P.seek * st.duration : Math.min(st.duration || 0, st.position + (st.playing ? (performance.now() - P.at) / 1000 : 0));
    const k = st.duration ? pos / st.duration : 0;
    q('.rc-fill').style.transform = `scaleX(${clamp(k, 0, 1)})`;
    q('.rc-cur').textContent = fmtTime(pos);
    q('.rc-rem').textContent = '-' + fmtTime((st.duration || 0) - pos);
  };
  tick();
  const poll = async () => {
    if (RC.panel !== P) return;
    try { applyRemote(P, await rc(d, '/rj/state')); msg(P, ''); }
    catch (e) { msg(P, e.pending ? `${T('Confirm the access on {0}: a request will appear on that screen.', d.name)}` : `${T('{0} isn\'t responding. Check that rJuke is open and on the same Wi‑Fi.', d.name)}`); }
    P.timer = setTimeout(poll, 1000);
  };
  // the first request starts with the panel open, so the animation isn't disturbed
  async function send(cmd) {
    try { applyRemote(P, await rc(d, '/rj/cmd', { method: 'POST', body: cmd })); } catch (e) { msg(P, e.pending ? `${T('Confirm the access on {0}', d.name)}` : `${T('{0} isn\'t responding', d.name)}`); }
  }
  async function drawList() {
    const box = q('.rc-list');
    if (P.query) return;
    if (P.tab === 'queue') { drawQueue(P); return; }
    if (!P.lib) { box.innerHTML = T('<div class="rc-empty">Loading the library…</div>'); try { P.lib = await rc(d, '/rj/library'); } catch { box.innerHTML = T('<div class="rc-empty">Library not available</div>'); return; } }
    if (P.tab !== 'albums' && P.tab !== 'playlists') return;
    const list = P.tab === 'albums' ? P.lib.albums : P.lib.playlists;
    box.innerHTML = list.length ? list.map((x) => P.tab === 'albums'
      ? `<div class="rc-row" data-album="${esc(x.key)}"><div class="rc-thumb" data-cover="${x.cover ? esc(x.key) : ''}" style="${phStyle(x.key)}"></div><div class="tx"><div class="tt">${esc(x.title)}</div><div class="ta">${esc(x.artist)}${x.year ? ' · ' + x.year : ''}</div></div>${icon('play', 'rc-go')}</div>`
      : `<div class="rc-row" data-pl="${esc(x.id)}"><div class="rc-thumb pl" style="${phStyle(x.id)}">${icon('playlist')}</div><div class="tx"><div class="tt">${esc(x.name)}</div><div class="ta">${plural(x.count, T('track'), T('tracks'))}</div></div>${icon('play', 'rc-go')}</div>`).join('')
      : `<div class="rc-empty">${P.tab === 'albums' ? T('No albums') : T('No playlists')} su ${esc(d.name)}</div>`;
    lazyCovers(P);
  }
  P.drawList = drawList;
}
function closeRemote(instant) {
  const P = RC.panel; if (!P) return;
  RC.panel = null;
  clearTimeout(P.timer); cancelAnimationFrame(P.raf);
  if (P.io) P.io.disconnect();
  if (instant) { P.el.remove(); return; }
  P.el.classList.remove('open'); P.el.classList.add('out');
  setTimeout(() => P.el.remove(), 420);
}
function msg(P, text) {
  const m = P.el.querySelector('.rc-msg');
  m.hidden = !text; m.textContent = text;
  P.el.querySelector('.rc-actions').hidden = !!text;
  rcFit(P);
}
// the cover shrinks as much as needed so that controls, volume and “Listen here” all fit (nothing cut off above or below)
function rcFit(P) {
  requestAnimationFrame(() => {
    if (!P || RC.panel !== P) return;
    const main = P.el.querySelector('.rc-main'), art = P.el.querySelector('.rc-art');
    if (!main || !art) return;
    const body = P.el.querySelector('.rc-body');
    body.classList.remove('rc-scroll');
    art.style.width = '';
    const base = art.offsetWidth;
    const over = main.scrollHeight - main.clientHeight;
    if (over <= 0) return;
    const w = Math.floor(base - over - 4);
    // very short screen: instead of cutting or making a tiny cover, the whole panel scrolls
    if (w < 130) body.classList.add('rc-scroll');
    else art.style.width = w + 'px';
  });
}
window.addEventListener('resize', () => { if (RC.panel) rcFit(RC.panel); });
async function applyRemote(P, st) {
  if (!st || RC.panel !== P) return;
  const q = (s) => P.el.querySelector(s);
  const changed = !P.st || (P.st.track && P.st.track.key) !== (st.track && st.track.key);
  P.st = st; P.at = performance.now();
  q('.rc-play').innerHTML = icon(st.playing ? 'pause' : 'play');
  q('[data-c="shuffle"]').classList.toggle('on', !!st.shuffle);
  const rp = q('[data-c="repeat"]');
  rp.classList.toggle('on', st.repeat !== 'off'); rp.innerHTML = icon(st.repeat === 'one' ? 'repeat1' : 'repeat');
  const vol = q('.rc-vol');
  if (vol.hidden !== (st.volume == null)) { vol.hidden = st.volume == null; rcFit(P); }
  if (st.volume != null && !q('.rc-slider').classList.contains('drag')) q('.rc-sfill').style.width = st.volume * 100 + '%';
  if (changed) {
    q('.rc-title').textContent = st.track ? st.track.title : T('Nothing playing');
    q('.rc-artist').textContent = st.track ? `${st.track.artist} — ${st.track.album}` : `${T('Choose something to play on {0}', P.d.name)}`;
    q('.rc-info').classList.remove('swap'); void q('.rc-info').offsetWidth; q('.rc-info').classList.add('swap');
    const c = st.coverColors || ['#2fbf71', '#0f6b5c', '#a2f7a1'];
    q('.rc-bg').style.background = `radial-gradient(70% 60% at 20% 15%, ${c[0]}, transparent 70%), radial-gradient(60% 60% at 85% 40%, ${c[1]}, transparent 70%), radial-gradient(70% 60% at 40% 100%, ${c[2] || c[0]}, transparent 70%), #111`;
    const art = q('.rc-art');
    if (st.cover) {
      const b64 = await rc(P.d, '/rj/cover', { binary: true }).catch(() => null);
      if (RC.panel !== P) return;
      art.innerHTML = b64 ? `<img src="data:image/jpeg;base64,${b64}" alt="">` : `<div class="ph" style="${phStyle(st.track.key)}">${icon('note')}</div>`;
    } else art.innerHTML = `<div class="ph" style="${phStyle(st.track ? st.track.key : P.d.id)}">${icon('note')}</div>`;
    art.classList.remove('swap'); void art.offsetWidth; art.classList.add('swap');
  }
  q('.rc-main').classList.toggle('paused', !st.playing);
  if (P.tab === 'queue' && !P.query) drawQueue(P);
}
function drawQueue(P) {
  const st = P.st, box = P.el.querySelector('.rc-list');
  if (!st) { box.innerHTML = T('<div class="rc-empty">Connecting…</div>'); return; }
  const sig = (st.track ? st.track.key : '') + '|' + st.qStart + '|' + st.total;
  if (P.qsig === sig && box.firstElementChild) return;
  P.qsig = sig;
  if (!st.queue.length) { box.innerHTML = `<div class="rc-empty">${T('{0}\'s queue is empty', esc(P.d.name))}</div>`; return; }
  box.innerHTML = st.queue.slice(0, 120).map((t, k) => `<div class="rc-row ${k === 0 ? 'cur' : ''}" data-i="${st.qStart + k}"><div class="rc-n">${k === 0 ? icon('sparkle') : k}</div><div class="tx"><div class="tt">${esc(t.title)}</div><div class="ta">${esc(t.artist)}</div></div><div class="d">${fmtTime(t.duration)}</div></div>`).join('');
}
function lazyCovers(P) {
  if (P.io) P.io.disconnect();
  const queue = [];
  let active = 0;
  const pump = () => {
    while (active < 3 && queue.length) {
      const el = queue.shift(); active++;
      rc(P.d, '/rj/albumcover?key=' + encodeURIComponent(el.dataset.cover), { binary: true })
        .then((b64) => { if (b64) { el.style.background = `center / cover no-repeat url(data:image/jpeg;base64,${b64})`; el.classList.add('has'); } })
        .catch(() => {}).finally(() => { active--; pump(); });
    }
  };
  P.io = new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) { P.io.unobserve(e.target); queue.push(e.target); }
    pump();
  }, { root: P.el.querySelector('.rc-list'), rootMargin: '200px' });
  P.el.querySelectorAll('.rc-thumb[data-cover]:not([data-cover=""])').forEach((t) => P.io.observe(t));
}

// ---------- UI integration ----------
function connectUIRefresh() {
  const n = RC.devices.size;
  document.querySelectorAll('[data-connect-btn]').forEach((b) => b.classList.toggle('has-dev', n > 0));
  const box = document.getElementById('set-connect-devs');
  if (box) box.textContent = n ? [...RC.devices.values()].map((d) => d.name).join(' · ') : RC.scanning ? T('Searching your home network…') : T('No other devices found yet');
  const me = document.getElementById('set-connect-me');
  if (me && RC.started) me.textContent = `${T('{0} · address {1}:{2}', RC.me.name, RC.ip || T('not available'), RC.port)}`;
}
window.connectUIRefresh = connectUIRefresh;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && RC.panel) { e.stopPropagation(); closeRemote(); } }, true);
window.connectClose = () => { if (RC.panel) { closeRemote(); return true; } if (window.partyCloseIfOpen && partyCloseIfOpen()) return true; return false; };
