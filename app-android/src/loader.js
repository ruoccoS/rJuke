'use strict';
// Chooses the UI: phone (touch) or TV (remote). Scripts load in order.
(async () => {
  let tv = false;
  try { const i = await window.Juke.info(); tv = !!(i && i.tv); } catch { /* */ }
  if (/[?&]tv=1/.test(location.search)) tv = true;
  const load = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.async = false; s.onload = res; s.onerror = rej; document.body.appendChild(s); });
  if (tv) {
    document.documentElement.classList.add('tv-mode');
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'tv.css'; document.head.appendChild(l);
    for (const x of document.querySelectorAll('link[href="styles.css"], link[href="mobile.css"]')) x.remove();
    for (const f of ['qrcode.js', 'party-guest.js', 'tv.js']) await load(f);
    window.bootTV();
  } else {
    for (const f of ['app.js', 'connect.js', 'qrcode.js', 'party-guest.js', 'party.js']) await load(f);
    window.rjBoot();
  }
})();
