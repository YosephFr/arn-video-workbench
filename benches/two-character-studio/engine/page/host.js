// HOST: an anonymous stylised human built from primitives in code. Low-poly head with defined planes, live eyes,
// a talking mouth driven by visemes, a jaw that drops on open vowels, combed hair, a shirt with collar and arms that rest
// on the desk and lift into gestures. Every visible trait is a parameter (skin, hair, eyes, brows, beard, shirt, tie,
// glasses), so each brand casts its own host. It is not modelled on anyone.
//
// API: const h = makeHost({ ...cast.host, pose:'desk', deskY });  h.rig.setFace({ smile, open, wide, round, blink, squint,
//      brow, inner, look:[x,y] });  h.rig.head.rotation (pose);  h.rig.setArm(side, lift, kind)
import * as THREE from 'three';
import { V3, rng, clamp, lerp, smooth, gauss, mat, dmat, decal, plate, hitFront, clearGroup, faceAlong, limb, lin, finishShadows, shadeHex, mixHex } from './kit.js';

// face layout in head space (front = +z, eye line ~ y 0), from the classic proportion guides: eyes at mid-head, nose
// base halfway eyes -> chin, mouth a third of the way nose -> chin, mouth width ~ pupil distance, ears brow -> nose base.
export const FACE = {
  W: 0.76, DF: 0.80, DB: 0.86, YB: 0.86,          // half-width, front depth, back depth, chin below the eye line
  eyeX: 0.255, eyeY: 0.045, eyeW: 0.235,
  browY: 0.212,
  noseY: -0.235,
  mouthY: -0.455, mouthW: 0.40,
};

/* ---------------------------------------------------------------- head shape
   direction d (unit) -> point on the head. Upper half: rounded cranium. Lower half: width/depth profiles that keep the
   cheeks, cut a jaw angle and taper to a squarish chin; superellipse cross-sections turn the front of the face into a
   plane that meets the side planes. */
const WX_LO = [[0, 1], [0.25, 0.97], [0.45, 0.90], [0.62, 0.76], [0.76, 0.59], [0.88, 0.41], [0.96, 0.27], [1, 0.18]];
function headShape(d, jaw = 1){
  const s = clamp(d.y, -1, 1), c = Math.sqrt(Math.max(0, 1 - s*s));
  const th = Math.atan2(d.x, d.z);
  let y, wx, wzf, wzb, n;
  if (s >= 0){
    y = s; wx = Math.pow(c, 0.9); wzf = Math.pow(c, 0.95); wzb = c;
    n = lerp(2.3, 2.0, smooth(0.15, 0.75, s));
  } else {
    const t = -s;
    y = -t*FACE.YB;
    wx  = lerp(1, lin(t, WX_LO), jaw);
    wzf = lin(t, [[0, 1], [0.45, 0.99], [0.62, 0.975], [0.80, 0.91], [0.92, 0.76], [1, 0.46]]);
    wzb = lin(t, [[0, 1], [0.25, 0.84], [0.5, 0.58], [0.75, 0.34], [1, 0.16]]);
    n = lerp(2.3, 3.0, smooth(0.3, 0.8, t));
  }
  const e = 2/n, sx = Math.sin(th), cz = Math.cos(th);
  let X = FACE.W*wx*Math.sign(sx)*Math.pow(Math.abs(sx), e);
  let Z = (cz >= 0 ? FACE.DF*wzf : FACE.DB*wzb)*Math.sign(cz)*Math.pow(Math.abs(cz), e);
  const f = smooth(0.2, 0.75, cz), ax = Math.abs(X);      // big forms, front plane only
  let dz = 0, dr = 0;
  dz += 0.030*gauss(X, y - 0.25, 0.34, 0.05);              // brow ridge
  dz -= 0.032*gauss(ax - FACE.eyeX, y - FACE.eyeY, 0.10, 0.055);   // eye sockets
  dr += 0.030*gauss(ax - 0.50, y + 0.07, 0.12, 0.09);      // cheekbones
  dz += 0.016*gauss(ax - 0.33, y + 0.18, 0.09, 0.07);      // cheek apples
  dz += 0.036*gauss(X, y - FACE.mouthY, 0.26, 0.12);       // mouth barrel
  dz += 0.030*gauss(X, y + 0.76, 0.16, 0.06);              // chin
  dr -= 0.018*gauss(ax - 0.64, y - 0.30, 0.08, 0.14);      // temples
  Z += f*dz;
  X += Math.sign(X)*f*dr*0.8; Z += f*dr*0.6;
  return V3(X, y, Z);
}

// head mesh: rows on the feature lines, mirror-symmetric triangulation (no random facets on the face)
const ROWS_UP = [1, 0.97, 0.88, 0.75, 0.60, 0.46, 0.34, 0.26, 0.19, 0.12, 0.045];
const ROWS_LO = [-0.03, -0.12, -0.235, -0.33, -0.40, -0.455, -0.52, -0.60, -0.67, -0.74, -0.80, -0.84, -0.86];
function headGeometry(jaw, NCOL = 32){
  const sRows = [...ROWS_UP, ...ROWS_LO.map(y => y/FACE.YB)];
  const grid = sRows.map(s => {
    const c = Math.sqrt(Math.max(0, 1 - s*s));
    return Array.from({ length:NCOL }, (_, j) => { const th = j/NCOL*Math.PI*2, d = V3(c*Math.sin(th), s, c*Math.cos(th)); return { d, p:headShape(d, jaw) }; });
  });
  const pos = [], dirs = [];
  const tri = (...q) => { for (const v of q){ pos.push(v.p.x, v.p.y, v.p.z); dirs.push(v.d.clone().normalize()); } };
  for (let i = 0; i < grid.length - 1; i++) for (let j = 0; j < NCOL; j++){
    const j1 = (j + 1) % NCOL, a = grid[i][j], b = grid[i][j1], cc = grid[i + 1][j1], dd = grid[i + 1][j];
    const jm = j < NCOL/2 ? j : NCOL - 1 - j;
    const diagAC = ((i + jm) % 2 === 0) === (j < NCOL/2);
    if (diagAC){ tri(a, dd, cc); tri(a, cc, b); } else { tri(a, dd, b); tri(b, dd, cc); }
  }
  const last = grid[grid.length - 1], ctr = { d:V3(0, -1, 0), p:last.reduce((m, v) => m.add(v.p), V3(0, 0, 0)).multiplyScalar(1/NCOL) };
  for (let j = 0; j < NCOL; j++) tri(last[j], ctr, last[(j + 1) % NCOL]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return { g, dirs };
}

/* ---------------------------------------------------------------- hair
   One smooth volume over the skull: tidy sides and volume on top that rises from the hairline, swept up and back and a
   little to one side (sign of `sweep`). The mesh follows "comb lanes" that run front -> back, so each lane is two long
   sloped strips: combed hair, not spikes. Styles: 'swept' (volume on top), 'short' (close crop), 'none'. */
const HL = [[0, 0.58], [0.30, 0.60], [0.55, 0.66], [0.82, 0.50], [1.05, 0.12], [1.28, -0.02], [1.42, 0.22], [1.86, 0.22], [2.2, -0.10], [3.15, -0.52]];
function hairlineSym(az){
  const a = Math.abs(az);
  for (let i = 1; i < HL.length; i++) if (a <= HL[i][0]){ const [a0, h0] = HL[i - 1], [a1, h1] = HL[i]; return lerp(h0, h1, (a - a0)/(a1 - a0)); }
  return HL[HL.length - 1][1];
}
function makeHairModel(H){
  const sg = Math.sign(H.sweep || 1) || 1, amt = Math.min(1, Math.abs(H.sweep ?? 0.34)/0.34);
  const vol = H.style === 'short' ? 0.42 : 1.0, lift = (H.lift ?? 1)*vol;
  const hairline = az => hairlineSym(az) + (H.hairline ?? 0) - 0.075*amt*smooth(0.12, 0.62, sg*az)*smooth(1.25, 0.85, sg*az);
  function base(d){
    const xs = sg*d.x;
    const a = d.y - hairline(Math.atan2(d.x, d.z));
    const top = smooth(0.10, 0.75, d.y), front = smooth(-0.5, 0.6, d.z), rise = smooth(0.0, 0.24, a);
    const T = (0.05 + 0.05*top)*(H.style === 'short' ? 0.75 : 1)
            + 0.17*lift*top*front*rise*Math.exp(-((xs - 0.24*amt)**2)/(2*0.42*0.42))
            + 0.075*vol*amt*smooth(-0.1, 0.65, xs)*smooth(-0.2, 0.5, d.y)*rise
            - 0.025*amt*smooth(-0.1, -0.6, xs)*top;
    return { T, front, top, rise, a };
  }
  function point(d, ridge, amp){
    const hf = base(d);
    const edge = 0.30 + 0.70*smooth(0.0, 0.07, hf.a);
    const T = edge*hf.T + (0.014 + 0.032*hf.top)*vol*amp*ridge*smooth(0.0, 0.08, hf.a);
    const v = headShape(d).addScaledVector(d, T);
    v.y += 0.24*T*hf.front*hf.top*hf.rise*lift;
    v.x += sg*0.40*amt*edge*hf.T*hf.front*hf.top*hf.rise;
    return { v, hf };
  }
  return { hairline, point, sg, amt };
}

const DEFAULTS = {
  skin:'#C68863', hair:{ style:'swept', color:'#2b1e16', sweep:-0.30 }, eyes:{ iris:'#4f3a26', lid:'crease' }, brows:{ color:null, arch:0.7, thickness:1 },
  beard:{ style:'none', color:null }, shirt:'#3e6a52', collar:true, tie:null, mic:false, glasses:null,
};

export function makeHost(opts = {}){
  const O = { ...DEFAULTS, ...opts, hair:{ ...DEFAULTS.hair, ...(opts.hair || {}) }, eyes:{ ...DEFAULTS.eyes, ...(opts.eyes || {}) },
              brows:{ ...DEFAULTS.brows, ...(opts.brows || {}) }, beard:{ ...DEFAULTS.beard, ...(opts.beard || {}) } };
  const root = new THREE.Group(); root.name = 'host';
  const rig = { root };
  const head = new THREE.Group(); head.name = 'head'; root.add(head); rig.head = head;
  const skinHex = O.skin, hairHex = O.hair.color;
  const skinMat = mat(skinHex, { roughness:0.72 });

  /* ---- skull with a soft blush on the cheeks (vertex colours) */
  const { g, dirs } = headGeometry(O.jawShape ?? 1);
  const p = g.attributes.position;
  {
    const col = new Float32Array(p.count*3), skin = new THREE.Color(skinHex), blush = new THREE.Color(O.blush || mixHex(skinHex, '#d9786a', 0.45)), c = new THREE.Color();
    for (let f = 0; f < p.count; f += 3){
      const x = (p.getX(f) + p.getX(f + 1) + p.getX(f + 2))/3, y = (p.getY(f) + p.getY(f + 1) + p.getY(f + 2))/3, z = (p.getZ(f) + p.getZ(f + 1) + p.getZ(f + 2))/3;
      c.copy(skin);
      if (z > 0.3) c.lerp(blush, 0.35*gauss(Math.abs(x) - 0.38, y + 0.15, 0.12, 0.08));
      for (let k = 0; k < 3; k++){ col[(f + k)*3] = c.r; col[(f + k)*3 + 1] = c.g; col[(f + k)*3 + 2] = c.b; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const skull = new THREE.Mesh(g, mat('#ffffff', { vertexColors:true, roughness:0.72 }));
  skull.name = 'skull'; head.add(skull); rig.skull = skull;
  skull.updateMatrixWorld(true);

  /* ---- optional beard (stubble): each skull facet split into coplanar sub-triangles with a smooth per-vertex alpha,
          so it reads as an even short-stubble shadow on jaw, chin and upper lip, never as patches. */
  let stubble = null;
  if (O.beard.style && O.beard.style !== 'none'){
    const SUB = 7, sp = [], sc = [];
    const sCol = new THREE.Color(O.beard.color || shadeHex(hairHex, 0.9));
    const hash = (x, y) => { const s = Math.sin(x*127.1 + y*311.7)*43758.5453; return s - Math.floor(s); };
    const MY = FACE.mouthY, full = O.beard.style === 'full';
    const T0 = [[0, 0.60], [0.26, 0.62], [0.36, 0.60], [0.47, 0.52], [0.62, 0.43], [0.80, 0.34], [1.0, 0.24], [1.15, 0.08], [1.26, -0.05]];
    const w = (x, y, z, d) => {
      const t = -d.y, az = Math.abs(Math.atan2(d.x, d.z)), t0 = lin(az, T0) - (full ? 0.08 : 0);
      let a = smooth(t0 - 0.02, t0 + 0.06, t);
      const ear = smooth(1.62, 1.42, az);
      a *= (ear + (1 - ear)*smooth(0.55, 0.75, t))*smooth(2.0, 1.75, az);
      a *= smooth(0.06, 0.0, y);
      const mu = gauss(x, y - (MY + 0.088), 0.12, 0.026);
      a = Math.max(a, (O.beard.mustache ?? 0.6)*mu*smooth(0.22, 0.15, Math.abs(x)));
      a *= smooth(-0.255, -0.29, y);                         // never on the nose
      a *= smooth(0.70, 1.30, (x/0.185)**2 + ((y - MY + 0.010)/0.032)**2);   // lips stay clear
      return a*(full ? 1.25 : 1);
    };
    for (let f = 0; f < p.count; f += 3){
      const A = V3(p.getX(f), p.getY(f), p.getZ(f)), B = V3(p.getX(f + 1), p.getY(f + 1), p.getZ(f + 1)), C = V3(p.getX(f + 2), p.getY(f + 2), p.getZ(f + 2));
      const cen = A.clone().add(B).add(C).multiplyScalar(1/3);
      if (cen.z < -0.45 || cen.y > 0.1) continue;
      const dA = dirs[f], dB = dirs[f + 1], dC = dirs[f + 2];
      const P = (i, j) => { const k = SUB - i - j;
        const n = dA.clone().multiplyScalar(i/SUB).addScaledVector(dB, j/SUB).addScaledVector(dC, k/SUB).normalize();
        const q = A.clone().multiplyScalar(i/SUB).addScaledVector(B, j/SUB).addScaledVector(C, k/SUB).addScaledVector(n, 0.007);
        q.dir = n; return q; };
      for (let i = 0; i < SUB; i++) for (let j = 0; j < SUB - i; j++){
        const tris = [[P(i, j), P(i + 1, j), P(i, j + 1)]];
        if (i + j < SUB - 1) tris.push([P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)]);
        for (const t of tris){
          const al = t.map(q => w(q.x, q.y, q.z, q.dir));
          if (al[0] + al[1] + al[2] < 0.03) continue;
          for (let k = 0; k < 3; k++){ const q = t[k]; sp.push(q.x, q.y, q.z); sc.push(sCol.r, sCol.g, sCol.b, clamp(al[k]*(0.62 + 0.10*hash(q.x*9, q.y*9)), 0, 0.78)); }
        }
      }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 4));
    sg.computeVertexNormals(); sg.computeBoundingSphere();
    stubble = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color:'#ffffff', vertexColors:true, transparent:true, depthWrite:false, flatShading:true,
      roughness:0.95, metalness:0, polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1 }));
    stubble.name = 'stubble'; stubble.userData.decal = true; head.add(stubble); rig.stubble = stubble;
  }

  /* ---- jaw: talking drops the chin. Skin (and beard) below the lips follow one displacement field of their rest
          position; the mouth decals are rebuilt on the moved surface afterwards. */
  const JAW = O.jaw ?? 0;                              // chin drop at open = 1 (scenes pass ~0.085; stills keep 0)
  const jawField = (x, y, z) => {
    const below = smooth(FACE.mouthY - 0.012, FACE.mouthY - 0.075, y);
    const front = smooth(-0.30, 0.20, z);
    const side = lerp(1, 0.35, smooth(0.25, 0.72, Math.abs(x)));
    return below*front*side*(1 + 0.18*smooth(FACE.mouthY - 0.075, -0.86, y));
  };
  const jawParts = [skull, stubble].filter(Boolean).map(m => {
    const a = m.geometry.attributes.position, rest = Float32Array.from(a.array), w = new Float32Array(a.count);
    for (let i = 0; i < a.count; i++) w[i] = jawField(rest[i*3], rest[i*3 + 1], rest[i*3 + 2]);
    return { m, a, rest, w };
  });
  let jawNow = 0;
  function setJaw(open){
    if (!JAW || Math.abs(open - jawNow) < 1e-4) return;
    jawNow = open;
    const d = JAW*open;
    for (const { m, a, rest, w } of jawParts){
      const arr = a.array;
      for (let i = 0; i < w.length; i++){ const k = w[i]*d; arr[i*3 + 1] = rest[i*3 + 1] - k; arr[i*3 + 2] = rest[i*3 + 2] - 0.30*k; }
      a.needsUpdate = true; m.geometry.computeBoundingSphere();
    }
  }
  rig.setJaw = setJaw;

  /* ---- nose: a clean faceted wedge (bridge, ridge, tip, wings) with its base on the proportion line */
  {
    const S = (x, y, out) => { const h = hitFront(skull, x, y); return h.point.clone().addScaledVector(h.face.normal, out); };
    const NY = FACE.noseY, nw = O.noseWidth ?? 1, nl = O.noseLength ?? 1;
    const P = {
      B:  S(0, 0.11, -0.004),
      Ml: S(-0.046*nw, -0.04, -0.006), Mr: S(0.046*nw, -0.04, -0.006),
      Rg: S(0, -0.04, 0.030*nl),
      T:  S(0, NY + 0.07, 0.080*nl),
      Tl: S(-0.046*nw, NY + 0.075, 0.048*nl), Tr: S(0.046*nw, NY + 0.075, 0.048*nl),
      Al: S(-0.086*nw, NY + 0.02, 0.004), Ar: S(0.086*nw, NY + 0.02, 0.004),
      C:  S(0, NY + 0.007, 0.036*nl),
      Sl: S(-0.036*nw, NY, 0.010), Sr: S(0.036*nw, NY, 0.010),
    };
    const faces = [['B', 'Ml', 'Rg'], ['B', 'Rg', 'Mr'], ['Ml', 'Tl', 'Rg'], ['Rg', 'Tl', 'T'], ['Rg', 'T', 'Tr'], ['Rg', 'Tr', 'Mr'],
      ['Ml', 'Al', 'Tl'], ['Mr', 'Tr', 'Ar'], ['Tl', 'Al', 'Sl'], ['Tl', 'Sl', 'C'], ['Tl', 'C', 'T'], ['T', 'C', 'Tr'], ['Tr', 'C', 'Sr'], ['Tr', 'Sr', 'Ar']];
    const pos = [], cc = [], base = new THREE.Color(skinHex), under = new THREE.Color(shadeHex(skinHex, 0.86));
    for (const fc of faces){ const c = fc.includes('C') ? under : base; for (const k of fc){ pos.push(P[k].x, P[k].y, P[k].z); cc.push(c.r, c.g, c.b); } }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    ng.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
    ng.computeVertexNormals();
    const nose = new THREE.Mesh(ng, mat('#ffffff', { vertexColors:true, roughness:0.7, side:THREE.DoubleSide }));
    nose.name = 'nose'; head.add(nose); rig.nose = nose;
    const nm = dmat(shadeHex(skinHex, 0.48), { roughness:0.9 });
    for (const s of [-1, 1]) decal(skull, head, t => [s*lerp(0.020, 0.054, t), NY + 0.012 - 0.004*Math.sin(Math.PI*t)],
                                              t => [s*lerp(0.020, 0.054, t), NY + 0.002 - 0.006*Math.sin(Math.PI*t)], 0, 0, 0.022, nm, 6, 1);
  }

  /* ---- eyes: almond shape (outer corner a touch higher), alive: sclera, iris with a darker rim and a pupil, two
          catchlights placed by the key light, a thick upper lash line with a small outer flick, a lid crease (or a soft
          fold shadow), a lower lid; the lids follow the gaze */
  const lashHex = shadeHex(hairHex, 0.55);
  const scleraMat = dmat('#E9E3DC', { roughness:0.35 });
  const irisRimMat = dmat(shadeHex(O.eyes.iris, 0.4), { roughness:0.35 });
  const irisMat = dmat(O.eyes.iris, { roughness:0.3 });
  const pupilMat = dmat('#060403', { roughness:0.2 });
  const lashMat = dmat(lashHex, { roughness:0.7 });
  const lidShadowMat = dmat(shadeHex(skinHex, 0.5), { transparent:true, opacity:0.38 });
  const lidFoldMat = dmat(shadeHex(skinHex, 0.76), { transparent:true, opacity:O.eyes.lid === 'soft' ? 0.32 : 0.0 });
  const creaseMat = dmat(shadeHex(skinHex, 0.62), { transparent:true, opacity:0.55 });
  const lowLidMat = dmat(shadeHex(skinHex, 0.70), { transparent:true, opacity:0.5 });
  const glintMat = new THREE.MeshBasicMaterial({ color:'#f4f4f4' });
  const browMat = dmat(O.brows.color || shadeHex(hairHex, 0.8), { roughness:0.9 });
  const eyes = {}, brows = {};
  for (const s of [-1, 1]){
    const name = s < 0 ? 'R' : 'L';       // viewer-left = the host's right
    const eg = new THREE.Group(); eg.name = 'eye' + name; head.add(eg); eyes[name] = eg;
    const bg = new THREE.Group(); bg.name = 'brow' + name; head.add(bg); brows[name] = bg;
  }
  rig.eyes = eyes; rig.brows = brows;
  const glint = (parent, x, y, r, off) => {
    const h = hitFront(skull, x, y); if (!h) return;
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 10), glintMat);
    m.position.copy(h.point).addScaledVector(h.face.normal, off); faceAlong(m, h.face.normal);
    m.userData.decal = true; parent.add(m);
  };
  function buildEyes(open, squint, lookX, lookY){
    for (const s of [-1, 1]){
      const eg = eyes[s < 0 ? 'R' : 'L']; clearGroup(eg);
      const cx = s*FACE.eyeX, cy = FACE.eyeY, W = FACE.eyeW;
      const X = u => cx + s*(u - 0.5)*W;                      // u: 0 inner corner -> 1 outer corner
      const base = u => cy + (u - 0.5)*0.022 - 0.004;
      const sn = u => Math.sin(Math.PI*clamp(u, 0, 1));
      const upOpen = u => base(u) + 0.060*Math.pow(sn(Math.pow(u, 0.85)), 0.8) + 0.010*lookY*sn(u) - 0.010*squint*sn(u);
      const lo = u => base(u) - (0.024 - 0.016*squint)*Math.pow(sn(u), 1.2) + 0.004*lookY*sn(u);
      const up = u => lerp(lo(u) + 0.002, upOpen(u), clamp(open, 0, 1));
      const uOf = x => 0.5 + s*(x - cx)/W;
      decal(skull, eg, u => [X(u), up(u)], u => [X(u), lo(u)], 0, 0, 0.005, scleraMat, 24, 2);
      if (open > 0.1){
        const R = 0.045, icx = cx + s*0.004 + lookX*0.036, icy = cy + 0.006 + lookY*0.014;
        const disc = (r, material, off) => {
          const span = t => icx + (2*t - 1)*r*0.999;
          const edge = (t, top) => {
            const x = span(t), dx = x - icx, h = Math.sqrt(Math.max(0, r*r - dx*dx)), u = uOf(x);
            if (u <= 0.02 || u >= 0.98) return [x, lo(clamp(u, 0, 1))];
            const t0 = Math.min(icy + h, up(u) - 0.001), b0 = Math.max(icy - h, lo(u) + 0.001);
            return [x, t0 > b0 ? (top ? t0 : b0) : b0];
          };
          decal(skull, eg, t => edge(t, true), t => edge(t, false), 0, 0, off, material, 20, 2);
        };
        disc(R, irisRimMat, 0.008);
        disc(R*0.80, irisMat, 0.010);
        disc(R*0.40, pupilMat, 0.012);
        const inside = (x, y, m) => { const u = uOf(x); return u > 0.05 && u < 0.95 && y < up(u) - m && y > lo(u) + m; };
        if (open > 0.4){
          const g1 = [icx - 0.40*R, icy + 0.38*R], g2 = [icx + 0.40*R, icy - 0.30*R];
          if (inside(g1[0], g1[1], 0.008)) glint(eg, g1[0], g1[1], 0.011, 0.016);
          if (inside(g2[0], g2[1], 0.004)) glint(eg, g2[0], g2[1], 0.005, 0.016);
        }
        decal(skull, eg, u => [X(u), up(u)], u => [X(u), Math.max(lo(u), up(u) - 0.017*sn(u))], 0, 0, 0.014, lidShadowMat, 20, 1);
      }
      const lashT = u => u <= 1 ? 0.009 + 0.006*u : 0.015 - (u - 1)*0.30;
      const lashY = u => u <= 1 ? up(u) : up(1) + (u - 1)*0.05;
      decal(skull, eg, u => { const v = lerp(0.0, 1.04, u); return [X(v), lashY(v) + lashT(v)]; },
                       u => { const v = lerp(0.0, 1.04, u); return [X(v), lashY(v) - 0.003]; }, 0, 0, 0.015, lashMat, 24, 1);
      if (O.eyes.lid === 'soft') decal(skull, eg, u => [X(u), up(u) + lashT(u) + 0.028*sn(u)], u => [X(u), up(u) + lashT(u)], 0, 0, 0.005, lidFoldMat, 20, 1);
      else { const cr = u => upOpen(u) + 0.026 + 0.006*sn(u) - 0.004*squint;    // lid crease: a thin line that follows the open lid
        decal(skull, eg, u => { const v = lerp(0.12, 0.92, u); return [X(v), cr(v) + 0.0035]; }, u => { const v = lerp(0.12, 0.92, u); return [X(v), cr(v) - 0.0035]; }, 0, 0, 0.006, creaseMat, 16, 1); }
      decal(skull, eg, u => { const v = lerp(0.14, 0.94, u); return [X(v), lo(v)]; }, u => { const v = lerp(0.14, 0.94, u); return [X(v), lo(v) - 0.006]; }, 0, 0, 0.007, lowLidMat, 16, 1);
    }
  }
  function buildBrows(raise, inner){
    const arch = O.brows.arch ?? 0.7, thick = O.brows.thickness ?? 1;
    for (const s of [-1, 1]){
      const bg = brows[s < 0 ? 'R' : 'L']; clearGroup(bg);
      const x0 = 0.105, x1 = 0.44;
      const yb = t => FACE.browY + lerp(0.022*inner + 0.030*Math.max(0, raise), 0, t) + 0.040*raise
                      + lin(t, [[0, 0.000], [0.38, 0.012*arch], [0.66, 0.018*arch], [0.86, 0.004], [1, -0.020]]);
      const th = t => 0.046*thick*lin(t, [[0, 1], [0.55, 0.86], [1, 0.46]])*(t < 0.06 ? 0.75 + 4*t : 1);
      decal(skull, bg, t => [s*lerp(x0, x1, t), yb(t) + th(t)], t => [s*lerp(x0, x1, t), yb(t)], 0, 0, 0.008, browMat, 18, 2);
    }
  }

  /* ---- mouth: closed calm smile by default; `open` (0..1) opens it for talking, `wide` stretches (e/i), `round`
          puckers (o/u). Lips, teeth and tongue are decals rebuilt on the (possibly dropped) jaw surface. */
  const mouth = new THREE.Group(); mouth.name = 'mouth'; head.add(mouth); rig.mouth = mouth;
  const lipBase = mixHex(shadeHex(skinHex, 0.86), '#b25e58', 0.35);
  const lineMat = dmat(shadeHex(skinHex, 0.32), { roughness:0.8 });
  const innerMat = dmat('#3a1613', { roughness:0.9 });
  const teethMat = dmat('#ece5da', { roughness:0.5 });
  const upLipMat = dmat(shadeHex(lipBase, 0.92), { roughness:0.6, transparent:true, opacity:0.85 });
  const loLipMat = dmat(shadeHex(lipBase, 1.04), { roughness:0.45, transparent:true, opacity:0.8 });
  const shadeMat = dmat(shadeHex(skinHex, 0.56), { transparent:true, opacity:0.30 });
  const tongueMat = dmat('#7e3834', { roughness:0.6 });
  function buildMouth(m){
    clearGroup(mouth);
    const { open, smile, wide, round } = m;
    const my = FACE.mouthY;
    const MW = FACE.mouthW*(1 + 0.10*(smile - 0.5))*(1 + 0.14*wide - 0.50*round)*(1 - 0.16*open*(1 - wide));
    const E = t => 2*t - 1, X = t => (t - 0.5)*MW;
    const pw = (t, k) => Math.pow(Math.max(0, 1 - E(t)**2), k);
    const lift = (0.012 + 0.034*smile)*(1 - 0.75*open)*(1 - 0.9*round);
    const line = t => my + lift*Math.pow(Math.abs(E(t)), 2.2) - 0.004*pw(t, 1);
    const gap = 0.115*open*(1 + 0.45*round);
    const k = lerp(0.55, 0.30, round);
    const up = t => line(t) + ((0.004 + 0.006*wide)*pw(t, 1) + 0.010*round*pw(t, 0.5))*open;
    const lo = t => line(t) - gap*pw(t, k);
    const bow = t => pw(t, 0.5)*(1 - 0.22*Math.exp(-((E(t)/0.10)**2)));      // cupid's bow dip
    if (open > 0.03){
      decal(skull, mouth, t => [X(t), up(t) + 0.002], t => [X(t), lo(t) - 0.002], 0, 0, (JAW ? 0.011 : 0.014), innerMat, 24, 3);
      const tw = 0.18 + 0.12*round, tm = t => lerp(tw, 1 - tw, t);
      if (JAW){
        const tw2 = 0.12 + 0.16*round, tm2 = t => lerp(tw2, 1 - tw2, t);
        decal(skull, mouth, t => [X(tm2(t)), up(tm2(t)) + 0.006], t => { const u = tm2(t); return [X(u), up(u) - Math.min(0.024, gap*0.55)*pw(u, 0.5)]; }, 0, 0, 0.0125, teethMat, 18, 1);
      } else
        decal(skull, mouth, t => [X(tm(t)), up(tm(t)) - 0.001], t => { const u = tm(t); return [X(u), up(u) - Math.min(0.020, gap*0.62)*pw(u, 0.35)]; }, 0, 0, 0.016, teethMat, 18, 1);
      if (open > 0.55){
        const qm = t => lerp(0.3, 0.7, t);
        decal(skull, mouth, t => [X(qm(t)), lo(qm(t)) + 0.002 + gap*0.22*pw(qm(t), 0.5)], t => [X(qm(t)), lo(qm(t)) + 0.002], 0, 0, (JAW ? 0.012 : 0.0155), tongueMat, 14, 1);
      }
    } else {
      const th = t => 0.0042*(0.45 + 0.55*pw(t, 0.4));
      decal(skull, mouth, t => [X(t), line(t) + th(t)], t => [X(t), line(t) - th(t)], 0, 0, 0.015, lineMat, 28, 1);
    }
    decal(skull, mouth, t => [X(t), up(t) + 0.004 + (0.020 + 0.008*round)*bow(t)], t => [X(t), up(t) + 0.004], 0, 0, 0.0135, upLipMat, 28, 1);
    decal(skull, mouth, t => [X(t), lo(t) - 0.004], t => [X(t), lo(t) - 0.004 - (0.030 + 0.008*round)*pw(t, 0.8)], 0, 0, 0.0135, loLipMat, 24, 1);
    if (open < 0.5) for (const s of [-1, 1]){       // corner tucks: short curved strokes up and out (fade when the mouth opens)
      const cx = s*MW*0.5, cy = line(s < 0 ? 0 : 1);
      decal(skull, mouth, t => [cx + s*0.020*t, cy + 0.003 + 0.016*t*t], t => [cx + s*0.020*t, cy - 0.003 + 0.016*t*t - 0.001], 0, 0, 0.0145, shadeMat, 8, 1)
        .material = dmat(shadeHex(skinHex, 0.45), { transparent:true, opacity:0.7*(1 - 2*open) });
    }
    decal(skull, mouth, t => [lerp(-0.085, 0.085, t), lo(0.5) - 0.040 - 0.005*Math.sin(Math.PI*t)],
                        t => [lerp(-0.085, 0.085, t), lo(0.5) - 0.052 - 0.006*Math.sin(Math.PI*t)], 0, 0, 0.010, shadeMat, 10, 1);
  }

  /* ---- ears: from the brow line to the nose base */
  for (const s of [-1, 1]){
    const eg = new THREE.Group(); eg.position.set(s*0.735, -0.03, -0.07); eg.rotation.set(0, s*0.5, -s*0.08); head.add(eg);
    const e = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), skinMat); e.scale.set(0.085, 0.22, 0.13); eg.add(e);
    const ie = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), mat(shadeHex(skinHex, 0.85))); ie.scale.set(0.033, 0.12, 0.07); ie.position.set(s*0.058, 0, 0.02); eg.add(ie);
  }

  /* ---- hair: one smooth combed volume */
  if (O.hair.style !== 'none'){
    const HM = makeHairModel(O.hair);
    const hair = new THREE.Group(); hair.name = 'hair'; head.add(hair); rig.hair = hair;
    const SWEEP = 0.34*HM.amt*HM.sg, LANE = 0.30;
    const L0 = -1.92, L1 = 1.56, HALF = LANE/2, NC = Math.ceil((L1 - L0)/HALF), P0 = -0.15, P1 = 4.25, NR = 90;
    const grid = [];
    for (let i = 0; i <= NC; i++){
      const lp = (HM.sg > 0 ? L0 + i*HALF : -(L0 + i*HALF)), lane = Math.floor(i/2);
      const amp = 0.7 + 0.3*Math.abs(Math.sin((lane + 3)*12.9898)*43758.5453 % 1);
      const row = [];
      for (let j = 0; j <= NR; j++){
        const ph = lerp(P0, P1, j/NR);
        const la = clamp(lp + SWEEP*clamp(ph, 0, Math.PI/2), -1.555, 1.555);
        const d = V3(Math.sin(la), Math.cos(la)*Math.sin(ph), Math.cos(la)*Math.cos(ph));
        row.push({ d, a:d.y - HM.hairline(Math.atan2(d.x, d.z)), r:i % 2, amp });
      }
      grid.push(row);
    }
    const mix = (P, Q, t) => ({ d:P.d.clone().lerp(Q.d, t).normalize(), a:0, r:lerp(P.r, Q.r, t), amp:lerp(P.amp, Q.amp, t), cut:true });
    const out = [], cc = [];
    const dark = new THREE.Color(hairHex), sheen = new THREE.Color(O.hair.sheen || mixHex(hairHex, '#c8a27a', 0.18)), c = new THREE.Color(), cs = new THREE.Color();
    const put = q => { if (!q.v) q.v = HM.point(q.d, q.r, q.amp).v; out.push(q.v.x, q.v.y, q.v.z); };
    const skirt = (P, Q) => {                 // closes the gap between the hair edge and the skin
      const s = [P, Q].map(q => headShape(q.d).addScaledVector(q.d, -0.012));
      put(P); out.push(s[0].x, s[0].y, s[0].z); out.push(s[1].x, s[1].y, s[1].z);
      put(P); out.push(s[1].x, s[1].y, s[1].z); put(Q);
      for (let k = 0; k < 6; k++) cc.push(cs.r, cs.g, cs.b);
    };
    const clipTri = T3 => {
      const poly = [];
      for (let k = 0; k < 3; k++){
        const P = T3[k], Q = T3[(k + 1) % 3];
        if (P.a >= 0) poly.push(P);
        if ((P.a >= 0) !== (Q.a >= 0)) poly.push(mix(P, Q, P.a/(P.a - Q.a)));
      }
      if (poly.length < 3) return;
      for (let k = 1; k < poly.length - 1; k++){ put(poly[0]); put(poly[k]); put(poly[k + 1]); }
      for (let k = 1; k < poly.length - 1; k++) for (let n = 0; n < 3; n++) cc.push(c.r, c.g, c.b);
      for (let k = 0; k < poly.length; k++){ const P = poly[k], Q = poly[(k + 1) % poly.length]; if (P.cut && Q.cut) skirt(P, Q); }
    };
    for (let i = 0; i < NC; i++) for (let j = 0; j < NR; j++){
      const A = grid[i][j], B = grid[i + 1][j], C = grid[i + 1][j + 1], D = grid[i][j + 1];
      if (A.a < 0 && B.a < 0 && C.a < 0 && D.a < 0) continue;
      const top = smooth(0.10, 0.75, (A.d.y + C.d.y)/2);
      c.copy(dark).lerp(sheen, 0.45*top*(A.amp - 0.55)/0.45).multiplyScalar(i % 2 ? 1.0 : 0.85);
      cs.copy(c);
      if (HM.sg > 0){ clipTri([A, B, C]); clipTri([A, C, D]); } else { clipTri([A, C, B]); clipTri([A, D, C]); }   // keep the winding outward when mirrored
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    cg.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
    cg.computeVertexNormals();
    const cap = new THREE.Mesh(cg, mat('#ffffff', { vertexColors:true, roughness:0.5, side:THREE.DoubleSide }));
    cap.name = 'hairVolume'; hair.add(cap); rig.hairVolume = cap;
  }

  /* ---- optional glasses: thin round or square frames, a bridge over the nose and temples back to the ears */
  if (O.glasses){
    const GL = O.glasses === true ? {} : O.glasses;
    const frameM = mat(GL.color || '#15171c', { roughness:0.35, metalness:0.3, flatShading:false });
    const lensM = new THREE.MeshStandardMaterial({ color:GL.tint || '#cfe0ff', transparent:true, opacity:0.10, roughness:0.05, metalness:0.0, depthWrite:false });
    const glasses = new THREE.Group(); glasses.name = 'glasses'; head.add(glasses); rig.glasses = glasses;
    const R = GL.size ?? 0.145, square = GL.shape === 'square', ey = FACE.eyeY + 0.012;
    const rimAt = s => { const h = hitFront(skull, s*FACE.eyeX, ey); return h.point.clone().add(V3(0, 0, 0.085)); };
    for (const s of [-1, 1]){
      const c = rimAt(s);
      const ring = square ? new THREE.Mesh(new THREE.TorusGeometry(R, 0.011, 6, 4).rotateZ(Math.PI/4).scale(1.05, 0.82, 1), frameM)
                          : new THREE.Mesh(new THREE.TorusGeometry(R, 0.011, 8, 36).scale(1, 0.86, 1), frameM);
      ring.position.copy(c); ring.rotation.y = s*0.12; glasses.add(ring);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(R*0.98, 32).scale(1, square ? 0.80 : 0.86, 1), lensM);
      lens.position.copy(c).add(V3(0, 0, -0.004)); lens.rotation.y = s*0.12; lens.userData.decal = true; glasses.add(lens);
      // temple: from the outer rim back along the side of the skull (just outside its surface) to the top of the ear
      const outer = c.clone().add(V3(s*R*0.98, 0.01, -0.02)), pts = [outer];
      for (const az of [0.95, 1.2, 1.45, 1.62]){ const d = V3(s*Math.sin(az), 0.06, Math.cos(az)).normalize(); pts.push(headShape(d).addScaledVector(d, 0.03)); }
      glasses.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.009, 6, false), frameM));
    }
    const bl = rimAt(-1).add(V3(R*0.98, 0.012, 0)), br = rimAt(1).add(V3(-R*0.98, 0.012, 0));
    const bridge = new THREE.CatmullRomCurve3([bl, V3(0, ey + 0.035, (bl.z + br.z)/2 + 0.02), br]);
    glasses.add(new THREE.Mesh(new THREE.TubeGeometry(bridge, 12, 0.010, 6, false), frameM));
  }

  /* ---- body: short neck + shirt (collar, placket and buttons derive from the shirt colour) */
  const R = rng(O.seed || 1234);
  const body = new THREE.Group(); body.name = 'body'; root.add(body); rig.body = body;
  body.position.y = 0.20;
  const SHIRT = O.shirt;
  const shade = k => shadeHex(SHIRT, k);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.70, 12).translate(0, -1.02, -0.15), mat(shadeHex(skinHex, 0.80), { roughness:0.75 }));
  body.add(neck); rig.neck = neck;
  const tg = new THREE.IcosahedronGeometry(1, 2).scale(1.32, 1.05, 0.88).translate(0, -2.22, -0.08);
  {
    const tp = tg.attributes.position, tc = [], base = new THREE.Color(SHIRT), c = new THREE.Color();
    for (let f = 0; f < tp.count; f += 3){ c.copy(base).multiplyScalar(0.96 + R()*0.06); for (let k = 0; k < 3; k++) tc.push(c.r, c.g, c.b); }
    tg.setAttribute('color', new THREE.Float32BufferAttribute(tc, 3));
    tg.computeBoundingSphere();
  }
  const torso = new THREE.Mesh(tg, mat('#ffffff', { vertexColors:true, roughness:0.88 }));
  body.add(torso); rig.torso = torso;
  const collar = new THREE.Group(); collar.name = 'collar'; body.add(collar); rig.collar = collar;
  decal(torso, collar, t => [lerp(-0.11, 0.11, t), -1.27], t => [lerp(-0.015, 0.015, t), -1.60], 0, 0, 0.014, dmat(shadeHex(skinHex, 0.92)), 12, 4);   // the V of skin at the open neck
  if (O.collar !== false){
    const shirtMat = mat(shade(1.10), { roughness:0.88, side:THREE.DoubleSide });
    body.add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.47, 0.25, 16, 1, true, 0.55, Math.PI*2 - 1.1).rotateX(0.12).translate(0, -1.19, -0.15), shirtMat));
    const edgeMat = mat(shade(0.62), { roughness:0.9, side:THREE.DoubleSide });
    const ptMat = mat(shade(1.16), { roughness:0.85, side:THREE.DoubleSide });
    const btnMat = mat(shade(1.75), { roughness:0.4 });
    for (const s of [-1, 1]){
      plate(torso, collar, [[s*0.08, -1.265], [s*0.49, -1.24], [s*0.285, -1.69]], 0.018, 0.02, edgeMat).userData.decal = true;
      plate(torso, collar, [[s*0.09, -1.28], [s*0.47, -1.25], [s*0.28, -1.66]], 0.034, 0.026, ptMat);
    }
    decal(torso, collar, t => [-0.035, lerp(-1.60, -2.5, t)], t => [0.035, lerp(-1.60, -2.5, t)], 0, 0, 0.02, dmat(shade(1.06)), 10, 1);   // placket
    if (!O.tie) for (const by of [-1.80, -2.08]){
      const h = hitFront(torso, 0, by); if (!h) continue;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.014, 10).rotateX(Math.PI/2), btnMat);
      b.position.copy(h.point).addScaledVector(h.face.normal, 0.03); faceAlong(b, h.face.normal); b.userData.decal = true; collar.add(b);
    }
  }
  if (O.tie){                                    // optional tie over the placket, in short segments so it hugs the chest
    const TIE = O.tie === true ? '#8e1f2a' : O.tie;
    const tieM = mat(TIE, { roughness:0.55 }), tieD = mat(shadeHex(TIE, 0.72), { roughness:0.6 });
    const NB = 10, ya = -1.47, yb = -2.28, wa = 0.058, wb = 0.150;
    for (let i = 0; i < NB; i++){ const y0 = ya + (yb - ya)*i/NB, y1 = ya + (yb - ya)*(i + 1)/NB, w0 = wa + (wb - wa)*i/NB, w1 = wa + (wb - wa)*(i + 1)/NB;
      plate(torso, collar, [[-w0, y0 + 0.004], [w0, y0 + 0.004], [w1, y1], [-w1, y1]], 0.050, 0.028, tieM); }
    plate(torso, collar, [[-wb, yb + 0.004], [wb, yb + 0.004], [0, -2.44]], 0.050, 0.028, tieM);
    plate(torso, collar, [[-0.092, -1.33], [0.092, -1.33], [0.064, -1.50], [-0.064, -1.50]], 0.068, 0.036, tieD);
  }
  if (O.mic){                                    // optional lapel mic on the left collar
    const h = hitFront(torso, 0.30, -1.80);
    if (h){
      const mic = new THREE.Mesh(new THREE.CapsuleGeometry(0.030, 0.050, 4, 10), mat('#121317', { roughness:0.35, metalness:0.3 }));
      mic.position.copy(h.point).addScaledVector(h.face.normal, 0.075); mic.userData.decal = true; collar.add(mic);
    }
  }

  /* ---- arms: seated at the desk, forearms on the desk top, hands resting. rig.setArm(side, lift, kind) raises one
          forearm into a gesture: 'open' (explaining, palm up) or 'point' (toward rig.pointAt, in root space).
          side -1 = the host's right (viewer left), +1 = the host's left (viewer right, toward the orb). */
  if (O.pose === 'desk'){
    const dy = O.deskY ?? -2.75;
    const sleeve = mat(shade(1.02), { roughness:0.88 }), cuffM = mat(shade(1.14), { roughness:0.85 });
    const arms = new THREE.Group(); arms.name = 'arms'; root.add(arms); rig.arms = arms;
    const REST = s => ({ el:V3(s*1.18, dy + 0.17, 1.25), wr:V3(s*0.52, dy + 0.15, 2.05) });
    const POSE = {
      open:  s => ({ el:V3(s*1.24, dy + 0.22, 1.18), wr:V3(s*0.92, dy + 1.02, 1.80) }),
      point: s => ({ el:V3(s*1.26, dy + 0.24, 1.20), wr:V3(s*1.42, dy + 0.62, 2.10) }),
    };
    const armState = {};
    function buildArm(s, lift = 0, kind = 'open'){
      const key = s + ':' + lift.toFixed(3) + kind;
      if (armState[s]?.key === key) return;
      if (armState[s]){ clearGroup(armState[s].g); arms.remove(armState[s].g); }
      const g = new THREE.Group(); arms.add(g); armState[s] = { g, key };
      const r = REST(s), q = (POSE[kind] || POSE.open)(s), u = lift;
      const el = r.el.clone().lerp(q.el, u), wr = r.wr.clone().lerp(q.wr, u);
      wr.y += 0.18*Math.sin(Math.PI*u)*(1 - u);              // the hand arcs up on its way, no straight slide
      const sh = V3(s*1.04, -1.55, -0.05);
      const shoulder = new THREE.Mesh(new THREE.IcosahedronGeometry(0.30, 1), sleeve); shoulder.position.copy(sh).add(V3(-s*0.04, 0.06, 0)); shoulder.scale.set(1, 0.9, 1); g.add(shoulder);
      limb(g, sh, el, 0.25, 0.20, sleeve, 9);
      const elbow = new THREE.Mesh(new THREE.IcosahedronGeometry(0.215, 1), sleeve); elbow.position.copy(el); g.add(elbow);
      limb(g, el, wr, 0.21, 0.16, sleeve, 9);
      const dir = wr.clone().sub(el).normalize();
      limb(g, wr.clone().addScaledVector(dir, -0.07), wr.clone().addScaledVector(dir, 0.03), 0.17, 0.17, cuffM, 9);
      const hand = new THREE.Group(); g.add(hand);
      const restQ = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), V3(dir.x, 0, dir.z).normalize());
      const restP = wr.clone().addScaledVector(dir, 0.20); restP.y = dy + 0.085 + (s > 0 ? 0.06 : 0);
      let upQ = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), dir), upP = wr.clone().addScaledVector(dir, 0.20);
      if (kind === 'open') upQ.multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), -s*1.1));
      if (kind === 'point' && rig.pointAt){
        const aim = rig.pointAt.clone().sub(wr).normalize();
        upQ = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), aim); upP = wr.clone().addScaledVector(aim, 0.20);
      }
      const k = smooth(0, 0.35, u);
      hand.position.copy(restP).lerp(upP, k); hand.quaternion.copy(restQ).slerp(upQ, k);
      const palm = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), skinMat); palm.scale.set(0.15, 0.075, 0.21); hand.add(palm);
      const thumb = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), skinMat); thumb.scale.set(0.05, 0.05, 0.10);
      thumb.position.set(-s*0.12, 0.04, 0.0); thumb.rotation.y = -s*0.5; hand.add(thumb);
      rig['hand' + (s < 0 ? 'R' : 'L')] = hand;
      finishShadows(g);
      if (rig.onRebuild) rig.onRebuild(g);
    }
    buildArm(-1); buildArm(1);
    rig.setArm = (s, lift, kind) => buildArm(s, Math.round(clamp(lift, 0, 1)*50)/50, kind);
  } else rig.setArm = () => {};

  /* ---- face state: only the parts whose inputs changed are rebuilt */
  const face = { smile:0.55, open:0, wide:0, round:0, blink:0, squint:0.25, brow:0, inner:0, look:[0, 0] };
  let built = null;
  rig.setFace = (o = {}) => {
    Object.assign(face, o);
    const key = JSON.stringify(face);
    if (key === built) return;
    const prev = built ? JSON.parse(built) : {};
    if (prev.open !== face.open) setJaw(face.open);
    if (prev.smile !== face.smile || prev.open !== face.open || prev.wide !== face.wide || prev.round !== face.round) buildMouth(face);
    if (prev.blink !== face.blink || prev.squint !== face.squint || String(prev.look) !== String(face.look)) buildEyes(1 - face.blink, face.squint, face.look[0], face.look[1]);
    if (prev.brow !== face.brow || prev.inner !== face.inner) buildBrows(face.brow, face.inner);
    built = key;
    finishShadows(root);
    if (rig.onRebuild) rig.onRebuild(head);
  };
  rig.setFace(O.face || {});

  root.rotation.y = -0.08;                     // default pose: a slight three-quarter
  head.rotation.set(0.03, -0.12, 0.03);
  finishShadows(root);
  root.rig = rig;
  return root;
}
