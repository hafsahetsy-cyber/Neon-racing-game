import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { polyLength } from './RoadGrid';
import { colorBox } from './props';
import type { CityDefinition, MapRoad } from './types';

const UP = new THREE.Vector3(0, 1, 0);
const HEAD = 0xeaf2ff;
const TAIL = 0xff1030;

interface Kind {
  size: [number, number, number];
  geo: THREE.BufferGeometry;
  speed: [number, number];
  share: number;
}

/** Original low-poly traffic designs; body colour comes from the instance colour. */
function makeKinds(): Kind[] {
  const W = 0xffffff;
  // decorated bus: tall, slab-sided, strung with lights like a jingle bus
  const bus = mergeGeometries([
    colorBox(2.5, 2.7, 9, 0, 1.75, 0, W),
    colorBox(2.56, 0.7, 8.2, 0, 2.35, 0, 0x05070a),
    colorBox(2.6, 0.08, 9.05, 0, 3.12, 0, 0xff2bd6, 3),
    colorBox(2.6, 0.08, 9.05, 0, 0.75, 0, 0xffd23f, 3),
    colorBox(2.1, 0.5, 0.5, 0, 3.35, -4.2, 0x00f0ff, 2.5),
    colorBox(0.4, 0.25, 0.1, -0.85, 1.0, -4.52, HEAD, 6),
    colorBox(0.4, 0.25, 0.1, 0.85, 1.0, -4.52, HEAD, 6),
    colorBox(0.4, 0.2, 0.1, -0.9, 1.0, 4.52, TAIL, 5),
    colorBox(0.4, 0.2, 0.1, 0.9, 1.0, 4.52, TAIL, 5),
  ]);
  // three-wheeler
  const rick = mergeGeometries([
    colorBox(1.3, 0.75, 2.5, 0, 0.75, 0, W),
    colorBox(1.25, 0.08, 2.0, 0, 1.75, 0.15, W),
    colorBox(1.2, 0.6, 0.06, 0, 1.4, 1.1, 0x05070a),
    colorBox(0.08, 0.7, 0.08, -0.58, 1.4, -0.75, 0x101014),
    colorBox(0.08, 0.7, 0.08, 0.58, 1.4, -0.75, 0x101014),
    colorBox(1.34, 0.05, 2.54, 0, 0.36, 0, 0x4dff9a, 2.5),
    colorBox(0.26, 0.2, 0.08, 0, 0.95, -1.27, HEAD, 6),
    colorBox(0.9, 0.1, 0.08, 0, 0.95, 1.27, TAIL, 5),
  ]);
  // old saloon turned hover-car
  const car = mergeGeometries([
    colorBox(1.8, 0.55, 4.3, 0, 0.72, 0, W),
    colorBox(1.6, 0.5, 2.1, 0, 1.24, 0.2, 0x06080c),
    colorBox(1.62, 0.06, 2.12, 0, 1.5, 0.2, W),
    colorBox(1.84, 0.05, 4.34, 0, 0.42, 0, 0x00f0ff, 2.5),
    colorBox(0.36, 0.14, 0.08, -0.6, 0.78, -2.17, HEAD, 6),
    colorBox(0.36, 0.14, 0.08, 0.6, 0.78, -2.17, HEAD, 6),
    colorBox(1.5, 0.1, 0.08, 0, 0.82, 2.17, TAIL, 5),
  ]);
  // motorbike
  const bike = mergeGeometries([
    colorBox(0.4, 0.5, 1.9, 0, 0.7, 0, W),
    colorBox(0.5, 0.75, 0.5, 0, 1.35, 0.15, 0x0a0a0e),
    colorBox(0.2, 0.16, 0.08, 0, 1.0, -0.97, HEAD, 6),
    colorBox(0.2, 0.1, 0.08, 0, 0.85, 0.97, TAIL, 5),
  ]);
  return [
    { size: [2.5, 3.2, 9], geo: bus, speed: [7, 11], share: 0.14 },
    { size: [1.3, 1.8, 2.5], geo: rick, speed: [7, 12], share: 0.34 },
    { size: [1.8, 1.5, 4.3], geo: car, speed: [9, 15], share: 0.34 },
    { size: [0.5, 1.7, 1.9], geo: bike, speed: [9, 16], share: 0.18 },
  ];
}

interface Agent {
  kind: number;
  slot: number;
  road: number;
  s: number;
  dir: 1 | -1;
  speed: number;
  cruise: number;
  lane: number;
  body: RAPIER.RigidBody;
}

const BODY_COLORS = [0x2a3a55, 0x55202a, 0x1f4a3a, 0x4a4420, 0x3a2a55, 0x555555, 0x10343c, 0x5a2e12];

/** Ambient traffic that follows the real road network and keeps to the correct side. */
export class Traffic {
  readonly group = new THREE.Group();
  private agents: Agent[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private lens: number[];
  private usable: number[] = [];
  private links = new Map<string, { road: number; start: boolean }[]>();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private out = { x: 0, z: 0, dx: 0, dz: 0 };
  private seed = 99;

  constructor(private roads: MapRoad[], def: CityDefinition, world: RAPIER.World, count: number) {
    const kinds = makeKinds();
    this.lens = roads.map((r) => polyLength(r.p));
    const key = (x: number, z: number) => `${Math.round(x / 3)},${Math.round(z / 3)}`;
    roads.forEach((r, i) => {
      if (r.c > 3 || this.lens[i] < 60) return;
      this.usable.push(i);
      const n = r.p.length;
      for (const [k, start] of [[key(r.p[0], r.p[1]), true], [key(r.p[n - 2], r.p[n - 1]), false]] as const) {
        let l = this.links.get(k);
        if (!l) this.links.set(k, (l = []));
        l.push({ road: i, start });
      }
    });
    const sideSign = def.driveSide === 'left' ? 1 : -1;
    const counts = kinds.map((k) => Math.round(count * k.share));
    kinds.forEach((kind, ki) => {
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
      // white vertices are bodywork (take the per-vehicle colour); everything else keeps its own glow
      mat.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace(
          '#include <color_vertex>',
          `#include <color_vertex>
          #ifdef USE_INSTANCING_COLOR
            vColor.rgb = (color.r > 0.99 && color.r < 1.01 && color.g > 0.99 && color.b > 0.99) ? instanceColor.rgb : color.rgb;
          #endif`,
        );
      };
      const mesh = new THREE.InstancedMesh(kind.geo, mat, Math.max(1, counts[ki]));
      mesh.count = counts[ki];
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.group.add(mesh);
      for (let i = 0; i < counts[ki]; i++) {
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, 0));
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(kind.size[0] / 2, kind.size[1] / 2, kind.size[2] / 2).setTranslation(0, kind.size[1] / 2 + 0.2, 0).setFriction(0.3),
          body,
        );
        const cruise = kind.speed[0] + this.rnd() * (kind.speed[1] - kind.speed[0]);
        const a: Agent = { kind: ki, slot: i, road: 0, s: 0, dir: 1, speed: cruise, cruise, lane: 0, body };
        this.place(a, this.usable[Math.floor(this.rnd() * this.usable.length)], this.rnd() > 0.5, sideSign, true);
        mesh.setColorAt(i, new THREE.Color(BODY_COLORS[Math.floor(this.rnd() * BODY_COLORS.length)]).multiplyScalar(0.55));
        this.agents.push(a);
      }
    });
    this.sideSign = sideSign;
  }
  private sideSign = 1;

  private rnd() {
    return (this.seed = (this.seed * 16807) % 2147483647) / 2147483647;
  }

  private place(a: Agent, road: number, fromStart: boolean, sideSign: number, randomS = false) {
    const r = this.roads[road];
    a.road = road;
    a.dir = r.o ? 1 : fromStart ? 1 : -1;
    a.s = randomS ? this.rnd() * this.lens[road] : a.dir > 0 ? 0 : this.lens[road];
    // keep-left (or right): offset from the centreline towards the kerb on our side
    a.lane = r.o ? (this.rnd() - 0.5) * (r.w - 3.5) : sideSign * a.dir * (r.w / 4 + (this.rnd() - 0.5) * 0.8);
  }

  private sample(road: number, s: number) {
    const p = this.roads[road].p;
    let acc = 0;
    const o = this.out;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1];
      const len = Math.hypot(dx, dz);
      if (s <= acc + len || i + 5 >= p.length) {
        const t = Math.max(0, Math.min(1, (s - acc) / (len || 1)));
        o.x = p[i] + dx * t;
        o.z = p[i + 1] + dz * t;
        o.dx = dx / (len || 1);
        o.dz = dz / (len || 1);
        return o;
      }
      acc += len;
    }
    return o;
  }

  update(dt: number, player: THREE.Vector3) {
    for (const a of this.agents) {
      const r = this.roads[a.road];
      const o = this.sample(a.road, a.s);
      const fx = o.dx * a.dir, fz = o.dz * a.dir;
      // left of travel = (fz, -fx)
      const x = o.x + o.dz * a.lane, z = o.z - o.dx * a.lane;
      // brake for the player if they are right in front
      const px = player.x - x, pz = player.z - z;
      const ahead = px * fx + pz * fz;
      const lateral = Math.abs(px * fz - pz * fx);
      const blocked = ahead > 0 && ahead < 16 && lateral < 2.6;
      const target = blocked ? 0 : a.cruise;
      a.speed += Math.max(-14 * dt, Math.min(5 * dt, target - a.speed));
      a.s += a.speed * dt * a.dir;

      if (a.s > this.lens[a.road] || a.s < 0) {
        const p = r.p;
        const end = a.s < 0 ? [p[0], p[1]] : [p[p.length - 2], p[p.length - 1]];
        const opts = (this.links.get(`${Math.round(end[0] / 3)},${Math.round(end[1] / 3)}`) ?? []).filter(
          (l) => l.road !== a.road && (l.start || !this.roads[l.road].o),
        );
        if (opts.length) {
          const pick = opts[Math.floor(this.rnd() * opts.length)];
          this.place(a, pick.road, pick.start, this.sideSign);
        } else if (!r.o) {
          a.dir = a.dir > 0 ? -1 : 1;
          a.s = Math.max(0, Math.min(this.lens[a.road], a.s));
          a.lane = -a.lane;
        } else {
          this.place(a, this.usable[Math.floor(this.rnd() * this.usable.length)], true, this.sideSign);
        }
        continue;
      }
      this.q.setFromAxisAngle(UP, Math.atan2(-fx, -fz));
      this.v.set(x, 0.05, z);
      this.m4.compose(this.v, this.q, this.one);
      this.meshes[a.kind].setMatrixAt(a.slot, this.m4);
      a.body.setNextKinematicTranslation(this.v);
      a.body.setNextKinematicRotation(this.q);
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }
}
