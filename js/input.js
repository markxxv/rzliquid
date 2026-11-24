import * as THREE from 'three';
import { REDUCED_MOTION } from './config.js';

/** Указатель -> точка на плоскости z=0, сглаженная скорость, удержание (притяжение). */
export class Input {
  constructor(el) {
    this.el = el;
    this.ndc = new THREE.Vector2(0, 0);
    this.hasPointer = false;
    this.down = false;
    this.world = new THREE.Vector3(99, 99, 0);
    this.prev = new THREE.Vector3(99, 99, 0);
    this.vel = new THREE.Vector2();
    this.speed = 0;
    this.influence = 0;           // 0..1 — насколько «живой» указатель
    this.idle = 0;                // секунд без взаимодействия
    this.parallax = new THREE.Vector2();
    this._smooth = new THREE.Vector3(99, 99, 0);
    this._first = true;
    this._ray = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this._tmp = new THREE.Vector3();
    this.onFirst = null;

    const set = (e) => {
      const r = el.getBoundingClientRect();
      this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
      this.hasPointer = true; this.idle = 0;
      if (this.onFirst) { this.onFirst(); this.onFirst = null; }
    };
    el.addEventListener('pointermove', set);
    el.addEventListener('pointerdown', (e) => { set(e); this.down = true; try { el.setPointerCapture(e.pointerId); } catch (_) {} });
    const up = (e) => { this.down = false; if (e.pointerType === 'touch') this.hasPointer = false; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', (e) => { if (!this.down) this.hasPointer = false; });
  }

  /** Виртуальный «призрачный» курсор, если зритель давно ничего не трогает. */
  _autopilot(t) {
    if (REDUCED_MOTION || this.idle < 5) return null;
    const cycle = 11, k = ((t - (t % cycle)) / cycle) | 0;
    const ph = (t % cycle) / 3.2;      // быстрый проход 3.2 с, дальше пауза
    if (ph > 1) return null;
    const dir = k % 2 ? -1 : 1;
    const x = THREE.MathUtils.lerp(-1.1, 1.0, dir > 0 ? ph : 1 - ph);
    const y = -0.15 + 0.35 * Math.sin(ph * Math.PI * 1.6 + k);
    return new THREE.Vector3(x, y, 0);
  }

  update(camera, dt, t) {
    this.idle += dt;
    let target = null, infl = 0;
    if (this.hasPointer) {
      this._ray.setFromCamera(this.ndc, camera);
      if (this._ray.ray.intersectPlane(this._plane, this._tmp)) target = this._tmp.clone();
      infl = 1;
    } else {
      target = this._autopilot(t);
      infl = target ? 0.75 : 0;
    }
    if (target) {
      if (this._smooth.x > 50) this._smooth.copy(target);
      this._smooth.lerp(target, 1 - Math.exp(-dt * 22));
      this.world.copy(this._smooth);
    } else {
      this.world.set(99, 99, 0); this._smooth.set(99, 99, 0);
    }
    this.influence += (infl - this.influence) * (1 - Math.exp(-dt * 6));
    if (this.prev.x < 50 && this.world.x < 50 && dt > 0) {
      this.vel.set((this.world.x - this.prev.x) / dt, (this.world.y - this.prev.y) / dt);
      const m = this.vel.length(); if (m > 9) this.vel.multiplyScalar(9 / m);
    } else this.vel.set(0, 0);
    this.speed += (this.vel.length() - this.speed) * (1 - Math.exp(-dt * 12));
    this.prev.copy(this.world);

    const pt = this.hasPointer ? this.ndc : { x: 0, y: 0 };
    this.parallax.x += (pt.x - this.parallax.x) * (1 - Math.exp(-dt * 2.5));
    this.parallax.y += (pt.y - this.parallax.y) * (1 - Math.exp(-dt * 2.5));
  }
}
