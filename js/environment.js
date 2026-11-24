import * as THREE from 'three';

/**
 * Процедурная фотостудия: чёрный потолок, светлый пол-«циклорама»,
 * большой верхний софтбокс и пара боковых полос. Именно она даёт
 * характерные чёрно-белые отражения хрома как на референсе.
 */
const frag = /* glsl */ `
varying vec3 vDir;
float rbox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float panel(vec2 p, vec2 c, vec2 b, float r, float soft) { return 1.0 - smoothstep(-soft, soft, rbox(p - c, b, r)); }

vec3 studio(vec3 d) {
  float y = d.y;
  // жёсткий горизонт: чёрный «потолок» / светлый пол-циклорама
  // горизонт отражений ~ -0.42: чёрная полоса в середине шара, светлый «пол» ниже
  float floorK = smoothstep(-0.40, -0.445, y);
  vec3 floorCol = mix(vec3(0.66, 0.70, 0.71), vec3(0.95, 0.98, 0.99), smoothstep(-0.45, -0.9, y));
  vec3 col = vec3(0.006, 0.007, 0.008) + floorCol * floorK;

  if (y > 0.2) {                         // верхний софтбокс (жёсткая кромка)
    vec2 uv = d.xz / y;
    col += vec3(1.0) * 7.0 * panel(uv, vec2(-0.05, 0.10), vec2(0.70, 0.62), 0.28, 0.015);
    col += vec3(0.92, 0.98, 1.0) * 4.0 * panel(uv, vec2(0.15, -0.95), vec2(0.9, 0.05), 0.04, 0.012);
    col += vec3(1.0) * 4.0 * panel(uv, vec2(0.95, 0.35), vec2(0.07, 0.55), 0.04, 0.012);
  }
  if (d.x < -0.2) {                      // левые полосы
    vec2 uv = vec2(d.z, d.y) / (-d.x);
    col += vec3(1.0) * 5.0 * panel(uv, vec2(0.05, 0.25), vec2(0.09, 0.9), 0.05, 0.012);
    col += vec3(1.0) * 3.0 * panel(uv, vec2(-0.75, 0.2), vec2(0.05, 0.7), 0.03, 0.012);
  }
  if (d.x > 0.2) {                       // правые полосы
    vec2 uv = vec2(-d.z, d.y) / d.x;
    col += vec3(0.95, 1.0, 1.0) * 4.0 * panel(uv, vec2(0.0, 0.2), vec2(0.06, 0.7), 0.04, 0.012);
    col += vec3(1.0) * 2.5 * panel(uv, vec2(0.8, 0.3), vec2(0.04, 0.5), 0.03, 0.012);
  }
  if (d.z < -0.2) {                      // стена позади — тонкие светлые ободки
    vec2 uv = vec2(d.x, d.y) / (-d.z);
    col += vec3(0.85, 0.93, 0.93) * 1.2 * panel(uv, vec2(0.0, 0.3), vec2(1.1, 0.30), 0.25, 0.25);
  }
  if (d.z > 0.3) {                       // за камерой: широкий «белый экран» сверху-слева
    vec2 uv = vec2(d.x, d.y) / d.z;
    col += vec3(1.0) * 2.2 * panel(uv, vec2(-0.8, 0.9), vec2(0.5, 0.18), 0.1, 0.012);
  }
  return col;
}
void main() { gl_FragColor = vec4(studio(normalize(vDir)), 1.0); }
`;

export function buildEnvironment(renderer) {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: frag,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(20, 48, 24), mat));

  const half = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const rt = new THREE.WebGLCubeRenderTarget(1024, {
    type: half ? THREE.HalfFloatType : THREE.UnsignedByteType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const cam = new THREE.CubeCamera(0.1, 50, rt);
  cam.update(renderer, scene);

  scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return rt.texture;
}
