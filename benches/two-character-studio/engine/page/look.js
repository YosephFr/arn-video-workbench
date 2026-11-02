// The look: renderer settings, the light rig and the post chain (bloom + a slight desaturation + vignette).
// Night office logic: a warm key from off-frame above, cool rims from the window, and every practical light in the set
// (TV, dock ring, LED strip, laptop) motivated by an object you can see.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function makeRenderer(canvas, w, h, exposure = 1.0){
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, preserveDrawingBuffer:true, alpha:false, powerPreference:'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

// Base rig: hemisphere + warm key (casts the shadows) + cool fill + two blue rims.
export function addLights(scene, o = {}){
  const L = {};
  const tgt = o.target || new THREE.Vector3(0, 0, 0);
  const at = (l, x, y, z) => { l.position.set(tgt.x + x, tgt.y + y, tgt.z + z); l.target.position.copy(tgt); scene.add(l.target); scene.add(l); return l; };
  L.hemi = new THREE.HemisphereLight('#6c86c8', '#0b0f22', 0.55); scene.add(L.hemi);
  L.key = at(new THREE.DirectionalLight('#ffd2a6', 2.4), -3.2, 2.4, 4.2);
  L.key.castShadow = true;
  L.key.shadow.mapSize.set(o.shadowMap || 2048, o.shadowMap || 2048);
  const s = o.span || 3;
  Object.assign(L.key.shadow.camera, { left:-s, right:s, top:s, bottom:-s, near:0.5, far:15 + s });
  L.key.shadow.bias = -0.0004; L.key.shadow.normalBias = 0.03;
  L.fill = at(new THREE.DirectionalLight('#9db4ea', 0.45), 3.5, -0.5, 3);
  L.rim1 = at(new THREE.DirectionalLight('#5f8cff', 2.6), 3, 2.5, -4);
  L.rim2 = at(new THREE.DirectionalLight('#4a6ee0', 1.6), -3.5, 1.5, -3.5);
  return L;
}

// post: bloom on the practical lights only (high threshold), a touch of desaturation and a vignette.
// Mask and ID passes call this with { bloom:0, vignette:0, flat:true } so their colours stay exact.
export function makeComposer(renderer, scene, camera, w, h, o = {}){
  const rt = new THREE.WebGLRenderTarget(w, h, { type:THREE.HalfFloatType, samples:o.flat ? 0 : 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(1);
  composer.setSize(w, h);
  const rp = new RenderPass(scene, camera);
  composer.addPass(rp);
  if (!o.flat){
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), o.bloom ?? 0.28, 0.5, 0.82));
    // grade: saturation, a cool tint, the vignette, and the frozen beat: uGrey desaturates everything outside the
    // host mask (tHost, white where the live host is), so the world freezes in grey while the host keeps talking in colour
    const grade = new ShaderPass({
      uniforms: { tDiffuse: { value:null }, tHost: { value:null }, uGrey: { value:0 }, uPx: { value:new THREE.Vector2(1/w, 1/h) },
                  vig: { value:o.vignette ?? 1.5 }, sat: { value:o.saturation ?? 0.88 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D tHost; uniform float uGrey; uniform vec2 uPx; uniform float vig; uniform float sat; varying vec2 vUv;
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
          c.rgb = mix(vec3(l), c.rgb, sat);
          c.rgb *= vec3(1.0, 0.99, 1.02);
          if (uGrey > 0.0){
            float hm = 0.4*texture2D(tHost, vUv).r + 0.15*(texture2D(tHost, vUv + vec2(uPx.x, 0.0)).r + texture2D(tHost, vUv - vec2(uPx.x, 0.0)).r
                     + texture2D(tHost, vUv + vec2(0.0, uPx.y)).r + texture2D(tHost, vUv - vec2(0.0, uPx.y)).r);
            float g = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722))*0.84;
            c.rgb = mix(c.rgb, vec3(g), uGrey*(1.0 - hm));
          }
          vec2 q = vUv - 0.5;
          float v = 1.0 - smoothstep(0.32, 0.82, length(q));
          c.rgb *= mix(1.0 - 0.5*vig, 1.0, v);
          gl_FragColor = c;
        }`,
    });
    composer.addPass(grade);
    composer.grade = grade;
  }
  composer.addPass(new OutputPass());
  composer.renderPass = rp;
  return composer;
}
