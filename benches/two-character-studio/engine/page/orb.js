// ORB: a neutral AI character made of particles. A thin shell of a few thousand soft points (Fibonacci sphere) over a
// faint inner core, coloured by the brand. Two eye ovals live on its face (+z of the group): the particles keep flowing
// through them while they stay put, so the orb looks alive without a mouth. It can wear a bow tie.
//
// Motion rules (lessons from production):
// - calm: it never vibrates with the waveform and never shrinks. Its own voice level arrives through a critically
//   damped follower (director.js) and only swells the shell by a few percent, brightens the glow and adds a slow ripple;
// - position and gaze are damped too (director.js); the idle bob is a slow pure function of t;
// - it may glow but never clips: brightness is bounded here and the HDR grade protects it (mask pass = white).
import * as THREE from 'three';
import { rng, mat, shadeHex } from './kit.js';

const VERT = `
  attribute vec3 aDir; attribute float aR; attribute float aSize; attribute float aPhase; attribute float aKind;
  uniform float uTime, uRadius, uSwell, uRipple, uLevel, uGlow, uSpin, uPx, uSize, uBlink, uEyeGain, uEyeMode, uMinPx;
  uniform vec2 uEyeLook; uniform vec3 uColor, uHot;
  varying vec3 vCol; varying float vA;
  mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
  float eyeMask(vec3 d, float side){
    float yaw = atan(d.x, d.z), pit = asin(clamp(d.y, -1.0, 1.0));
    float ex = side*0.34 + uEyeLook.x*0.16, ey = 0.10 + uEyeLook.y*0.10;
    float dx = (yaw - ex)/0.12, dy = (pit - ey)/(0.20*max(0.08, 1.0 - uBlink));
    return (1.0 - smoothstep(0.55, 1.0, dx*dx + dy*dy))*step(0.0, d.z);
  }
  void main(){
    float spin = uSpin*(aKind > 0.5 ? 0.55 : 1.0) + 0.06*sin(uTime*0.31 + aPhase);
    vec3 d = rotY(spin)*aDir;
    // slow travelling ripple while speaking (spatial waves, ~1.3 Hz): reads as breath, never as a waveform
    float rip = sin(3.0*d.y + 2.0*d.x + uTime*8.2 + aPhase*0.15)*sin(2.0*d.z - uTime*5.3);
    float r = aR*(1.0 + uSwell + uRipple*rip*(1.0 - aKind));
    vec3 p = d*uRadius*r;
    vec4 mv = modelViewMatrix*vec4(p, 1.0);
    gl_Position = projectionMatrix*mv;
    vec3 nV = normalize(normalMatrix*d);
    float facing = clamp(nV.z, -1.0, 1.0);
    float e = (aKind > 0.5 || uEyeMode == 0.0) ? 0.0 : max(eyeMask(d, -1.0), eyeMask(d, 1.0));
    float tw = 0.78 + 0.22*sin(uTime*(1.1 + aPhase*0.05) + aPhase);
    float rim = pow(1.0 - abs(facing), 2.0);
    float b = (aKind > 0.5 ? 0.34 : 0.72 + 0.34*rim)*tw*uGlow*(0.82 + 0.40*uLevel);
    b *= mix(0.30, 1.0, smoothstep(-0.6, 0.35, facing));          // the far side is dimmer: depth without a solid body
    vec3 col = mix(uColor, uHot, 0.22*rim + 0.12*uLevel);
    b *= 1.0 - (uEyeMode > 0.0 ? 0.55 : 0.88)*e*step(0.001, abs(uEyeMode));   // eye ovals: the shell steps back around them
    vCol = col*b; vA = 1.0;
    gl_PointSize = max(uMinPx, aSize*uSize*uPx/max(0.1, -mv.z)*(1.0 + 0.12*uLevel));
  }`;
const FRAG = `
  varying vec3 vCol; varying float vA;
  void main(){
    vec2 c = gl_PointCoord - 0.5; float r2 = dot(c, c)*4.0;
    if (r2 > 1.0) discard;
    float a = exp(-r2*2.6)*(1.0 - r2*0.15);
    gl_FragColor = vec4(vCol*a, a*vA);
  }`;

export function makeOrb(o = {}){
  const R = o.radius ?? 0.62;
  const root = new THREE.Group(); root.name = 'orb';
  const body = new THREE.Group(); body.name = 'orbBody'; root.add(body);       // turns with the gaze (the face is +z)
  const color = new THREE.Color(o.color || '#EC7623');
  const hot = new THREE.Color(o.highlight || '#ffffff').lerp(color, 0.25);
  const r = rng(o.seed || 4242);

  // ---- particles: shell (Fibonacci sphere with jitter) + a sparse inner core
  const NS = o.particles ?? 4200, NI = Math.round(NS*0.18), N = NS + NI;
  const dir = new Float32Array(N*3), rad = new Float32Array(N), size = new Float32Array(N), phase = new Float32Array(N), kind = new Float32Array(N);
  const GA = Math.PI*(3 - Math.sqrt(5));
  for (let i = 0; i < N; i++){
    let x, y, z;
    if (i < NS){ y = 1 - 2*(i + 0.5)/NS; const rr = Math.sqrt(1 - y*y), th = GA*i; x = Math.cos(th)*rr; z = Math.sin(th)*rr;
      x += (r() - 0.5)*0.035; y += (r() - 0.5)*0.035; z += (r() - 0.5)*0.035; }
    else { const u = r()*2 - 1, th = r()*Math.PI*2, rr = Math.sqrt(1 - u*u); x = Math.cos(th)*rr; y = u; z = Math.sin(th)*rr; }
    const l = Math.hypot(x, y, z); dir.set([x/l, y/l, z/l], i*3);
    rad[i] = i < NS ? 0.955 + 0.075*r() : 0.25 + 0.6*Math.cbrt(r());
    size[i] = i < NS ? 0.65 + 0.7*r()*r() : 0.9 + 0.8*r();
    phase[i] = r()*100; kind[i] = i < NS ? 0 : 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N*3), 3));   // real positions come from aDir
  g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
  g.setAttribute('aR', new THREE.BufferAttribute(rad, 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R*1.3);
  const U = {
    uTime:{ value:0 }, uRadius:{ value:R }, uSwell:{ value:0 }, uRipple:{ value:0 }, uLevel:{ value:0 }, uGlow:{ value:1 },
    uSpin:{ value:0 }, uPx:{ value:1000 }, uSize:{ value:o.pointSize ?? 0.032 }, uBlink:{ value:0 }, uEyeGain:{ value:o.eyeGain ?? 1.1 }, uMinPx:{ value:1.6 },
    uEyeMode:{ value:o.eyes === 'dark' ? -1 : o.eyes === 'none' ? 0 : 1 }, uEyeLook:{ value:new THREE.Vector2() },
    uColor:{ value:color.clone().multiplyScalar(o.intensity ?? 1.0) }, uHot:{ value:hot },
  };
  const pmat = new THREE.ShaderMaterial({ uniforms:U, vertexShader:VERT, fragmentShader:FRAG, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending });
  const points = new THREE.Points(g, pmat); points.frustumCulled = false; points.renderOrder = 5; body.add(points);

  // ---- eyes: two dense ovals of particles fixed on the face (they do not spin with the shell); blink squashes them.
  //      'glow' adds light; 'dark' paints opaque dark discs over the shell (the cloud is translucent, so a dimmed area alone
  //      would be filled by the particles behind it)
  let eyes = null;
  if (o.eyes !== 'none'){
    const EV = `attribute vec2 aUV; attribute float aSize;
      uniform float uRadius, uPx, uSize, uBlink, uMinPx, uGlow, uLevel; uniform vec2 uEyeLook; uniform vec3 uHot;
      varying vec3 vCol; varying float vA;
      void main(){
        vA = 1.0;
        float side = aUV.x > 0.0 ? 1.0 : -1.0; vec2 q = vec2(aUV.x - side*2.0, aUV.y);     // q in -1..1 inside each eye
        float yaw = side*0.33 + uEyeLook.x*0.14 + q.x*0.105, pit = 0.12 + uEyeLook.y*0.09 + q.y*0.175*max(0.06, 1.0 - uBlink);
        vec3 d = vec3(sin(yaw)*cos(pit), sin(pit), cos(yaw)*cos(pit));
        vec4 mv = modelViewMatrix*vec4(d*uRadius*1.03, 1.0);
        gl_Position = projectionMatrix*mv;
        float edge = 1.0 - smoothstep(0.55, 1.0, length(q));
        vCol = uHot*(0.58 + 0.30*edge)*uGlow*(0.9 + 0.2*uLevel);
        gl_PointSize = max(uMinPx, aSize*uSize*uPx/max(0.1, -mv.z));
      }`;
    const n = o.eyeParticles ?? 170, uv = [], sz = [];
    for (const side of [-1, 1]) for (let i = 0; i < n; i++){       // sunflower spiral fills each oval evenly
      const rr = Math.sqrt((i + 0.5)/n), th = i*GA; uv.push(side*2 + rr*Math.cos(th), rr*Math.sin(th)); sz.push(0.55 + 0.35*r()); }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(uv.length/2*3), 3));
    eg.setAttribute('aUV', new THREE.Float32BufferAttribute(uv, 2));
    eg.setAttribute('aSize', new THREE.Float32BufferAttribute(sz, 1));
    eg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R*1.3);
    const dark = o.eyes === 'dark';
    const FRAG_DARK = `uniform vec3 uDark; varying vec3 vCol; varying float vA;
      void main(){ vec2 c = gl_PointCoord - 0.5; float r2 = dot(c, c)*4.0; if (r2 > 1.0) discard; gl_FragColor = vec4(uDark, 0.9*(1.0 - r2*r2)); }`;
    if (dark) U.uDark = { value:new THREE.Color(o.eyeColor || '#090b14') };
    eyes = new THREE.Points(eg, new THREE.ShaderMaterial({ uniforms:U, vertexShader:EV, fragmentShader:dark ? FRAG_DARK : FRAG, transparent:true, depthWrite:false,
                                                          blending:dark ? THREE.NormalBlending : THREE.AdditiveBlending }));
    eyes.frustumCulled = false; eyes.renderOrder = 6; body.add(eyes);
  }

  // ---- soft aura behind the cloud: the orb glows into the room (camera-facing sprite, additive)
  const auraTex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d');
    const g = c.createRadialGradient(128, 128, 0, 128, 128, 128); g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.35, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 256, 256); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map:auraTex, color:color.clone(), transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, opacity:0.35 }));
  aura.scale.setScalar(R*3.2); aura.renderOrder = 3; root.add(aura);

  // ---- faint inner core: gives the cloud a body (brighter in the middle, transparent at the edge)
  const coreMat = new THREE.ShaderMaterial({
    uniforms:{ uColor:{ value:color.clone() }, uK:{ value:0.30 } },
    vertexShader:'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
    fragmentShader:'uniform vec3 uColor; uniform float uK; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0), 2.2); gl_FragColor = vec4(uColor*f*uK, 1.0); }',
    transparent:true, depthWrite:false, blending:THREE.AdditiveBlending });
  const core = new THREE.Mesh(new THREE.SphereGeometry(R*0.86, 40, 28), coreMat); core.renderOrder = 4; body.add(core);

  // ---- optional body: a dim, semi-opaque sphere inside the shell, so busy backgrounds do not show through the cloud
  //      (`body`: 0 = pure particle cloud, 0.5 = a solid-looking orb)
  if ((o.body ?? 0) > 0){
    const bodyMesh = new THREE.Mesh(new THREE.SphereGeometry(R*0.97, 40, 28), new THREE.MeshBasicMaterial({ color:color.clone().multiplyScalar(0.10), transparent:true, opacity:o.body, depthWrite:false }));
    bodyMesh.renderOrder = 2; body.add(bodyMesh);
  }

  // ---- silhouette: the space the orb occupies (ID pass for the overlap QA and the HDR mask); hidden in the beauty pass
  const silhouette = new THREE.Mesh(new THREE.SphereGeometry(R*1.10, 32, 24), new THREE.MeshBasicMaterial({ color:'#ffffff' }));   // covers the outermost particles and their sprites
  silhouette.visible = false; silhouette.userData.silhouette = true; body.add(silhouette);

  // ---- optional bow tie, hung under the face (never over the eyes)
  let bowtie = null;
  if (o.accessory === 'bowtie'){
    const BC = o.bowtie || '#1d2433';
    const bowM = mat(BC, { roughness:0.5 }), knotM = mat(shadeHex(BC, 0.7), { roughness:0.55 });
    const d = new THREE.Vector3(0, -0.62, 0.78).normalize();
    bowtie = new THREE.Group(); bowtie.name = 'bowtie';
    const wing = s => { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(s*0.30, 0.14); sh.quadraticCurveTo(s*0.34, 0, s*0.30, -0.14); sh.lineTo(0, 0);
      bowtie.add(new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth:0.05, bevelEnabled:true, bevelThickness:0.015, bevelSize:0.015, bevelSegments:2 }).translate(0, 0, -0.025), bowM)); };
    wing(1); wing(-1);
    bowtie.add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.12, 0.09), knotM));
    bowtie.scale.setScalar(R*(o.bowtieScale ?? 1.0));
    bowtie.position.copy(d).multiplyScalar(R*1.10);
    bowtie.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d); bowtie.rotateZ(0.04);
    bowtie.traverse(m => { if (m.isMesh){ m.castShadow = true; m.receiveShadow = true; } });
    body.add(bowtie);
  }

  // ---- the orb's own light: a soft brand-coloured glow on the dock and the desk
  const light = new THREE.PointLight(color, 0.0, 4.5, 1.8); light.position.set(0, -0.1, 0.25); root.add(light);

  const api = { root, body, points, eyes, aura, core, silhouette, bowtie, light, uniforms:U, radius:R, color,
    // s: { t, level 0..1 (damped), glow (state multiplier), spin (rad), blink 0..1, look [x,y], px (pixels per unit at 1) }
    update(s){
      U.uTime.value = s.t; U.uLevel.value = s.level; U.uGlow.value = s.glow; U.uSpin.value = s.spin; U.uBlink.value = s.blink;
      U.uSwell.value = 0.028*s.level; U.uRipple.value = 0.012*s.level; U.uPx.value = s.px; U.uMinPx.value = s.minPx ?? 1.6;
      silhouette.scale.setScalar(1 + U.uSwell.value);           // the ID pass and the HDR mask follow the real swell (the QA measures it)
      U.uEyeLook.value.set(s.look[0], s.look[1]);
      coreMat.uniforms.uK.value = (0.24 + 0.18*s.level)*s.glow;
      aura.material.opacity = Math.min(0.6, (0.26 + 0.16*s.level)*s.glow);
      light.intensity = (o.lightIntensity ?? 1.1)*(0.55 + 0.6*s.level)*s.glow + (s.dark || 0)*8;
    } };
  root.userData.orb = api;
  return api;
}
