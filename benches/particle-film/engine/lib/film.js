'use strict';
// defineFilm: the act-based film runner. A piece's film.js is a builder that receives the timeline anchors
// and the engine, and returns the plates, acts, captions, end card and sound events:
//
//   module.exports = defineFilm(__dirname, ({ L, W, T, P, cam, fx }) => ({
//     plates: { hand: { src: 'procedural:hand-phone', N: 30000, screen: true } },
//     acts: [ { name: 'hook', start: 0, end: L('L02').end, setup() {...}, draw(f, t, env) {...} } ],
//     captions: { y: 300 },
//     endCard: { lock: T.lastEnd + 1.6, world: 'night' },
//     events: [ { t: 0.2, name: 'pop', gain_db: -10 } ],
//   }));
//
// Acts are time ranges that may overlap, so a transition is two acts drawn in the same frame rather than a
// cut. Each act draws its own background (env.paper / env.night) and sets the camera (f.cam) every frame.
// env.post holds this frame's finishing (bloom, grain, vignette); env.captionTone switches caption style.

const path = require('path');
const tl = require('./timeline');
const P = require('./plates');
const { loadBrand, loadLogos, brand } = require('./brand');
const { makeCaptions } = require('./captions');
const { createEndCard } = require('./endcard');
const { makePaper } = require('../post/post');
const { rgb01, mixHex } = require('../core/math');
const { setFamilies } = require('../draw/bubbles');

function hexToRgb255(hex) { return rgb01(hex).map((v) => Math.round(v * 255)); }
// Finishing presets: warm paper (no bloom, warm vignette) and night (bloom on, black vignette).
const PAPER_POST = { bloom: 0, grain: 0.07, vignette: 0.34, vignetteColor: '45,30,15', flicker: 0.015 };
const NIGHT_POST = { bloom: 0.85, bloomRadius: 10, grain: 0.06, vignette: 0.5, vignetteColor: '0,0,0', flicker: 0.02 };

function defineFilm(dir, build) {
  process.env.WB_PIECE = process.env.WB_PIECE || dir;
  let cfg = null, papers = null, nights = null, captions = null, endCard = null, ready = false;
  const env = { post: {}, captionTone: 'paper' };

  // The builder runs lazily (it needs the timeline and the brand, both read from the piece folder).
  function configure() {
    if (cfg) return cfg;
    const dirs = { piece: process.env.WB_PIECE, bench: process.env.WB_BENCH || path.join(__dirname, '..', '..'), repo: process.env.WB_REPO || path.join(__dirname, '..', '..', '..', '..') };
    const b = loadBrand(dirs);
    setFamilies({ body: b.fonts.body, mono: b.fonts.mono });
    const T = { duration: tl.duration, lastEnd: tl.lastEnd, estimated: tl.estimated };
    const engine = {
      L: tl.L, W: tl.W, Wi: tl.Wi, Hot: tl.Hot, along: tl.along, T, tl, P, brand: b, env,
      cam: require('./cam'), fx: require('./fx'), ink: require('../draw/ink'), bubbles: require('../draw/bubbles'),
      math: require('../core/math'), noise: require('../core/noise').noise, voicenote: require('./voicenote'), appui: require('./appui'),
      Frame: require('../core/frame').Frame,
    };
    cfg = build(engine);
    cfg.acts = cfg.acts || [];
    if (cfg.plates) P.register(cfg.plates);
    // World palettes: paper (warm sheet, ink dots) and night (dark sheet, light dots), from the brand.
    const paperBase = cfg.paper || hexToRgb255(mixHex(b.colors.background, '#ece5d6', 0.6));
    env.world = {
      paperBase, ink: rgb01(b.colors.ink), inkHex: b.colors.ink, accent: rgb01(b.colors.accent), accentHex: b.colors.accent,
      light: [0.96, 0.93, 0.87], lightWarm: [1, 0.85, 0.63], night: '#07080b',
      red: rgb01(b.colors.negative), redHex: b.colors.negative, green: rgb01(b.colors.positive), greenHex: b.colors.positive,
    };
    env.brand = b;
    env.T = T;
    captions = cfg.captions === false ? null : makeCaptions({ tone: () => env.captionTone, ...(cfg.captions || {}) });
    if (cfg.endCard) endCard = createEndCard(cfg.endCard);
    return cfg;
  }

  const film = {
    get duration() { configure(); return tl.duration; },
    get events() { configure(); return (cfg.events || []).map((e) => ({ ...e })); },
    get endCardStart() { configure(); return endCard ? endCard.start() : Infinity; },
    get posterTime() { configure(); return cfg.posterTime; },
    async init(e) {
      configure();
      if (ready) return; ready = true;
      await loadLogos(brand());
      await P.loadPlates(Object.keys(cfg.plates || {}));
      if (endCard) await endCard.init();
      const W = Math.round(e.width * e.scale), H = Math.round(e.height * e.scale);
      papers = [1, 2, 3].map((s) => makePaper(W, H, { seed: s, base: env.world.paperBase }));
      nights = [4, 5, 6].map((s) => makePaper(W, H, { seed: s, base: [9, 9, 12], mottle: 4, tooth: 5, fibres: 300, warm: false }));
      env.paper = (f, t) => { const c = f.ctx; c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.drawImage(papers[Math.floor(t * 12) % 3], 0, 0); c.restore(); };
      env.night = (f, t) => { const c = f.ctx; c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.drawImage(nights[Math.floor(t * 12) % 3], 0, 0); c.restore(); };
      env.endCard = endCard;
      if (cfg.setup) await cfg.setup(env);   // place plates, precompute paths (plates are loaded by now)
      for (const a of cfg.acts) if (a.setup) await a.setup(env);
    },
    render(f, t) {
      env.post = { ...PAPER_POST, ...(cfg.post || {}) };
      env.nightPost = () => Object.assign(env.post, NIGHT_POST, cfg.nightPost || {});
      env.captionTone = 'paper';
      const only = process.env.WB_ACTS ? process.env.WB_ACTS.split(',') : null;
      let drew = false;
      for (const a of cfg.acts) {
        if (only && !only.includes(a.name)) continue;
        const start = typeof a.start === 'function' ? a.start() : a.start, end = typeof a.end === 'function' ? a.end() : a.end;
        if (t >= start && t < end) { f.cam = f.homeCam(); a.draw(f, t, env); drew = true; }
      }
      const inCard = endCard && t >= endCard.start();
      if (!drew) {
        if (inCard && endCard.cfg.world === 'night') { env.night(f, t); Object.assign(env.post, NIGHT_POST); }
        else env.paper(f, t);
      }
      if (inCard) {
        if (endCard.cfg.world === 'night') env.captionTone = 'night';
        endCard.draw(f, t, (cfg.endCard.source && cfg.endCard.source(t)) || {});
      }
      const hideCaps = endCard ? endCard.lock - 0.2 : Infinity;
      if (captions && process.env.WB_CAPTIONS !== '0' && t < hideCaps) captions(f, t);
      f.setScreen(f.ctx);
      f.finish(env.post);
    },
  };
  return film;
}

module.exports = { defineFilm };
