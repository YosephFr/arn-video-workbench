// Page bootstrap. render.mjs serves this page with /config.json (brand, cast, plan, fonts, images, pass, scale).
// Exposes window.render(t) (deterministic: frame N shows time N/fps) and window.setLayer(name) to choose what the next
// screenshot shows: 'full' (3D + 2D), 'beauty' (3D only) or 'ui' (2D only, transparent background).
import { buildDirector } from './director.js';
import { makeUI } from './ui.js';

window.__done = false;
window.wbReady = (async () => {
  try {
    const C = await (await fetch('/config.json' + location.search)).json();
    for (const f of C.fonts || []){                        // brand fonts (OFL TTFs from core/bin/fetch-fonts.sh)
      try { const ff = new FontFace(f.family, `url(${f.url})`, { weight:String(f.weight || 400) }); await ff.load(); document.fonts.add(ff); }
      catch (e){ console.warn('font failed: ' + f.url); }
    }
    await document.fonts.ready;
    const W = Math.round(C.width*C.scale), H = Math.round(C.height*C.scale);
    const gl = document.getElementById('gl'), ui = document.getElementById('ui');
    for (const c of [gl, ui]){ c.width = W; c.height = H; c.style.width = W + 'px'; c.style.height = H + 'px'; }
    const director = await buildDirector({ canvas:gl, W, H, C });
    const layer = makeUI(ui, { W, H, plan:C.plan, brand:C.brand, fonts:C.fontFamilies, images:C.images });
    const uiMode = C.pass === 'poster' ? 'poster' : 'video';
    const draws3D = C.pass !== 'ui';
    window.render = (t) => {
      if (draws3D){ director.update(t); director.renderFrame(); }
      if (C.pass === 'full' || C.pass === 'ui' || C.pass === 'poster') layer.draw(t, uiMode);
      window.__frameT = t;
      return true;
    };
    window.setLayer = (name) => {
      gl.style.visibility = name === 'ui' ? 'hidden' : 'visible';
      ui.style.visibility = name === 'beauty' ? 'hidden' : 'visible';
      for (const el of [document.documentElement, document.body]) el.style.background = name === 'ui' ? 'transparent' : '#05070f';
    };
    window.renderBoth = (t) => { director.update(t); director.renderFrame(); layer.draw(t, 'video'); return true; };
    window.__studioInfo = { duration:director.duration, W, H };
    window.render(0);
    window.__done = true;
  } catch (err){
    console.error('studio failed: ' + (err && err.stack ? err.stack : err));
    window.__error = String(err && err.stack ? err.stack : err);
    window.__done = true;
  }
})();
