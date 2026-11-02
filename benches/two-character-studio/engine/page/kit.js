// Shared helpers: math, seeded random numbers, materials and "decals" (thin strips wrapped onto a mesh surface).
// Faces are built from decals rebuilt on demand (mouth, lids, brows), so every expression is pure geometry: no textures.
import * as THREE from 'three';

export const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
export const deg = Math.PI / 180;
// mulberry32: tiny deterministic PRNG. Everything that varies is seeded, so frame N always renders the same picture.
export function rng(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0)/4294967296; }; }
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a)*t;
export const smooth = (a, b, x) => { const t = clamp((x - a)/(b - a), 0, 1); return t*t*(3 - 2*t); };
export const smoother = u => u*u*u*(u*(6*u - 15) + 10);          // quintic: zero velocity and acceleration at both ends
export const gauss = (dx, dy, sx, sy) => Math.exp(-(dx*dx)/(2*sx*sx) - (dy*dy)/(2*sy*sy));
export const eOut = x => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
export const eInOut = x => x < 0.5 ? 4*x*x*x : 1 - Math.pow(-2*x + 2, 3)/2;
export const eBack = x => { const c1 = 1.45, c3 = c1 + 1; return x <= 0 ? 0 : x >= 1 ? 1 : 1 + c3*Math.pow(x - 1, 3) + c1*Math.pow(x - 1, 2); };
export const u01 = (t, t0, d) => clamp((t - t0)/d, 0, 1);

// flat-shaded low-poly look: the "planes of the head" read as facets under a hard key light
export function mat(color, o = {}){
  return new THREE.MeshStandardMaterial(Object.assign({ color, roughness:0.78, metalness:0, flatShading:true }, o));
}
// decal material: double sided and pulled toward the camera so it never z-fights the surface below
export function dmat(color, o = {}){
  return mat(color, Object.assign({ side:THREE.DoubleSide, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2 }, o));
}

// strip geometry between two 2D curves top(t) and bot(t), t in [0,1]
export function bandGeom(top, bot, N = 24, M = 3){
  const pos = [], tris = [];
  for (let i = 0; i <= N; i++){
    const t = i/N, a = top(t), b = bot(t);
    for (let j = 0; j <= M; j++){ const s = j/M; pos.push(lerp(a[0], b[0], s), lerp(a[1], b[1], s), 0); }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++){
    const a = i*(M + 1) + j, b = a + 1, c = (i + 1)*(M + 1) + j, d = c + 1;
    tris.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(tris);
  return g;
}

const _ray = new THREE.Raycaster();
const _o = new THREE.Vector3(), _dz = new THREE.Vector3();
// first hit on the front of a mesh, in the mesh's OWN space (cast along its local -z), so decals can be rebuilt while
// the character is moved or turned in a scene. Returns { point, face } in local space, or null.
export function hitFront(mesh, x, y){
  _o.set(x, y, 10).applyMatrix4(mesh.matrixWorld);
  _dz.set(0, 0, -1).transformDirection(mesh.matrixWorld);
  _ray.set(_o, _dz);
  const h = _ray.intersectObject(mesh, false);
  if (!h.length) return null;
  return { point: mesh.worldToLocal(h[0].point.clone()), face: h[0].face };
}
// wrap a flat 2D strip onto the front of a mesh (projected along -z), lifted by `off` along the surface normal
export function conform(geom, mesh, cx, cy, off){
  const p = geom.attributes.position;
  for (let i = 0; i < p.count; i++){
    const x = cx + p.getX(i), y = cy + p.getY(i);
    const h = hitFront(mesh, x, y);
    if (h){ const n = h.face.normal; p.setXYZ(i, h.point.x + n.x*off, h.point.y + n.y*off, h.point.z + n.z*off); }
    else p.setXYZ(i, x, y, 0);
  }
  p.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}
export function decal(target, parent, top, bot, cx, cy, off, material, N = 24, M = 3){
  const m = new THREE.Mesh(conform(bandGeom(top, bot, N, M), target, cx, cy, off), material);
  m.userData.decal = true;
  parent.add(m);
  return m;
}
// thick flat plate (polygon) conformed onto the front of a mesh (collar points, a tie blade)
export function plate(target, parent, pts, off, thick, material){
  const lo = [], hi = [];
  for (const [x, y] of pts){
    const h = hitFront(target, x, y);
    const P = h ? h.point.clone() : V3(x, y, 0);
    const n = h ? h.face.normal.clone() : V3(0, 0, 1);
    lo.push(P.clone().addScaledVector(n, off));
    hi.push(P.clone().addScaledVector(n, off + thick));
  }
  const pos = [], N = pts.length;
  const tri = (a, b, c) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 1; i < N - 1; i++){ tri(hi[0], hi[i], hi[i + 1]); tri(lo[0], lo[i + 1], lo[i]); }
  for (let i = 0; i < N; i++){ const j = (i + 1) % N; tri(lo[i], lo[j], hi[j]); tri(lo[i], hi[j], hi[i]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals(); g.computeBoundingSphere();
  const m = new THREE.Mesh(g, material);
  parent.add(m);
  return m;
}
// replace the children of a group (used to rebuild animated decals: mouth, eyelids, brows)
export function clearGroup(g){
  for (const c of [...g.children]){ g.remove(c); c.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
}
// orient an object's +z along a direction given in its PARENT's space (Object3D.lookAt works in world space, which
// breaks as soon as the character is moved or turned)
const _Z = new THREE.Vector3(0, 0, 1);
export function faceAlong(obj, n){ obj.quaternion.setFromUnitVectors(_Z, n.clone().normalize()); return obj; }
// low-poly limb: tapered cylinder from a to b (radius r0 at a, r1 at b)
export function limb(parent, a, b, r0, r1, material, seg = 8){
  const dir = b.clone().sub(a), len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, seg, 1).translate(0, len/2, 0), material);
  m.position.copy(a); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  parent.add(m); return m;
}
// piecewise-linear profile through control points [[t, v], ...] (linear on purpose: flat planes between rows)
export function lin(t, pts){
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]){ const [a, va] = pts[i - 1], [b, vb] = pts[i]; return lerp(va, vb, (t - a)/(b - a)); }
  return pts[pts.length - 1][1];
}
export function finishShadows(root){
  root.traverse(o => { if (o.isMesh){ o.castShadow = !o.userData.decal && !o.userData.noShadow; o.receiveShadow = true; } });
}
// colour helpers
export const hex = c => '#' + new THREE.Color(c).getHexString();
export const shadeHex = (c, k) => '#' + new THREE.Color(c).multiplyScalar(k).getHexString();
export const mixHex = (a, b, t) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
