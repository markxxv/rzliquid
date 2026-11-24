import * as THREE from 'three';
import { D0, FOV0, REDUCED_MOTION } from './config.js';
import { buildEnvironment } from './environment.js';
import { createBackground } from './background.js';
import { Mercury } from './mercury.js';
import { GlassPanes } from './glass.js';
import { Wires } from './wires.js';
import { Floaters } from './floaters.js';
import { Input } from './input.js';

const params = new URLSearchParams(location.search);
const STILL = params.has('still');
const canvas = document.getElementById('scene');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance', alpha: false, stencil: false,
  });
} catch (err) {
  document.body.insertAdjacentHTML('beforeend',
    '<div style="position:fixed;inset:0;display:grid;place-items:center;color:#bbb;font:14px/1.5 system-ui;text-align:center;padding:24px">Для этой инсталляции нужен браузер с поддержкой WebGL2.</div>');
  throw err;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.setClearColor(0x000000, 1);

const maxPR = Math.min(window.devicePixelRatio || 1, 2);
let pr = params.has('pr') ? parseFloat(params.get('pr')) : Math.min(maxPR, 1.25);
renderer.setPixelRatio(pr);

/* ── сцена ── */
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV0, 16 / 9, 0.1, 50);
camera.position.set(0, 0, D0);

const envTex = buildEnvironment(renderer);
const envUniforms = {
  uEnv: { value: envTex },
  uEnvRot: { value: new THREE.Matrix3() },
};

const bg = createBackground();
const glass = new GlassPanes(envUniforms);
const mercury = new Mercury(envUniforms);
const wires = new Wires(envUniforms);
const floaters = new Floaters(envUniforms);
scene.add(bg, glass.group, mercury.mesh, wires.group, floaters.group);

const input = new Input(canvas);
const hint = document.getElementById('hint');
if (hint && !STILL) {
  setTimeout(() => hint.classList.add('on'), 1800);
  const hide = () => hint.classList.remove('on');
  input.onFirst = () => setTimeout(hide, 3500);
  setTimeout(hide, 12000);
}

/* ── размер / композиция ── */
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  const aspect = w / h;
  camera.aspect = aspect;
  // вся композиция 16:9 целиком; на узких экранах показываем центральную часть
  const visH = Math.max(2.0, 2.5 / aspect);
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(visH / 2 / D0));
  camera.updateProjectionMatrix();
  floaters.setAspect(aspect);
}
window.addEventListener('resize', resize);
resize();

/* ── окружение вращается за курсором — блики скользят по хрому ── */
const envEuler = new THREE.Euler(), envMat4 = new THREE.Matrix4();
function updateEnv(t) {
  const px = input.parallax.x, py = input.parallax.y;
  const drift = REDUCED_MOTION ? 0 : 1;
  envEuler.set(py * 0.22 + Math.sin(t * 0.13) * 0.04 * drift, -px * 0.45 + Math.sin(t * 0.09) * 0.05 * drift, 0);
  envMat4.makeRotationFromEuler(envEuler);
  envUniforms.uEnvRot.value.setFromMatrix4(envMat4);
}

/* ── адаптивное разрешение ── */
let slow = 0, fast = 0, quality = 1;
const fpsEl = document.getElementById('fps');
if (params.has('debug') && fpsEl) fpsEl.style.display = 'block';
let fpsAcc = 0, fpsN = 0;
function adapt(dt) {
  if (STILL || params.has('pr')) return;
  if (dt > 0.026) { slow++; fast = 0; } else if (dt < 0.0185) { fast++; slow = Math.max(0, slow - 1); } else { slow = Math.max(0, slow - 1); fast = 0; }
  if (slow > 25) { slow = 0; if (quality > 0 && pr <= 0.85) quality = 0; if (pr > 0.55) { pr = Math.max(0.55, pr - 0.15); resize(); } }
  else if (fast > 240) { fast = 0; if (pr < maxPR && quality > 0) { pr = Math.min(maxPR, pr + 0.1); resize(); } }
}

/* ── цикл ── */
let T = 0, shown = false;
function pixSize() { return (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / renderer.domElement.height; }

function frame(dt, draw = true) {
  T += dt;
  // лёгкий параллакс камеры
  camera.position.x += (input.parallax.x * 0.16 - camera.position.x) * (1 - Math.exp(-dt * 3));
  camera.position.y += (input.parallax.y * 0.09 - camera.position.y) * (1 - Math.exp(-dt * 3));
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  input.update(camera, dt, T);
  updateEnv(T);
  mercury.update(dt, T, input, camera, pixSize(), quality);
  glass.update(T, input);
  wires.update(dt, T, input);
  floaters.update(dt, T, input, mercury);
  if (draw) renderer.render(scene, camera);
  if (draw && !shown) { shown = true; requestAnimationFrame(() => canvas.classList.add('on')); }
}

if (STILL) {
  // детерминированный кадр для проверки: ?still&mx=..&my=..&steps=..
  const mx = parseFloat(params.get('mx') ?? 'NaN'), my = parseFloat(params.get('my') ?? 'NaN');
  const steps = parseInt(params.get('steps') ?? '150', 10);
  if (!Number.isNaN(mx)) { input.hasPointer = true; input.ndc.set(mx, my); }
  if (params.has('down')) input.down = true;
  for (let i = 0; i < steps; i++) frame(1 / 60, i === steps - 1);
  window.__ready = true;
} else {
  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min((now - last) / 1000, 1 / 20); last = now;
    if (!document.hidden) {
      frame(dt); adapt(dt);
      if (fpsEl && fpsEl.style.display === 'block') {
        fpsAcc += dt; fpsN++;
        if (fpsAcc > 0.5) { fpsEl.textContent = `${(fpsN / fpsAcc) | 0} fps · pr ${pr.toFixed(2)} · q${quality}`; fpsAcc = 0; fpsN = 0; }
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
