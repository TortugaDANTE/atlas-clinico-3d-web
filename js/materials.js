import * as THREE from 'three';
import { makeTextures } from './textures.js';

export const holoTime = { value: 0 };

const VS = `varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = -mv.xyz; vP = position; gl_Position = projectionMatrix*mv; }`;
const FS = `uniform vec3 uColor; uniform float uTime; uniform float uOpacity; uniform float uScan; uniform float uBase; uniform float uPow;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main(){
  vec3 n = normalize(vN); vec3 v = normalize(vV);
  float f = pow(1.0 - abs(dot(n, v)), uPow);
  float lines = smoothstep(0.38, 0.5, abs(fract(vP.y*0.085) - 0.5));
  float sweep = pow(0.5 + 0.5*sin(vP.y*0.018 - uTime*1.3), 6.0);
  float a = (uBase + f*0.62 + uScan*(lines*0.07 + sweep*0.12)) * uOpacity;
  vec3 col = uColor*(0.45 + 0.7*f) + vec3(0.4,0.8,1.0)*f*0.12*uScan + uColor*sweep*0.25*uScan;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function fresnelMaterial({ color = 0x40e0ff, opacity = 1, scan = 1, base = 0.07, power = 2.2 } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: holoTime, uOpacity: { value: opacity }, uScan: { value: scan }, uBase: { value: base }, uPow: { value: power } },
  });
}
export function wireMaterial(color = 0x40e0ff) {
  return new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false });
}

const PHYS = {
  bone:      { roughness: 0.62, clearcoat: 0.05, sheen: 0.0, bump: 0.5 },
  artery:    { roughness: 0.32, clearcoat: 0.7, sheen: 0.2, bump: 0.15 },
  vein:      { roughness: 0.34, clearcoat: 0.6, sheen: 0.2, bump: 0.15 },
  gall:      { roughness: 0.22, clearcoat: 1.0, sheen: 0.2, bump: 0.2 },
  collecting:{ roughness: 0.3, clearcoat: 0.8, sheen: 0.0, bump: 0.1 },
  default:   { roughness: 0.46, clearcoat: 0.35, sheen: 1.0, bump: 0.6 },
};

// Material "Realista": PBR + textura procedural + brillo cálido tipo subdérmico (sheen + emisión suave)
export function realMaterial(def) {
  const kind = def.tex || 'liver';
  const tx = makeTextures(kind);
  const p = PHYS[kind] || PHYS.default;
  const col = def.color ? new THREE.Color(def.color) : new THREE.Color(0xffffff);
  const m = new THREE.MeshPhysicalMaterial({
    color: def.tex ? 0xffffff : col, map: def.tex ? tx.map : null, bumpMap: tx.bump, bumpScale: p.bump,
    roughness: p.roughness, metalness: 0, clearcoat: p.clearcoat, clearcoatRoughness: 0.45,
    sheen: p.sheen, sheenColor: new THREE.Color(0xff9a8a), sheenRoughness: 0.55,
    emissive: new THREE.Color(tx.base[0] / 255, tx.base[1] / 255, tx.base[2] / 255), emissiveIntensity: kind === 'bone' ? 0.03 : 0.12,
    envMapIntensity: 0.8,
  });
  if (def.tex) { const r = def.texRepeat || [3, 2]; tx.map.repeat.set(r[0], r[1]); tx.bump.repeat.set(r[0], r[1]); }
  return m;
}
