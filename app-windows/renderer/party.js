'use strict';
/* PartyBox — friends scan a QR code and pick the music from the browser, without installing anything */

const PB = {
  on: false, token: '', ips: [], ip: '', port: 0,
  guests: new Map(),          // id ospite → { id, name, seen, kicked, joined }
  reqs: [],                   // { rid, c, name, path, status: pending|queued|playing|played|rejected, at }
  labels: new Map(),          // path → name of whoever chose it
  panel: null, pill: null, timer: 0, lastCur: '', tab: 'reqs',
};
const partyName = () => (nm() ? `${T('{0}\'s PartyBox', nm())}` : T('PartyBox'));
// started from the car: always “open queue”, nobody has to approve while driving
const partyCfg = () => ({ mode: 'free', limit: 3, ssid: '', pass: '', ...(S.settings.party || {}), ...(PB.auto ? { mode: 'free' } : {}) });
async function partySaveCfg(patch) { S.settings = await rj.setSettings({ party: { ...partyCfg(), ...patch } }); }
const partyUrl = () => `http://${PB.ip}:${PB.port}/party?k=${PB.token}`;

// ---------- start / end ----------
async function partyStart({ auto = false } = {}) {
  if (auto && PB.on) { PB.auto = true; partyAutoSync(true); return; }
  PB.auto = auto;
  if (!RC.started) { try { await connectInit(); } catch { /* */ } }
  if (!RC.started) { partyFail(T('I can\'t start PartyBox: no network available')); return; }
  PB.ips = (rj.connectIps ? await rj.connectIps().catch(() => []) : []).filter((x) => x && x.ip);
  if (!PB.ips.length && RC.ip) PB.ips = [{ ip: RC.ip, name: T('Wi‑Fi') }];
  if (!PB.ips.length) { partyFail(T('To use PartyBox turn on the phone\'s hotspot or connect to a Wi‑Fi network')); return; }
  const wasOn = PB.on;
  if (!PB.on) {
    // dedicated server: it turns on only now and turns off with “End PartyBox”
    const token = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
    PB.token = token;
    let port = 0;
    // on Android the guest page stays in memory in the native code: it opens even with the app in the background
    try { port = rj.partyServe ? (await rj.partyServe(true, { token, page: partyGuestPage({ ended: false }), ended: partyGuestPage({ ended: true }) })).port : RC.port; } catch { port = 0; }
    if (!port) { PB.token = ''; partyFail(T('I can\'t start PartyBox: no free network port')); return; }
    PB.port = port;
    PB.on = true;
    PB.guests.clear(); PB.reqs = []; PB.labels.clear(); PB.lastCur = cur() ? cur().path : '';
    PB.timer = setInterval(partyTick, 1000);
    document.body.classList.add('party-on');
  }
  PB.ip = PB.ips.some((x) => x.ip === PB.ip) ? PB.ip : PB.ips[0].ip;
  partyOpen();
  partyNetCheck();
  partyAutoSync(auto ? true : wasOn ? undefined : false);
}
// notice on the phone and, if the command came from the car, on the car screen too
function partyFail(msg) {
  toast(msg, null, 'err');
  if (PB.auto && rj.partyAuto) rj.partyAuto({ on: PB.on, error: msg });
  if (!PB.on) PB.auto = false;
}
// Android Auto: “Start/End PartyBox” buttons and the QR code instead of the cover (until it's hidden)
async function partyAutoSync(showQr) {
  if (!rj.partyAuto) return;
  if (!PB.on) { rj.partyAuto({ on: false }); return; }
  let qr = null;
  try { qr = await qrPNG(partyUrl()); } catch { qr = null; }
  rj.partyAuto({ on: true, qr, ...(showQr === undefined ? {} : { show: !!showQr }) });
}
function qrPNG(text) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const N = 1024, c = document.createElement('canvas');
      c.width = N; c.height = N;
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, N, N);
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 132, 92, 760, 760);
      g.fillStyle = '#0b1f10'; g.textAlign = 'center';
      g.font = '700 46px system-ui, sans-serif';
      g.fillText(partyName(), N / 2, 912);
      g.fillStyle = '#4a5a4f'; g.font = '500 32px system-ui, sans-serif';
      g.fillText(T('Scan to pick the music'), N / 2, 962);
      resolve(c.toDataURL('image/png').split(',')[1]);
    };
    img.onerror = reject;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(qrSVG(text, { fg: '#000000' }).replace('<svg ', '<svg width="760" height="760" '));
  });
}
// Windows: if the network is “Public” or the firewall blocks rJuke, phones can't reach the PC
async function partyNetCheck() {
  if (!rj.netCheck) return;
  PB.net = await rj.netCheck().catch(() => ({ ok: true }));
  drawNetWarn();
}
function drawNetWarn() {
  const el = PB.panel && PB.panel.querySelector('.pb-warn'); if (!el) return;
  const n = PB.net;
  if (!n || n.ok) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<b>${T('{0}Phones may not be able to connect', icon('sparkle'))}</b>
    <span>${T('{0} Press the button and answer “Yes” to the Windows prompt: rJuke will be allowed only for the devices on your home network.', n.blocked ? T('The Windows firewall is blocking rJuke on this network.') : n.public ? T('Windows treats this network as “Public” and doesn\'t let other devices in.') : T('The Windows firewall hasn\'t allowed rJuke yet.'))}</span>
    <button class="btn primary sm" data-pb="netfix">${T('Allow rJuke')}</button>`;
}
function partyStop() {
  PB.on = false; PB.token = ''; PB.auto = false;
  partyAutoSync();
  if (rj.partyServe) rj.partyServe(false).catch(() => {});
  clearInterval(PB.timer);
  document.body.classList.remove('party-on');
  partyClose(true);
  if (PB.pill) { PB.pill.remove(); PB.pill = null; }
  toast(`${T('{0} is over. Thanks for the music!', partyName())}`);
}
window.partyStart = partyStart;
window.partyHandle = partyHandle;
window.PB = PB;

// request progress: queued → playing → played
function partyTick() {
  const p = cur() ? cur().path : '';
  if (p === PB.lastCur) return;
  for (const r of PB.reqs) {
    if (r.status === 'playing' && r.path !== p) r.status = 'played';
    if (r.status === 'queued' && r.path === p) r.status = 'playing';
  }
  for (const [path] of PB.labels) if (path === PB.lastCur && path !== p && !PB.reqs.some((r) => r.path === path && (r.status === 'queued' || r.status === 'playing'))) PB.labels.delete(path);
  PB.lastCur = p;
  partyRefresh();
}

// ---------- guest requests ----------
const tOut = (t) => ({ id: t.path, title: t.title, artist: t.artist, album: t.album_.title, dur: Math.round(t.duration || 0), cover: t.cover ? t.albumKey : '' });
const htmlResp = (text, status = 200) => ({ status, text, type: 'text/html; charset=utf-8' });
const cleanName = (s) => String(s || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 24) || T('Guest');

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
    case '/party/api/hello': {
      const g = partyGuest(b.c, b.name);
      if (!g) return { status: 400, body: {} };
      return { status: 200, body: { ok: true, kicked: g.kicked } };
    }
    case '/party/api/state': return { status: 200, body: partyState(q('c')) };
    case '/party/api/search': {
      const s = norm(q('q')).trim();
      if (!s) return { status: 200, body: { tracks: [], albums: [] } };
      const terms = s.split(/\s+/);
      const hit = (x) => terms.every((w) => x.includes(w));
      return { status: 200, body: {
        albums: S.albums.filter((a) => hit(a.s)).slice(0, 8).map((a) => ({ key: a.key, title: a.title, artist: a.artist, year: a.year || null, cover: a.cover ? a.key : '' })),
        tracks: S.tracks.filter((t) => hit(t.s)).slice(0, 50).map(tOut),
      } };
    }
    case '/party/api/albums': return { status: 200, body: { albums: S.albums.slice().sort((x, y) => (y.added || 0) - (x.added || 0)).slice(0, 600).map((a) => ({ key: a.key, title: a.title, artist: a.artist, year: a.year || null, cover: a.cover ? a.key : '' })) } };
    case '/party/api/album': {
      const a = S.albumMap.get(q('key'));
      return a ? { status: 200, body: { title: a.title, artist: a.artist, year: a.year || null, cover: a.cover ? a.key : '', tracks: a.tracks.map(tOut) } } : { status: 404, body: {} };
    }
    case '/party/api/cover': {
      const a = S.albumMap.get(q('a'));
      return a && a.cover ? { file: q('size') === 'l' ? a.cover.l : a.cover.s, type: 'image/jpeg' } : { status: 404, body: {} };
    }
    case '/party/api/request': return { status: 200, body: partyRequest(b) };
    case '/party/api/leave': return { status: 200, body: partyLeave(b.c) };
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
    rj.haptic && rj.haptic('tick');
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
    const by = !shown.has(x.path) && PB.labels.get(x.path) || '';
    shown.add(x.path);
    return { ...tOut(x), by };
  });
  return {
    name: partyName(), host: nm(), mode: cfg.mode, limit: cfg.limit, kicked: !!(g && g.kicked),
    now: t ? { ...tOut(t), by: PB.labels.get(t.path) || '', pos: audio.currentTime || 0, playing: !!S.playing, dur: audio.duration || t.duration || 0 } : null,
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
    toast(`${T('{0} queued “{1}”', g.name, t.title)}`, t.cover);
    partyRefresh();
    return { ok: true, status: 'queued', message: T('Queued! 🎶') };
  }
  toast(`${T('{0} wants to hear “{1}”', g.name, t.title)}`, t.cover);
  rj.haptic && rj.haptic('long');
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
  queueInsertAt(at, [t]);
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
    path += `M${c},${r}h1.02v1.02h-1.02z`; // filled modules: readable by any camera
  }
  const eye = (x, y) => `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.8" fill="none" stroke="${fg}" stroke-width="1"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.9" fill="${fg}"/>`;
  return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision"><path d="${path}" fill="${fg}"/>${eye(0, 0)}${eye(n - 7, 0)}${eye(0, n - 7)}</svg>`;
}
const wifiEsc = (s) => String(s).replace(/([\\;,:"])/g, '\\$1');
const wifiQR = (cfg) => `WIFI:T:${cfg.pass ? 'WPA' : 'nopass'};S:${wifiEsc(cfg.ssid)};${cfg.pass ? `P:${wifiEsc(cfg.pass)};` : ''};`;

// ---------- panel ----------
function partyOpen() {
  if (PB.panel) return;
  if (window.connectClose) connectClose();
  const el = h(`<div class="pb-back"><div class="pb">
    <div class="pb-glow"></div>
    <div class="pb-head">
      <div class="pb-title"><span class="pb-badge">${icon('sparkle')}</span><div><b>${esc(partyName())}</b><span class="pb-sub"></span></div></div>
      <div class="pb-head-btns"><button class="ibtn pb-min" title="${T('Minimize')}">${icon(TOUCH ? 'down' : 'minus')}</button></div>
    </div>
    <div class="pb-body">
      <div class="pb-left">
        <div class="pb-steps"></div>
        <div class="pb-qr-wrap"><div class="pb-qr"></div></div>
        <div class="pb-texts">
          <div class="pb-hint">${T('Scan with the camera to pick the music')}</div>
          <div class="pb-url"></div>
        </div>
        <div class="pb-net"></div>
        <div class="pb-warn" hidden></div>
      </div>
      <div class="pb-right">
        <div class="pb-tabs"></div>
        <div class="pb-pane"></div>
        <button class="btn pb-end">${T('{0}End PartyBox', icon('close'))}</button>
      </div>
    </div>
  </div></div>`);
  document.body.appendChild(el);
  PB.panel = el;
  PB.wifiStep = false;
  const q = (s) => el.querySelector(s);
  q('.pb-min').addEventListener('click', () => partyClose());
  el.addEventListener('mousedown', (e) => { if (e.target === el) partyClose(); });
  q('.pb-end').addEventListener('click', async () => {
    if (await confirmModal({ title: `${T('End the {0}?', partyName())}`, text: T('Guests won\'t be able to pick tracks anymore. The ones already queued stay.'), ok: T('End'), danger: true })) partyStop();
  });
  q('.pb-tabs').appendChild(segmented([['reqs', T('Requests')], ['guests', T('Guests')], ['set', T('Settings')]], PB.tab, (k) => { PB.tab = k; drawPane(); }));
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pb]'); if (!b) return;
    const a = b.dataset.pb;
    if (a === 'yes' || a === 'no') { rj.haptic && rj.haptic('tick'); partyDecide(b.dataset.rid, a === 'yes'); }
    if (a === 'all') { PB.reqs.filter((r) => r.status === 'pending').forEach((r) => partyEnqueue(r)); partyRefresh(); }
    if (a === 'kick') { const g = PB.guests.get(b.dataset.id); if (g) { g.kicked = true; PB.reqs.filter((r) => r.c === g.id && r.status === 'pending').forEach((r) => { r.status = 'rejected'; }); toast(`${T('{0} has been removed', g.name)}`); partyRefresh(); } }
    if (a === 'unkick') { const g = PB.guests.get(b.dataset.id); if (g) { g.kicked = false; partyRefresh(); } }
    if (a === 'ip') { PB.ip = b.dataset.ip; drawQR(); partyAutoSync(); }
    if (a === 'step') { PB.wifiStep = b.dataset.s === 'wifi'; drawQR(); }
    if (a === 'netfix') {
      b.disabled = true; b.textContent = T('Waiting for Windows to confirm…');
      rj.netFix().then((r) => { PB.net = r; drawNetWarn(); toast(r.ok ? T('Done! Phones can now connect to the PC') : T('Windows didn\'t confirm: try again and answer “Yes”')); });
    }
  });
  drawQR();
  // first the “light” panel slides up, then the effects turn on (bug #20)
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('open')));
  const pbox = q('.pb');
  let isReady = false;
  const ready = () => { if (isReady || PB.panel !== el) return; isReady = true; el.classList.add('ready'); drawPane(); drawNetWarn(); partyRefresh(); };
  pbox.addEventListener('transitionend', (e) => { if (e.target === pbox && e.propertyName === 'transform') ready(); }, { once: true });
  setTimeout(ready, 700);
  partyPill();
}
function partyClose(instant) {
  const el = PB.panel; if (!el) return;
  PB.panel = null;
  if (instant) el.remove();
  else { el.classList.remove('open'); el.classList.add('out'); setTimeout(() => el.remove(), 450); }
  partyPill();
}
window.partyCloseIfOpen = () => { if (PB.panel) { partyClose(); return true; } return false; };

function drawQR() {
  const el = PB.panel; if (!el) return;
  const q = (s) => el.querySelector(s);
  const cfg = partyCfg();
  const hasWifi = !!cfg.ssid;
  q('.pb-steps').innerHTML = hasWifi ? `<div class="seg pb-seg">${T('<button data-pb="step" data-s="wifi" class="{0}">1 · Join the Wi‑Fi', PB.wifiStep ? 'on' : '')}</button>${T('<button data-pb="step" data-s="page" class="{0}">2 · Pick the music', PB.wifiStep ? '' : 'on')}</button></div>` : '';
  const text = PB.wifiStep && hasWifi ? wifiQR(cfg) : partyUrl();
  const box = q('.pb-qr');
  box.classList.remove('swap'); void box.offsetWidth; box.classList.add('swap');
  box.innerHTML = qrSVG(text);
  q('.pb-hint').textContent = PB.wifiStep && hasWifi ? `${T('Scan to join the “{0}” network, then go to step 2', cfg.ssid)}` : T('Scan with the camera to pick the music');
  q('.pb-url').textContent = PB.wifiStep && hasWifi ? (cfg.pass ? `${T('Password: {0}', cfg.pass)}` : T('Network without a password')) : partyUrl().replace(/^http:\/\//, '');
  q('.pb-net').innerHTML = PB.ips.length > 1 && !(PB.wifiStep && hasWifi)
    ? `<span>${T('Network:')}</span>${PB.ips.map((x) => `<button class="pb-chip ${x.ip === PB.ip ? 'on' : ''}" data-pb="ip" data-ip="${esc(x.ip)}">${esc(x.name)} · ${esc(x.ip)}</button>`).join('')}`
    : `<span>${T('Guests need to be on your same network{0}', PB.ips[0] ? ` (${esc(PB.ips.find((x) => x.ip === PB.ip)?.name || T('Wi‑Fi'))})` : '')}</span>`;
}

function partyRefresh() {
  partyPill();
  if (!PB.panel) return;
  const pending = PB.reqs.filter((r) => r.status === 'pending').length;
  const g = [...PB.guests.values()].filter((x) => !x.kicked).length;
  PB.panel.querySelector('.pb-sub').textContent = `${plural(g, T('guest'), T('guests'))} · ${partyCfg().mode === 'free' ? T('open queue') : T('with approval')}${pending ? ` ${T('· {0} to approve', plural(pending, T('request'), T('requests')))}` : ''}`;
  const tabs = PB.panel.querySelectorAll('.pb-tabs button');
  if (tabs[0]) tabs[0].innerHTML = `${T('Requests{0}', pending ? ` <i class="pb-dot">${pending}</i>` : '')}`;
  if (PB.tab !== 'set') drawPane();
}

const ST_LABEL = { pending: T('To approve'), queued: T('Queued'), playing: T('Playing'), played: T('Already played'), rejected: T('Declined') };
function drawPane() {
  const el = PB.panel; if (!el) return;
  const box = el.querySelector('.pb-pane');
  const cfg = partyCfg();
  if (PB.tab === 'reqs') {
    const list = PB.reqs.slice().sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.at - a.at).slice(0, 80);
    const pend = list.filter((r) => r.status === 'pending').length;
    const sig = list.map((r) => r.rid + r.status).join();
    if (box.dataset.sig === 'r' + sig) return;
    box.dataset.sig = 'r' + sig;
    box.innerHTML = list.length ? `${pend > 1 ? `<button class="btn ghost pb-all" data-pb="all">${T('{0}Approve all ({1})', icon('check'), pend)}</button>` : ''}${list.map((r) => {
      const t = S.byPath.get(r.path); if (!t) return '';
      return `<div class="pb-row ${r.status}">${artHTML(t.cover, t.albumKey)}<div class="tx"><div class="tt">${esc(t.title)}</div><div class="ta">${esc(t.artist)} · <b>${esc(r.name)}</b></div></div>
        ${r.status === 'pending' ? `<button class="ibtn pb-yes" data-pb="yes" data-rid="${r.rid}" title="${T('Approve')}">${icon('check')}</button><button class="ibtn pb-no" data-pb="no" data-rid="${r.rid}" title="${T('Decline')}">${icon('close')}</button>` : `<span class="pb-st">${ST_LABEL[r.status]}</span>`}</div>`;
    }).join('')}` : `<div class="pb-empty">${T('{0}<b>No requests for now', icon('sparkle'))}</b><span>${cfg.mode === 'free' ? T('The tracks picked by guests go straight into the queue, after the one that\'s playing.') : T('When someone picks a track, you\'ll find it here to approve.')}</span></div>`;
  } else if (PB.tab === 'guests') {
    const list = [...PB.guests.values()].sort((a, b) => b.joined - a.joined);
    const sig = list.map((g) => g.id + g.name + g.kicked).join() + PB.reqs.length;
    if (box.dataset.sig === 'g' + sig) return;
    box.dataset.sig = 'g' + sig;
    box.innerHTML = list.length ? list.map((g) => {
      const n = PB.reqs.filter((r) => r.c === g.id && r.status !== 'rejected').length;
      return `<div class="pb-row ${g.kicked ? 'kicked' : ''}"><div class="pb-av" style="${phStyle(g.id)}">${esc(g.name.slice(0, 1).toUpperCase())}</div><div class="tx"><div class="tt">${esc(g.name)}</div><div class="ta">${g.kicked ? T('Removed') : plural(n, T('track picked'), T('tracks picked'))}</div></div>
        <button class="btn ghost sm" data-pb="${g.kicked ? 'unkick' : 'kick'}" data-id="${esc(g.id)}">${g.kicked ? T('Let back in') : T('Remove')}</button></div>`;
    }).join('') : `<div class="pb-empty">${T('{0}<b>No guests yet', icon('person'))}</b><span>${T('Have them scan the QR code: whoever joins shows up here.')}</span></div>`;
  } else {
    box.dataset.sig = '';
    box.innerHTML = `<div class="pb-set">
      <div class="pb-field"><b>${T('How tracks arrive')}</b><div class="pb-mode"></div><span class="pb-help"></span></div>
      <div class="pb-field"><b>${T('Waiting tracks per person')}</b><div class="pb-limit"></div></div>
      <div class="pb-field"><b>${T('Network for guests <em>(optional)')}</em></b><span class="pb-help">${T('Handy in the car with the phone\'s hotspot: a first QR code appears that connects your friends to the network.')}</span>
        <input class="field" id="pb-ssid" placeholder="Nome della rete" maxlength="32" spellcheck="false" value="${esc(cfg.ssid)}">
        <input class="field" id="pb-pass" placeholder="Password" maxlength="63" spellcheck="false" value="${esc(cfg.pass)}"></div>
    </div>`;
    const help = box.querySelector('.pb-help');
    const setHelp = (m) => { help.textContent = m === 'free' ? T('The tracks picked by guests go straight into the queue.') : T('Every request comes to you here: you decide whether to queue it.'); };
    setHelp(cfg.mode);
    box.querySelector('.pb-mode').appendChild(segmented([['free', T('Open queue')], ['approve', T('With approval')]], cfg.mode, async (k) => { await partySaveCfg({ mode: k }); setHelp(k); partyRefresh(); }));
    box.querySelector('.pb-limit').appendChild(segmented([['1', '1'], ['3', '3'], ['5', '5'], ['0', T('No limit')]], String(cfg.limit), (k) => partySaveCfg({ limit: +k })));
    const save = async () => { await partySaveCfg({ ssid: box.querySelector('#pb-ssid').value.trim(), pass: box.querySelector('#pb-pass').value }); PB.wifiStep = false; drawQR(); };
    box.querySelector('#pb-ssid').addEventListener('change', save);
    box.querySelector('#pb-pass').addEventListener('change', save);
  }
}

// pill always visible while the party is on
function partyPill() {
  if (!PB.on || PB.panel) { if (PB.pill) { PB.pill.classList.add('out'); const p = PB.pill; PB.pill = null; setTimeout(() => p.remove(), 300); } return; }
  if (!PB.pill) {
    PB.pill = h(`<button class="pb-pill">${icon('sparkle')}<span><span class="pb-lbl">${T('PartyBox ·')} </span><span class="pb-cnt"></span></span><i class="pb-dot"></i></button>`);
    PB.pill.addEventListener('click', () => partyOpen());
    document.body.appendChild(PB.pill);
  }
  const pending = PB.reqs.filter((r) => r.status === 'pending').length;
  const g = [...PB.guests.values()].filter((x) => !x.kicked).length;
  PB.pill.querySelector('.pb-cnt').textContent = plural(g, T('guest'), T('guests'));
  PB.pill.title = `${T('{0}: open the panel', partyName())}`;
  const d = PB.pill.querySelector('.pb-dot');
  d.textContent = pending || ''; d.hidden = !pending;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && PB.panel && !document.querySelector('.modal-back')) { e.stopPropagation(); partyClose(); } }, true);
