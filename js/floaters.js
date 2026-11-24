import * as THREE from 'three';
import { pxToWorld, wr, mulberry32, REDUCED_MOTION } from './config.js';
import { ENV_GLSL, BG_GLSL } from './shaders.js';

/* ───────── шейдеры ───────── */
const chromeVert = /* glsl */ `
varying vec3 vW; varying vec3 vN;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 w = m * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(m) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const chromeFrag = /* glsl */ `
varying vec3 vW; varying vec3 vN;
${ENV_GLSL}
void main() {
  vec3 V = normalize(cameraPosition - vW); vec3 N = normalize(vN);
  vec3 col = envSample(reflect(-V, N), 0.0) * vec3(0.965, 0.978, 1.0);
  col *= 0.9 + 0.1 * pow(1.0 - max(dot(N, V), 0.0), 3.0);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const bubbleVert = /* glsl */ `
attribute float aOpa;
uniform float uAspect;
varying vec3 vW; varying vec3 vN; varying vec2 vC; varying vec2 vNdc; varying float vR; varying float vOpa;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 w = m * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(m) * normal); vOpa = aOpa;
  vec4 cw = m * vec4(0.0, 0.0, 0.0, 1.0);
  float r = length(vec3(m[0][0], m[0][1], m[0][2]));
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec4 c0 = projectionMatrix * viewMatrix * cw;
  vec4 c1 = projectionMatrix * viewMatrix * vec4(cw.xyz + right * r, 1.0);
  vC = c0.xy / c0.w; vR = abs(c1.x / c1.w - c0.x / c0.w);
  gl_Position = projectionMatrix * viewMatrix * w;
  vNdc = gl_Position.xy / gl_Position.w;
}`;
const bubbleFrag = /* glsl */ `
varying vec3 vW; varying vec3 vN; varying vec2 vC; varying vec2 vNdc; varying float vR; varying float vOpa;
uniform float uAspect;
${ENV_GLSL}
${BG_GLSL}
void main() {
  vec3 V = normalize(cameraPosition - vW); vec3 N = normalize(vN);
  float ndv = max(dot(N, V), 0.0);
  float f = pow(1.0 - ndv, mix(2.0, 4.2, step(vOpa, 0.01)));
  vec2 q = (vNdc - vC) / vec2(vR, vR * uAspect);
  vec3 lens = pow(bgColor(vC - q * vec2(vR, vR * uAspect) * 0.85), vec3(2.2)) * 0.75;
  vec3 refl = envSample(reflect(-V, N), 0.3);
  vec3 col = mix(lens, refl * 1.15, clamp(f * 1.15 + 0.08, 0.0, 1.0));
  float a = mix(vOpa, mix(0.9, 0.6, step(vOpa, 0.01)), clamp(f * 1.2, 0.0, 1.0));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

const shardVert = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
}`;
const shardFrag = /* glsl */ `
varying vec3 vW;
${ENV_GLSL}
void main() {
  vec3 V = normalize(cameraPosition - vW);
  vec3 N = normalize(cross(dFdx(vW), dFdy(vW)));
  if (dot(N, V) < 0.0) N = -N;
  vec3 e = envSample(reflect(-V, N), 0.6);
  float l = dot(e, vec3(0.3333));
  vec3 col = e * 0.85 + vec3(0.01, 0.07, 0.06) * (1.0 - l);
  float a = clamp(0.35 + 0.6 * l + 0.2 * pow(1.0 - abs(dot(N, V)), 2.0), 0.0, 0.95);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

/* ───────── данные (px референса) ───────── */
const BEADS = [[690, 835, 22, .02], [1473, 718, 34, .03], [1505, 803, 23, 0], [73, 905, 8, 0], [190, 963, 6, 0], [1100, 235, 4, 0]];
const BUBBLES = [[718, 200, 19], [894, 322, 25], [311, 443, 14], [1460, 248, 12], [1637, 102, 8], [1745, 475, 12],
  [1018, 218, 10], [978, 215, 7], [960, 330, 8], [1523, 403, 6], [871, 293, 6], [838, 336, 4], [662, 70, 6]];
const SHARDS = [[752, 369, 15], [880, 430, 20], [917, 246, 12], [365, 698, 26], [565, 452, 9], [1550, 440, 14]];

class Field {
  constructor(mesh, items, opts) {
    this.mesh = mesh;
    this.items = items;
    this.opts = opts;
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.e = new THREE.Euler();
  }
  step(dt, t, input) {
    const m = input.world, mv = input.vel, infl = input.influence;
    const idle = REDUCED_MOTION ? 0.3 : 1;
    for (const it of this.items) {
      if (it.fixed) continue;
      const a = 0.012 * idle;
      const hx = it.home.x + Math.sin(t * it.f1 + it.ph) * a * 1.6, hy = it.home.y + Math.cos(t * it.f2 + it.ph * 1.7) * a * 1.6;
      let ax = (hx - it.p.x) * this.opts.k - it.v.x * this.opts.c;
      let ay = (hy - it.p.y) * this.opts.k - it.v.y * this.opts.c;
      let az = (it.home.z - it.p.z) * this.opts.k - it.v.z * this.opts.c;
      if (infl > 0.01) {
        const rx = it.p.x - m.x, ry = it.p.y - m.y, d2 = rx * rx + ry * ry, d = Math.sqrt(d2) + 1e-4;
        const sg = 0.2 + it.r * 1.2, fo = Math.exp(-d2 / (2 * sg * sg)) * infl;
        const lite = 1 / (0.5 + it.r * 14);
        ax += (rx / d) * 36 * fo * lite + (mv.x * 0.5 - it.v.x) * 3.5 * fo;
        ay += (ry / d) * 36 * fo * lite + (mv.y * 0.5 - it.v.y) * 3.5 * fo;
        az += (it.id % 2 ? 1 : -1) * 4 * fo;
      }
      it.v.x += ax * dt; it.v.y += ay * dt; it.v.z += az * dt;
      it.p.x += it.v.x * dt; it.p.y += it.v.y * dt; it.p.z += it.v.z * dt;
      if (it.spin) it.rot.x += it.spin.x * dt, it.rot.y += it.spin.y * dt, it.rot.z += it.spin.z * dt;
    }
  }
  write(extra) {
    this.items.forEach((it, i) => {
      const sc = it.r * (extra ? extra(it, i) : 1);
      this.s.set(sc * (it.sx || 1), sc * (it.sy || 1), sc * (it.sz || 1));
      this.e.set(it.rot.x, it.rot.y, it.rot.z); this.q.setFromEuler(this.e);
      this.m.compose(it.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

function makeItems(list, rnd, z0, spin) {
  return list.map(([x, y, r, z], i) => {
    const zz = z ?? (rnd() - 0.4) * 0.5;
    const home = pxToWorld(x, y, zz);
    return {
      id: i, home, p: home.clone(), v: new THREE.Vector3(), r: wr(r), z: zz,
      ph: rnd() * 6.28, f1: 0.3 + rnd() * 0.5, f2: 0.25 + rnd() * 0.5,
      rot: new THREE.Vector3(rnd() * 6, rnd() * 6, rnd() * 6),
      spin: spin ? new THREE.Vector3((rnd() - 0.5) * 0.9, (rnd() - 0.5) * 0.9, (rnd() - 0.5) * 0.9) : null,
    };
  });
}

export class Floaters {
  constructor(envUniforms) {
    const rnd = mulberry32(99);
    const spray = (n, rmin, rmax) => Array.from({ length: n }, () => {
      const a = rnd() * Math.PI * 2, rad = Math.sqrt(rnd());
      return [1130 + Math.cos(a) * rad * 620, 380 + Math.sin(a) * rad * 330, rmin + rnd() * (rmax - rmin)];
    });
    this.group = new THREE.Group();

    // хромовые капли
    const beadItems = makeItems([...BEADS, ...spray(6, 3, 6)], rnd, 0, false);
    const beadMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 40, 24), new THREE.ShaderMaterial({
      uniforms: { ...envUniforms }, vertexShader: chromeVert, fragmentShader: chromeFrag }), beadItems.length);
    beadMesh.frustumCulled = false; beadMesh.renderOrder = 2;
    this.beads = new Field(beadMesh, beadItems, { k: 3.2, c: 1.5 });

    // стеклянные пузыри + 3 оболочки вокруг больших шаров
    const bubItems = makeItems([...BUBBLES, ...spray(22, 3, 7)], rnd, 0, false);
    this.shellCount = 3;
    const bubGeo = new THREE.SphereGeometry(1, 40, 24);
    const opa = new Float32Array(bubItems.length + 3);
    for (let i = 0; i < opa.length; i++) opa[i] = i < 3 ? 0.0 : 0.42;
    bubGeo.setAttribute('aOpa', new THREE.InstancedBufferAttribute(opa, 1));
    this.bubUniforms = { uAspect: { value: 16 / 9 } };
    const bubMesh = new THREE.InstancedMesh(bubGeo, new THREE.ShaderMaterial({
      uniforms: { ...envUniforms, ...this.bubUniforms }, vertexShader: bubbleVert, fragmentShader: bubbleFrag,
      transparent: true, depthWrite: false }), bubItems.length + 3);
    bubMesh.frustumCulled = false; bubMesh.renderOrder = 30;
    // первые 3 — оболочки (переносим физику шаров в update), остальные — свободные пузыри
    const shellItems = [0, 1, 2].map(() => ({ p: new THREE.Vector3(), r: 1, rot: new THREE.Vector3(), fixed: true, id: 0 }));
    this.bubbles = new Field(bubMesh, [...shellItems, ...bubItems], { k: 2.6, c: 1.4 });

    // осколки стекла
    const shItems = makeItems([...SHARDS, ...spray(18, 4, 9)], rnd, 0, true);
    shItems.forEach((s, i) => { s.sx = 1.6 + rnd() * 0.9; s.sy = 0.5 + rnd() * 0.5; s.sz = 0.18 + rnd() * 0.25; });
    const shMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.ShaderMaterial({
      uniforms: { ...envUniforms }, vertexShader: shardVert, fragmentShader: shardFrag,
      transparent: true, depthWrite: false, side: THREE.DoubleSide }), shItems.length);
    shMesh.frustumCulled = false; shMesh.renderOrder = 31;
    this.shards = new Field(shMesh, shItems, { k: 2.2, c: 1.2 });

    this.group.add(beadMesh, bubMesh, shMesh);
    this.beads.write(); this.shards.write();
  }

  setAspect(a) { this.bubUniforms.uAspect.value = a; }

  update(dt, t, input, mercury) {
    this.beads.step(dt, t, input);
    this.shards.step(dt, t, input);
    // оболочки следуют за шарами ртути
    const sh = this.bubbles.items;
    mercury.spheres.forEach((s, i) => { sh[i].p.copy(s.pos); sh[i].r = s.r * (i === 2 ? 1.1 : 1.075); });
    this.bubbles.step(dt, t, input);
    this.beads.write(); this.shards.write(); this.bubbles.write();
  }
}
