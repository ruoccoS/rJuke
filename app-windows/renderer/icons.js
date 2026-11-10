'use strict';
// SF Symbols-style icons, hand drawn (24x24)
const ICONS = {
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  downloaded: '<circle class="f" cx="12" cy="12" r="9"/><path class="k" d="M12 7.5v8M8.8 12.5 12 15.7l3.2-3.2"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .6-8 6 6 0 0 0-11.6 1.6A3.3 3.3 0 0 0 7 18.5z"/>',
  chevron: '<path d="M9.5 6 15.5 12l-6 6"/>',
  play: '<path class="f" d="M7 4.9v14.2c0 1 1.1 1.6 1.9 1.1l11-7.1c.8-.5.8-1.6 0-2.1l-11-7.1C8.1 3.4 7 4 7 4.9z"/>',
  pause: '<rect class="f" x="5.6" y="4" width="4.6" height="16" rx="1.4"/><rect class="f" x="13.8" y="4" width="4.6" height="16" rx="1.4"/>',
  next: '<path class="f" d="M2 6.4v11.2c0 .9 1 1.4 1.7.9L11.6 13v4.6c0 .9 1 1.4 1.7.9l8.2-5.6c.6-.4.6-1.4 0-1.8L13.3 5.5c-.7-.5-1.7 0-1.7.9V11L3.7 5.5C3 5 2 5.5 2 6.4z"/>',
  prev: '<g transform="translate(24 0) scale(-1 1)"><path class="f" d="M2 6.4v11.2c0 .9 1 1.4 1.7.9L11.6 13v4.6c0 .9 1 1.4 1.7.9l8.2-5.6c.6-.4.6-1.4 0-1.8L13.3 5.5c-.7-.5-1.7 0-1.7.9V11L3.7 5.5C3 5 2 5.5 2 6.4z"/></g>',
  shuffle: '<path d="M3 7h3c2.1 0 3.3 1 4.5 2.8l2.6 4.2c1.2 1.9 2.4 3 4.6 3H21M3 17h3c2.1 0 3.3-1 4.5-2.8M13.4 9.6C14.6 8 15.8 7 17.8 7H21M18.2 4 21 7l-2.8 3M18.2 14l2.8 3-2.8 3"/>',
  repeat: '<path d="M4 11.5v-1A3.5 3.5 0 0 1 7.5 7H20M17.2 4 20 7l-2.8 3M20 12.5v1a3.5 3.5 0 0 1-3.5 3.5H4M6.8 20 4 17l2.8-3"/>',
  repeat1: '<path d="M4 11.5v-1A3.5 3.5 0 0 1 7.5 7H20M17.2 4 20 7l-2.8 3M20 12.5v1a3.5 3.5 0 0 1-3.5 3.5H4M6.8 20 4 17l2.8-3"/><path d="M11.2 10.6 12.4 9.8v4.6"/>',
  vol0: '<path class="f" d="M3.5 9.6c0-.6.5-1.1 1.1-1.1H7l3.8-3.3c.6-.5 1.5-.1 1.5.7v12.2c0 .8-.9 1.2-1.5.7L7 15.5H4.6c-.6 0-1.1-.5-1.1-1.1z"/>',
  vol: '<path class="f" d="M3.5 9.6c0-.6.5-1.1 1.1-1.1H7l3.8-3.3c.6-.5 1.5-.1 1.5.7v12.2c0 .8-.9 1.2-1.5.7L7 15.5H4.6c-.6 0-1.1-.5-1.1-1.1z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.4a8 8 0 0 1 0 11.2"/>',
  lyrics: '<path d="M4.5 6A2.5 2.5 0 0 1 7 3.5h10A2.5 2.5 0 0 1 19.5 6v7.5A2.5 2.5 0 0 1 17 16h-6.2l-3.9 3.4c-.5.4-1.3.1-1.3-.6V16H7a2.5 2.5 0 0 1-2.5-2.5z"/><path class="f" d="M8.4 8h2.3v2.4c0 1.3-.6 2.2-1.9 2.6l-.3-.7c.6-.3.9-.8.9-1.4h-1zM13.3 8h2.3v2.4c0 1.3-.6 2.2-1.9 2.6l-.3-.7c.6-.3.9-.8.9-1.4h-1z"/>',
  queue: '<path d="M9.5 6.5H20M9.5 12H20M9.5 17.5H20"/><circle class="f" cx="5" cy="6.5" r="1.4"/><circle class="f" cx="5" cy="12" r="1.4"/><circle class="f" cx="5" cy="17.5" r="1.4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.3"/><path d="m15.3 15.3 4.7 4.7"/>',
  home: '<path d="M4 10.4 12 4l8 6.4v8.6a1.5 1.5 0 0 1-1.5 1.5H15v-5.2a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5.2H5.5A1.5 1.5 0 0 1 4 19z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  album: '<rect x="3.5" y="7" width="13.5" height="13.5" rx="2.5"/><path d="M7 3.8h10.7A2.8 2.8 0 0 1 20.5 6.6v10.7"/><circle cx="10.25" cy="13.75" r="2.2"/>',
  note: '<path d="M9 18V6.2l10-2.2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  playlist: '<path d="M3.5 6h10M3.5 11h10M3.5 16h6"/><path d="M17.5 17.5V5.4l3-.9"/><circle cx="15.2" cy="17.5" r="2.3"/>',
  settings: '<path d="M4 7h8.5M17.5 7H20M4 17h2.5M11.5 17H20"/><circle cx="15" cy="7" r="2.5"/><circle cx="9" cy="17" r="2.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  import: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  export: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14"/>',
  trash: '<path d="M4.5 7h15M10 4h4M6.8 7l.8 12.1a1.6 1.6 0 0 0 1.6 1.4h5.6a1.6 1.6 0 0 0 1.6-1.4L17.2 7M10.2 11v5.5M13.8 11v5.5"/>',
  more: '<circle class="f" cx="5.5" cy="12" r="1.7"/><circle class="f" cx="12" cy="12" r="1.7"/><circle class="f" cx="18.5" cy="12" r="1.7"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  forward: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  down: '<path d="M5.5 9 12 15.5 18.5 9"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8a2 2 0 0 1 1.4.6l1.4 1.4h6.4a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
  edit: '<path d="M4.5 19.5h3.8L18.6 9.2a2.7 2.7 0 0 0-3.8-3.8L4.5 15.7zM13.5 6.7l3.8 3.8"/>',
  playnext: '<path d="M4 6h9.5M4 11h9.5M4 16h5"/><path class="f" d="M14.5 13.4v6.2c0 .6.6.9 1.1.6l4.7-3.1c.4-.3.4-.9 0-1.2l-4.7-3.1c-.5-.3-1.1 0-1.1.6z"/>',
  playlast: '<path d="M4 6h15M4 11h15M4 16h8"/><path class="f" d="M14.5 13.4v6.2c0 .6.6.9 1.1.6l4.7-3.1c.4-.3.4-.9 0-1.2l-4.7-3.1c-.5-.3-1.1 0-1.1.6z"/>',
  warn: '<path d="M12 6.8v6.4"/><path d="M12 17.1v.1"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  grip: '<circle class="f" cx="9" cy="7" r="1.3"/><circle class="f" cx="15" cy="7" r="1.3"/><circle class="f" cx="9" cy="12" r="1.3"/><circle class="f" cx="15" cy="12" r="1.3"/><circle class="f" cx="9" cy="17" r="1.3"/><circle class="f" cx="15" cy="17" r="1.3"/>',
  person: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20c1-3.6 4-5.5 7.5-5.5s6.5 1.9 7.5 5.5"/>',
  sparkle: '<path class="f" d="M12 2.8c.4 3.9 2.1 6.5 6.2 7.4.5.1.5.8 0 .9-4.1.9-5.8 3.5-6.2 7.4-.1.5-.8.5-.9 0-.4-3.9-2.1-6.5-6.2-7.4-.5-.1-.5-.8 0-.9 4.1-.9 5.8-3.5 6.2-7.4.1-.5.8-.5.9 0z"/>',
  minus: '<path d="M6 12h12"/>',
  enlarge: '<path d="M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5 13.5 10.5M4.5 19.5l6-6"/>',
  party: '<path d="M4 20.5 8.6 7.8l7.6 7.6z"/><path d="M13.5 4.5c.6 1.3.4 2.4-.6 3.3M17 9.6c1.4-.5 2.6-.3 3.5.6M15.5 3.5v.01M20.5 6.5v.01M19.5 13.5v.01M11 3v.01"/>',
  qr: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.5"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.5"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.5"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM18 14h2.5M14 20.5h2"/>',
  pc: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>',
  tv: '<rect x="2.5" y="7" width="19" height="13" rx="2.2"/><path d="M8.5 3.2 12 7l3.5-3.8"/>',
  phone: '<rect x="6.5" y="2.8" width="11" height="18.4" rx="2.6"/><path d="M10.5 18h3"/>',
  tablet: '<rect x="4.5" y="2.8" width="15" height="18.4" rx="2.4"/><path d="M11 18h2"/>',
  laptop: '<rect x="4.5" y="4.8" width="15" height="10.7" rx="1.6"/><path d="M2.5 19.2h19"/>',
  speaker: '<rect x="5.5" y="2.8" width="13" height="18.4" rx="2.4"/><circle cx="12" cy="14.3" r="3.4"/><circle cx="12" cy="7.2" r="1.1"/>',
  car: '<path d="M5 12.3l1.6-4.4c.3-.8 1-1.3 1.8-1.3h7.2c.8 0 1.5.5 1.8 1.3l1.6 4.4"/><rect x="3.5" y="12.3" width="17" height="4.8" rx="1.4"/><path d="M6.2 17.1v2.2M17.8 17.1v2.2M7.6 14.7h.01M16.4 14.7h.01"/>',
  headphones: '<path d="M4 15.5v-3a8 8 0 0 1 16 0v3"/><rect x="3.5" y="14" width="4" height="6.5" rx="1.6"/><rect x="16.5" y="14" width="4" height="6.5" rx="1.6"/>',
  cast: '<path d="M3.5 18.5a2 2 0 0 1 2 2M3.5 14.5a6 6 0 0 1 6 6M3.5 10.5a10 10 0 0 1 10 10"/><path d="M6 6.5V5.8c0-1 .8-1.8 1.8-1.8h11.4c1 0 1.8.8 1.8 1.8v11.4c0 1-.8 1.8-1.8 1.8h-2.7"/>',
};

// icons that can be chosen to show up on other devices (rJuke Connect)
const DEVICE_ICONS = [['phone', 'Telefono'], ['tablet', 'Tablet'], ['pc', 'PC fisso'], ['laptop', 'Portatile'], ['tv', 'TV'], ['speaker', 'Cassa'], ['car', 'Autoradio'], ['headphones', 'Cuffie']];
// another device's icon: the one it chose, otherwise by its type
const devIcon = (d) => (d.icon && DEVICE_ICONS.some(([k]) => k === d.icon) ? d.icon : d.tv ? 'tv' : d.platform === 'android' ? 'phone' : 'pc');
function icon(name, cls = '') {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

const logoSVG = () => '<img class="logo" src="logo@2x.png" alt="" draggable="false">';
