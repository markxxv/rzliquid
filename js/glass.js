import * as THREE from 'three';
import { wx, wy, wr, D0 } from './config.js';
import { ENV_GLSL } from './shaders.js';

/* Листы стекла (полигоны в px референса). Все лежат позади ртути.
   bevels: [индекс_вершины, ширина_px, яркость 0..1] — грань poly[i] -> poly[i+1] */
const PANES = [
  { name: 'top', z: -0.30, rot: [0.10, -0.12, 0.0], base: '#cfe0de', alpha: 0.82, env: 0.10, grad: -0.10,
    poly: [[1030, -90], [1040, 0], [1250, 182], [1292, 122], [1392, 88], [1470, 72], [1552, 28], [1610, -90]],
    bevels: [[1, 6, 1.0], [2, 4, 0.8], [3, 4, 0.8], [4, 4, 0.7], [5, 4, 0.7]] },
  { name: 'wedge', z: -0.28, rot: [-0.08, 0.14, 0.02], base: '#8ea3a2', alpha: 0.34, env: 0.22, grad: 0.35,
    poly: [[400, 245], [540, 92], [562, 160], [600, 262], [640, 335], [700, 420], [790, 480], [900, 525], [945, 538], [870, 572], [700, 592], [620, 592]],
    bevels: [[11, 7, 1.0], [0, 5, 0.8], [4, 4, 0.9], [5, 4, 0.9], [6, 4, 0.9], [7, 4, 0.9]] },
  { name: 'right', z: -0.26, rot: [0.05, -0.08, 0.0], base: '#d3e3e1', alpha: 0.80, env: 0.08, grad: -0.08,
    poly: [[1000, 700], [1190, 470], [1485, 445], [1650, 875], [970, 1045], [965, 800]],
    bevels: [[3, 10, 0.35], [4, 14, 0.30], [2, 3, 0.5]] },
  { name: 'bl', z: -0.22, rot: [0.02, 0.10, 0.0], base: '#b9cdcc', alpha: 0.40, env: 0.12, grad: 0.1, fade: [0.05, 0.5],
    poly: [[115, 1055], [272, 905], [480, 855], [800, 760], [880, 900], [830, 1170], [190, 1170]],
    bevels: [[0, 7, 0.9], [6, 6, 0.9]] },
];

const paneVert = /* glsl */ `
varying vec3 vW; varying vec3 vN; varying float vY; varying float vX;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0)); vY = position.y; vX = position.x;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const paneFrag = /* glsl */ `
varying vec3 vW; varying vec3 vN; varying float vY; varying float vX;
uniform vec3 uBase; uniform float uAlpha, uEnvAmt, uGrad; uniform vec2 uFade;
${ENV_GLSL}
void main() {
  vec3 V = normalize(cameraPosition - vW);
  vec3 N = normalize(vN); if (dot(N, V) < 0.0) N = -N;
  vec3 e = envSample(reflect(-V, N), 3.0);
  float fr = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 c = uBase * (1.0 + uGrad * vY * 1.2) + e * uEnvAmt;
  float fade = 1.0 - smoothstep(uFade.x, uFade.y, vX);
  gl_FragColor = vec4(c, clamp(uAlpha + fr * 0.3, 0.0, 1.0) * fade);
  #include <colorspace_fragment>
}`;

const edgeVert = /* glsl */ `
varying vec3 vW; varying vec3 vN; varying vec2 vUv;
attribute vec2 aUv;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0)); vUv = aUv;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const edgeFrag = /* glsl */ `
varying vec3 vW; varying vec3 vN; varying vec2 vUv;
uniform vec3 uOuter, uInner; uniform float uLit;
${ENV_GLSL}
void main() {
  vec3 V = normalize(cameraPosition - vW);
  vec3 N = normalize(vN); if (dot(N, V) < 0.0) N = -N;
  vec3 e = envSample(reflect(-V, N), 1.5);
  float l = clamp(dot(e, vec3(0.3333)) * 0.55 + uLit, 0.0, 1.0);
  vec3 c = mix(uOuter, uInner, smoothstep(0.0, 1.0, vUv.y));
  c *= (0.55 + 0.95 * l);
  c += vec3(0.55, 0.78, 0.72) * smoothstep(0.22, 0.0, vUv.y) * (0.35 + 0.65 * l);
  float a = mix(0.97, 0.30, smoothstep(0.25, 1.0, vUv.y));
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;

const sRGB = (hex) => new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);

export class GlassPanes {
  constructor(envUniforms) {
    this.group = new THREE.Group();
    this.panes = [];
    PANES.forEach((def, idx) => {
      const s = (D0 - def.z) / D0;
      const pts = def.poly.map(([x, y]) => new THREE.Vector2(wx(x), wy(y)));
      const c = pts.reduce((a, p) => a.add(p), new THREE.Vector2()).multiplyScalar(1 / pts.length);
      const loc = pts.map((p) => p.clone().sub(c));
      const g = new THREE.Group();
      g.position.set(c.x * s, c.y * s, def.z);
      g.scale.set(s, s, 1);
      g.rotation.set(...def.rot);
      g.userData.base = def.rot;
      g.userData.ph = idx * 1.9;

      const face = new THREE.Mesh(
        new THREE.ShapeGeometry(new THREE.Shape(loc)),
        new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, side: THREE.DoubleSide,
          uniforms: { ...envUniforms, uBase: { value: sRGB(def.base) }, uAlpha: { value: def.alpha }, uEnvAmt: { value: def.env }, uGrad: { value: def.grad }, uFade: { value: new THREE.Vector2(...(def.fade || [9, 10])) } },
          vertexShader: paneVert, fragmentShader: paneFrag,
        }));
      face.renderOrder = 10 + idx * 2;
      g.add(face);

      // ориентация полигона -> внутренняя нормаль рёбер
      let area = 0;
      for (let i = 0; i < loc.length; i++) { const a = loc[i], b = loc[(i + 1) % loc.length]; area += a.x * b.y - b.x * a.y; }
      const sign = area > 0 ? 1 : -1;
      for (const [i, wpx, lit] of def.bevels) {
        const a = loc[i], b = loc[(i + 1) % loc.length];
        const dir = b.clone().sub(a).normalize();
        const inn = new THREE.Vector2(-dir.y, dir.x).multiplyScalar(sign);
        const w = wr(wpx);
        const a2 = a.clone().addScaledVector(inn, w), b2 = b.clone().addScaledVector(inn, w);
        const pos = new Float32Array([a.x, a.y, 0.002, b.x, b.y, 0.002, b2.x, b2.y, 0.002, a2.x, a2.y, 0.002]);
        const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('aUv', new THREE.BufferAttribute(uv, 2));
        geo.setIndex([0, 1, 2, 0, 2, 3]);
        const dark = lit < 0.5;
        const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, side: THREE.DoubleSide,
          uniforms: {
            ...envUniforms,
            uOuter: { value: sRGB(dark ? '#2f9c8c' : '#a9efdc') },
            uInner: { value: sRGB(dark ? '#0f5f58' : '#4aa596') },
            uLit: { value: dark ? 0.32 : 0.55 },
          },
          vertexShader: edgeVert, fragmentShader: edgeFrag,
        }));
        m.renderOrder = 11 + idx * 2;
        g.add(m);
      }
      this.group.add(g);
      this.panes.push(g);
    });
  }

  update(t, input) {
    for (const g of this.panes) {
      const b = g.userData.base, ph = g.userData.ph;
      g.rotation.x = b[0] + Math.sin(t * 0.23 + ph) * 0.03 + input.parallax.y * 0.07;
      g.rotation.y = b[1] + Math.cos(t * 0.19 + ph) * 0.03 - input.parallax.x * 0.09;
    }
  }
}
