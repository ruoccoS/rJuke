// Test harness: runs JS steps in the renderer and saves screenshots (development only)
const { dialog, app } = require('electron');
const fs = require('fs'); const path = require('path');
module.exports = (win) => {
  const steps = JSON.parse(fs.readFileSync(process.env.RJ_STEPS, 'utf8'));
  if (process.env.RJ_SIZE) { const [w, h] = process.env.RJ_SIZE.split('x').map(Number); win.setContentSize(w, h); }
  const out = process.env.RJ_OUT; fs.mkdirSync(out, { recursive: true });
  dialog.showOpenDialog = async (_w, o) => {
    const multi = o && o.filters && o.filters[0] && o.filters[0].extensions.includes('m3u8');
    return { canceled: false, filePaths: multi ? process.env.RJ_PLAYLISTS.split('|') : [process.env.RJ_PICK] };
  };
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 2) console.log('[renderer]', msg); });
  win.webContents.once('did-finish-load', async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await sleep(800);
    for (const st of steps) {
      if (st.at) { let xy = null; try { xy = await win.webContents.executeJavaScript(st.at); } catch (e) { console.log('[err]', e.message); } if (xy) { if (st.atClick) st.click = xy; else st.mouse = xy; } }
      if (st.mouse) { const [x, y] = st.mouse; win.webContents.sendInputEvent({ type: 'mouseMove', x, y }); }
      if (st.click) { const [x, y] = st.click; win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); }
      if (st.sh) { try { require('child_process').execSync(st.sh); } catch (e) { console.log('[err]', e.message); } }
      if (st.js) { try { const r = await win.webContents.executeJavaScript(st.js); if (r !== undefined) console.log('[js]', JSON.stringify(r)); } catch (e) { console.log('[err]', e.message); } }
      if (st.wait) await sleep(st.wait);
      if (st.shot) { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, st.shot), img.toPNG()); console.log('[shot]', st.shot); }
    }
    app.quit();
  });
};
