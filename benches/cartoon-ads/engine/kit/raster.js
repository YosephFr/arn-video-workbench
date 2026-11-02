/* Density maps for particle sets, drawn in the browser so text and the logo use exactly the fonts and layout the
   film uses. engine/points.mjs calls K.raster(spec) here and relaxes the dots in Node.
   Density is 0..1 per pixel: 1 where a dot must be (dark ink on a light plate, or light on dark with mode 'light'). */
(function () {
  'use strict';
  var K = window.K;
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); return { c: c, x: x }; }
  function density(c, mode) {
    var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, n = c.width * c.height, D = new Float32Array(n);
    for (var i = 0, j = 0; i < n; i++, j += 4) {
      var a = d[j + 3] / 255, l = (0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2]) / 255;
      l = l * a + (mode === 'light' ? 0 : 1) * (1 - a);
      D[i] = mode === 'light' ? l : 1 - l;
    }
    return D;
  }
  function b64(f32) {
    var u8 = new Uint8Array(f32.buffer), s = '';
    for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function loadImage(src) { return new Promise(function (ok, ko) { var im = new Image(); im.onload = function () { ok(im); }; im.onerror = function () { ko(new Error('cannot load ' + src)); }; im.src = src; }); }

  var KINDS = {
    // { text: 'Two\nlines', w, h, size, weight, font: 'display' | 'body' }
    text: function (s) {
      var w = s.w || 1000, h = s.h || 520, r = canvas(w, h), x = r.x, lines = String(s.text).split('\n');
      var size = s.size || Math.min(h / lines.length * 0.86, w / Math.max.apply(null, lines.map(function (l) { return l.length; })) * 1.9);
      x.fillStyle = '#000'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = (s.weight || 800) + ' ' + size + 'px ' + (s.font === 'body' ? K.F.body : K.F.display);
      lines.forEach(function (l, i) { x.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.02); });
      return Promise.resolve(r.c);
    },
    // the wordmark exactly as K.logo draws it
    logo: function (s) {
      var L = K.logoLayout(), w = s.w || 1200, k = w / L.w, h = Math.round(L.h * k), r = canvas(w, h), x = r.x;
      if (L.svg) {
        var head = (K.logoSvg.match(/<svg\b[^>]*>/) || [''])[0], svgText = /\swidth\s*=/.test(head) ? K.logoSvg : K.logoSvg.replace(/<svg\b/, '<svg width="' + L.w + '" height="' + L.h + '"');
        var url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
        return loadImage(url).then(function (im) { x.drawImage(im, 0, 0, w, h); return r.c; });
      }
      x.fillStyle = '#000'; x.textBaseline = 'alphabetic';
      x.font = L.weight + ' ' + (L.size * k) + 'px ' + K.F.display;
      L.letters.forEach(function (l) { x.fillText(l.ch, (l.x - L.x0) * k, -L.y0 * k); });
      if (L.dot) { x.beginPath(); x.arc((L.dot.cx - L.x0) * k, (L.dot.cy - L.y0) * k, L.dot.r * k, 0, Math.PI * 2); x.fill(); }
      return Promise.resolve(r.c);
    },
    // the mascot's silhouette with its face cut out
    mascot: function (s) {
      var S = window.MASCOT_SHAPE, w = s.w || 700, k = w / S.view[2], h = Math.round(S.view[3] * k), r = canvas(w, h), x = r.x, face = K.mascotFace();
      x.setTransform(k, 0, 0, k, -S.view[0] * k, -S.view[1] * k);
      x.fillStyle = '#000'; K.mascotPaths().forEach(function (d) { x.fill(new Path2D(d)); });
      x.fillStyle = '#fff'; x.strokeStyle = '#fff';
      face.eyes.forEach(function (e) { x.beginPath(); x.ellipse(e.cx, e.cy, e.rx, e.ry, 0, 0, Math.PI * 2); x.fill(); });
      if (face.mouth) { var mp = new Path2D(face.mouth.d); x.lineWidth = face.mouth.width * 1.4; x.lineCap = 'round'; x.lineJoin = 'round'; x.fill(mp); x.stroke(mp); }
      return Promise.resolve(r.c);
    },
    // a plate: any image or SVG file (only its tone is used). { src, w, h, crop: [x, y, w, h] in 0..1, fit: 'contain' | 'cover' }
    image: function (s) {
      return loadImage(s.src).then(function (im) {
        var sx = 0, sy = 0, sw = im.naturalWidth || im.width, sh = im.naturalHeight || im.height;
        if (s.crop) { sx = s.crop[0] * sw; sy = s.crop[1] * sh; sw = s.crop[2] * sw; sh = s.crop[3] * sh; }
        var w = s.w || 480, h = s.h || Math.round(w * sh / sw), r = canvas(w, h), x = r.x;
        if (s.mode === 'light') { x.fillStyle = '#000'; x.fillRect(0, 0, w, h); }
        var k = s.fit === 'cover' ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh), dw = sw * k, dh = sh * k;
        x.drawImage(im, sx, sy, sw, sh, (w - dw) / 2, (h - dh) / 2, dw, dh);
        return r.c;
      });
    }
  };

  K.raster = function (spec) {
    var kind = spec.kind;
    if (!KINDS[kind]) return Promise.reject(new Error('unknown point source ' + kind));
    return KINDS[kind](spec).then(function (c) {
      return { w: c.width, h: c.height, density: b64(density(c, spec.mode)) };
    });
  };
})();
