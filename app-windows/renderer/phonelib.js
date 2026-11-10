'use strict';
/* rJuke — “speaker” PC: the library stays on the phone, the PC fetches tracks when needed */

const PH = { online: null, busy: false, pending: false, timer: 0, stamp: '', cached: new Map(), fetching: new Set(), lyrics: new Map(), wantPlay: false, pairRefresh: null };
const phoneMode = () => !!(S.settings && S.settings.source === 'phone' && S.settings.phone && S.settings.phone.token);
const phoneDev = () => S.settings.phone;
const phoneName = () => (S.settings && S.settings.phone && S.settings.phone.name) || T('The phone');
// “on the phone” or “on Marco's PC” if the music comes from another PC
const phoneWhere = () => (S.settings && S.settings.phone && S.settings.phone.platform !== 'android' ? T('on {0}', phoneName()) : T('on the phone'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function phoneUrl(kind, q, d = phoneDev()) {
  return `http://${d.host}:${d.port}/rj/lib/${kind}?${new URLSearchParams({ t: d.token, ...q })}`;
}
// the key doesn't depend on the phone: if the app is reinstalled the tracks already on the PC stay valid
const phoneKey = (t) => `${t.path}|${t.mtime || 0}|${t.size || 0}`;
const phoneIsCached = (t) => phoneMode() && PH.cached.has(phoneKey(t));
const phoneCanPlay = (t) => phoneIsCached(t) || PH.online !== false;
function phoneTrackSrc(t) {
  const f = PH.cached.get(phoneKey(t));
  return f ? fileUrl(f) : phoneUrl('file', { p: t.path });
}

// index received from the phone → library in this PC's format (covers and tracks become phone addresses)
function phoneLibFrom(idx, d = phoneDev()) {
  const covers = {};
  for (const [k, c] of Object.entries((idx && idx.covers) || {})) {
    if (c) covers[k] = { colors: c.colors || null, avg: c.avg || null, light: !!c.light, s: phoneUrl('cover', { a: k, size: 's' }, d), l: phoneUrl('cover', { a: k, size: 'l' }, d) };
  }
  return { tracks: ((idx && idx.tracks) || []).map((t) => ({ ...t, remote: true })), covers };
}
// the phone changed address: I update the cover links without rebuilding everything
function phoneRelink() {
  const seen = new Set();
  for (const a of S.albums) {
    if (!a.cover || seen.has(a.cover)) continue;
    seen.add(a.cover);
    a.cover.s = phoneUrl('cover', { a: a.key, size: 's' });
    a.cover.l = phoneUrl('cover', { a: a.key, size: 'l' });
  }
  renderSidebarPlaylists();
  if (S.view) rerender();
  updateLCD(false);
}
function phoneMergePlaylists(list) {
  const ph = (list || []).map((p) => {
    const id = 'ph_' + p.id, old = S.plMap.get(id);
    return { id, name: p.name, paths: (p.paths || []).slice(), created: old ? old.created : Date.now(), phone: true };
  });
  S.playlists = [...ph, ...S.playlists.filter((p) => !p.phone)];
  S.plMap = new Map(S.playlists.map((p) => [p.id, p]));
  savePlaylistsNow();
}
async function phoneApply(idx, { loud = false, quiet = false } = {}) {
  const prevCount = S.tracks.length;
  const index = { tracks: idx.tracks || [], covers: idx.covers || {}, playlists: idx.playlists || [] };
  PH.stamp = idx.stamp || '';
  await rj.saveLibrary({ source: 'phone', id: phoneDev().id, stamp: PH.stamp, index });
  buildLibrary(phoneLibFrom(index));
  phoneMergePlaylists(index.playlists);
  if (quiet) return;
  renderSidebarPlaylists();
  if (S.view) rerender();
  updateLCD(false);
  const diff = S.tracks.length - prevCount;
  if (loud) toast(`${T('Library updated: {0}', plural(S.tracks.length, T('track'), T('tracks')))}`);
  else if (prevCount && diff > 0) toast(`${T('{0} from the phone', plural(diff, T('new track'), T('new tracks')))}`);
}

// ---------- connection to the phone ----------
function phoneCandidates() {
  const p = phoneDev(), out = [];
  const live = RC.devices.get(p.id);
  if (live) out.push({ host: live.host, port: live.port });
  if (!out.some((x) => x.host === p.host && x.port === p.port)) out.push({ host: p.host, port: p.port });
  // phone reinstalled: it has a new code but the same name
  for (const d of RC.devices.values()) if (d.id !== p.id && d.name === p.name && !out.some((x) => x.host === d.host && x.port === d.port)) out.push({ host: d.host, port: d.port });
  return out;
}
function phoneSchedule(ms) { clearTimeout(PH.timer); PH.timer = setTimeout(() => phoneSync(), ms); }
async function phoneSync({ loud = false } = {}) {
  if (!phoneMode()) return false;
  if (PH.busy) return false;
  if (!RC.started) { phoneSchedule(1500); return false; }
  PH.busy = true; phoneUI();
  const p = phoneDev();
  let res = null, used = null, pending = false, err = '', newId = p.id;
  for (const c of phoneCandidates()) {
    try {
      const info = await rc(c, '/rj/info', { timeout: 4000 });
      // same phone, or the same phone reinstalled (new code, same name): I ask it for permission again
      if (info.id !== p.id && !(info.name && info.name === p.name)) continue;
      used = c; newId = info.id;
      res = await rc(c, `/rj/lib/index${PH.stamp ? '?since=' + encodeURIComponent(PH.stamp) : ''}`, { timeout: 45000 });
      break;
    } catch (e) { if (e.pending) { pending = true; break; } if (used) { err = e.message; break; } }
  }
  if (!phoneMode()) { PH.busy = false; return false; } // meanwhile the user chose to use a folder
  if (!res) {
    PH.busy = false; PH.online = false; PH.pending = pending; phoneUI();
    phoneSchedule(pending ? 4000 : 15000);
    if (loud) toast(pending ? `${T('{0} tap “Allow” to use its music', phoneWhere().replace(/^s/, 'S'))}` : err ? `${phoneName()}: ${err}` : `${T('{0} isn\'t responding. Keep rJuke open {1}, on the same Wi‑Fi as the PC.', phoneName(), phoneWhere())}`, null, pending ? '' : 'err');
    return false;
  }
  const moved = used.host !== p.host || used.port !== p.port || (res.token && res.token !== p.token);
  const reborn = newId !== p.id;
  S.settings = await rj.setSettings({ phone: { ...p, id: newId, host: used.host, port: used.port, name: res.name || p.name, token: res.token || p.token } });
  if (reborn) { PH.lyrics.clear(); toast(`${T('Connected again to {0}', phoneName())}`); }
  PH.online = true; PH.pending = false;
  try {
    if (!res.same) await phoneApply(res, { loud });
    else {
      if (moved) phoneRelink();
      if (loud) toast(T('The library is already up to date'));
    }
  } finally { PH.busy = false; }
  phoneUI();
  phoneSchedule(60000);
  return true;
}
window.phoneDevicesChanged = () => {
  if (PH.pairRefresh) PH.pairRefresh();
  if (phoneMode() && PH.online === false && !PH.busy && [...RC.devices.values()].some((d) => d.id === phoneDev().id || d.name === phoneDev().name)) phoneSync();
};
async function phoneCacheRefresh() {
  try { PH.cached = new Map(Object.entries((await rj.pcacheList()) || {})); } catch { /* */ }
  phoneMarkRows();
}
async function phoneBoot() {
  if (!phoneMode()) return;
  const lib = await rj.loadLibrary().catch(() => null);
  PH.stamp = (lib && lib.source === 'phone' && lib.id === phoneDev().id && S.tracks.length && lib.stamp) || '';
  await phoneCacheRefresh();
  phoneUI();
  phoneSchedule(1200);
  window.addEventListener('online', () => phoneSync());
  window.addEventListener('focus', () => { if (PH.online === false && !PH.busy) phoneSync(); });
}

// ---------- playback ----------
async function phonePrefetch(i) {
  const list = [S.queue[i], S.queue[i + 1], S.queue[i + 2]].filter((t) => t && t.remote && !phoneIsCached(t));
  let got = false;
  for (const t of list) {
    if (PH.online === false || !phoneMode()) break;
    const key = phoneKey(t);
    if (PH.fetching.has(key)) continue;
    PH.fetching.add(key);
    const ext = (t.path.split('.').pop() || 'bin').toLowerCase();
    let f = null;
    try { f = await rj.pcacheFetch({ url: phoneUrl('file', { p: t.path }), key, ext }); } catch { f = null; }
    PH.fetching.delete(key);
    if (f) { PH.cached.set(key, f); got = true; }
  }
  if (got) { await phoneCacheRefresh(); phoneCacheUI(); }
}
function phoneUnavailable(t, i, fromError = false) {
  if (fromError) { PH.online = false; phoneUI(); phoneSchedule(2500); }
  const quiet = fromError && !PH.wantPlay;
  audio.removeAttribute('src');
  try { audio.load(); } catch { /* */ }
  S.playing = false; updatePlayState();
  if (quiet) return;
  PH.wantPlay = false;
  for (let j = i + 1; j < S.queue.length; j++) {
    const x = S.queue[j];
    if (!x.remote || phoneIsCached(x)) {
      toast(`${T('{0} isn\'t responding: switching to a track already on the PC', phoneName())}`, null, 'err');
      setTimeout(() => loadTrack(j), 400);
      return;
    }
  }
  toast(`${T('{0} isn\'t responding. Keep rJuke open {1}, on the same Wi‑Fi as the PC.', phoneName(), phoneWhere())}`, null, 'err');
}
async function phoneLyrics(t) {
  const key = phoneKey(t);
  if (PH.lyrics.has(key)) return PH.lyrics.get(key);
  let data = null, failed = false;
  if (PH.online !== false) {
    try {
      const d = await rc(phoneDev(), `/rj/lib/lyrics?${new URLSearchParams({ t: phoneDev().token, p: t.path })}`, { timeout: 6000 });
      data = d && Object.keys(d).length ? d : null;
    } catch { failed = true; }
  } else failed = true;
  const f = PH.cached.get(key);
  if (!data && f) { try { data = await rj.lyrics(f); } catch { data = null; } }
  if (!failed) PH.lyrics.set(key, data);
  return data;
}

// ---------- status in the sidebar and in settings ----------
function phoneStatus() {
  if (PH.busy) return { cls: 'busy', txt: T('Updating the library…'), long: `${T('Updating {0}\'s library…', phoneName())}` };
  if (PH.pending) return { cls: 'off', txt: `${T('Confirm {0}', phoneWhere())}`, long: `${T('{0} tap “Allow” to use its music', phoneWhere().replace(/^s/, 'S'))}` };
  if (PH.online === false) return { cls: 'off', txt: `${T('{0} isn\'t responding', phoneName())}`, long: `${T('{0} isn\'t responding: keep rJuke open {1}, on the same Wi‑Fi as the PC. Meanwhile the tracks already on the PC keep playing.', phoneName(), phoneWhere())}` };
  if (PH.online) return { cls: 'on', txt: `${T('Music from {0}', phoneName())}`, long: `${T('Connected to {0}', phoneName())}` };
  return { cls: 'busy', txt: `${T('Connecting {0}…', phoneName())}`, long: `${T('Connecting to {0}…', phoneName())}` };
}
// tracks not yet on the PC: faded when the phone doesn't answer
function phoneMarkRows() {
  document.body.classList.toggle('ph-off', phoneMode() && PH.online === false);
  if (!phoneMode()) return;
  for (const r of document.querySelectorAll('.tr[data-path]')) {
    const t = S.byPath.get(r.dataset.path);
    if (t) r.classList.toggle('nc', !!t.remote && !phoneIsCached(t));
  }
  for (const r of document.querySelectorAll('.q-item[data-qi]')) {
    const t = S.queue[+r.dataset.qi];
    if (t) r.classList.toggle('nc', !!t.remote && !phoneIsCached(t));
  }
}
function phoneUI() {
  phoneMarkRows();
  const pill = document.getElementById('src-pill');
  if (pill) {
    const on = phoneMode();
    pill.hidden = !on;
    if (on) {
      const st = phoneStatus();
      pill.className = 'src-pill ' + st.cls;
      pill.title = st.long;
      pill.innerHTML = `${st.cls === 'busy' ? '<span class="spinner"></span>' : '<span class="dot"></span>'}<span class="txt">${esc(st.txt)}</span>`;
    }
  }
  const row = document.getElementById('set-phone-st');
  if (row && phoneMode()) row.textContent = `${phoneStatus().long} · ${plural(S.tracks.length, T('track'), T('tracks'))} · ${plural(S.albums.length, T('album'), T('albums'))}`;
  const btn = document.querySelector('[data-a="phone-sync"]');
  if (btn) btn.disabled = PH.busy;
}
const fmtBytes = (b) => (b >= 1024 ** 3 ? (b / 1024 ** 3).toLocaleString(loc(), { maximumFractionDigits: 1 }) + ' GB' : Math.round(b / 1024 ** 2).toLocaleString(loc()) + ' MB');
async function phoneCacheUI() {
  const el = document.getElementById('set-phone-cache');
  if (!el) return;
  let st = { count: 0, bytes: 0 };
  try { st = await rj.pcacheStats(); } catch { /* */ }
  el.textContent = st.count
    ? `${T('{0} · {1} of {2} GB. Played tracks stay here and start right away, even if {3} isn\'t responding.', plural(st.count, T('track'), T('tracks')), fmtBytes(st.bytes), S.settings.phoneCacheGB || 2, phoneName())}`
    : `${T('No tracks yet. The ones you play stay here (up to {0} GB) and start right away, even if {1} isn\'t responding.', S.settings.phoneCacheGB || 2, phoneName())}`;
}

// rows of the Library section in settings
function phoneSettingsHTML() {
  if (phoneMode()) {
    return `<div class="set-row"><div class="lbl"><b>${T('Music from {0}', esc(phoneName()))}</b><span id="set-phone-st"></span></div>
        <button class="btn ghost" data-a="phone-sync">${T('{0}Update', icon('refresh'))}</button></div>
      <div class="set-row"><div class="lbl"><b>${T('Tracks kept on this PC')}</b><span id="set-phone-cache">…</span></div>
        <div class="set-ctl"><div id="set-cache-seg"></div><button class="btn ghost" data-a="phone-clear">${T('{0}Clear', icon('trash'))}</button></div></div>
      <div class="set-row"><div class="lbl"><b>${T('Change phone')}</b><span>${T('Choose another phone or PC, or reconnect this one')}</span></div>
        <button class="btn ghost" data-a="phone-on">${T('{0}Change…', icon('phone'))}</button></div>
      <div class="set-row"><div class="lbl"><b>${T('Use a folder on this PC')}</b><span>${T('Stop getting the music from {0} and read it from a folder on the disk', esc(phoneName()))}</span></div>
        <button class="btn ghost" data-a="phone-off">${T('{0}Choose folder…', icon('folder'))}</button></div>`;
  }
  return `<div class="set-row"><div class="lbl"><b>${T('Music from the phone')}</b><span>${T('Leave the music on the phone and use this PC as a speaker: it fetches the tracks when needed, without copying the whole library')}</span></div>
      <button class="btn ghost" data-a="phone-on">${T('{0}Connect…', icon('phone'))}</button></div>`;
}
function phoneSettingsBind(el) {
  const segHost = $('#set-cache-seg', el);
  if (segHost) {
    segHost.appendChild(segmented([['1', T('1 GB')], ['2', T('2 GB')], ['5', T('5 GB')], ['10', T('10 GB')]], String(S.settings.phoneCacheGB || 2), async (k) => {
      S.settings = await rj.setSettings({ phoneCacheGB: +k });
      await rj.pcacheTrim();
      await phoneCacheRefresh();
      phoneCacheUI();
    }));
  }
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'phone-sync') phoneSync({ loud: true });
    if (a === 'phone-clear') {
      if (!(await confirmModal({ title: T('Clear the tracks on the PC?'), text: T('They\'ll be fetched again from the phone when you play them again. The music on the phone isn\'t touched.'), ok: T('Clear'), danger: true }))) return;
      await rj.pcacheClear(); PH.cached.clear(); phoneCacheUI(); toast(T('Tracks on the PC deleted'));
    }
    if (a === 'phone-off') {
      const d = await rj.pickFolder(); if (!d) return;
      clearTimeout(PH.timer);
      S.settings = await rj.setSettings({ source: 'folder', musicDir: d });
      PH.online = null; PH.pending = false; PH.stamp = ''; PH.lyrics.clear();
      S.playlists = [...(S.settings.folderPlaylists || []), ...S.playlists.filter((p) => !p.phone)];
      S.settings = await rj.setSettings({ folderPlaylists: null });
      S.plMap = new Map(S.playlists.map((p) => [p.id, p]));
      savePlaylistsNow();
      buildLibrary({ tracks: [], covers: {} });
      renderSidebarPlaylists(); updateLCD(false); phoneUI();
      rerender();
      runScan(true);
    }
    if (a === 'phone-on') {
      const ok = await phonePairModal(phoneMode());
      if (ok) rerender();
    }
  });
  setTimeout(() => { phoneUI(); phoneCacheUI(); }, 0);
}

// ---------- pairing: list of devices found, confirmation on the phone, receiving the library ----------
function phonePairUI(box, onDone) {
  box.innerHTML = `<div class="pair-list" role="list"></div>
    <div class="pair-manual"><button class="pair-link" type="button">${T('Don\'t see it? Connect it with its address')}</button>
      <div class="pair-addr" hidden><input class="pair-in" placeholder="${T('For example 192.168.1.20')}" spellcheck="false" maxlength="60"><button class="btn primary pair-go" type="button">${T('Connect')}</button></div>
      <div class="pair-hint" hidden>${T('You\'ll find it on the phone in Settings › rJuke Connect › This device')}</div>
      <div class="pair-err" hidden></div></div>`;
  const list = $('.pair-list', box);
  const st = new Map(); // id → { state, msg }
  let alive = true, t0 = Date.now(), active = null;
  // long list: scrollbar outside the rows and a fade at the bottom if there's more below
  const fit = () => {
    const sc = list.scrollHeight > list.clientHeight + 1;
    list.classList.toggle('scroll', sc);
    list.classList.toggle('more', sc && list.scrollTop + list.clientHeight < list.scrollHeight - 2);
  };
  list.addEventListener('scroll', fit, { passive: true });
  const devs = () => [...RC.devices.values()].sort((a, b) => (a.platform === 'android' ? 0 : 1) - (b.platform === 'android' ? 0 : 1) || coll.compare(a.name, b.name));
  const draw = () => {
    if (!alive) return;
    const ds = devs();
    if (!ds.length) {
      const late = Date.now() - t0 > 9000 && !RC.scanning;
      list.innerHTML = late
        ? `<div class="pair-empty"><span class="pe-tx">${T('No devices found. Open rJuke on the phone, on the same Wi‑Fi as this PC.')}</span><button class="btn ghost pair-retry" type="button">${T('{0}Search again', icon('refresh'))}</button></div>`
        : `<div class="pair-empty"><span class="spinner"></span><span class="pe-tx">${T('Looking for your devices on the network…')}</span></div>`;
      const r = $('.pair-retry', list);
      if (r) r.addEventListener('click', () => { t0 = Date.now(); scanHome(); draw(); });
      return;
    }
    list.innerHTML = ds.map((d) => {
      const s = st.get(d.id) || { state: 'idle' };
      const sub = s.state === 'wait' ? (d.platform === 'android' ? T('On the phone tap “Allow”') : `${T('On {0} tap “Allow”', d.name)}`) : s.state === 'load' ? (s.msg || T('Receiving the library…')) : s.state === 'err' ? s.msg : d.platform === 'android' ? T('Use the music on this phone') : T('Use the music on this PC');
      const busy = s.state === 'wait' || s.state === 'load';
      return `<button class="pair-dev ${s.state}" data-id="${esc(d.id)}" type="button" role="listitem" ${active && active !== d.id ? 'disabled' : ''}>
        <span class="pd-i">${icon(devIcon(d))}</span><span class="pd-tx"><b>${esc(d.name)}</b><span>${esc(sub)}</span></span>
        <span class="pd-go">${busy ? '<span class="spinner"></span>' : icon('forward')}</span></button>`;
    }).join('');
    fit();
  };
  const pair = async (d) => {
    const rowId = d.id;
    if (active) return;
    active = rowId;
    st.set(rowId, { state: 'load', msg: T('Connecting…') }); draw();
    try { const info = await rc(d, '/rj/info', { timeout: 5000 }); if (info.id) d = { ...d, id: info.id, name: info.name || d.name }; } catch {
      if (!alive) return;
      st.set(rowId, { state: 'err', msg: T('Not responding. Check that rJuke is open and try again') }); active = null; draw();
      return;
    }
    if (!alive) return;
    st.set(rowId, { state: 'load' }); draw();
    const until = Date.now() + 120000;
    while (alive) {
      try {
        const idx = await rc(d, '/rj/lib/index', { timeout: 45000 });
        if (!alive) return;
        if (!idx.token || !Array.isArray(idx.tracks)) throw new Error(T('Invalid response from the device'));
        st.set(rowId, { state: 'load' }); draw();
        await onDone(d, idx);
        return;
      } catch (e) {
        if (!alive) return;
        if (e.pending && Date.now() < until) { st.set(rowId, { state: 'wait' }); draw(); await sleep(1500); continue; }
        const msg = e.pending ? T('No confirmation from the phone. Try again') : /timeout|ECONN|EHOST|ENET/i.test(e.message) ? T('Not responding. Try again') : (e.message || T('Error'));
        st.set(rowId, { state: 'err', msg }); active = null; draw();
        return;
      }
    }
  };
  list.addEventListener('click', (e) => {
    const b = e.target.closest('.pair-dev'); if (!b || b.disabled) return;
    const d = RC.devices.get(b.dataset.id); if (d) pair(d);
  });
  const link = $('.pair-link', box), addr = $('.pair-addr', box), hint = $('.pair-hint', box), perr = $('.pair-err', box), inp = $('.pair-in', box), go = $('.pair-go', box);
  link.addEventListener('click', () => { link.hidden = true; addr.hidden = false; hint.hidden = false; setTimeout(() => inp.focus(), 30); });
  const manual = async () => {
    const v = inp.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!v) { inp.focus(); return; }
    const [host, port] = v.split(':');
    go.disabled = true; perr.hidden = true;
    try {
      const d = await probeDevice(host, +port || 47123, true);
      const list2 = (S.settings.connectManual || []).filter((x) => x.host !== d.host);
      S.settings = await rj.setSettings({ connectManual: [...list2, { host: d.host, port: d.port }] });
      addr.hidden = true; hint.hidden = true; link.hidden = false; inp.value = '';
      draw(); pair(d);
    } catch (e) {
      perr.hidden = false;
      perr.textContent = /stesso dispositivo/.test(e.message) ? e.message : `${T('No response from {0}. Check the address and that rJuke is open on the phone.', host)}`;
    }
    go.disabled = false;
  };
  go.addEventListener('click', manual);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') manual(); });
  PH.pairRefresh = draw;
  const tick = setInterval(draw, 3000);
  draw();
  setTimeout(() => { if (alive && !RC.devices.size) scanHome(); }, 2500);
  return () => { alive = false; clearInterval(tick); if (PH.pairRefresh === draw) PH.pairRefresh = null; };
}
// the phone said yes: from now on the music comes from there
async function phoneAdopt(d, idx) {
  // the PC folder's playlists are set aside: they come back if the folder is used again
  if (!phoneMode() && S.playlists.some((p) => !p.phone)) {
    const keep = S.playlists.filter((p) => !p.phone).map(({ id, name, paths, created, source, sourceMtime, renamed }) => ({ id, name, paths, created, source, sourceMtime, renamed }));
    S.settings = await rj.setSettings({ folderPlaylists: keep });
    S.playlists = S.playlists.filter((p) => p.phone);
    S.plMap = new Map(S.playlists.map((p) => [p.id, p]));
  }
  S.settings = await rj.setSettings({ source: 'phone', phone: { id: d.id, name: idx.name || d.name, platform: idx.platform || d.platform || 'android', host: d.host, port: d.port, token: idx.token } });
  PH.online = true; PH.pending = false; PH.lyrics.clear();
  await phoneCacheRefresh();
}
function phonePairModal(change = false) {
  return modal(`<h3>${change ? T('Change phone') : T('Use the music on the phone')}</h3>
    <p>${T('Open rJuke on the phone, on the same Wi‑Fi as this PC. The music stays on the phone: the PC only keeps the tracks you play.')}</p>
    <div class="pair"></div>
    <div class="modal-actions"><button class="btn ghost" data-r="0">${T('Cancel')}</button></div>`, (back, close) => {
    $('.modal', back).classList.add('pair-modal');
    let stop = null;
    const end = (v) => { if (stop) stop(); close(v); };
    $('[data-r="0"]', back).addEventListener('click', () => end(false));
    stop = phonePairUI($('.pair', back), async (d, idx) => {
      await phoneAdopt(d, idx);
      await phoneApply(idx, { quiet: true });
      renderSidebarPlaylists(); updateLCD(false); phoneUI();
      phoneSchedule(60000);
      toast(`${T('Now playing the music on {0}: {1}', phoneName(), plural(S.tracks.length, T('track'), T('tracks')))}`);
      end(true);
    });
    // closed with Esc or a click outside: I stop the search
    new MutationObserver((_, ob) => { if (!back.isConnected || back.classList.contains('out')) { if (stop) stop(); ob.disconnect(); } }).observe(back, { attributes: true, attributeFilter: ['class'] });
  });
}
