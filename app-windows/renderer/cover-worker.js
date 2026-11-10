'use strict';
// Processes covers outside the main process: decodes, resizes and computes the colors.
const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
function palette(d) {
  const buckets = new Map();
  let tr = 0, tg = 0, tb = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
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
async function jpeg(bmp, maxW, q) {
  const w = Math.min(maxW, bmp.width), h = Math.max(1, Math.round(bmp.height * w / bmp.width));
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, h);
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: q })).arrayBuffer());
}
self.onmessage = async (e) => {
  const { id, buf } = e.data;
  try {
    const bmp = await createImageBitmap(new Blob([buf]));
    const s = await jpeg(bmp, 400, 0.86);
    const l = await jpeg(bmp, 1200, 0.9);
    const c = new OffscreenCanvas(32, 32);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0, 32, 32);
    const pal = palette(g.getImageData(0, 0, 32, 32).data);
    bmp.close();
    self.postMessage({ id, ok: true, s, l, pal }, [s.buffer, l.buffer]);
  } catch {
    self.postMessage({ id, ok: false });
  }
};
