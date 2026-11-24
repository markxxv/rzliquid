import * as THREE from 'three';
import { pxToWorld, wr, mulberry32, REDUCED_MOTION } from './config.js';
import { ENV_GLSL } from './shaders.js';

/* ───────────── описание нитей (px референса) ───────────── */
const rnd = mulberry32(31);

function fan(pts, n, spread, w, opt = {}) {
  const out = [];
  const L = pts.length;
  for (let k = 0; k < n; k++) {
    const off = (k - (n - 1) / 2) * spread + (rnd() - 0.5) * spread * 0.4;
    const q = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(L - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const m = Math.hypot(tx, ty) || 1; tx /= m; ty /= m;
      const f = 0.55 + 0.45 * (i / (L - 1)) + (rnd() - 0.5) * 0.25;
      return [p[0] - ty * off * f + (rnd() - 0.5) * 9, p[1] + tx * off * f + (rnd() - 0.5) * 9];
    });
    out.push({ pts: q, w: w * (0.85 + rnd() * 0.35), ...opt });
  }
  return out;
}

const STRANDS = [
  ...fan([[610, 598], [500, 470], [400, 330], [310, 190], [250, 90], [205, -30]], 4, 16, 4.2, { zr: -0.06, zt: 0.12, soft: 1 }),
  ...fan([[640, 590], [610, 430], [575, 290], [550, 150], [530, -20]], 3, 9, 4.0, { zr: -0.06, zt: 0.1, soft: 1 }),
  ...fan([[1000, 560], [1100, 500], [1210, 420], [1330, 300], [1480, 170], [1640, 50], [1780, -40]], 6, 17, 4.5, { zr: -0.05, zt: 0.14, soft: 1.1 }),
  ...fan([[1040, 590], [1150, 560], [1260, 500], [1390, 440], [1530, 400], [1690, 400]], 3, 16, 3.6, { zr: -0.03, zt: 0.12, soft: 1.2 }),
  ...fan([[1000, 600], [1090, 470], [1170, 330], [1215, 200]], 3, 14, 3.6, { zr: -0.03, zt: 0.1, soft: 1.0 }),
  ...fan([[1170, 560], [1300, 600], [1420, 560], [1500, 480]], 3, 11, 3.4, { zr: 0.0, zt: 0.14, soft: 1.2 }),
  ...fan([[1230, 470], [1330, 445], [1450, 430], [1580, 440], [1670, 445]], 3, 14, 3.0, { zr: 0.0, zt: 0.1, soft: 1.3 }),
  ...fan([[1180, 420], [1300, 360], [1400, 330], [1510, 300]], 2, 14, 3.0, { zr: 0.0, zt: 0.12, soft: 1.3 }),
  ...fan([[1140, 520], [1115, 600], [1120, 690], [1160, 750]], 3, 10, 4.0, { zr: 0.05, zt: 0.16, soft: 0.8 }),
  ...fan([[1010, 470], [1080, 525], [1170, 525], [1235, 470]], 3, 9, 3.6, { zr: 0.06, zt: 0.16, soft: 0.8 }),
  ...fan([[1030, -20], [1045, 100], [1070, 200], [1085, 280]], 2, 8, 4.0, { zr: 0.05, zt: 0.1, soft: 0.8 }),
  { pts: [[690, 720], [715, 800], [722, 890], [700, 1000], [650, 1120], [640, 1180]], w: 3.6, zr: 0.02, zt: 0.1, soft: 1 },
  { pts: [[600, 815], [540, 900], [500, 990], [498, 1090], [505, 1180]], w: 3.6, zr: 0.02, zt: 0.1, soft: 1 },
  { pts: [[470, 858], [472, 940], [420, 1000], [335, 1045], [345, 1110], [360, 1180]], w: 3.0, zr: 0.02, zt: 0.08, soft: 1 },
  { pts: [[760, 700], [800, 780], [780, 860], [740, 960], [690, 1080], [680, 1180]], w: 3.0, zr: 0.02, zt: 0.1, soft: 1 },
  { pts: [[880, 700], [860, 800], [820, 880], [790, 950], [770, 1010]], w: 3.0, zr: 0.02, zt: 0.1, soft: 1.1 },
  { pts: [[1240, 780], [1350, 812], [1450, 850], [1540, 900]], w: 2.6, zr: -0.2, zt: -0.2, soft: 1.2 },
  { pts: [[420, 610], [520, 560], [640, 545], [760, 575]], w: 3.2, zr: 0.14, zt: 0.14, soft: 0.8 },
  { pts: [[560, 645], [700, 590], [830, 600]], w: 2.8, zr: 0.12, zt: 0.12, soft: 0.8 },
  ...fan([[1000, 980], [1020, 1060], [1050, 1170]], 8, 10, 2.4, { zr: -0.12, zt: -0.1, soft: 1.4, fiber: true }),
  ...fan([[1090, 960], [1110, 1050], [1090, 1170]], 5, 10, 2.4, { zr: -0.12, zt: -0.1, soft: 1.4, fiber: true }),
];

const M = 26;            // узлов на нить
const RADIAL = 5;        // вершин поперёк ленты

const vert = /* glsl */ `
attribute vec3 aNormal;
varying vec3 vW; varying vec3 vN;
void main() {
  vW = position; vN = aNormal;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;
const frag = /* glsl */ `
varying vec3 vW; varying vec3 vN;
uniform vec3 uTint; uniform float uAlpha;
${ENV_GLSL}
void main() {
  vec3 V = normalize(cameraPosition - vW);
  vec3 N = normalize(vN); if (dot(N, V) < 0.0) N = -N;
  vec3 col = envSample(reflect(-V, N), 0.35) * uTint;
  // ключевой блик вдоль проволоки — делает её «литой» хромированной трубкой
  vec3 H = normalize(normalize(vec3(-0.45, 0.75, 0.5)) + V);
  col += vec3(0.95, 1.0, 1.0) * pow(max(dot(N, H), 0.0), 40.0) * 0.9;
  col = max(col, vec3(0.035));
  gl_FragColor = vec4(col, uAlpha);
  #include <colorspace_fragment>
}`;

class Group {
  constructor(strands, envUniforms, tint, alpha) {
    this.strands = strands;
    this.n = strands.length;
    const total = this.n * M;
    this.pos = new Float32Array(total * 3);
    this.vel = new Float32Array(total * 3);
    this.home = new Float32Array(total * 3);
    this.rest = new Float32Array(this.n * (M - 1));
    this.vpos = new Float32Array(total * RADIAL * 3);
    this.vnor = new Float32Array(total * RADIAL * 3);
    this.half = strands.map((s) => wr(s.w * 2.2) / 2);

    strands.forEach((s, si) => {
      const curve = new THREE.CatmullRomCurve3(
        s.pts.map((p, i) => pxToWorld(p[0], p[1], THREE.MathUtils.lerp(s.zr, s.zt, i / (s.pts.length - 1)))), false, 'centripetal');
      const pts = curve.getSpacedPoints(M - 1);
      pts.forEach((p, i) => {
        const o = (si * M + i) * 3;
        this.pos[o] = this.home[o] = p.x; this.pos[o + 1] = this.home[o + 1] = p.y; this.pos[o + 2] = this.home[o + 2] = p.z;
        if (i > 0) this.rest[si * (M - 1) + i - 1] = p.distanceTo(pts[i - 1]);
      });
    });

    const idx = [];
    for (let si = 0; si < this.n; si++) for (let i = 0; i < M - 1; i++) for (let j = 0; j < RADIAL - 1; j++) {
      const a = (si * M + i) * RADIAL + j, b = (si * M + i + 1) * RADIAL + j;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.vpos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aNormal', new THREE.BufferAttribute(this.vnor, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { ...envUniforms, uTint: { value: tint }, uAlpha: { value: alpha } },
      vertexShader: vert, fragmentShader: frag, side: THREE.DoubleSide,
      transparent: alpha < 1, depthWrite: alpha >= 1,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = alpha < 1 ? -5 : 1;
    this.build();
  }

  step(dt, t, input) {
    const { pos, vel, home, strands } = this;
    const m = input.world, mv = input.vel, infl = input.influence;
    const idle = REDUCED_MOTION ? 0.3 : 1;
    for (let si = 0; si < this.n; si++) {
      const st = strands[si];
      const ph = si * 1.37;
      for (let i = 1; i < M; i++) {
        const o = (si * M + i) * 3, s = i / (M - 1);
        const k = (150 / st.soft) * (1 - s) + (7 / st.soft) * s + 2;
        let ax = (home[o] - pos[o]) * k - vel[o] * 2.4;
        let ay = (home[o + 1] - pos[o + 1]) * k - vel[o + 1] * 2.4;
        let az = (home[o + 2] - pos[o + 2]) * k - vel[o + 2] * 2.4;
        // изгибная жёсткость
        const p0 = o - 3, p1 = i < M - 1 ? o + 3 : o;
        ax += ((pos[p0] + pos[p1]) * 0.5 - pos[o]) * 55;
        ay += ((pos[p0 + 1] + pos[p1 + 1]) * 0.5 - pos[o + 1]) * 55;
        // медленный «дрейф в невесомости»
        const a = 0.22 * idle * s;
        ax += Math.sin(t * 0.8 + ph + i * 0.35) * a * 0.9;
        ay += Math.cos(t * 0.67 + ph * 1.3 + i * 0.3) * a * 0.9;
        az += Math.sin(t * 0.5 + ph + i * 0.2) * a * 0.3;
        if (infl > 0.01) {
          const rx = pos[o] - m.x, ry = pos[o + 1] - m.y;
          const d2 = rx * rx + ry * ry, d = Math.sqrt(d2) + 1e-4;
          const fo = Math.exp(-d2 / (2 * 0.2 * 0.2)) * infl;
          ax += (rx / d) * 34 * fo + (mv.x * 0.7 - vel[o]) * 4 * fo;
          ay += (ry / d) * 34 * fo + (mv.y * 0.7 - vel[o + 1]) * 4 * fo;
        }
        vel[o] += ax * dt; vel[o + 1] += ay * dt; vel[o + 2] += az * dt;
      }
      for (let i = 1; i < M; i++) {
        const o = (si * M + i) * 3;
        pos[o] += vel[o] * dt; pos[o + 1] += vel[o + 1] * dt; pos[o + 2] += vel[o + 2] * dt;
      }
      // длина нити сохраняется
      for (let it = 0; it < 2; it++) for (let i = 1; i < M; i++) {
        const o = (si * M + i) * 3, q = o - 3, L = this.rest[si * (M - 1) + i - 1];
        let dx = pos[o] - pos[q], dy = pos[o + 1] - pos[q + 1], dz = pos[o + 2] - pos[q + 2];
        const d = Math.hypot(dx, dy, dz) + 1e-9, diff = (d - L) / d;
        const wq = i === 1 ? 0 : 0.5, wo = i === 1 ? 1 : 0.5;
        pos[o] -= dx * diff * wo; pos[o + 1] -= dy * diff * wo; pos[o + 2] -= dz * diff * wo;
        pos[q] += dx * diff * wq; pos[q + 1] += dy * diff * wq; pos[q + 2] += dz * diff * wq;
      }
    }
  }

  build() {
    const { pos, vpos, vnor } = this;
    for (let si = 0; si < this.n; si++) {
      const hw = this.half[si];
      for (let i = 0; i < M; i++) {
        const o = (si * M + i) * 3;
        const a = (si * M + Math.max(0, i - 1)) * 3, b = (si * M + Math.min(M - 1, i + 1)) * 3;
        let tx = pos[b] - pos[a], ty = pos[b + 1] - pos[a + 1];
        const m = Math.hypot(tx, ty) || 1; tx /= m; ty /= m;
        const sx = -ty, sy = tx;
        const taper = 0.55 + 0.45 * Math.min(1, (M - 1 - i) / 3 + 0.3) * Math.min(1, i / 2 + 0.4);
        for (let j = 0; j < RADIAL; j++) {
          const u = (j / (RADIAL - 1)) * 2 - 1;
          const v = (si * M + i) * RADIAL + j, w = v * 3;
          vpos[w] = pos[o] + sx * u * hw * taper;
          vpos[w + 1] = pos[o + 1] + sy * u * hw * taper;
          vpos[w + 2] = pos[o + 2];
          const nz = Math.sqrt(Math.max(0, 1 - u * u));
          vnor[w] = sx * u; vnor[w + 1] = sy * u; vnor[w + 2] = nz;
        }
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aNormal.needsUpdate = true;
  }
}

export class Wires {
  constructor(envUniforms) {
    this.cables = new Group(STRANDS.filter((s) => !s.fiber), envUniforms, new THREE.Vector3(0.93, 0.95, 0.97), 1);
    this.fibers = new Group(STRANDS.filter((s) => s.fiber), envUniforms, new THREE.Vector3(0.78, 0.92, 0.9), 0.5);
    this.group = new THREE.Group();
    this.group.add(this.cables.mesh, this.fibers.mesh);
    this.acc = 0;
  }
  update(dt, t, input) {
    this.acc += dt;
    const h = 1 / 90; let n = 0;
    while (this.acc >= h && n < 6) { this.cables.step(h, t, input); this.fibers.step(h, t, input); this.acc -= h; n++; }
    if (n === 6) this.acc = 0;
    this.cables.build(); this.fibers.build();
  }
}
