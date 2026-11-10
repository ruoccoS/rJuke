'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rj', {
  info: () => ipcRenderer.invoke('app:info'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  loadLibrary: () => ipcRenderer.invoke('library:load'),
  scan: (root, name, full) => ipcRenderer.invoke('library:scan', root, { name, full }),
  onScanProgress: (fn) => ipcRenderer.on('scan:progress', (_e, p) => fn(p)),
  lyrics: (file) => ipcRenderer.invoke('lyrics:get', file),
  getPlaylists: () => ipcRenderer.invoke('playlists:get'),
  savePlaylists: (lists) => ipcRenderer.invoke('playlists:save', lists),
  importPlaylists: () => ipcRenderer.invoke('playlists:import'),
  exportPlaylist: (data) => ipcRenderer.invoke('playlists:export', data),
  showInFolder: (p) => ipcRenderer.invoke('shell:show', p),
  exists: (p) => ipcRenderer.invoke('file:exists', p),
  coverData: (p) => ipcRenderer.invoke('cover:data', p),
  onCoverJob: (fn) => ipcRenderer.on('cover:job', (_e, j) => fn(j)),
  coverDone: (r) => ipcRenderer.send('cover:done', r),
  coverReady: () => ipcRenderer.send('cover:ready'),
  connectStart: (info) => ipcRenderer.invoke('connect:start', info),
  onConnectRequest: (fn) => ipcRenderer.on('connect:req', async (_e, req) => {
    let r;
    try { r = await fn(req); } catch (e) { r = { status: 500, body: { error: String(e && e.message) } }; }
    ipcRenderer.send('connect:res', { id: req.id, ...r });
  }),
  onConnectDevices: (fn) => { ipcRenderer.on('connect:devices', (_e, d) => fn(d)); ipcRenderer.send('connect:devices?'); },
  connectFetch: (o) => ipcRenderer.invoke('connect:fetch', o),
  connectScan: () => ipcRenderer.invoke('connect:scan'),
  connectIps: () => ipcRenderer.invoke('connect:ips'),
  partyServe: (on) => ipcRenderer.invoke('party:serve', on),
  pcacheList: () => ipcRenderer.invoke('pcache:list'),
  pcacheFetch: (o) => ipcRenderer.invoke('pcache:fetch', o),
  pcacheStats: () => ipcRenderer.invoke('pcache:stats'),
  pcacheTrim: () => ipcRenderer.invoke('pcache:trim'),
  pcacheClear: () => ipcRenderer.invoke('pcache:clear'),
  saveLibrary: (lib) => ipcRenderer.invoke('library:save', lib),
  netCheck: () => ipcRenderer.invoke('net:check'),
  netFix: () => ipcRenderer.invoke('net:fix'),
  chromeColors: (c) => ipcRenderer.send('chrome:colors', c),
  playerState: (s) => ipcRenderer.send('player:state', s),
  onMediaCmd: (fn) => ipcRenderer.on('media:cmd', (_e, c) => fn(c)),
  onThemeChanged: (fn) => ipcRenderer.on('theme:changed', (_e, d) => fn(d)),
});
