import * as THREE from 'three';
import type { QualitySettings } from '../core/Quality';
import type { Vehicle } from '../vehicles/Vehicle';
import { Particles } from './Particles';
import { makeGlowTexture } from './textures';

const TRAIL_N = 56;

/** Camera-facing light ribbon that follows a point on the car. */
class Trail {
  readonly mesh: THREE.Mesh;
  private pts: THREE.Vector3[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private geo: THREE.BufferGeometry;
  private started = false;
  intensity = 0;

  constructor(private color: THREE.Color, private width: number) {
    for (let i = 0; i < TRAIL_N; i++) this.pts.push(new THREE.Vector3());
    this.pos = new Float32Array(TRAIL_N * 2 * 3);
    this.col = new Float32Array(TRAIL_N * 2 * 4);
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide, fog: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  update(head: THREE.Vector3, camPos: THREE.Vector3) {
    if (!this.started || head.distanceToSquared(this.pts[0]) > 900) {
      for (const p of this.pts) p.copy(head);
      this.started = true;
    }
    // shift when the head has moved far enough, otherwise just drag the first point
    if (head.distanceToSquared(this.pts[1]) > 0.45 * 0.45) {
      const last = this.pts.pop()!;
      last.copy(head);
      this.pts.unshift(last);
    }
    this.pts[0].copy(head);
    const side = _a;
    const tan = _b;
    const toCam = _c;
    for (let i = 0; i < TRAIL_N; i++) {
      const p = this.pts[i];
      const next = this.pts[Math.min(TRAIL_N - 1, i + 1)];
      const prev = this.pts[Math.max(0, i - 1)];
      tan.copy(prev).sub(next);
      toCam.copy(camPos).sub(p);
      side.crossVectors(tan, toCam);
      const l = side.length();
      if (l > 1e-5) side.multiplyScalar(1 / l);
      else side.set(0, 1, 0);
      const t = i / (TRAIL_N - 1);
      const w = this.width * (1 - t * 0.75);
      this.pos.set([p.x + side.x * w, p.y + side.y * w, p.z + side.z * w], i * 6);
      this.pos.set([p.x - side.x * w, p.y - side.y * w, p.z - side.z * w], i * 6 + 3);
      const a = Math.pow(1 - t, 2.2) * this.intensity;
      const c = this.color;
      this.col.set([c.r, c.g, c.b, a], i * 8);
      this.col.set([c.r, c.g, c.b, a], i * 8 + 4);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.mesh.visible = this.intensity > 0.01;
  }
}
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _v = new THREE.Vector3();

/** Wind streaks rushing past the camera; lives in camera space. */
class SpeedLines {
  readonly mesh: THREE.LineSegments;
  private pos: Float32Array;
  private col: Float32Array;
  private seeds: Float32Array;
  private geo: THREE.BufferGeometry;
  constructor(private n: number, private color: THREE.Color) {
    this.pos = new Float32Array(n * 6);
    this.col = new Float32Array(n * 8);
    this.seeds = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) this.respawn(i, true);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.mesh = new THREE.LineSegments(
      this.geo,
      new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
  }
  private respawn(i: number, anywhere: boolean) {
    const a = Math.random() * Math.PI * 2;
    const r = 2.2 + Math.random() * 7;
    this.seeds[i * 3] = Math.cos(a) * r;
    this.seeds[i * 3 + 1] = Math.sin(a) * r * 0.6;
    this.seeds[i * 3 + 2] = anywhere ? -Math.random() * 70 : -70 - Math.random() * 10;
  }
  update(dt: number, speed: number, strength: number) {
    const len = 1.2 + speed * 0.09;
    for (let i = 0; i < this.n; i++) {
      this.seeds[i * 3 + 2] += speed * 1.6 * dt;
      if (this.seeds[i * 3 + 2] > 2) this.respawn(i, false);
      const x = this.seeds[i * 3];
      const y = this.seeds[i * 3 + 1];
      const z = this.seeds[i * 3 + 2];
      this.pos.set([x, y, z, x, y, z - len], i * 6);
      const fade = strength * THREE.MathUtils.smoothstep(-z, 1, 14) * (1 - THREE.MathUtils.smoothstep(-z, 45, 70));
      const c = this.color;
      this.col.set([c.r, c.g, c.b, fade * 0.55, c.r, c.g, c.b, 0], i * 8);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.mesh.visible = strength > 0.01;
  }
}

/** Expanding ring fired when boost ignites. */
class Shockwave {
  readonly mesh: THREE.Mesh;
  private t = 1;
  constructor(color: THREE.Color) {
    this.mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 1, 48),
      new THREE.MeshBasicMaterial({
        color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      }),
    );
    this.mesh.visible = false;
    this.mesh.renderOrder = 6;
  }
  fire(pos: THREE.Vector3, quat: THREE.Quaternion) {
    this.t = 0;
    this.mesh.position.copy(pos);
    this.mesh.quaternion.copy(quat);
    this.mesh.visible = true;
  }
  update(dt: number) {
    if (this.t >= 1) {
      this.mesh.visible = false;
      return;
    }
    this.t += dt / 0.55;
    const e = 1 - Math.pow(1 - this.t, 3);
    this.mesh.scale.setScalar(0.5 + e * 13);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - this.t) * 0.9;
  }
}

/** All world-space effects attached to the player's vehicle. */
export class VehicleFX {
  readonly group = new THREE.Group();
  readonly speedLines: SpeedLines;
  private trails: Trail[] = [];
  private sparks: Particles;
  private smoke: Particles;
  private shock: Shockwave;
  private lastBoostEvents = 0;
  private lastHitTime = -1;
  private smokeAcc = 0;
  private sparkAcc = 0;
  private sparkCol = new THREE.Color(8, 4.2, 1.2);
  private smokeCol = new THREE.Color(0.55, 0.5, 0.75);
  private boostCol: THREE.Color;

  constructor(private vehicle: Vehicle, private q: QualitySettings) {
    const glow = makeGlowTexture();
    const cfg = vehicle.config;
    this.boostCol = new THREE.Color(cfg.colors.accent).multiplyScalar(5);
    const red = new THREE.Color(1.5, 0.08, 0.2);
    for (let i = 0; i < cfg.fx.tailLights.length; i++) {
      const t = new Trail(red, 0.05);
      this.trails.push(t);
      this.group.add(t.mesh);
    }
    this.sparks = new Particles({ max: Math.floor(500 * q.particles), texture: glow, additive: true, gravity: 16, drag: 0.6, grow: -0.6 });
    this.smoke = new Particles({ max: Math.floor(320 * q.particles), texture: glow, additive: false, gravity: -1.2, drag: 1.4, grow: 3.2 });
    this.shock = new Shockwave(new THREE.Color(cfg.colors.accent).multiplyScalar(3));
    this.group.add(this.smoke.points, this.sparks.points, this.shock.mesh);
    this.speedLines = new SpeedLines(Math.floor(160 * q.particles), new THREE.Color(0.7, 0.9, 1.3));
  }

  update(dt: number, camera: THREE.PerspectiveCamera, viewportH: number) {
    const v = this.vehicle;
    const cfg = v.config;
    this.sparks.setViewport(viewportH, camera.fov);
    this.smoke.setViewport(viewportH, camera.fov);

    const sNorm = THREE.MathUtils.clamp(v.speed / cfg.engine.topSpeed, 0, 1.5);
    const boostK = v.boosting ? 1 : 0;

    // tail-light trails
    const trailI = THREE.MathUtils.smoothstep(sNorm, 0.22, 0.75) * 0.55 + boostK * 0.35;
    cfg.fx.tailLights.forEach((p, i) => {
      const tr = this.trails[i];
      tr.intensity += (trailI - tr.intensity) * Math.min(1, dt * 5);
      _d.set(p[0], p[1], p[2]).applyQuaternion(v.quaternion).add(v.position);
      tr.update(_d, camera.position);
    });

    // tyre smoke + drift sparks from sliding rear wheels
    this.smokeAcc += dt;
    this.sparkAcc += dt;
    const emitSmoke = this.smokeAcc > 0.022;
    const emitSpark = this.sparkAcc > 0.016;
    for (let i = 0; i < cfg.wheels.length; i++) {
      const w = v.wheels[i];
      if (!w.grounded || cfg.wheels[i].pos[2] < 0) continue;
      const slide = Math.max(w.skid, v.drifting ? v.driftAmount : 0);
      if (slide < 0.3 || v.speed < 5) continue;
      if (emitSmoke) {
        _v.copy(v.velocity).multiplyScalar(0.25);
        _v.x += (Math.random() - 0.5) * 2;
        _v.y += 0.6 + Math.random();
        _v.z += (Math.random() - 0.5) * 2;
        _d.copy(w.contact).setY(w.contact.y + 0.15);
        this.smoke.emit(_d, _v, this.smokeCol, 0.085 * slide, 0.6 + Math.random() * 0.5, 0.9 + Math.random() * 0.6);
      }
      if (emitSpark && slide > 0.55 && v.speed > 14) {
        for (let k = 0; k < 2; k++) {
          _v.copy(v.velocity).multiplyScalar(0.45);
          _v.x += (Math.random() - 0.5) * 7;
          _v.y += 1.5 + Math.random() * 4;
          _v.z += (Math.random() - 0.5) * 7;
          this.sparks.emit(w.contact, _v, this.sparkCol, 1, 0.07 + Math.random() * 0.06, 0.3 + Math.random() * 0.45);
        }
      }
    }
    if (emitSmoke) this.smokeAcc = 0;
    if (emitSpark) this.sparkAcc = 0;

    // scrape / crash sparks
    if (v.lastHit.time !== this.lastHitTime) {
      this.lastHitTime = v.lastHit.time;
      const n = Math.floor((10 + 50 * v.lastHit.strength) * this.q.particles);
      for (let k = 0; k < n; k++) {
        _v.copy(v.velocity).multiplyScalar(0.5 + Math.random() * 0.4);
        _v.x += (Math.random() - 0.5) * 12;
        _v.y += Math.random() * 8;
        _v.z += (Math.random() - 0.5) * 12;
        _d.copy(v.lastHit.pos);
        _d.x += (Math.random() - 0.5) * 1.2;
        _d.z += (Math.random() - 0.5) * 1.2;
        this.sparks.emit(_d, _v, this.sparkCol, 1, 0.08 + Math.random() * 0.08, 0.35 + Math.random() * 0.6);
      }
    }

    // boost: shockwave + thruster embers
    if (v.boostEvents !== this.lastBoostEvents) {
      this.lastBoostEvents = v.boostEvents;
      _d.set(0, 0.7, 1.6).applyQuaternion(v.quaternion).add(v.position);
      this.shock.fire(_d, v.quaternion);
    }
    if (v.boosting) {
      for (const p of cfg.fx.thrusters) {
        _d.set(p[0], p[1], p[2] + 0.3).applyQuaternion(v.quaternion).add(v.position);
        _v.copy(v.forward).multiplyScalar(-6 - Math.random() * 6).addScaledVector(v.velocity, 0.6);
        _v.x += (Math.random() - 0.5) * 2;
        _v.y += (Math.random() - 0.5) * 2;
        this.sparks.emit(_d, _v, this.boostCol, 0.9, 0.12 + Math.random() * 0.1, 0.25 + Math.random() * 0.2);
      }
    }
    this.shock.update(dt);
    this.sparks.update(dt);
    this.smoke.update(dt);

    const lines = THREE.MathUtils.smoothstep(sNorm, 0.5, 1.05) * 0.8 + boostK * 0.5;
    this.speedLines.update(dt, v.speed, Math.min(1.2, lines));
  }
}
