import * as THREE from 'three';
import { wx, wy, wr, REDUCED_MOTION, mulberry32 } from './config.js';
import { ENV_GLSL } from './shaders.js';

/* ───────────────────────── геометрия «капли» (px референса) ───────────────────────── */
// [x, y, r, жёсткость]
const NODES = [
  // крыло
  [292, 872, 8, 0.35], [340, 845, 22, 0.5], [410, 800, 50, 0.6], [500, 745, 88, 0.8],
  [600, 690, 106, 1.0], [700, 665, 86, 0.9], [780, 650, 54, 0.8],
  // центральное тело
  [880, 640, 56, 1.2], [980, 610, 78, 1.2], [1060, 670, 88, 1.2], [1050, 770, 78, 1.2],
  // капля вниз
  [1075, 850, 66, 1.0], [1110, 940, 60, 0.8], [1150, 1015, 62, 0.6], [1190, 1062, 56, 0.5],
  // «рог» вверх-вправо
  [1030, 545, 42, 0.7], [1110, 505, 30, 0.5], [1180, 478, 18, 0.35],
  // нижняя «губа» крыла
  [352, 862, 15, 0.4], [450, 832, 34, 0.6], [560, 792, 54, 0.8], [665, 752, 52, 0.8],
  // «ухо» и гребень на центральном теле
  [880, 592, 38, 0.8], [952, 552, 46, 0.8],
  // выпуклость справа (к нижнему шару)
  [1135, 705, 52, 0.8],
];
const SEGS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10],
  [10, 11], [11, 12], [12, 13], [13, 14], [8, 15], [15, 16], [16, 17],
  [1, 18], [18, 19], [19, 20], [20, 21], [21, 7],
  [7, 22], [22, 23], [23, 15], [9, 24], [24, 10],
];
// большие шары [x, y, r, z]
const SPHERES = [[1097, 358, 132, 0.02], [1462, 318, 95, -0.08], [1277, 645, 128, 0.06]];
const NB = 12;

const vert = /* glsl */ `
varying vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const frag = /* glsl */ `
precision highp float;
varying vec2 vNdc;
uniform vec4 uN[${NODES.length}];
uniform vec4 uC[${SEGS.length}];
uniform vec4 uS[3];
uniform vec4 uB[${NB}];
uniform float uFlat, uK, uKS, uKB, uTime, uBounce, uPix, uRipple, uWarp, uBand, uSteps;
uniform vec2 uMouse;
uniform mat4 uInvViewProj, uViewProj;
uniform vec3 uBoxMin, uBoxMax;
${ENV_GLSL}

const int NSEG = ${SEGS.length};
const ivec2 SEG[${SEGS.length}] = ivec2[${SEGS.length}](${SEGS.map(([a, b]) => `ivec2(${a},${b})`).join(',')});

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * h * k * (1.0 / 6.0);
}
float dot2(vec3 v) { return dot(v, v); }
float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 ba = b - a; float l2 = dot(ba, ba); float rr = r1 - r2;
  float a2 = l2 - rr * rr;
  if (a2 < 1e-6) return min(length(p - a) - r1, length(p - b) - r2);
  float il2 = 1.0 / l2;
  vec3 pa = p - a; float y = dot(pa, ba); float z = y - l2;
  float x2 = dot2(pa * l2 - ba * y);
  float y2 = y * y * l2; float z2 = z * z * l2;
  float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

float map(vec3 p) {
  vec3 q = vec3(p.xy, p.z * uFlat);

  // сферы и капли — дёшево, считаем точно
  float dO = 1e3;
  for (int i = 0; i < 3; i++) dO = smin(dO, length(p - uS[i].xyz) - uS[i].w, uKS);
  for (int i = 0; i < ${NB}; i++) { if (uB[i].w > 0.001) dO = smin(dO, length(p - uB[i].xyz) - uB[i].w, uKB); }

  // стадия 1: нижние оценки по ограничивающим сферам звеньев
  float lb[NSEG];
  float lbMin = 1e3;
  for (int i = 0; i < NSEG; i++) {
    float l = length(q - uC[i].xyz) - uC[i].w;
    lb[i] = l; lbMin = min(lbMin, l);
  }
  float dBody = lbMin / uFlat;
  float dd;
  if (dBody > min(dO, 1e3) + uK + 0.03) {
    dd = min(dBody, dO) - 0.01;            // тело далеко: достаточно оценки
  } else {
    float d = 1e3;
    for (int i = 0; i < NSEG; i++) {
      if (lb[i] < d + uK) {
        ivec2 s = SEG[i];
        vec4 A = uN[s.x]; vec4 B = uN[s.y];
        d = smin(d, sdRoundCone(q, vec3(A.xy, 0.0), vec3(B.xy, 0.0), A.w, B.w), uK);
      }
    }
    dd = smin(d / uFlat, dO, uKS);
  }
  // круги на ртути вокруг курсора
  float rr = length(p.xy - uMouse);
  dd += uRipple * 0.0045 * sin(58.0 * rr - uTime * 15.0) * exp(-6.5 * rr);
  return dd;
}

vec3 calcNormal(vec3 p) {
  const vec2 e = vec2(1.0, -1.0) * 0.0007;
  return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}

vec3 chromeTint = vec3(0.965, 0.978, 1.0);

// Волны, идущие вдоль контура капли: полосы отражений повторяют форму (как у настоящей жидкой ртути)
vec3 bandNormal(vec3 n, vec3 p) {
  float best = 1e3; vec2 dir = vec2(0.0); float uu = 0.0, hh = 0.0;
  for (int i = 0; i < NSEG; i++) {
    ivec2 s = SEG[i]; vec4 A = uN[s.x]; vec4 B = uN[s.y];
    vec2 pa = p.xy - A.xy, ba = B.xy - A.xy;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    vec2 v = pa - ba * h; float L = length(v); float r = mix(A.w, B.w, h);
    float sd = L - r;
    if (sd < best) { best = sd; dir = v / max(L, 1e-5); uu = clamp(L / r, 0.0, 1.2); hh = float(i) + h; }
  }
  float sph = 1e3;
  for (int i = 0; i < 3; i++) sph = min(sph, length(p - uS[i].xyz) - uS[i].w);
  float w = smoothstep(0.02, -0.02, best) * smoothstep(-0.01, 0.03, sph - best);
  float ph = uTime * 0.33 + hh * 0.9;
  float wave = sin(uu * 6.2 + ph) * (0.55 + 0.45 * sin(hh * 1.7 + uTime * 0.2));
  return normalize(n + vec3(dir * wave * uBand * w, 0.0));
}

// Медленно текущая «рябь» нормали — даёт характерные чёрно-белые волны жидкого хрома
vec3 flowNormal(vec3 n, vec3 p, float t) {
  float a = sin(p.x * 4.3 + 1.7 * sin(p.y * 3.1 + t * 0.31) + t * 0.23);
  float b = sin(p.y * 5.1 + 1.4 * sin(p.x * 2.7 - t * 0.27) - t * 0.19);
  float c = sin((p.x + p.y) * 7.0 + 2.0 * a - t * 0.4);
  float d = sin((p.x - p.y) * 11.0 + 1.6 * b + t * 0.33);
  vec2 g = vec2(a * 0.55 + c * 0.30 + d * 0.12, b * 0.55 - c * 0.30 - d * 0.12);
  return normalize(n + vec3(g, 0.0) * uWarp);
}

void main() {
  vec4 f = uInvViewProj * vec4(vNdc, 1.0, 1.0); f.xyz /= f.w;
  vec3 ro = cameraPosition; vec3 rd = normalize(f.xyz - ro);

  vec3 inv = 1.0 / rd;
  vec3 t0 = (uBoxMin - ro) * inv, t1 = (uBoxMax - ro) * inv;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  float tN = max(max(tmin.x, tmin.y), tmin.z);
  float tF = min(min(tmax.x, tmax.y), tmax.z);
  if (tF < max(tN, 0.0)) discard;

  float t = max(tN, 0.0);
  float minR = 1e5, tMin = t; bool hit = false;
  for (int i = 0; i < 90; i++) {
    if (float(i) > uSteps) break;
    float d = map(ro + rd * t);
    float pw = uPix * t;
    float ratio = d / pw;
    if (ratio < minR) { minR = ratio; tMin = t; }
    if (d < 0.0004) { hit = true; break; }
    t += d * 0.85;
    if (t > tF) break;
  }
  float cov = hit ? 1.0 : 1.0 - smoothstep(0.0, 1.0, minR);
  if (cov < 0.02) discard;

  float ts = hit ? t : tMin;
  vec3 pos = ro + rd * ts;
  vec3 n = flowNormal(bandNormal(calcNormal(pos), pos), pos, uTime);
  vec3 r = reflect(rd, n);
  vec3 col = envSample(r, 0.0);

  if (uBounce > 0.5) {
    vec3 po = pos + n * 0.003; float t2 = 0.0; bool h2 = false;
    for (int j = 0; j < 30; j++) {
      float d = map(po + r * t2);
      if (d < 0.0006) { h2 = true; break; }
      t2 += d * 0.9 + 0.0008;
      if (t2 > 1.8) break;
    }
    if (h2) {
      vec3 p2 = po + r * t2; vec3 n2 = calcNormal(p2);
      col = envSample(reflect(r, n2), 0.0) * 0.80;
    }
  }
  float ndv = max(dot(n, -rd), 0.0);
  col *= chromeTint * (0.90 + 0.10 * pow(1.0 - ndv, 3.0));

  gl_FragColor = vec4(col, cov);
  vec4 clip = uViewProj * vec4(pos, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  #include <colorspace_fragment>
}
`;

export class Mercury {
  constructor(envUniforms) {
    this.rand = mulberry32(7);
    this.nodes = NODES.map(([x, y, r, k], i) => ({
      home: new THREE.Vector2(wx(x), wy(y)),
      pos: new THREE.Vector2(wx(x), wy(y)),
      vel: new THREE.Vector2(),
      r0: wr(r), r: wr(r), k, e: 0, ph: i * 1.7,
    }));
    this.links = SEGS.map(([a, b]) => ({ a, b, L: this.nodes[a].home.distanceTo(this.nodes[b].home) }));
    this.spheres = SPHERES.map(([x, y, r, z], i) => ({
      home: new THREE.Vector3(wx(x), wy(y), z),
      pos: new THREE.Vector3(wx(x), wy(y), z),
      vel: new THREE.Vector3(), r: wr(r), ph: i * 2.3,
    }));
    this.beads = Array.from({ length: NB }, () => ({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0, age: 0 }));
    this.spawnCd = 0;
    this.acc = 0;

    this.uniforms = {
      ...envUniforms,
      uN: { value: this.nodes.map(() => new THREE.Vector4()) },
      uC: { value: this.links.map(() => new THREE.Vector4()) },
      uS: { value: this.spheres.map(() => new THREE.Vector4()) },
      uB: { value: this.beads.map(() => new THREE.Vector4()) },
      uFlat: { value: 1.75 }, uK: { value: 0.075 }, uKS: { value: 0.05 }, uKB: { value: 0.042 },
      uTime: { value: 0 }, uBounce: { value: 1 }, uWarp: { value: 0.2 }, uSteps: { value: 72 }, uBand: { value: 0.30 }, uPix: { value: 0.001 }, uRipple: { value: 0 },
      uMouse: { value: new THREE.Vector2(99, 99) },
      uInvViewProj: { value: new THREE.Matrix4() }, uViewProj: { value: new THREE.Matrix4() },
      uBoxMin: { value: new THREE.Vector3() }, uBoxMax: { value: new THREE.Vector3() },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
      alphaToCoverage: true,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    this._m = new THREE.Matrix4();
    this._ripple = 0;
  }

  /* ───────────────────────── физика ───────────────────────── */
  _step(dt, t, input) {
    const idleAmp = REDUCED_MOTION ? 0.3 : 1;
    const m = input.world, mv = input.vel, infl = input.influence;
    const N = this.nodes;

    for (let i = 0; i < N.length; i++) {
      const n = N[i];
      const sway = 0.006 * idleAmp * (1.4 - n.k * 0.5);
      const hx = n.home.x + Math.sin(t * 0.55 + n.ph) * sway + Math.sin(t * 0.21 + n.ph * 2.1) * sway * 0.7;
      const hy = n.home.y + Math.cos(t * 0.47 + n.ph * 1.3) * sway + Math.cos(t * 0.19 + n.ph) * sway * 0.7;
      const kh = 38 * (0.45 + 0.55 * n.k);
      let ax = (hx - n.pos.x) * kh - n.vel.x * 6.4;
      let ay = (hy - n.pos.y) * kh - n.vel.y * 6.4;

      if (infl > 0.01) {
        const rx = n.pos.x - m.x, ry = n.pos.y - m.y;
        const d2 = rx * rx + ry * ry, d = Math.sqrt(d2) + 1e-4;
        const sg = 0.24 + n.r0 * 1.1;
        const fo = Math.exp(-d2 / (2 * sg * sg)) * infl;
        ax += (rx / d) * 26 * fo + (mv.x * 0.5 - n.vel.x) * 4.5 * fo;
        ay += (ry / d) * 26 * fo + (mv.y * 0.5 - n.vel.y) * 4.5 * fo;
        if (input.down) {
          const sg2 = 0.5, f2 = Math.exp(-d2 / (2 * sg2 * sg2));
          ax -= (rx / d) * 44 * f2; ay -= (ry / d) * 44 * f2;
        }
        n.e = Math.min(1, n.e + fo * (0.4 + input.speed * 0.35) * dt * 2.2);
      }
      n.vel.x += ax * dt; n.vel.y += ay * dt;
    }
    // поверхностное натяжение: звенья держат длину
    for (const l of this.links) {
      const a = N[l.a], b = N[l.b];
      let dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y;
      const d = Math.hypot(dx, dy) + 1e-6; dx /= d; dy /= d;
      const f = (d - l.L) * 95 * dt;
      const wa = b.k / (a.k + b.k), wb = a.k / (a.k + b.k);
      a.vel.x += dx * f * wa; a.vel.y += dy * f * wa;
      b.vel.x -= dx * f * wb; b.vel.y -= dy * f * wb;
    }
    for (const l of this.links) {
      const a = N[l.a], b = N[l.b];
      const dx = ((b.vel.x - a.vel.x)) * 3.0 * dt, dy = ((b.vel.y - a.vel.y)) * 3.0 * dt;
      a.vel.x += dx; a.vel.y += dy; b.vel.x -= dx; b.vel.y -= dy;
    }
    for (const n of N) {
      n.pos.x += n.vel.x * dt; n.pos.y += n.vel.y * dt;
      n.e *= Math.exp(-dt * 2.0);
      n.r = n.r0 * (1 + 0.075 * n.e * Math.sin(t * 17 + n.ph));
    }

    // шары
    for (const s of this.spheres) {
      const sw = 0.011 * idleAmp;
      const hx = s.home.x + Math.sin(t * 0.5 + s.ph) * sw, hy = s.home.y + Math.cos(t * 0.43 + s.ph) * sw;
      let ax = (hx - s.pos.x) * 15 - s.vel.x * 1.9, ay = (hy - s.pos.y) * 15 - s.vel.y * 1.9;
      let az = (s.home.z - s.pos.z) * 12 - s.vel.z * 2;
      if (infl > 0.01) {
        const rx = s.pos.x - m.x, ry = s.pos.y - m.y;
        const d2 = rx * rx + ry * ry, d = Math.sqrt(d2) + 1e-4;
        const sg = 0.28 + s.r * 0.9, fo = Math.exp(-d2 / (2 * sg * sg)) * infl;
        ax += (rx / d) * 30 * fo + (mv.x * 0.4 - s.vel.x) * 3 * fo;
        ay += (ry / d) * 30 * fo + (mv.y * 0.4 - s.vel.y) * 3 * fo;
        if (input.down) {
          const sg2 = 0.55, f2 = Math.exp(-d2 / (2 * sg2 * sg2));
          ax -= (rx / d) * 38 * f2; ay -= (ry / d) * 38 * f2;
        }
      }
      s.vel.x += ax * dt; s.vel.y += ay * dt; s.vel.z += az * dt;
    }
    const S = this.spheres;
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
      const a = S[i], b = S[j];
      const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, d = Math.hypot(dx, dy) + 1e-6;
      const ov = a.r + b.r + 0.03 - d;
      if (ov > 0) { const f = ov * 140 * dt; a.vel.x -= (dx / d) * f; a.vel.y -= (dy / d) * f; b.vel.x += (dx / d) * f; b.vel.y += (dy / d) * f; }
    }
    for (const s of S) s.pos.addScaledVector(s.vel, dt);

    // отрывающиеся капли
    this.spawnCd -= dt;
    if (infl > 0.3 && input.speed > 2.0 && this.spawnCd <= 0) {
      let best = null, bd = 0.32;
      for (const n of N) { const d = Math.hypot(n.pos.x - m.x, n.pos.y - m.y) - n.r; if (d < bd) { bd = d; best = n; } }
      const free = this.beads.find((b) => !b.on);
      if (best && free) {
        const ang = Math.atan2(m.y - best.pos.y, m.x - best.pos.x) + (this.rand() - 0.5) * 1.2;
        free.on = true; free.age = 0; free.r = 0.016 + this.rand() * 0.03;
        free.p.set(best.pos.x + Math.cos(ang) * best.r, best.pos.y + Math.sin(ang) * best.r, (this.rand() - 0.5) * 0.06);
        free.v.set(mv.x * 0.5 + Math.cos(ang) * 0.9, mv.y * 0.5 + Math.sin(ang) * 0.9, (this.rand() - 0.5) * 0.2);
        this.spawnCd = 0.07;
      }
    }
    for (const b of this.beads) {
      if (!b.on) continue;
      b.age += dt;
      b.v.multiplyScalar(Math.exp(-dt * 1.6));
      let best = null, bd = 1e9;
      for (const n of N) { const d = Math.hypot(n.pos.x - b.p.x, n.pos.y - b.p.y); if (d < bd) { bd = d; best = n; } }
      if (best && b.age > 0.45) {
        const dx = best.pos.x - b.p.x, dy = best.pos.y - b.p.y, d = bd + 1e-5;
        b.v.x += (dx / d) * 22 * dt; b.v.y += (dy / d) * 22 * dt;
        if (bd < best.r * 0.8 + b.r) b.r -= dt * 0.22;
      }
      if (infl > 0.01) {
        const rx = b.p.x - m.x, ry = b.p.y - m.y, d = Math.hypot(rx, ry) + 1e-4, fo = Math.exp(-(d * d) / (2 * 0.15 * 0.15)) * infl;
        b.v.x += (rx / d) * 14 * fo * dt; b.v.y += (ry / d) * 14 * fo * dt;
      }
      b.p.addScaledVector(b.v, dt);
      if (b.r <= 0.002 || b.age > 6) { b.on = false; b.r = 0; }
    }
  }

  update(dt, t, input, camera, pixSize, quality) {
    const steps = Math.min(8, Math.max(1, Math.ceil(dt * 120))), h = dt / steps;
    for (let i = 0; i < steps; i++) this._step(h, t + (i - steps + 1) * h, input);

    // ripple
    const target = input.influence > 0.3 ? Math.min(1, input.speed * 0.35) : 0;
    this._ripple += (target - this._ripple) * (1 - Math.exp(-dt * (target > this._ripple ? 14 : 2.2)));

    const u = this.uniforms;
    this.nodes.forEach((n, i) => u.uN.value[i].set(n.pos.x, n.pos.y, 0, n.r));
    this.links.forEach((l, i) => {
      const A = this.nodes[l.a], B = this.nodes[l.b];
      u.uC.value[i].set((A.pos.x + B.pos.x) / 2, (A.pos.y + B.pos.y) / 2, 0,
        Math.hypot(A.pos.x - B.pos.x, A.pos.y - B.pos.y) / 2 + Math.max(A.r, B.r) + 0.004);
    });
    this.spheres.forEach((s, i) => u.uS.value[i].set(s.pos.x, s.pos.y, s.pos.z, s.r));
    this.beads.forEach((b, i) => u.uB.value[i].set(b.p.x, b.p.y, b.p.z, b.on ? b.r : 0));
    u.uTime.value = t; u.uRipple.value = this._ripple;
    u.uMouse.value.set(input.world.x, input.world.y);
    u.uPix.value = pixSize; u.uBounce.value = quality > 1 ? 1 : 0; u.uSteps.value = quality > 0 ? 72 : 48;

    camera.updateMatrixWorld();
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    u.uViewProj.value.copy(this._m);
    u.uInvViewProj.value.copy(this._m).invert();

    // ограничивающий бокс
    let x0 = 9, y0 = 9, x1 = -9, y1 = -9;
    const grow = (x, y, r) => { x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r); };
    for (const n of this.nodes) grow(n.pos.x, n.pos.y, n.r + 0.1);
    for (const s of this.spheres) grow(s.pos.x, s.pos.y, s.r + 0.1);
    for (const b of this.beads) if (b.on) grow(b.p.x, b.p.y, b.r + 0.1);
    u.uBoxMin.value.set(x0, y0, -0.7); u.uBoxMax.value.set(x1, y1, 0.7);
  }
}
