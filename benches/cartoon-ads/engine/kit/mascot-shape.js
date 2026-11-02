/* The mascot's shape. This is the one file to replace when you bring your own character: the rig (mascot.js),
   the transition wipe, the app badge and the particle set "mascot" all read it.

   Units are the shape's own. (0, 0) is the lowest point of the body: the point the mascot stands on.
     view   [x, y, w, h]          the box the mascot is drawn in; K.mascot(parent, { size }) makes w that many pixels
     body   SVG path              the silhouette that squashes and stretches (filled with the mascot's colour); several
                                  subpaths are fine (here: the body and two small feet)
     ears   [{ base, length, width, lean, shape }]
                                  appendages drawn behind the body (ears, a sprout, antennae): base [x, y] sits inside
                                  the body, lean in degrees (+ leans right), shape 'capsule' (round tip) or 'leaf'
                                  (pointed tip, with `stem` the share of the length that is a thin stem). The rig
                                  bends them from the root and lets them follow the body.
     eyes   [{ x, y, r }]         the eyes, drawn in the face colour: r for round dots, or rx and ry for ovals. The rig
                                  blinks, aims and squints them (a happy eye is the dot with its lower half covered).
     mouth  { x, y, w, smile, stroke } | null   a small mouth: its centre, width, resting smile (−0.3 to 1) and line
                                  width. The rig widens it, opens it and rounds it into an "o".
     blush  [{ x, y, rx, ry }]    soft cheeks in a light tint of the body, stronger when the mascot is happy (optional)
     gaze   { x, up, down }       how far the eyes may travel inside the body; looking further up is the body's job
     lid    0..1                  where a closing eye meets: 0.5 is the middle, near 1 a sleepy lid coming down

   The placeholder below is a round pebble on two small feet with one leaf sprout, dot eyes, a small smile and blush.
   Its signature is the sprout: keep your own character's signature as consistent as its colour. Keep the proportions
   readable at 200 px wide: a simple silhouette, big eyes, nothing thin that disappears when the body squashes. */
(function () {
  'use strict';
  window.MASCOT_SHAPE = {
    view: [-300, -620, 600, 640],
    body: 'M0 -14C150 -14 258 -40 258 -180C258 -330 152 -404 0 -404C-152 -404 -258 -330 -258 -180C-258 -40 -150 -14 0 -14Z' +
          'M56 -18A56 18 0 1 0 168 -18A56 18 0 1 0 56 -18Z' +
          'M-168 -18A56 18 0 1 0 -56 -18A56 18 0 1 0 -168 -18Z',
    ears: [
      { base: [18, -392], length: 178, width: 96, lean: 14, shape: 'leaf', stem: 0.3 }
    ],
    eyes: [
      { x: -82, y: -226, r: 30 },
      { x: 82, y: -226, r: 30 }
    ],
    mouth: { x: 0, y: -160, w: 64, smile: 0.35, stroke: 12 },
    blush: [
      { x: -150, y: -168, rx: 36, ry: 20 },
      { x: 150, y: -168, rx: 36, ry: 20 }
    ],
    gaze: { x: 30, up: 14, down: 24 },
    lid: 0.6
  };
})();
