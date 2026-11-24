import * as THREE from 'three';

// Композиция собрана в координатах референса 2048×1152 px.
// 1 world unit = 576 px (высота кадра = 2 юнита), камера смотрит вдоль -Z.
export const REF_W = 2048;
export const REF_H = 1152;
export const UNIT = 576;
export const FOV0 = 30;
export const D0 = 1 / Math.tan(THREE.MathUtils.degToRad(FOV0 / 2)); // расстояние до плоскости z=0

export const wx = (x) => (x - REF_W / 2) / UNIT;
export const wy = (y) => (REF_H / 2 - y) / UNIT;
export const wr = (r) => r / UNIT;

/** px референса -> мир, с компенсацией перспективы для объектов на глубине z */
export function pxToWorld(x, y, z = 0, out = new THREE.Vector3()) {
  const s = (D0 - z) / D0;
  return out.set(wx(x) * s, wy(y) * s, z);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const REDUCED_MOTION =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
