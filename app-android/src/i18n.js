// Translations. The app's texts are written in English; a dictionary per language
// (lang-it.js, …) maps them to the other languages.
//
//   T('Play')                     -> 'Riproduci' when the language is Italian
//   T('Connected to {0}', name)   -> placeholders {0}, {1}, … are filled in order
//
// The language is chosen once, before the interface is drawn: the one picked in Settings,
// otherwise the device's. Changing it reloads the interface.
// The dictionaries (lang-*.js) are loaded before this file.
(function (root) {
  const dicts = root.I18N_DICTS || (root.I18N_DICTS = {});
  const LANGS = [['en', 'English'], ['it', 'Italiano']];
  const I18N = { lang: 'en', dicts, LANGS };
  const KEY = 'rj.lang';

  function systemLang() {
    const l = (root.navigator && root.navigator.language) || (root.process && root.process.env && (root.process.env.LANG || root.process.env.LC_ALL)) || 'en';
    return String(l).toLowerCase().slice(0, 2);
  }
  // pref: 'auto' (or empty) = follow the device
  function setLang(pref) {
    let l = pref && pref !== 'auto' ? pref : systemLang();
    if (l !== 'en' && !dicts[l]) l = 'en';
    I18N.lang = l;
    I18N.pref = pref || 'auto';
    if (root.document) root.document.documentElement.lang = l;
    try { if (root.localStorage) root.localStorage.setItem(KEY, I18N.pref); } catch { /* */ }
    return l;
  }
  function T(s, ...args) {
    const d = dicts[I18N.lang];
    const r = (d && d[s]) || s;
    return args.length ? r.replace(/\{(\d+)\}/g, (m, i) => (args[i] != null ? args[i] : '')) : r;
  }
  // locale for dates and numbers
  const loc = () => ({ it: 'it-IT', en: 'en-GB' }[I18N.lang] || 'en-GB');

  // first guess at load time (the saved choice), so texts computed while the scripts load are right too
  let saved = '';
  try { saved = (root.localStorage && root.localStorage.getItem(KEY)) || ''; } catch { /* */ }
  // the fixed texts in index.html are written in English: translate them once the page is there
  // (elements marked data-i18n, plus title / placeholder / aria-label everywhere)
  function translatePage(rootEl) {
    const d = root.document; if (!d) return;
    const base = rootEl || d;
    for (const el of base.querySelectorAll('[title],[placeholder],[aria-label]')) {
      for (const a of ['title', 'placeholder', 'aria-label']) { const v = el.getAttribute(a); if (v) el.setAttribute(a, T(v)); }
    }
    for (const el of base.querySelectorAll('[data-i18n]')) {
      for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) n.nodeValue = n.nodeValue.replace(n.nodeValue.trim(), T(n.nodeValue.trim()));
    }
  }
  I18N.translatePage = translatePage;
  if (root.document) root.document.addEventListener('DOMContentLoaded', () => translatePage());
  I18N.setLang = setLang;
  root.I18N = I18N; root.T = T; root.loc = loc;
  setLang(saved);
  if (typeof module !== 'undefined' && module.exports) module.exports = { I18N, T, loc, setLang };
})(typeof window !== 'undefined' ? window : globalThis);
