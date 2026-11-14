import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { DriveInput } from '../core/Input';
import type { VehicleConfig } from './VehicleConfig';

export interface WheelState {
  grounded: boolean;
  /** Suspension compression 0..2*travel. */
  compression: number;
  /** Local Y of the wheel centre. */
  localY: number;
  spin: number;
  steerAngle: number;
  /** Sideways slip speed at the contact patch (m/s). */
  slip: number;
  /** 0..1 how far beyond the grip limit the tyre is. */
  skid: number;
  contact: THREE.Vector3;
  load: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Arcade-realistic vehicle: a Rapier rigid body driven by a custom raycast
 * suspension + tyre model. Everything tunable lives in VehicleConfig.
 */
export class Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly wheels: WheelState[];

  // --- interpolated render transform
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  private prevPos = new THREE.Vector3();
  private prevQuat = new THREE.Quaternion();
  private currPos = new THREE.Vector3();
  private currQuat = new THREE.Quaternion();

  // --- public telemetry (read by camera, fx, audio, hud, network)
  readonly velocity = new THREE.Vector3();
  readonly forward = new THREE.Vector3(0, 0, -1);
  readonly up = new THREE.Vector3(0, 1, 0);
  readonly right = new THREE.Vector3(1, 0, 0);
  speed = 0; // m/s magnitude
  forwardSpeed = 0;
  steer = 0; // smoothed -1..1
  throttle = 0;
  braking = false;
  groundedWheels = 0;
  airTime = 0;
  /** Rear lateral slip 0..1 for smoke/sound. */
  driftAmount = 0;
  drifting = false;
  /** Signed drift angle in radians (velocity vs heading). */
  driftAngle = 0;
  rpm = 0.1; // 0..1
  gear = 1;
  boost = 1; // meter 0..1
  /** Grip of the surface under the car (1 = tarmac). Set by the game from the world. */
  gripScale = 1;
  boosting = false;
  /** Incremented each time boost kicks in — fx listen for changes. */
  boostEvents = 0;
  /** Set on hard landings / impacts, decays to zero. Camera shake reads it. */
  impact = 0;
  /** World position + strength of the last hard contact, for sparks. */
  lastHit = { time: -1, pos: new THREE.Vector3(), strength: 0 };

  private steerAngle = 0;
  private boostLock = false;
  private flippedTime = 0;
  private lastVel = new THREE.Vector3();
  private readonly chassisCollider: RAPIER.Collider;

  // scratch
  private _o = new THREE.Vector3();
  private _d = new THREE.Vector3();
  private _n = new THREE.Vector3();
  private _f = new THREE.Vector3();
  private _s = new THREE.Vector3();
  private _vp = new THREE.Vector3();
  private _com = new THREE.Vector3();
  private _ang = new THREE.Vector3();
  private _tmp = new THREE.Vector3();
  private _tmp2 = new THREE.Vector3();
  private _imp = new THREE.Vector3();
  private _wf = new THREE.Vector3();
  private _q = new THREE.Quaternion();
  private _gn = new THREE.Vector3();
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  constructor(
    private world: RAPIER.World,
    readonly config: VehicleConfig,
    spawn: { position: THREE.Vector3; yaw: number },
  ) {
    const c = config;
    const q = new THREE.Quaternion().setFromAxisAngle(UP, spawn.yaw);
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.position.x, spawn.position.y, spawn.position.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setLinearDamping(0.0)
      .setAngularDamping(0.35);
    this.body = world.createRigidBody(desc);

    const [hx, hy, hz] = c.chassis.halfExtents;
    const [w, h, d] = [hx * 2, hy * 2, hz * 2];
    // Box inertia, padded a little so the car feels planted rather than twitchy.
    const pad = 1.6;
    const inertia = {
      x: (c.mass / 12) * (h * h + d * d) * pad,
      y: (c.mass / 12) * (w * w + d * d) * 1.1,
      z: (c.mass / 12) * (w * w + h * h) * pad * 1.4,
    };
    const col = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(c.chassis.center[0], c.chassis.center[1], c.chassis.center[2])
      .setMassProperties(c.mass, { x: 0, y: c.comHeight, z: c.comZ ?? 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 })
      .setFriction(0.15)
      .setRestitution(0.15)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(c.mass * 30);
    this.chassisCollider = world.createCollider(col, this.body);

    this.wheels = c.wheels.map((wc) => ({
      grounded: false,
      compression: c.suspension.travel,
      localY: wc.pos[1],
      spin: 0,
      steerAngle: 0,
      slip: 0,
      skid: 0,
      contact: new THREE.Vector3(),
      load: 0,
    }));

    this.readBody();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    this.position.copy(this.currPos);
    this.quaternion.copy(this.currQuat);
  }

  get colliderHandle() {
    return this.chassisCollider.handle;
  }

  private readBody() {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.set(r.x, r.y, r.z, r.w);
    const v = this.body.linvel();
    this.velocity.set(v.x, v.y, v.z);
    this.forward.set(0, 0, -1).applyQuaternion(this.currQuat);
    this.up.set(0, 1, 0).applyQuaternion(this.currQuat);
    this.right.set(1, 0, 0).applyQuaternion(this.currQuat);
    this.speed = this.velocity.length();
    this.forwardSpeed = this.velocity.dot(this.forward);
  }

  /** Called once per fixed physics tick, BEFORE world.step(). */
  step(dt: number, input: DriveInput) {
    const c = this.config;
    const body = this.body;
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    this.readBody();

    const gravity = Math.abs(this.world.gravity.y);
    const nWheels = c.wheels.length;
    const mShare = c.mass / nWheels;
    const com = body.worldCom();
    this._com.set(com.x, com.y, com.z);
    const av = body.angvel();
    this._ang.set(av.x, av.y, av.z);

    // ---------- driver inputs -> intent
    const fs = this.forwardSpeed;
    let throttle = input.throttle;
    let brake = input.brake;
    let reverse = 0;
    if (brake > 0 && fs < 1.2 && throttle === 0) {
      reverse = brake;
      brake = 0;
    }
    if (throttle > 0 && fs < -1.5) {
      brake = Math.max(brake, throttle);
      throttle = 0;
    }
    this.throttle = throttle;
    this.braking = brake > 0.05;

    // steering: fast response, speed-sensitive lock
    const target = clamp(input.steer, -1, 1);
    const rate = (Math.abs(target) < Math.abs(this.steer) || Math.sign(target) !== Math.sign(this.steer) ? 1.6 : 1) * c.steer.speed;
    this.steer += clamp(target - this.steer, -rate * dt, rate * dt);
    const sNorm = clamp(Math.abs(fs) / c.engine.topSpeed, 0, 1);
    const lock = THREE.MathUtils.lerp(c.steer.maxAngle, c.steer.minAngle, Math.pow(sNorm, 0.65));
    // While drifting, give back some lock so counter-steering actually catches the slide.
    const driftLock = this.drifting ? Math.min(c.steer.maxAngle, lock * 1.6) : lock;
    this.steerAngle = -this.steer * driftLock;

    // boost
    const wantBoost = input.boost && this.boost > 0.02 && !this.boostLock && (throttle > 0 || fs > 3);
    if (wantBoost && !this.boosting) this.boostEvents++;
    this.boosting = wantBoost;
    if (this.boosting) {
      this.boost = Math.max(0, this.boost - dt / c.boost.duration);
      if (this.boost <= 0.02) this.boostLock = true;
    } else {
      const driftBonus = this.drifting ? 0.16 * this.driftAmount : 0;
      this.boost = Math.min(1, this.boost + (c.boost.regen + driftBonus) * dt);
      if (this.boostLock && (!input.boost || this.boost > 0.3)) this.boostLock = false;
    }

    // engine
    const top = c.engine.topSpeed * (this.boosting ? c.boost.topSpeedMul : 1);
    let driveAccel = 0;
    if (throttle > 0 || this.boosting) {
      const r = clamp(fs / top, 0, 1.2);
      const curve = Math.max(0, 1 - Math.pow(r, 2.6));
      // punchy launch, tapering towards top speed
      driveAccel = (c.engine.accel * Math.max(throttle, this.boosting ? 1 : 0) + (this.boosting ? c.boost.accel : 0)) * curve;
    } else if (reverse > 0) {
      const r = clamp(-fs / c.engine.reverseSpeed, 0, 1);
      driveAccel = -c.engine.accel * 0.6 * reverse * (1 - r * r);
    }
    const nDrive = c.wheels.reduce((n, w) => n + (w.drive ? 1 : 0), 0) || 1;

    // ---------- wheels
    const k = mShare * Math.pow(2 * Math.PI * c.suspension.frequency, 2);
    const damp = 2 * c.suspension.damping * Math.sqrt(k * mShare);
    const travel = c.suspension.travel;
    const downforce = 1 + Math.min(0.5, this.speed * this.speed * 0.00018);
    let grounded = 0;
    this._gn.set(0, 0, 0);
    let rearSlip = 0;
    let rearCount = 0;

    const overAngle = fs > 3 ? Math.max(0, Math.abs(this.driftAngle) - c.driftAngleLimit) : 0;
    for (let i = 0; i < nWheels; i++) {
      const wc = c.wheels[i];
      const ws = this.wheels[i];
      // ray origin: top of suspension travel
      this._o.set(wc.pos[0], wc.pos[1] + travel, wc.pos[2]).applyQuaternion(this.currQuat).add(this.currPos);
      this._d.copy(this.up).negate();
      const maxLen = travel * 2 + wc.radius;
      this.ray.origin.x = this._o.x; this.ray.origin.y = this._o.y; this.ray.origin.z = this._o.z;
      this.ray.dir.x = this._d.x; this.ray.dir.y = this._d.y; this.ray.dir.z = this._d.z;
      const hit = this.world.castRayAndGetNormal(this.ray, maxLen, true, undefined, undefined, undefined, body);

      ws.steerAngle = wc.steer ? this.steerAngle : 0;

      if (!hit) {
        ws.grounded = false;
        ws.compression = 0;
        ws.localY += (wc.pos[1] - travel - ws.localY) * Math.min(1, dt * 12);
        ws.slip = 0;
        ws.skid = 0;
        ws.load = 0;
        ws.spin += (fs / wc.radius) * dt;
        continue;
      }
      const dist = hit.timeOfImpact;
      this._n.set(hit.normal.x, hit.normal.y, hit.normal.z);
      if (this._n.dot(this.up) < 0.2) {
        // wall, not ground
        ws.grounded = false;
        continue;
      }
      grounded++;
      this._gn.add(this._n);
      ws.grounded = true;
      ws.contact.copy(this._o).addScaledVector(this._d, dist);
      const compression = maxLen - dist;
      ws.compression = compression;
      ws.localY = wc.pos[1] + travel - (dist - wc.radius);

      // velocity of the contact point on the chassis
      this._tmp.copy(ws.contact).sub(this._com);
      this._vp.copy(this._ang).cross(this._tmp).add(this.velocity);

      // --- suspension
      const compRate = -this._vp.dot(this._n);
      let load = k * (compression - travel) + mShare * gravity + damp * compRate;
      load = clamp(load, 0, mShare * gravity * 5);
      ws.load = load;
      this._imp.copy(this._n).multiplyScalar(load * dt);
      body.applyImpulseAtPoint(this._imp, ws.contact, true);

      // --- tyre basis on the ground plane
      this._wf.copy(this.forward);
      if (wc.steer) this._wf.applyAxisAngle(this.up, this.steerAngle);
      this._f.copy(this._wf).addScaledVector(this._n, -this._wf.dot(this._n)).normalize();
      this._s.crossVectors(this._f, this._n);
      const vLong = this._vp.dot(this._f);
      const vLat = this._vp.dot(this._s);

      const isRear = wc.pos[2] > 0;
      const locked = wc.handbrake && input.handbrake;
      const gripLoad = load * downforce;

      // --- longitudinal
      let jLong = 0;
      if (locked) {
        jLong = clamp(-vLong * mShare, -c.grip.handbrake * 1.4 * gripLoad * dt, c.grip.handbrake * 1.4 * gripLoad * dt);
      } else {
        if (wc.drive && driveAccel !== 0) jLong += ((c.mass * driveAccel) / nDrive) * dt;
        if (brake > 0) {
          const jb = c.engine.brake * mShare * brake * dt;
          jLong += clamp(-vLong * mShare, -jb, jb);
        } else if (driveAccel === 0) {
          const jr = 1.1 * mShare * dt; // rolling resistance + engine braking
          jLong += clamp(-vLong * mShare, -jr, jr);
        }
        const maxLong = c.grip.longitudinal * this.gripScale * gripLoad * dt;
        jLong = clamp(jLong, -maxLong, maxLong);
      }

      // --- lateral
      let mu = c.grip.lateral * this.gripScale;
      const slipAngle = Math.atan2(Math.abs(vLat), Math.abs(vLong) + 1.5);
      if (isRear) {
        if (locked) mu *= c.grip.handbrake;
        else {
          // once the tail steps out, it stays out — but stays controllable
          // hysteresis: an established drift keeps sliding at shallower angles than it took to start one
          const sliding = this.drifting
            ? THREE.MathUtils.smoothstep(slipAngle, 0.04, 0.2)
            : THREE.MathUtils.smoothstep(slipAngle, 0.14, 0.42);
          // the slide is only sustained while the driver keeps steering into the turn
          const sustain = clamp(-Math.sign(this.driftAngle) * this.steer, 0, 1);
          const hold = 0.12 + 0.88 * sustain;
          mu *= THREE.MathUtils.lerp(1, c.grip.drift, sliding * hold);
          // power oversteer: throttle eats into lateral grip
          mu *= 1 - 0.22 * throttle * sliding * hold;
          // brake-to-drift: a dab of brake while turning at speed unsticks the tail
          if (brake > 0.3 && Math.abs(this.steer) > 0.4 && fs > 14) mu *= 0.6;
        }
        mu *= 1 + overAngle * 3.5; // tail regains bite past the drift angle limit
      } else {
        mu /= 1 + overAngle * 5; // ...while the nose washes out, so slides hold instead of spinning
        // easing off the steering mid-drift lets the nose wash wide, which straightens the car
        if (this.drifting) mu *= 0.6 + 0.4 * clamp(-Math.sign(this.driftAngle) * this.steer, 0, 1);
      }
      const maxLat = mu * gripLoad * dt;
      const wantLat = -vLat * mShare;
      const jLat = clamp(wantLat, -maxLat, maxLat);
      ws.slip = Math.abs(vLat);
      ws.skid = maxLat > 0 ? clamp((Math.abs(wantLat) - maxLat) / maxLat, 0, 1) : 0;
      if (locked && Math.abs(vLong) > 3) ws.skid = Math.max(ws.skid, 0.8);
      if (isRear) {
        rearSlip += clamp((slipAngle - 0.1) / 0.5, 0, 1) * clamp(this.speed / 8, 0, 1);
        rearCount++;
      }

      // Apply tyre forces nearer the centre of mass height to tame roll/pitch.
      const hCom = this._tmp.copy(this._com).sub(ws.contact).dot(this._n);
      this._tmp2.copy(ws.contact).addScaledVector(this._n, hCom * c.antiRoll);
      this._imp.copy(this._f).multiplyScalar(jLong).addScaledVector(this._s, jLat);
      body.applyImpulseAtPoint(this._imp, this._tmp2, true);

      // wheel spin for visuals
      const spinSpeed = locked ? 0 : wc.drive && throttle > 0 && ws.skid > 0.5 ? (vLong + 6) / wc.radius : vLong / wc.radius;
      ws.spin += spinSpeed * dt;
    }

    // ---------- body-level forces
    const wasAir = this.groundedWheels === 0;
    this.groundedWheels = grounded;
    this.driftAmount += ((rearCount ? rearSlip / rearCount : 0) - this.driftAmount) * Math.min(1, dt * 8);
    this.drifting = this.driftAmount > 0.25 && grounded >= 2;
    const flatVel = this._tmp.copy(this.velocity).addScaledVector(this.up, -this.velocity.dot(this.up));
    this.driftAngle = this.speed > 4 ? Math.atan2(flatVel.dot(this.right), Math.max(0.01, flatVel.dot(this.forward))) : 0;

    // drift thrust: keep momentum through a held slide instead of scrubbing to a crawl
    if (this.drifting && throttle > 0 && this.speed > 6 && this.speed < top) {
      const push = c.mass * 7.5 * throttle * this.driftAmount * clamp(-Math.sign(this.driftAngle) * this.steer + 0.3, 0, 1) * Math.min(1, Math.abs(this.driftAngle) * 2) * dt;
      this._imp.copy(flatVel).normalize().multiplyScalar(push);
      body.applyImpulse(this._imp, true);
    }

    // aero drag
    const drag = 0.00055 * this.speed;
    this._imp.copy(this.velocity).multiplyScalar(-drag * c.mass * dt);
    body.applyImpulse(this._imp, true);

    if (grounded > 0) {
      // downforce keeps it glued over crests at speed
      this._imp.copy(this.up).multiplyScalar(-c.mass * Math.min(9, this.speed * this.speed * 0.0022) * dt);
      body.applyImpulse(this._imp, true);
      // stabiliser: keep the body aligned with the road so hard cornering slides instead of rolling over
      this._gn.normalize();
      const stab = this._tmp.crossVectors(this.up, this._gn).multiplyScalar(c.mass * 16 * dt);
      stab.addScaledVector(this.forward, -this._ang.dot(this.forward) * c.mass * 1.4 * dt);
      // drift assist: cap the yaw rate and the slide angle so drifts hold instead of spinning out
      const yawRate = this._ang.dot(this.up);
      const maxYaw = 2.1;
      let yawFix = 0;
      if (Math.abs(yawRate) > maxYaw) yawFix -= (yawRate - Math.sign(yawRate) * maxYaw) * 9;
      const da = this.driftAngle;
      const over = Math.abs(da) - c.driftAngleLimit;
      if (over > 0 && this.forwardSpeed > 3) yawFix -= Math.sign(da) * over * 26 + yawRate * 5 * Math.min(1, over * 4);
      stab.addScaledVector(this.up, yawFix * c.mass * dt);
      body.applyTorqueImpulse(stab, true);
      if (wasAir && this.airTime > 0.25) {
        this.impact = Math.max(this.impact, clamp(this.airTime * 0.9, 0.2, 1));
      }
      this.airTime = 0;
    } else {
      this.airTime += dt;
      // mid-air: level out gently and allow a touch of yaw/pitch control
      const corr = this._tmp.crossVectors(this.up, UP).multiplyScalar(c.mass * 5.5 * dt);
      corr.addScaledVector(this._ang, -c.mass * 0.9 * dt);
      corr.addScaledVector(this.up, -this.steer * c.mass * 0.9 * dt);
      body.applyTorqueImpulse(corr, true);
    }

    // sudden velocity changes = crash
    const dv = this._tmp.copy(this.velocity).sub(this.lastVel).length();
    if (dv > 5) this.impact = Math.max(this.impact, clamp(dv / 22, 0, 1));
    this.lastVel.copy(this.velocity);
    this.impact = Math.max(0, this.impact - dt * 2.2);

    // auto-recover if we end up on our roof
    if (this.up.y < 0.25 && this.speed < 4) {
      this.flippedTime += dt;
      if (this.flippedTime > 1.6) this.reset();
    } else this.flippedTime = 0;

    // fake gearbox for audio + HUD
    const ratio = clamp(Math.abs(fs) / (c.engine.topSpeed * (this.boosting ? c.boost.topSpeedMul : 1.02)), 0, 0.999);
    const g = c.engine.gears;
    // gears get longer as they go up
    const shaped = Math.pow(ratio, 0.72) * g;
    const gear = Math.min(g, Math.floor(shaped) + 1);
    const inGear = shaped - Math.floor(shaped);
    this.gear = fs < -0.5 ? 0 : gear;
    let rpmTarget = 0.18 + 0.82 * (gear === 1 ? inGear : 0.42 + 0.58 * inGear);
    if (grounded === 0 && throttle > 0) rpmTarget = 1;
    if (this.drifting && throttle > 0) rpmTarget = Math.max(rpmTarget, 0.85);
    if (throttle === 0 && Math.abs(fs) < 1) rpmTarget = 0.12;
    this.rpm += (rpmTarget - this.rpm) * Math.min(1, dt * (rpmTarget > this.rpm ? 9 : 5));
  }

  /** Called after world.step() so render interpolation has the newest transform. */
  postStep() {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.set(r.x, r.y, r.z, r.w);
  }

  registerHit(force: number) {
    const s = clamp(force / (this.config.mass * 260), 0, 1);
    if (s < 0.05) return;
    this.lastHit.time = performance.now();
    this.lastHit.strength = s;
    this.lastHit.pos.copy(this.currPos).addScaledVector(this.velocity, 0.03).addScaledVector(this.up, 0.5);
  }

  interpolate(alpha: number) {
    this.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
  }

  reset(position?: THREE.Vector3, yaw?: number) {
    const p = position ?? this._tmp.copy(this.currPos).setY(this.currPos.y + 1.2);
    const y = yaw ?? Math.atan2(-this.forward.x, -this.forward.z);
    this._q.setFromAxisAngle(UP, y);
    this.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    this.body.setRotation({ x: this._q.x, y: this._q.y, z: this._q.z, w: this._q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.flippedTime = 0;
    this.readBody();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    this.lastVel.set(0, 0, 0);
  }
}
