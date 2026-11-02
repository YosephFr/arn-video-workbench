// The director: builds the set, the two characters and the TV from the piece's config, then poses everything for time
// t from plan.json (written by tools/plan.py): the shot and its camera move, the TV content, the room light, the host's
// expressions, gaze, mouth and gestures, the orb's states, voice level and gaze, and the frozen beat.
// update(t) depends only on t (the damped orb motion is simulated from 0 with a fixed step), so any frame can be rendered
// alone, in any order, in parallel workers, and the mask and ID passes line up with the beauty pass exactly.
import * as THREE from 'three';
import { makeRenderer, addLights, makeComposer } from './look.js';
import { makeSet, makeTopLamp, contactShadow, DESK_Y, DOCK, DOCK_TOP } from './set.js';
import { makeTV } from './tv.js';
import { makeHost } from './host.js';
import { makeOrb } from './orb.js';
import { CAMS } from './cameras.js';
import { phonesForLine, mouthAt, syntheticEnvelope } from './speech.js';
import { clamp, lerp, smooth, smoother } from './kit.js';

const ENV_RATE = 50;                     // timeline.json envelopes are 50 Hz
const SIM_DT = 1/240;                    // fixed step of the orb's damped motion
// host expression tags (added over a neutral face, each with its own fade in and out)
const NEUTRAL = { smile:0.05, brow:0.45, inner:0.25, squint:0.20 };
const TAGS = {
  brow_up:      { brow:+0.60, inner:+0.20 },
  furrow:       { brow:-0.35, inner:-0.50, squint:+0.25 },
  fake_intense: { brow:-0.25, inner:-0.90, squint:+0.35, smile:+0.10, pitch:+0.07 },
  shock:        { brow:+0.90, inner:+0.50, squint:-0.20, pitch:-0.04 },
  eyes_down:    { inner:+0.50, brow:-0.10, lookY:-0.70, pitch:+0.10, squint:+0.10 },
  stare_lock:   { inner:+0.60, squint:+0.30, brow:-0.05, smile:-0.05 },
  smile:        { smile:+0.45, squint:+0.15 },
  serious:      { smile:-0.05, brow:-0.12, inner:-0.15, squint:+0.12 },
  tilt:         { roll:+0.12 },
  lean_in:      { lean:+0.8 }, lean_back:{ lean:-0.6 },
  look_cam:     { cam:+1.0 }, look_tv:{ tv:+1.0 },
  dart:         {}, blink:{},
};
// orb states: glow multiplier, spin rate (rad/s) and an optional slow pulse
const ORB = {
  idle:{ g:1.00, spin:0.16 }, speak:{ g:1.18, spin:0.20 }, think:{ g:1.0, spin:0.55, pulse:0.12 }, judge:{ g:0.70, spin:0.08 },
  dim:{ g:0.50, spin:0.10 }, off:{ g:0.12, spin:0.04 }, pulse:{ g:1.50, spin:0.24 }, soft_pulse:{ g:1.25, spin:0.20, pulse:0.08 },
};

export async function buildDirector({ canvas, W, H, C }){
  const plan = C.plan, cast = C.cast, brand = C.brand, pass = C.pass, Q = C.query || {};
  const MASK = pass === 'mask', IDP = pass === 'id', FLAT = MASK || IDP;
  const setCfg = cast.set || {};
  const renderer = makeRenderer(canvas, W, H, setCfg.exposure ?? 1.0);
  if (FLAT){ renderer.toneMapping = THREE.NoToneMapping; renderer.shadowMap.enabled = false; }
  const scene = new THREE.Scene();
  const BG = new THREE.Color('#05070f'); scene.background = BG.clone();

  // ---------------------------------------------------------------- set, lights, TV
  const S = makeSet(scene, { led:setCfg.led || brand.colors.accent, ring:setCfg.ring, plant:setCfg.plant, city:setCfg.city, wall:setCfg.wall, desk:setCfg.desk });
  const L = addLights(scene, { target:new THREE.Vector3(1.0, -1.0, 1.0), span:6, shadowMap:C.scale < 0.75 ? 1024 : 2048 });
  L.hemi.intensity = 0.10*(setCfg.ambient ?? 6.8);                         // night office: low hemisphere, lifted for the wide set
  L.key.intensity = 1.05; L.key.color.set('#ffc890'); L.fill.intensity = 0.10; L.rim1.intensity = 3.4; L.rim2.intensity = 2.4;
  const lapGlow = S.laptop.userData.glow; lapGlow.intensity = 5.2*0.6; lapGlow.distance = 5.0; lapGlow.color.set('#a9c2ff');
  S.laptop.traverse(o => { if (o.isMesh && o.material.blending === THREE.AdditiveBlending) o.material.opacity *= 0.6; });
  const mon = new THREE.SpotLight('#8fb0ff', 14*0.6, 9, 0.5, 0.8, 1.6); mon.position.set(0.3, -1.85, 2.9); mon.target.position.set(0, 0, 0); scene.add(mon, mon.target);   // laptop light on the host's face
  const down = new THREE.SpotLight('#ffb878', 10, 10, 0.42, 0.75, 1.4); down.position.set(-2.8, 0.6, 1.4); down.target.position.set(-0.2, -2.75, 1.9);   // warm downlight on the host's half of the desk
  scene.add(down, down.target); down.castShadow = !FLAT; down.shadow.mapSize.set(1024, 1024); down.shadow.bias = -0.0005;
  const tv = await makeTV(scene, { brand:brand.colors, fonts:C.fontFamilies, palette:setCfg.tv?.palette, level:setCfg.tv?.level, evidenceLevel:setCfg.tv?.evidence_level,
                                   tokens:setCfg.tv?.tokens, buildAt:setCfg.tv?.build_at ?? null, images:C.images, floorY:S.floorY });

  // ---------------------------------------------------------------- characters
  const host = makeHost({ ...(cast.host || {}), pose:'desk', deskY:DESK_Y, jaw:0.085 }); scene.add(host); host.rotation.y = 0;
  const hr = host.rig;
  for (const s of [-1, 1]){ const cs = contactShadow(0.55, 0.45); cs.position.set(s*0.62, DESK_Y + 0.006, 2.15); cs.scale.set(1.3, 0.8, 1); scene.add(cs); }
  for (const s of [-1, 1]){ const cs = contactShadow(0.4, 0.5); cs.position.set(s*1.18, DESK_Y + 0.006, 1.3); scene.add(cs); }
  const orbCfg = cast.orb || {};
  const orb = makeOrb({ ...orbCfg, color:orbCfg.color || brand.colors.accent });
  const R = orb.radius, ORB_POS = new THREE.Vector3(DOCK[0], DESK_Y + DOCK_TOP + 0.22 + R, DOCK[1]);
  orb.root.position.copy(ORB_POS); scene.add(orb.root); orb.body.rotation.order = 'YXZ';
  const oShadow = contactShadow(0.42, 0.6); oShadow.position.set(DOCK[0], DESK_Y + 0.135, DOCK[1]); scene.add(oShadow);
  const lamp = setCfg.lamp ? makeTopLamp(scene, ORB_POS, { intensity:2.2 }) : null;   // suspense pieces only; then the ring is off
  const RING = S.dockRing.material.color.clone().lerp(orb.color, setCfg.ring_tint ?? 0.22).multiplyScalar(setCfg.ring_level ?? 0.85);

  // light inventory, scaled by the room level (the characters' own lights are excluded)
  const own = new Set(); host.traverse(o => own.add(o)); orb.root.traverse(o => own.add(o));
  const LIGHTS = [], BASICS = [], EMI = [];
  scene.traverse(o => {
    if (o.isLight && !own.has(o)) LIGHTS.push([o, o.intensity]);
    else if (o.isMesh && !own.has(o) && o !== tv.mesh && o.material?.isMeshBasicMaterial && !o.userData.hdr) BASICS.push([o.material, o.material.color.clone()]);
    if (o.isMesh && !own.has(o) && o.material?.emissive && o.material.emissiveIntensity > 0) EMI.push([o.material, o.material.emissiveIntensity]);
  });

  const camera = new THREE.PerspectiveCamera(28, W/H, 0.05, 300); scene.add(camera);
  const composer = makeComposer(renderer, scene, camera, W, H, FLAT ? { flat:true } : { bloom:setCfg.bloom ?? 0.26, vignette:setCfg.vignette ?? 1.5 });
  const hostRT = FLAT ? null : new THREE.WebGLRenderTarget(W, H);
  if (composer.grade) composer.grade.uniforms.tHost.value = hostRT.texture;

  // ---------------------------------------------------------------- timing data from the plan
  const dur = plan.duration, shots = plan.shots, lang = plan.language || 'en';
  const lines = plan.lines;
  const envs = {};                                        // who -> 50 Hz envelope over the whole piece
  const nEnv = Math.ceil(dur*ENV_RATE) + 2;
  for (const l of lines){
    const who = l.who; if (!who) continue;
    const e = envs[who] || (envs[who] = new Float32Array(nEnv));
    let src = l.env || [];
    if (!src.length || Math.max(...src) < 0.02) src = syntheticEnvelope(l.words, l.start, l.end, ENV_RATE);   // silent placeholder voice
    const k0 = Math.round(l.start*ENV_RATE);
    for (let i = 0; i < src.length; i++){ const k = k0 + i; if (k >= 0 && k < nEnv) e[k] = Math.max(e[k], src[i]); }
  }
  const envAt = (who, t) => { const e = envs[who]; if (!e) return 0; const f = t*ENV_RATE, i = Math.floor(f), u = f - i; return lerp(e[i] ?? 0, e[i + 1] ?? 0, u); };
  const envS = (who, t) => 0.25*envAt(who, t - 0.10) + 0.5*envAt(who, t - 0.05) + 0.25*envAt(who, t);
  const phH = lines.filter(l => l.who === 'host').map(l => phonesForLine(l.words, lang));
  const HT = plan.host_tags || [], OS = (plan.orb_states || []).slice().sort((a, b) => (a.pri - b.pri) || (a.t0 - b.t0));
  const GS = plan.gestures || [], LK = plan.looks || [], RK = plan.room?.length ? plan.room : [{ t:0, level:1 }];
  const tagW = (g, t, att = 0.12, rel = 0.18) => smooth(g.t0 - 0.02, g.t0 + att, t)*smooth(g.t1 + rel, g.t1, t)*(g.amp ?? 1);
  const locks = HT.filter(g => g.tag === 'stare_lock');
  const blinksH = [1.9, 4.3, 6.4, 10.2, 13.1, 16.8, 20.5, 23.9, 27.4, 31.0, 35.2, 39.6, 43.1, 47.5, 52.0, 56.3, 60.8, 64.9]
    .concat(HT.filter(g => g.tag === 'blink').map(g => g.t0)).concat(lines.filter(l => l.who === 'host').map(l => l.start - 0.12))
    .filter(b => b < dur && !locks.some(g => b > g.t0 - 0.1 && b < g.t1));
  const blinksO = [2.6, 7.1, 12.4, 17.9, 22.6, 28.3, 33.0, 38.8, 44.2, 50.1, 55.0, 61.3].filter(b => b < dur);
  const blinkAt = (t, times) => times.reduce((m, b) => Math.max(m, 1 - clamp(Math.abs(t - b)/0.075, 0, 1)), 0);
  const roomAt = t => { let r = RK[0].level; for (let i = 1; i < RK.length; i++){ const k = RK[i]; r = lerp(r, k.level, clamp((t - k.t)/(k.fade || 0.04), 0, 1)); } return r; };
  const P = plan.pause || null;
  const shotAt = t => { let i = 0; while (i + 1 < shots.length && t >= shots[i + 1].t) i++; return shots[i]; };
  const lookW = (who, target, t) => LK.filter(g => g.who === who && g.target === target)
    .reduce((m, g) => Math.max(m, smooth(g.t0 - 0.15, g.t0 + 0.20, t)*smooth(g.t1 + 0.25, g.t1 - 0.05, t)*(g.amp ?? 1)), 0);

  // ---------------------------------------------------------------- camera: a pure function of t
  const V = a => new THREE.Vector3(...a);
  const TV_C = new THREE.Vector3(tv.screen.x, tv.screen.y, tv.screen.z);
  const _cp = new THREE.Vector3(), _cl = new THREE.Vector3();
  function cameraAt(t){
    const X = Q.camx ? { pos:Q.camx.slice(0, 3), look:Q.camx.slice(3, 6), fov:Q.camx[6] || 30 } : null;   // free camera probe: px,py,pz,lx,ly,lz,fov
    const s = shotAt(t), A = X || CAMS[Q.cam || s.a] || CAMS.two, B = X || CAMS[Q.cam || s.b || s.a] || A;
    const d = s.mv ? Math.min(s.mv, s.t1 - s.t) : (s.t1 - s.t);
    const u = smoother(clamp((t - s.t)/Math.max(0.5, d), 0, 1));
    _cp.set(...A.pos).lerp(V(B.pos), u); _cl.set(...A.look).lerp(V(B.look), u);
    if (!s.still && !Q.cam && !Q.camx){ _cp.x += 0.012*Math.sin(t*0.71) + 0.006*Math.sin(t*1.93); _cp.y += 0.009*Math.sin(t*0.53 + 1.0); }
    return { pos:_cp.clone(), look:_cl.clone(), fov:lerp(A.fov, B.fov, u), shot:s };
  }

  // ---------------------------------------------------------------- the orb's damped motion (fixed-step simulation)
  const HOST_T = new THREE.Vector3(0.0, -0.05, 0.55);    // the host's face, seen from the orb
  const orbStateAt = t => {
    const p = { g:ORB.idle.g, spin:ORB.idle.spin, pulse:0 };
    for (const g of OS){ const st = ORB[g.state] || ORB.idle, w = smooth(g.t0 - 0.10, g.t0 + 0.12, t)*smooth(g.t1 + 0.18, g.t1 - 0.02, t);
      if (w <= 0) continue; p.g = lerp(p.g, st.g, w); p.spin = lerp(p.spin, st.spin, w); if (st.pulse) p.pulse = Math.max(p.pulse, st.pulse*w); }
    if (p.pulse) p.g *= 1 + p.pulse*Math.sin(t*2*Math.PI*0.6);
    return p;
  };
  const speakW = t => OS.filter(g => g.state === 'speak').reduce((m, g) => Math.max(m, smooth(g.t0 - 0.3, g.t0 + 0.2, t)*smooth(g.t1 + 0.4, g.t1, t)), 0);
  const gazeTarget = t => {
    const wc = Q.lookcam ? 1 : lookW('orb', 'camera', t), wt = lookW('orb', 'tv', t);
    const tgt = HOST_T.clone();
    if (wt > 0) tgt.lerp(TV_C, wt);
    const sp = speakW(t);                                   // while it talks it also plays to the camera
    if (wc > 0 || sp > 0) tgt.lerp(cameraAt(t).pos, Math.max(wc, 0.45*sp));
    const d = tgt.sub(ORB_POS);
    // screen-direction cheat: the face turns toward its target only part of the way, so both eyes stay readable
    return [clamp(Math.atan2(d.x, d.z), -1.2, 1.2)*0.45, -Math.atan2(d.y, Math.hypot(d.x, d.z))*0.8];
  };
  const init = () => { const [y, p] = gazeTarget(0); return { t:0, lvl:0, lv:0, yaw:y, yv:0, pit:p, pv:0, spin:0 }; };
  let SIM = init();
  const W_LVL = 2*Math.PI*1.1, W_GAZE = 2*Math.PI*0.55;
  function step(s, t, dt){
    const target = clamp(envAt('orb', t), 0, 1);
    s.lv += (W_LVL*W_LVL*(target - s.lvl) - 2*W_LVL*s.lv)*dt; s.lvl += s.lv*dt;          // critically damped: no overshoot, no waveform
    const [ty, tp] = gazeTarget(t);
    s.yv += (W_GAZE*W_GAZE*(ty - s.yaw) - 2*W_GAZE*s.yv)*dt; s.yaw += s.yv*dt;
    s.pv += (W_GAZE*W_GAZE*(tp - s.pit) - 2*W_GAZE*s.pv)*dt; s.pit += s.pv*dt;
    s.spin += orbStateAt(t).spin*dt; s.t = t;
  }
  function orbAt(t){
    if (t < SIM.t - 1e-9) SIM = init();
    while (SIM.t + SIM_DT <= t + 1e-9) step(SIM, SIM.t + SIM_DT, SIM_DT);
    const s = { ...SIM }; if (t > s.t) step(s, t, t - s.t);
    return { level:clamp(s.lvl, 0, 1), yaw:s.yaw, pitch:s.pit, spin:s.spin };
  }

  // ---------------------------------------------------------------- pass-specific materials (HDR mask, ID pass)
  const BLACK = new THREE.MeshBasicMaterial({ color:'#000000' }), NOWRITE = new THREE.MeshBasicMaterial({ color:'#000000', colorWrite:false, depthWrite:false });
  const maskMat = c => new THREE.MeshBasicMaterial({ color:c });
  // mask: R = practical lights, G = the TV screen, B = the city; protected characters (no highlight expansion):
  // white = the host (skin cap), grey = the orb (glow cap)
  const M_LIGHT = [], M_SCREEN = maskMat('#00ff00'), M_CITY = maskMat('#0000ff'), M_PROTECT = maskMat('#ffffff'), M_ORBMASK = maskMat('#a0a0a0');
  if (MASK){
    scene.traverse(o => { if (!o.isMesh) return;
      if (own.has(o)) return;
      const k = o.userData.hdr;
      if (k === 'light'){ const m = maskMat('#ff0000'); M_LIGHT.push([o, m]); o.material = m; }
      else if (k === 'screen') o.material = M_SCREEN;
      else if (k === 'city') o.material = M_CITY;
      else if (o.material && (o.material.transparent || o.material.blending === THREE.AdditiveBlending)) o.material = NOWRITE;
      else o.material = BLACK; });
    orb.points.visible = false; orb.core.visible = false; orb.aura.visible = false; if (orb.eyes) orb.eyes.visible = false;
    orb.silhouette.visible = true; orb.silhouette.material = M_ORBMASK;
    tv.mask = true;
  }
  const M_HOST = new THREE.MeshBasicMaterial({ color:'#ff0000', blending:THREE.CustomBlending, blendEquation:THREE.MaxEquation, depthTest:false, depthWrite:false, transparent:true });
  const M_ORB = new THREE.MeshBasicMaterial({ color:'#00ff00', blending:THREE.CustomBlending, blendEquation:THREE.MaxEquation, depthTest:false, depthWrite:false, transparent:true });
  if (IDP){    // QA overlap: host red, orb green, MAX blend, no depth, everything else hidden (yellow = overlap)
    scene.traverse(o => { if ((o.isMesh || o.isPoints) && !own.has(o)) o.visible = false; });
    scene.background = new THREE.Color('#000000');
    orb.points.visible = false; orb.core.visible = false; orb.aura.visible = false; if (orb.eyes) orb.eyes.visible = false;
    orb.silhouette.visible = true; orb.silhouette.material = M_ORB;
    if (orb.bowtie) orb.bowtie.traverse(o => { if (o.isMesh) o.material = M_ORB; });
  }
  if (MASK){ scene.background = new THREE.Color('#000000'); if (orb.bowtie) orb.bowtie.traverse(o => { if (o.isMesh) o.material = M_ORBMASK; }); }
  function passMaterials(){       // host decals are rebuilt as the face moves: re-apply the pass material to new meshes
    if (!FLAT) return;
    host.traverse(o => { if (!o.isMesh || o.userData.passed) return;
      const tr = o.material?.transparent || o.material?.blending === THREE.AdditiveBlending;
      if (IDP){ o.material = M_HOST; if (tr && o.userData.decal) o.visible = false; }
      else o.material = tr ? NOWRITE : M_PROTECT;
      o.userData.passed = true; });
  }

  // ---------------------------------------------------------------- host gaze helpers
  const D3 = new THREE.Vector3(), EYE_C = new THREE.Vector3(0, 0.045, 0.55), LOC = new THREE.Vector3();
  const aim = (o, p) => { D3.copy(p).sub(o); return { yaw:Math.atan2(D3.x, D3.z), pitch:-Math.atan2(D3.y, Math.hypot(D3.x, D3.z)) }; };
  function eyeLook(head, target){ LOC.copy(target); head.worldToLocal(LOC).sub(EYE_C);
    return [clamp(2.6*Math.sin(Math.atan2(LOC.x, LOC.z)), -1, 1), clamp(3.2*Math.sin(Math.atan2(LOC.y, Math.hypot(LOC.x, LOC.z))), -0.8, 0.8)]; }
  const q = (v, k = 50) => Math.round(v*k)/k;
  const pointTargets = { tv:TV_C.clone(), orb:ORB_POS.clone() };

  // ---------------------------------------------------------------- update(t)
  const state = { grey:0, shot:null };
  function update(t){
    const cam = cameraAt(t), shot = cam.shot;
    camera.position.copy(cam.pos); camera.lookAt(cam.look); camera.fov = cam.fov; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    const inPause = P && t >= P.freeze && t < P.col1;
    const tw = inPause ? P.freeze : t;                     // the world freezes; the host stays live
    const grey = inPause ? 1 - smooth(P.col0, P.col1, t) : 0;
    state.grey = grey; state.shot = shot;

    // room level and practical lights
    const r = roomAt(tw);
    for (const [l, i0] of LIGHTS) l.intensity = i0*r;
    for (const [m, c0] of BASICS) m.color.copy(c0).multiplyScalar(0.06 + 0.94*r);
    for (const [m, e0] of EMI) m.emissiveIntensity = e0*r;
    if (!FLAT) scene.background.copy(BG).multiplyScalar(0.3 + 0.7*r);
    if (lamp) lamp.setLevel(r);
    const evW = !inPause && shot.kind === 'tv' && shot.evidence ? { ...shot.evidence, t0:shot.t } : null;
    tv.update(tw, evW);
    tv.mat.color.setScalar(tv.baseLevel(evW)*(0.06 + 0.94*r));

    // orb: damped level and gaze, calm hover, states
    const os = orbAt(tw), st = orbStateAt(tw);
    const hover = 0.030*Math.sin(tw*0.85) + 0.012*Math.sin(tw*0.31 + 1.2);
    orb.root.position.set(ORB_POS.x + 0.012*Math.sin(tw*0.42), ORB_POS.y + hover, ORB_POS.z);
    orb.body.rotation.set(clamp(os.pitch*0.6, -0.35, 0.35), clamp(os.yaw, -1.2, 1.2), 0.04*Math.sin(tw*0.37));
    const px = H/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2));
    const dark = 1 - r;
    orb.update({ t:tw, level:os.level, glow:st.g*(1 + 0.8*dark), spin:os.spin, blink:blinkAt(tw, blinksO), look:[0.10*Math.sin(tw*0.37), 0.06*Math.sin(tw*0.23)], px, dark, minPx:1.6*H/1920 });
    oShadow.material.opacity = clamp(0.75 - 1.4*hover, 0.15, 0.8)*(0.3 + 0.7*r);
    const ringK = lamp ? 0.0 : (1 + 0.30*os.level)*(0.15 + 0.85*r);
    if (!MASK) S.dockRing.material.color.copy(RING).multiplyScalar(ringK);
    if (!MASK) S.strip.material.color.copy(S.ledColor).multiplyScalar(0.06 + 0.94*r);

    // host: expression tags over a neutral face
    const o = { ...NEUTRAL, lookY:0, pitch:0, roll:0, lean:0, dart:0, cam:0, tv:0 };
    for (const g of HT){ const D = TAGS[g.tag]; if (!D) continue;
      const w = tagW(g, t, g.tag === 'shock' ? 0.06 : 0.12); if (w <= 0) continue;
      for (const k in D) o[k] += D[k]*w;
      if (g.tag === 'dart'){ const ph = Math.floor((t - g.t0)/0.16); o.dart = w*[0.85, -0.85, 0.7, -0.6, 0.8][((ph % 5) + 5) % 5]; } }
    o.cam = Q.lookcam ? 1 : Math.max(o.cam, lookW('host', 'camera', t)); o.tv = Math.max(o.tv, lookW('host', 'tv', t));
    host.position.set(0, -0.03*o.lean, 0.12*o.lean); host.updateMatrixWorld(true);
    const headW = new THREE.Vector3(); hr.head.getWorldPosition(headW);
    const gt = orb.root.position.clone().add(new THREE.Vector3(0, 0.10, 0));
    if (o.tv > 0) gt.lerp(TV_C, clamp(o.tv, 0, 1));
    if (o.cam > 0) gt.lerp(camera.position, clamp(o.cam, 0, 1));
    const fa = aim(headW, gt);
    const env = clamp(envAt('host', t), 0, 1), m = mouthAt(phH, t);
    const gain = clamp(0.40 + 0.75*env, 0, 1.05)*smooth(0.01, 0.05, env);
    hr.head.rotation.set(Math.min(0.80*fa.pitch, 0.34) + 0.05*envS('host', t) - 0.02 + 0.012*Math.sin(t*1.7) + o.pitch,
                         clamp(0.78*fa.yaw, -0.62, 0.62) + 0.018*Math.sin(t*0.9) + 0.05*o.dart, 0.012*Math.sin(t*1.3) + o.roll);
    hr.head.updateMatrixWorld(true);
    const lk = eyeLook(hr.head, gt);
    hr.setFace({ smile:q(clamp(o.smile, 0, 1.1), 20), brow:q(clamp(o.brow, -0.2, 1.4), 20), inner:q(clamp(o.inner, -1, 1.2), 20), squint:q(clamp(o.squint, 0, 1), 20),
                 open:q(m.open*gain), wide:q(m.wide), round:q(m.round), blink:q(blinkAt(t, blinksH), 20),
                 look:[q(clamp(lk[0] + o.dart, -1, 1)), q(clamp(lk[1] + o.lookY, -0.9, 0.8))] });
    for (const side of [1, -1]){                         // timed gestures, quantized so the arm rebuilds rarely
      let lift = 0, kind = side > 0 ? 'point' : 'open', target = null;
      for (const a of GS) if (a.side === side){ const w = smooth(a.t0 - 0.05, a.t0 + 0.35, t)*smooth(a.t1 + 0.35, a.t1 - 0.05, t)*(a.amp ?? 1);
        if (w > lift){ lift = w; kind = a.kind; target = a.target; } }
      hr.pointAt = target && pointTargets[target] ? pointTargets[target] : (target === 'camera' ? camera.position.clone() : pointTargets.orb);
      hr.setArm(side, Math.round(lift*12)/12, kind);
    }
    passMaterials();
    if (MASK){                                            // mask levels follow the lights; the frozen world is not expanded
      const k = inPause ? 0 : 1;
      for (const [mesh, mm] of M_LIGHT){ const lvl = mesh === S.dockRing ? ringK : (lamp && mesh === lamp.bulb ? r : 0.06 + 0.94*r); mm.color.setRGB(clamp(lvl, 0, 1)*k, 0, 0); }
      M_SCREEN.color.setRGB(0, clamp((0.06 + 0.94*r)*k, 0, 1), 0); M_CITY.color.setRGB(0, 0, k);
    }
  }

  // render: the composer, plus the host mask while the world is frozen
  function renderFrame(){
    if (composer.grade){
      composer.grade.uniforms.uGrey.value = state.grey;
      if (state.grey > 0){
        const vis = []; scene.traverse(o => { if ((o.isMesh || o.isPoints || o.isSprite) && o.visible){ vis.push(o); } });
        const hostSet = new Set(); host.traverse(x => hostSet.add(x));
        for (const o of vis) if (!hostSet.has(o)) o.visible = false;
        const bg = scene.background; scene.background = null; scene.overrideMaterial = M_PROTECT;
        renderer.setRenderTarget(hostRT); renderer.setClearColor('#000000', 1); renderer.clear(); renderer.render(scene, camera);
        renderer.setRenderTarget(null); scene.overrideMaterial = null; scene.background = bg;
        for (const o of vis) o.visible = true;
      }
    }
    composer.render();
  }

  // probes used by the QA and by humans: where the heads are on screen
  window.__studio = { camera, host, orb, tv, scene,
    heads(){ const v = new THREE.Vector3(), o = {};
      hr.head.getWorldPosition(v); v.project(camera); o.host = [+((v.x + 1)/2).toFixed(3), +((1 - v.y)/2).toFixed(3)];
      orb.root.getWorldPosition(v); v.project(camera); o.orb = [+((v.x + 1)/2).toFixed(3), +((1 - v.y)/2).toFixed(3)];
      return o; } };
  return { update, renderFrame, duration:dur, camera, cameraAt, state };
}
