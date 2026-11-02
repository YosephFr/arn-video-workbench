'use strict';
// Packs: a highlight is a folder with pack.json and one folder per story, in order.
//
//   <pack>/pack.json   { "title": "Getting started", "folder": "1 · Getting started",
//                        "stories": ["01-create-account", "02-set-up", "03-ready"],
//                        "titles": ["Create your account", "Set up in three steps", "You're ready"],
//                        "cover": { "icon": "user-plus", "name": "Start" } }
//   <pack>/captures/   captures shared by every story of the pack
//   <pack>/<story>/    a piece: script.json + film.js (the tutorial kit), plus generated voice/, audio/, renders/
//
// What the pack adds to each story's film (`pack` in the film API):
//   pack.number, pack.total, pack.isFirst, pack.isLast, pack.title, pack.titles
//   pack.carry()   the shot, camera and drift the previous story ends on, to open this one on exactly that frame:
//                  shots: [{ at: 0, ...start.shot }, …], phone: [{ t: 0, ...start.phone }, …]
// and, around every film: the brand close only on the last story, the "Pack · n of N" header (hidden in the reel
// version, WB_REEL=1), and the story layout (captions a little lower to leave room for the header).
const fs = require('fs');
const path = require('path');
const KIT = '../../app-tutorial/engine/kit/';
const { ease, clamp } = require(KIT + 'math');

function loadPack(storyDir) {
  const dir = path.dirname(path.resolve(storyDir)); const file = path.join(dir, 'pack.json');
  if (!fs.existsSync(file)) return null;
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  const index = pack.stories.indexOf(path.basename(path.resolve(storyDir)));
  return { ...pack, dir, index, number: index + 1, total: pack.stories.length, isFirst: index === 0, isLast: index === pack.stories.length - 1 };
}

const HEADER_Y = 300, CAPTION_Y = 392, PHONE_TOP = 572;

function storyExt(storyDir) {
  const pack = loadPack(storyDir);
  if (!pack) return {};   // a story outside a pack renders as a plain tutorial
  // The last shot and camera of the previous story (its film is built with its own timeline).
  const carry = () => {
    if (pack.isFirst) throw new Error('pack.carry(): the first story has nothing to carry');
    const prev = path.join(pack.dir, pack.stories[pack.index - 1]);
    const { defineTutorial } = require(KIT + 'tutorial');
    const film = defineTutorial(prev, require(path.join(prev, 'film.js')), storyExt(prev));
    const s = film.shots[film.shots.length - 1]; const P = film.phoneAt(film.duration); const G = film.geomAt(film.duration);
    const keep = ['cap', 'mode', 'url', 'chip', 'dark', 'frame', 'statusBg', 'top', 'barBg', 'mask', 'time', 'noStatus', 'draw', 'w', 'h'];
    return { shot: { ...Object.fromEntries(keep.filter((k) => s[k] !== undefined).map((k) => [k, s[k]])), carried: true }, phone: { cx: P.cx, top: P.top, sw: P.sw, alpha: P.alpha, drift: G ? G.d : 1 } };
  };
  return {
    cardDefault: pack.isLast,
    api: () => ({ pack: { title: pack.title, titles: pack.titles || pack.stories, number: pack.number, total: pack.total, isFirst: pack.isFirst, isLast: pack.isLast, carry } }),
    decorate: (cfg, api) => {
      const out = { ...cfg, phoneBase: { top: PHONE_TOP, ...(cfg.phoneBase || {}) } };
      if (cfg.captions !== false) out.captions = { y: CAPTION_Y, ...(cfg.captions || {}) };
      if (cfg.header !== false && !api.reel) out.over = [...(cfg.over || []), header(pack, cfg.header)];
      return out;
    },
  };
}

// "Getting started · 1 of 3", small, above the captions; it says where the viewer is when they tap through.
function header(pack, o = {}) {
  const label = `${pack.title} · ${pack.number} of ${pack.total}`;
  return {
    at: 0, to: 1e9, top: true, draw(u) {
      const { ctx, t, brand } = u; const until = (o && o.until) ?? Infinity;
      const a = ease.outCubic(clamp((t + 0.3) / 0.4)) * (1 - clamp((t - until) / 0.3)); if (a <= 0) return;
      ctx.save(); ctx.globalAlpha = a; ctx.font = brand.font(600, 28, 'body'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = brand.C.muted; ctx.fillText(label, 540, (o && o.y) || HEADER_Y); ctx.restore();
    },
  };
}

module.exports = { loadPack, storyExt, HEADER_Y, CAPTION_Y, PHONE_TOP };
