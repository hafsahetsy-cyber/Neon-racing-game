import * as THREE from 'three';
import type { Vehicle } from '../vehicles/Vehicle';

export interface Route {
  name: string;
  blurb: string;
  len: number;
  /** x, z, yaw of the start line. */
  start: [number, number, number];
  /** Checkpoints in order; the last one is the finish. */
  cps: [number, number][];
}

export type RacePhase = 'idle' | 'countdown' | 'racing' | 'finished';

export interface Standing {
  id: string;
  name: string;
  /** Checkpoints passed. */
  cp: number;
  /** Metres to the next checkpoint. */
  dist: number;
  /** Finish time in seconds, if finished. */
  time?: number;
  self: boolean;
}

const CP_RADIUS = 17;
const COUNTDOWN = 5;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Checkpoint race. Timing and checkpoint detection are local to each player; the party only
 * shares "race started" and each player's progress, so it works identically solo or with friends.
 */
export class Race {
  phase: RacePhase = 'idle';
  route: Route | null = null;
  routeIndex = -1;
  /** Next checkpoint to hit. */
  cp = 0;
  /** Seconds: counts down to zero before the start, then up during the race. */
  clock = 0;
  finishTime = 0;
  distToNext = 0;
  readonly group = new THREE.Group();
  /** Fired with a short label for toasts/sounds: 'go', 'checkpoint', 'finish'. */
  onEvent: (e: 'go' | 'checkpoint' | 'finish', race: Race) => void = () => {};

  private gate: THREE.Group;
  private gateMat: THREE.MeshBasicMaterial;
  private beamMat: THREE.MeshBasicMaterial;
  private ring: THREE.Mesh;
  private nextMarker: THREE.Mesh;
  private arrow: THREE.Mesh;
  private time = 0;
  private _v = new THREE.Vector3();

  constructor() {
    const cyan = new THREE.Color(0x00f0ff);
    this.gateMat = new THREE.MeshBasicMaterial({ color: cyan.clone().multiplyScalar(3), fog: false });
    this.beamMat = new THREE.MeshBasicMaterial({
      color: cyan.clone().multiplyScalar(0.7), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    this.gate = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(CP_RADIUS * 0.5, CP_RADIUS * 0.5, 260, 24, 1, true), this.beamMat);
    beam.position.y = 130;
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(CP_RADIUS * 0.5, 0.28, 8, 48), this.gateMat);
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.4;
    const halo = new THREE.Mesh(new THREE.TorusGeometry(CP_RADIUS * 0.5, 0.14, 8, 48), this.gateMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 7;
    this.gate.add(beam, this.ring, halo);
    // the checkpoint after next, shown faintly so players can plan a line
    this.nextMarker = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 3, 200, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xff2bd6).multiplyScalar(0.6), transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide, fog: false,
      }),
    );
    this.nextMarker.position.y = 100;
    // pointer floating over the car
    const arrowGeo = new THREE.ConeGeometry(0.28, 0.9, 4);
    arrowGeo.rotateX(-Math.PI / 2); // tip towards -Z
    this.arrow = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa630).multiplyScalar(3), fog: false }));
    this.group.add(this.gate, this.nextMarker, this.arrow);
    this.group.visible = false;
  }

  get active() {
    return this.phase === 'countdown' || this.phase === 'racing';
  }

  /** Where player number `slot` lines up on the grid. */
  gridSlot(route: Route, slot: number) {
    const [x, z, yaw] = route.start;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const row = Math.floor(slot / 2);
    const pos = new THREE.Vector3(x, 0.7, z).addScaledVector(fwd, -(row * 8 + 3)).addScaledVector(right, slot % 2 ? 2.4 : -2.4);
    return { position: pos, yaw };
  }

  start(route: Route, index: number, vehicle: Vehicle, slot: number) {
    this.route = route;
    this.routeIndex = index;
    this.cp = 0;
    this.clock = COUNTDOWN;
    this.finishTime = 0;
    this.phase = 'countdown';
    const g = this.gridSlot(route, slot);
    vehicle.reset(g.position, g.yaw);
    vehicle.boost = 1;
    this.group.visible = true;
    this.place();
  }

  stop() {
    this.phase = 'idle';
    this.route = null;
    this.group.visible = false;
  }

  /** True while the car must be held on the grid. */
  get holding() {
    return this.phase === 'countdown';
  }

  private place() {
    const r = this.route!;
    const c = r.cps[Math.min(this.cp, r.cps.length - 1)];
    this.gate.position.set(c[0], 0, c[1]);
    const last = this.cp >= r.cps.length - 1;
    const col = new THREE.Color(last ? 0xffa630 : 0x00f0ff);
    this.gateMat.color.copy(col).multiplyScalar(3);
    this.beamMat.color.copy(col).multiplyScalar(0.7);
    const n = r.cps[this.cp + 1];
    this.nextMarker.visible = !!n;
    if (n) this.nextMarker.position.set(n[0], 100, n[1]);
  }

  update(dt: number, v: Vehicle) {
    if (this.phase === 'idle' || !this.route) return;
    this.time += dt;
    const r = this.route;
    if (this.phase === 'countdown') {
      this.clock -= dt;
      if (this.clock <= 0) {
        this.phase = 'racing';
        this.clock = 0;
        this.onEvent('go', this);
      }
    } else if (this.phase === 'racing') {
      this.clock += dt;
      const c = r.cps[this.cp];
      this.distToNext = Math.hypot(v.position.x - c[0], v.position.z - c[1]);
      if (this.distToNext < CP_RADIUS) {
        this.cp++;
        if (this.cp >= r.cps.length) {
          this.phase = 'finished';
          this.finishTime = this.clock;
          this.group.visible = false;
          this.onEvent('finish', this);
          return;
        }
        this.place();
        this.onEvent('checkpoint', this);
      }
    }
    if (this.phase === 'finished') return;
    // animate gate + pointer
    const pulse = 1 + 0.06 * Math.sin(this.time * 6);
    this.ring.scale.setScalar(pulse);
    this.gate.rotation.y = this.time * 0.6;
    this.beamMat.opacity = 0.18 + 0.06 * Math.sin(this.time * 4);
    const c = r.cps[Math.min(this.cp, r.cps.length - 1)];
    const top = v.config.chassis.center[1] + v.config.chassis.halfExtents[1];
    this.arrow.position.copy(v.position).addScaledVector(UP, top + 1.2 + 0.1 * Math.sin(this.time * 5));
    this._v.set(c[0], this.arrow.position.y, c[1]);
    this.arrow.lookAt(this._v);
    this.arrow.rotateY(Math.PI); // cone tip was built pointing -Z; lookAt aims +Z
    this.arrow.visible = this.distToNext > 30 || this.phase === 'countdown';
  }

  /** Position of the next checkpoint, for the mini-map. */
  target(): [number, number] | null {
    if (!this.active || !this.route) return null;
    return this.route.cps[Math.min(this.cp, this.route.cps.length - 1)];
  }
}

export function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

/** Orders players: finishers by time, then by checkpoints passed, then by distance to the next one. */
export function rank(list: Standing[]) {
  return [...list].sort((a, b) => {
    if (a.time !== undefined || b.time !== undefined) return (a.time ?? Infinity) - (b.time ?? Infinity);
    return b.cp - a.cp || a.dist - b.dist;
  });
}
