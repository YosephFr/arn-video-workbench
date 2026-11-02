'use strict';
// The plate bank of the series: every plate an episode may use, with its stipple settings. Episodes name
// plates (`plates: ['clock', 'bulb']`) instead of repeating settings, so the whole series keeps one look.
//
// Procedural plates are drawn in memory by the particle-film engine (no files). Add your own photos with
//   node ../particle-film/tools/plate-from-image.mjs <photo> plates/<name>.png [--screen]
// and register them here: name: { src: 'plates/<name>.png', N: 26000, screen: true }.
// Defaults: N 26000, gamma 1.1 (higher thins mid-tones), edge 0.8 (outline emphasis), floor 0.04 (clean
// background). Use `crop` to put all N dots on the part of the plate the episode shows.

const BANK = {
  'hand-phone': { src: 'procedural:hand-phone', N: 30000, gamma: 1.1, edge: 0.8, floor: 0.03, screen: true },
  clock: { src: 'procedural:clock', N: 26000, gamma: 1.05, edge: 1.0, floor: 0.03 },
  person: { src: 'procedural:person', N: 26000, gamma: 1.3, edge: 1.0, floor: 0.04 },
  bulb: { src: 'procedural:bulb', N: 24000, gamma: 1.2, edge: 1.0, floor: 0.03 },
  mug: { src: 'procedural:mug', N: 24000, gamma: 1.1, edge: 0.9, floor: 0.04 },
  plane: { src: 'procedural:plane', N: 20000, gamma: 1.2, edge: 1.1, floor: 0.04 },
  // Your plates, for example:
  // 'hands-at-work': { src: 'plates/hands-at-work.png', N: 30000 },
  // 'phone-on-desk': { src: 'plates/phone-on-desk.png', N: 30000, screen: true },
};

module.exports = { BANK };
