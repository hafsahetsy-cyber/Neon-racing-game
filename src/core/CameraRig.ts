import * as THREE from 'three';
import type { Vehicle } from '../vehicles/Vehicle';

export type CameraMode = 'chase' | 'hood' | 'cinematic' | 'showroom';
export const CAMERA_MODES: CameraMode[] = ['chase', 'hood', 'cinematic'];

const UP = new THREE.Vector3(0, 1, 0);

/** Chase / hood / cinematic cameras with speed-driven FOV and shake. */
export class CameraRig {
  mode: CameraMode = 'chase';
  private heading = new THREE.Vector3(0, 0, -1);
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private fov = 62;
  private time = 0;
  private orbit = 0;
  private initialised = false;
  private _a = new THREE.Vector3();
  private _b = new THREE.Vector3();
  private _c = new THREE.Vector3();

  /** Returns how far (0..1) the camera can travel from `from` towards `to` before hitting the world. */
  obstacle: ((from: THREE.Vector3, to: THREE.Vector3) => number) | null = null;
  private pull = 1;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  /** Jump straight to the new mode's framing instead of easing from the old one. */
  snap() {
    this.initialised = false;
  }

  cycle(): CameraMode {
    this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
    this.initialised = false;
    return this.mode;
  }

  update(dt: number, v: Vehicle) {
    this.time += dt;
    const cam = this.camera;
    const top = v.config.engine.topSpeed;
    const sNorm = THREE.MathUtils.clamp(v.speed / top, 0, 1.5);
    const boostK = v.boosting ? 1 : 0;

    // FOV widens with speed, kicks on boost
    const fovBase = this.mode === 'hood' ? 72 : this.mode === 'showroom' ? 46 : 60;
    const fovTarget = fovBase + 20 * Math.pow(Math.min(1.2, sNorm), 1.4) + boostK * 7;
    this.fov += (fovTarget - this.fov) * Math.min(1, dt * (boostK ? 6 : 3));
    cam.fov = this.fov;
    cam.updateProjectionMatrix();

    const flatFwd = this._a.copy(v.forward).setY(0);
    if (flatFwd.lengthSq() < 1e-4) flatFwd.set(0, 0, -1);
    flatFwd.normalize();

    if (this.mode === 'chase') {
      // heading blends car facing with travel direction so drifts show the car's angle
      const velDir = this._b.copy(v.velocity).setY(0);
      const target = this._c.copy(flatFwd);
      if (velDir.lengthSq() > 16 && v.forwardSpeed > 0) target.lerp(velDir.normalize(), 0.45).normalize();
      this.heading.lerp(target, Math.min(1, dt * 4.5)).normalize();

      const dist = (6.2 - 1.5 * Math.min(1, sNorm) + boostK * 0.5) * (v.config.cameraDistance ?? 1);
      const height = 2.35 - 0.35 * Math.min(1, sNorm);
      const desired = this._b.copy(v.position).addScaledVector(this.heading, -dist).addScaledVector(UP, height);
      desired.y = Math.max(desired.y, 0.6);
      if (!this.initialised) {
        this.pos.copy(desired);
        this.initialised = true;
      }
      const lagXZ = Math.min(1, dt * 9);
      this.pos.x += (desired.x - this.pos.x) * lagXZ;
      this.pos.z += (desired.z - this.pos.z) * lagXZ;
      this.pos.y += (desired.y - this.pos.y) * Math.min(1, dt * 5);
      const lookT = this._c.copy(v.position).addScaledVector(UP, 1.15).addScaledVector(this.heading, 4 + sNorm * 5);
      this.look.lerp(lookT, Math.min(1, dt * 12));
      cam.position.copy(this.pos);
      // keep the camera out of walls in narrow streets: slide it in towards the car
      if (this.obstacle) {
        const pivot = this._b.copy(v.position).addScaledVector(UP, 1.6);
        const free = Math.min(1, this.obstacle(pivot, this.pos));
        const target = free < 1 ? Math.max(0.12, free - 0.08) : 1;
        this.pull += (target - this.pull) * Math.min(1, dt * (target < this.pull ? 30 : 4));
        if (this.pull < 0.999) cam.position.lerpVectors(pivot, this.pos, this.pull);
      }
      cam.up.copy(UP);
      cam.lookAt(this.look);
      // lean into corners a touch
      cam.rotateZ(-v.steer * 0.025 * Math.min(1, sNorm * 2) - v.driftAngle * 0.04);
    } else if (this.mode === 'hood') {
      const hl = v.config.fx.headlight;
      const p = this._b.set(0, Math.max(1.05, hl[1] + 0.45), hl[2] - 0.35).applyQuaternion(v.quaternion).add(v.position);
      cam.position.copy(p);
      cam.up.copy(v.up);
      cam.lookAt(this._c.copy(p).addScaledVector(v.forward, 10).addScaledVector(v.up, -0.4));
      this.initialised = true;
    } else {
      // cinematic: slow low orbit
      const show = this.mode === 'showroom';
      this.orbit += dt * (show ? 0.22 : 0.35);
      const r = show ? 5.2 + v.config.chassis.halfExtents[2] * 1.1 : 7.5 + sNorm * 2;
      const desired = this._b
        .copy(v.position)
        .add(this._c.set(Math.cos(this.orbit) * r, 1.1 + 0.9 * Math.sin(this.orbit * 0.7) + 0.9, Math.sin(this.orbit) * r));
      if (!this.initialised) {
        this.pos.copy(desired);
        this.initialised = true;
      }
      this.pos.lerp(desired, Math.min(1, dt * 6));
      cam.position.copy(this.pos);
      cam.up.copy(UP);
      cam.lookAt(this._c.copy(v.position).addScaledVector(UP, 0.9));
    }

    // shake: road buzz at speed, rumble on boost, jolt on impact
    const shake = 0.012 * Math.pow(sNorm, 3) + boostK * 0.02 + v.impact * 0.14;
    if (shake > 0.0005) {
      const t = this.time;
      cam.position.x += (Math.sin(t * 71.3) + Math.sin(t * 43.7)) * 0.5 * shake;
      cam.position.y += (Math.sin(t * 83.1) + Math.sin(t * 37.9)) * 0.5 * shake;
      cam.rotateZ(Math.sin(t * 59.3) * shake * 0.12);
    }
  }
}
