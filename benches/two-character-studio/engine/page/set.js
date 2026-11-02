// The night office: a big mullioned window over a procedural city, a desk on legs with a black laptop (no logo), a mug,
// papers, a plant, the orb's charging dock with its glowing ring, an LED strip along the desk front and an office chair.
// Every prop sits on something and gets a soft contact shadow. Everything is procedural: no photos, no textures on disk.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { rng, mat } from './kit.js';

export const DESK_Y = -2.75;               // desk top height in world units (the host's head sits near y = 0)
export const DOCK = [2.6, 1.6];            // orb dock (x, z) on the desk, at the host's left (viewer right)
export const DOCK_TOP = 0.125;

// The city seen from a high floor: horizon at the texture's mid-height (placed at eye level), sky above, lit blocks
// below, a few towers crossing the horizon. Pre-blurred like a shallow depth of field so the room stays sharp.
const CITY = {
  night:  { sky:['#060b22', '#0e1a44', '#22306a'], ground:['#141f4c', '#070b1c'], blocks:['#0f1940', '#121f4b'], tower:'#101a44',
            lit:0.24, warm:'255,196,120', cool:'150,190,255', tower2:['255,200,130', '160,200,255'], stars:160, beacons:true, glow:0.55, bokeh:70 },
  sunset: { sky:['#2e2f72', '#b45f88', '#ffb070'], ground:['#4a3358', '#1c1530'], blocks:['#3a2c50', '#45335a'], tower:'#33284a',
            lit:0.16, warm:'255,190,115', cool:'255,150,170', tower2:['255,195,125', '255,160,170'], stars:20, beacons:true, glow:0.45, bokeh:40, sun:[0.62, 0.47] },
};
export function makeCityTexture(W = 2048, H = 1152, seed = 7, palName = 'night'){
  const pal = CITY[palName] || CITY.night, r = rng(seed);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const hz = H*0.5;
  let gr = g.createLinearGradient(0, 0, 0, hz);
  gr.addColorStop(0, pal.sky[0]); gr.addColorStop(0.75, pal.sky[1]); gr.addColorStop(1, pal.sky[2]);
  g.fillStyle = gr; g.fillRect(0, 0, W, hz);
  gr = g.createLinearGradient(0, hz, 0, H);
  gr.addColorStop(0, pal.ground[0]); gr.addColorStop(1, pal.ground[1]);
  g.fillStyle = gr; g.fillRect(0, hz, W, H - hz);
  for (let i = 0; i < pal.stars; i++){ g.fillStyle = `rgba(210,220,255,${0.15 + r()*0.4})`; g.fillRect(r()*W, r()*hz*0.85, 1.5, 1.5); }
  if (pal.sun){
    const [sx, sy] = [pal.sun[0]*W, pal.sun[1]*H], sg = g.createRadialGradient(sx, sy, 4, sx, sy, H*0.45);
    sg.addColorStop(0, 'rgba(255,236,190,1)'); sg.addColorStop(0.06, 'rgba(255,200,130,0.85)'); sg.addColorStop(0.3, 'rgba(255,140,110,0.25)'); sg.addColorStop(1, 'rgba(255,120,120,0)');
    g.fillStyle = sg; g.fillRect(0, 0, W, H);
  }
  const cc = document.createElement('canvas'); cc.width = W; cc.height = H;
  const c = cc.getContext('2d');
  const win = () => r() < 0.66 ? `rgba(${pal.warm},${0.45 + r()*0.5})` : `rgba(${pal.cool},${0.4 + r()*0.5})`;
  for (let row = 0; row < 7; row++){                     // rows of blocks: small near the horizon, bigger and lower closer in
    const k = row/6, y0 = hz + 6 + k*k*H*0.42, bw = 18 + k*90, wh = 3 + k*9;
    for (let x = -bw*r(); x < W; x += bw*(0.7 + r()*0.8)){
      const w = bw*(0.5 + r()*0.6), top = y0 - (row < 2 ? r()*40 : r()*bw*0.9);
      c.fillStyle = r() < 0.5 ? pal.blocks[0] : pal.blocks[1]; c.fillRect(x, top, w, H - top);
      for (let wy = top + wh; wy < Math.min(H, top + 260 + k*400); wy += wh*2.2) for (let wx = x + wh; wx < x + w - wh; wx += wh*1.9)
        if (r() < pal.lit){ c.fillStyle = win(); c.fillRect(wx, wy, wh, wh*1.2); }
    }
  }
  for (let i = 0; i < 9; i++){                            // towers crossing the horizon
    const w = 40 + r()*70, x = r()*W, top = hz - 40 - r()*170;
    c.fillStyle = pal.tower; c.fillRect(x, top, w, hz - top + 40);
    for (let wy = top + 8; wy < hz + 30; wy += 12) for (let wx = x + 6; wx < x + w - 6; wx += 11)
      if (r() < pal.lit*1.25){ c.fillStyle = r() < 0.6 ? `rgba(${pal.tower2[0]},0.85)` : `rgba(${pal.tower2[1]},0.8)`; c.fillRect(wx, wy, 5, 6); }
    if (r() < 0.5 && pal.beacons){ c.fillStyle = 'rgba(255,80,80,0.9)'; c.fillRect(x + w/2 - 2, top - 6, 4, 4); }
  }
  g.save(); g.filter = 'blur(4px)'; g.drawImage(cc, 0, 0); g.restore(); g.filter = 'none';
  for (let i = 0; i < 10 && pal.glow > 0; i++){           // street glow
    const lx = r()*W, ly = hz + 40 + r()*H*0.4, rad = 60 + r()*120;
    const lg = g.createRadialGradient(lx, ly, 2, lx, ly, rad);
    lg.addColorStop(0, `rgba(255,200,130,${pal.glow})`); lg.addColorStop(0.15, `rgba(255,170,90,${pal.glow*0.4})`); lg.addColorStop(1, 'rgba(255,160,80,0)');
    g.fillStyle = lg; g.fillRect(0, 0, W, H);
  }
  for (let i = 0; i < pal.bokeh; i++){                    // out-of-focus lights
    const bx = r()*W, by = hz*0.8 + r()*H*0.5, rad = 10 + r()*34, warm = r() < 0.55, a = 0.10 + r()*0.25;
    const col = warm ? '255,190,120' : '130,175,255';
    const bg = g.createRadialGradient(bx, by, 0, bx, by, rad);
    bg.addColorStop(0, `rgba(${col},${a})`); bg.addColorStop(0.7, `rgba(${col},${a*0.6})`); bg.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = bg; g.beginPath(); g.arc(bx, by, rad, 0, Math.PI*2); g.fill();
  }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// soft round contact shadow (ground plane under props and characters)
export function contactShadow(radius = 0.6, opacity = 0.45){
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  const gr = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, `rgba(0,0,8,${opacity})`); gr.addColorStop(1, 'rgba(0,0,8,0)');
  c.fillStyle = gr; c.fillRect(0, 0, 128, 128);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(radius*2, radius*2), new THREE.MeshBasicMaterial({ map:new THREE.CanvasTexture(cv), transparent:true, depthWrite:false }));
  m.rotation.x = -Math.PI/2; m.userData.decal = true; m.renderOrder = 1;
  return m;
}

// The orb's charging dock: graphite puck with a glowing ring; the orb hovers just above it. Origin = where it sits.
export function makeDock(o = {}){
  const g = new THREE.Group(); g.name = 'dock';
  const dockM = mat('#2b2f3a', { roughness:0.4, metalness:0.3 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.54, 0.12, 18), dockM); base.position.y = 0.06; g.add(base);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.03, 6, 36), new THREE.MeshBasicMaterial({ color:o.ring || '#d6ecff' }));
  ring.position.y = DOCK_TOP; ring.rotation.x = Math.PI/2; ring.userData.decal = true; ring.userData.hdr = 'light'; g.add(ring);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.01, 18), mat('#3a4050', { roughness:0.3 })); pad.position.y = DOCK_TOP; g.add(pad);
  const light = new THREE.PointLight(o.ring || '#cfe2ff', 0.15, 1.2, 1.5); light.position.set(0, 0.35, 0.2); g.add(light);   // low: it must not light the orb from below
  const sh = contactShadow(0.75, 0.55); sh.position.y = 0.004; g.add(sh);
  g.userData = { ring, light };
  return g;
}

// Black laptop (no logo): thin rounded base + lid, screen glowing toward the user. Screen faces local -z.
export function makeLaptop(o = {}){
  const g = new THREE.Group(); g.name = 'laptop';
  const W = o.w ?? 1.55, D = o.d ?? 1.05;
  const shell = new THREE.MeshStandardMaterial({ color:o.color || '#2c2e34', roughness:0.38, metalness:0.2 });
  const base = new THREE.Mesh(new RoundedBoxGeometry(W, 0.07, D, 2, 0.03), shell); base.position.y = 0.035; g.add(base);
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(W*0.86, D*0.42), mat('#101114', { roughness:0.7 }));
  deck.rotation.x = -Math.PI/2; deck.position.set(0, 0.0705, -D*0.12); g.add(deck);
  const lid = new THREE.Group(); lid.position.set(0, 0.07, D/2 - 0.02); lid.rotation.x = o.tilt ?? 0.26; g.add(lid);
  const lidM = new THREE.Mesh(new RoundedBoxGeometry(W, D*0.95, 0.04, 2, 0.02), shell); lidM.position.set(0, D*0.475, 0); lid.add(lidM);
  const rim = new THREE.Mesh(new RoundedBoxGeometry(W + 0.035, D*0.95 + 0.035, 0.02, 2, 0.02), new THREE.MeshStandardMaterial({ color:'#6f737d', roughness:0.25, metalness:0.4 }));
  rim.position.set(0, D*0.475, -0.012); lid.add(rim);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W*0.92, D*0.86), new THREE.MeshBasicMaterial({ color:o.screen || '#b9cdf5' }));
  screen.position.set(0, D*0.48, -0.022); screen.rotation.y = Math.PI; lid.add(screen);
  const glow = new THREE.PointLight('#c4d6ff', o.glow ?? 2.4, 4.5, 1.6); glow.position.set(0, D*0.55, -0.75); lid.add(glow);
  { // soft screen light spilling around the lid edges, kept tight so it never reads as fog over a dark shirt
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const c = cv.getContext('2d'), gr = c.createRadialGradient(64, 64, 10, 64, 64, 64);
    gr.addColorStop(0, 'rgba(190,210,255,0.55)'); gr.addColorStop(0.55, 'rgba(170,195,255,0.22)'); gr.addColorStop(1, 'rgba(160,190,255,0)');
    c.fillStyle = gr; c.fillRect(0, 0, 128, 128);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(W*1.4, D*1.5), new THREE.MeshBasicMaterial({ map:new THREE.CanvasTexture(cv), transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, opacity:o.halo ?? 0.22 }));
    halo.position.set(0, D*0.5, -0.12); halo.userData.decal = true; lid.add(halo);
  }
  const sh = contactShadow(W*0.68, 0.55); sh.position.y = 0.004; sh.scale.set(1, D/W*1.1, 1); g.add(sh);
  g.userData = { lid, glow, screen };
  return g;
}

// small potted plant: dark ceramic pot + faceted leaves
export function makePlant(o = {}){
  const g = new THREE.Group(); g.name = 'plant';
  const r = rng(o.seed || 5);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.42, 9), mat(o.pot || '#2e3640', { roughness:0.6 })); pot.position.y = 0.21; g.add(pot);
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.02, 9), mat('#2a1d16')); soil.position.y = 0.41; g.add(soil);
  const leafM = [mat('#3f7a55', { roughness:0.6 }), mat('#4d8c5f', { roughness:0.6 }), mat('#356a4a', { roughness:0.6 })];
  for (let i = 0; i < 9; i++){
    const a = i/9*Math.PI*2 + r()*0.4, len = 0.45 + r()*0.3;
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), leafM[i % 3]);
    leaf.scale.set(0.09, len*0.5, 0.025);
    const piv = new THREE.Group(); piv.position.y = 0.42; piv.rotation.set(0, a, 0); g.add(piv);
    leaf.position.set(0, len*0.45, 0); const tilt = new THREE.Group(); tilt.rotation.z = 0.35 + r()*0.45; tilt.add(leaf); piv.add(tilt);
  }
  const sh = contactShadow(0.42, 0.6); sh.position.y = 0.004; g.add(sh);
  return g;
}

// Angled desk lamp over the orb (suspense pieces only). When it is on, the dock ring is off: one motivated light.
export function makeTopLamp(scene, orbPos, o = {}){
  const LB = new THREE.Vector3(3.45, DESK_Y, 0.55), LE = new THREE.Vector3(3.55, DESK_Y + 1.45, 0.45), LP = new THREE.Vector3(2.85, -0.30, 1.30);
  const aimAt = orbPos.clone().add(new THREE.Vector3(0, 0.05, 0));
  const lampM = mat('#2a3042', { roughness:0.75, metalness:0.3 }), chrome = mat('#9aa0ad', { roughness:0.5, metalness:0.3 });
  const g = new THREE.Group(); g.name = 'topLamp'; scene.add(g);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.27, 0.06, 20), lampM); base.position.copy(LB).add(new THREE.Vector3(0, 0.03, 0)); g.add(base);
  const sh = contactShadow(0.45, 0.6); sh.position.set(LB.x, DESK_Y + 0.004, LB.z); g.add(sh);
  const rod = (p, q, r) => { const d = q.clone().sub(p), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), chrome);
    m.position.copy(p).add(q).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); m.castShadow = true; g.add(m); };
  rod(LB.clone().add(new THREE.Vector3(0, 0.05, 0)), LE, 0.028); rod(LE, LP, 0.024);
  const jt = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), lampM); jt.position.copy(LE); g.add(jt);
  const shade = new THREE.Group(); shade.position.copy(LP); shade.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), aimAt.clone().sub(LP).normalize()); g.add(shade);
  const shadeOut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.30, 0.34, 24, 1, true), mat('#56607a', { roughness:0.75, metalness:0.3, side:THREE.DoubleSide, emissive:new THREE.Color('#3a2a18'), emissiveIntensity:0.6 }));
  shadeOut.position.y = -0.12; shadeOut.castShadow = true; shade.add(shadeOut);
  const bulbM = new THREE.MeshBasicMaterial({ color:'#fff1d6' });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), bulbM); bulb.position.y = -0.14; bulb.userData.hdr = 'light'; shade.add(bulb);
  const ON = new THREE.Color('#fff1d6'), OFF = new THREE.Color('#3a3630'), I = o.intensity ?? 2.2;
  const light = new THREE.SpotLight('#ffe6c4', I, 6, 0.55, 0.85, 1.4);          // wide soft cone from above: no hot spot
  light.position.copy(LP); light.target.position.copy(aimAt); scene.add(light, light.target);
  light.castShadow = true; light.shadow.mapSize.set(1024, 1024); light.shadow.bias = -0.0005;
  return { group:g, light, bulb, setLevel(l){ light.intensity = I*l; bulbM.color.copy(OFF).lerp(ON, l); } };
}

// The whole room. Returns handles the director animates (dock ring, LED strip, laptop lights, city, lamp).
export function makeSet(scene, o = {}){
  const g = new THREE.Group(); g.name = 'room'; scene.add(g);
  const dy = DESK_Y, floorY = dy - 6.0, eye = -0.3;
  const add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  const box = (w, h, d, m, x, y, z) => add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), x, y, z);
  const shadowAt = (x, z, r, a, y = dy + 0.004) => add(contactShadow(r, a), x, y, z);

  // floor + back wall with a mullioned window; the city far outside with the horizon at eye level
  const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(60, 40), mat('#181a26', { roughness:0.85 })), 0.5, floorY, 0);
  floor.rotation.x = -Math.PI/2;
  const wallZ = -5.5, wx0 = -8, wx1 = 10, wy0 = floorY + 3.6, wy1 = 9.5;
  const wallM = mat(o.wall || '#1b2242', { roughness:0.95 });
  box(20, 30, 0.4, wallM, wx0 - 10, floorY + 15, wallZ);
  box(20, 30, 0.4, wallM, wx1 + 10, floorY + 15, wallZ);
  box(wx1 - wx0, wy0 - floorY, 0.4, wallM, (wx0 + wx1)/2, (floorY + wy0)/2, wallZ);
  box(wx1 - wx0, 10, 0.4, wallM, (wx0 + wx1)/2, wy1 + 5, wallZ);
  const frameM = mat('#0b0f20', { roughness:0.55 });
  for (const x of [wx0, -2.6, 2.6, wx1]) box(0.26, wy1 - wy0, 0.5, frameM, x, (wy0 + wy1)/2, wallZ + 0.05);
  box(wx1 - wx0, 0.22, 0.45, frameM, (wx0 + wx1)/2, 4.3, wallZ + 0.05);
  box(wx1 - wx0 + 0.6, 0.18, 0.8, mat('#262c48', { roughness:0.7 }), (wx0 + wx1)/2, wy0 - 0.05, wallZ + 0.25);
  const cityMat = new THREE.MeshBasicMaterial({ map:makeCityTexture(2048, 1152, o.citySeed ?? 7, o.city || 'night'), fog:false });
  const city = add(new THREE.Mesh(new THREE.PlaneGeometry(190, 107), cityMat), 1, eye, -80);
  city.userData.decal = true; city.userData.hdr = 'city';

  // desk: top on four legs
  const wood = mat(o.desk || '#3a2b29', { roughness:0.55 });
  const DX0 = -3.4, DX1 = 4.4, DZ0 = 0.95, DZ1 = 3.7;
  const top = box(DX1 - DX0, 0.14, DZ1 - DZ0, wood, (DX0 + DX1)/2, dy - 0.07, (DZ0 + DZ1)/2);
  box(DX1 - DX0, 0.03, 0.03, mat('#5a4440', { roughness:0.4 }), (DX0 + DX1)/2, dy - 0.01, DZ1);
  const legM = mat('#24202a', { roughness:0.6 });
  for (const x of [DX0 + 0.2, DX1 - 0.2]) for (const z of [DZ0 + 0.2, DZ1 - 0.2]) box(0.14, 6 - 0.14, 0.14, legM, x, (floorY + dy - 0.14)/2, z);
  shadowAt((DX0 + DX1)/2, (DZ0 + DZ1)/2, 4.5, 0.35, floorY + 0.004).scale.set(1, 0.5, 1);

  // office chair behind the host
  const chairM = mat('#272b36', { roughness:0.8 }), metal = mat('#3c404c', { roughness:0.35, metalness:0.6 });
  const back = box(2.7, 2.5, 0.32, chairM, 0, dy - 0.15, -1.35); back.rotation.x = -0.08;
  box(2.5, 0.3, 2.2, chairM, 0, dy - 1.95, -0.2);
  box(0.16, 1.9, 0.16, metal, 0, dy - 3.0, -0.2);
  for (let i = 0; i < 5; i++){ const a = i/5*Math.PI*2, arm = box(1.4, 0.1, 0.16, metal, Math.cos(a)*0.7, floorY + 0.25, -0.2 + Math.sin(a)*0.7); arm.rotation.y = -a; }
  shadowAt(0, -0.2, 1.8, 0.5, floorY + 0.005);

  // mug (matte, a little darker so it stays under the HDR knee) and two sheets of paper
  const M = o.mug || [-1.0, 2.95];
  const mugM = mat('#b9b3aa', { roughness:0.8 });
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.16, 0.38, 12), mugM), M[0], dy + 0.19, M[1]);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.01, 12), mat('#2a160c', { roughness:0.3 })), M[0], dy + 0.35, M[1]);
  const handle = add(new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 10), mugM), M[0] - 0.19, dy + 0.2, M[1]); handle.rotation.y = Math.PI/2;
  shadowAt(M[0], M[1], 0.32, 0.6);
  for (const [x, z, r, k] of [[-0.95, 2.55, 0.10, 0], [-0.92, 2.53, 0.05, 1]]){
    const pp = add(new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.012, 1.1), mat('#a7a9ad', { roughness:0.9 })), x, dy + 0.01 + 0.012*k, z); pp.rotation.y = r;
  }

  // laptop, plant, dock
  const laptop = makeLaptop(o.laptop || {}); laptop.position.set(0.30, dy, 2.5); laptop.rotation.y = 0.08; scene.add(laptop);
  let plant = null;
  if (o.plant !== false){ plant = makePlant(); plant.position.set(3.55, dy, 0.9); scene.add(plant); }
  const dock = makeDock({ ring:o.ring }); dock.position.set(DOCK[0], dy, DOCK[1]); g.add(dock);

  // LED strip along the desk front (a practical light, tinted by the brand)
  const ledColor = new THREE.Color(o.led || '#4f86ff');
  const strip = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.045, 0.05), new THREE.MeshBasicMaterial({ color:ledColor.clone() }));
  strip.position.set(0.5, dy - 0.05, 3.72); strip.userData.hdr = 'light'; strip.userData.decal = true; scene.add(strip);

  return { room:g, top, floorY, wallZ, city, cityMat, laptop, plant, dock, dockRing:dock.userData.ring, dockLight:dock.userData.light, strip, ledColor };
}
