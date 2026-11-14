import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { QualitySettings } from '../../core/Quality';
import { makeGlowTexture } from '../../effects/textures';
import { RoadGrid, polyLength, walkPolyline } from './RoadGrid';
import { Occupancy, colorBox } from './props';
import type { CityMap } from './types';

const UP = new THREE.Vector3(0, 1, 0);

/** White vertices take the per-instance colour; everything else keeps its baked colour. */
function tintWhiteOnly(mat: THREE.Material, extraDecl = '', extraBody = '') {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${extraDecl}`)
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb = (color.r > 0.99 && color.r < 1.01 && color.g > 0.99 && color.b > 0.99) ? instanceColor.rgb : color.rgb;
        #endif`,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${extraBody}`);
    for (const [k, u] of Object.entries(mat.userData.uniforms ?? {})) sh.uniforms[k] = u as THREE.IUniform;
  };
}

function limb(g: THREE.BufferGeometry, v: number) {
  const n = g.attributes.position.count;
  g.setAttribute('aLimb', new THREE.BufferAttribute(new Float32Array(n).fill(v), 1));
  return g;
}

const CLOTHES = [0xe8e4d8, 0xcbb58a, 0x5a7fa8, 0x7a4a3a, 0x3f6b4f, 0x8a3050, 0x34343e, 0xd9a441, 0xb7c7d6];
const AWNINGS = [0xd43a3a, 0x2f7fd4, 0xe0b020, 0x35a060, 0xd46a2a, 0xe8e0d0];

interface Ped {
  road: number;
  s: number;
  dir: 1 | -1;
  side: 1 | -1;
  speed: number;
  dodge: number;
}

export interface StreetLife {
  group: THREE.Group;
  update(dt: number, time: number, player: THREE.Vector3): void;
}

/** Pedestrians, vendor carts and patrol drones — the things that make a street feel lived in. */
export function buildStreetLife(
  map: CityMap,
  grid: RoadGrid,
  occ: Occupancy,
  world: RAPIER.World,
  q: QualitySettings,
  streetLight: number,
): StreetLife {
  const group = new THREE.Group();
  let seed = 4242;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const roads = map.roads;
  const lens = roads.map((r) => polyLength(r.p));
  const m4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const out = { x: 0, z: 0, dx: 0, dz: 0 };
  const sample = (road: number, s: number) => {
    const p = roads[road].p;
    let acc = 0;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1];
      const len = Math.hypot(dx, dz) || 1;
      if (s <= acc + len || i + 5 >= p.length) {
        const t = Math.max(0, Math.min(1, (s - acc) / len));
        out.x = p[i] + dx * t;
        out.z = p[i + 1] + dz * t;
        out.dx = dx / len;
        out.dz = dz / len;
        return out;
      }
      acc += len;
    }
    return out;
  };

  // ------------------------------------------------------------ pedestrians
  const skin = new THREE.Color(0.34, 0.22, 0.14);
  const pedGeo = mergeGeometries([
    limb(colorBox(0.16, 0.8, 0.18, -0.11, 0.4, 0, 0xffffff), 1),
    limb(colorBox(0.16, 0.8, 0.18, 0.11, 0.4, 0, 0xffffff), -1),
    limb(colorBox(0.44, 0.82, 0.25, 0, 1.08, 0, 0xffffff), 0),
    limb(colorBox(0.1, 0.62, 0.12, -0.28, 1.14, 0, 0xffffff), -0.5),
    limb(colorBox(0.1, 0.62, 0.12, 0.28, 1.14, 0, 0xffffff), 0.5),
    limb(colorBox(0.22, 0.24, 0.22, 0, 1.62, 0, skin), 0),
    limb(colorBox(0.2, 0.035, 0.03, 0, 1.65, -0.12, 0x00f0ff, 2.2), 0), // visor
  ]);
  const pedMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const uTime = { value: 0 };
  pedMat.userData.uniforms = { uTime };
  tintWhiteOnly(
    pedMat,
    'attribute float aLimb;\nattribute vec2 aAnim;\nuniform float uTime;',
    `float sw = sin(uTime * aAnim.x + aAnim.y) * aLimb;
     float pivot = abs(aLimb) > 0.9 ? 0.8 : 1.45;
     transformed.z += sw * (pivot - position.y) * 0.6;
     transformed.y += abs(sin(uTime * aAnim.x + aAnim.y)) * 0.03;`,
  );
  const PEDS = Math.floor(260 * Math.min(1.3, q.particles + 0.2));
  const walkable = roads.map((r, i) => (r.c >= 1 && r.c <= 4 && lens[i] > 40 ? i : -1)).filter((i) => i >= 0);
  const pedMesh = new THREE.InstancedMesh(pedGeo, pedMat, PEDS);
  pedMesh.frustumCulled = false;
  const anim = new Float32Array(PEDS * 2);
  const peds: Ped[] = [];
  const spawnPed = (p: Ped, near?: THREE.Vector3) => {
    let road = walkable[Math.floor(rnd() * walkable.length)];
    if (near) {
      // keep the crowd around the player: retry until a street in the right distance band comes up
      for (let k = 0; k < 14; k++) {
        const r = roads[road];
        const mid = (r.p.length >> 2) << 1;
        const d = Math.hypot(r.p[mid] - near.x, r.p[mid + 1] - near.z);
        if (d > 50 && d < 260) break;
        road = walkable[Math.floor(rnd() * walkable.length)];
      }
    }
    p.road = road;
    p.s = rnd() * lens[road];
    p.dir = rnd() > 0.5 ? 1 : -1;
    p.side = rnd() > 0.5 ? 1 : -1;
    p.speed = 1.0 + rnd() * 0.7;
    p.dodge = 0;
  };
  for (let i = 0; i < PEDS; i++) {
    const p: Ped = { road: 0, s: 0, dir: 1, side: 1, speed: 1, dodge: 0 };
    spawnPed(p);
    peds.push(p);
    anim[i * 2] = 5.5 + rnd() * 2.5;
    anim[i * 2 + 1] = rnd() * 6.28;
    pedMesh.setColorAt(i, new THREE.Color(CLOTHES[Math.floor(rnd() * CLOTHES.length)]).multiplyScalar(0.62));
  }
  pedGeo.setAttribute('aAnim', new THREE.InstancedBufferAttribute(anim, 2));
  group.add(pedMesh);

  // ------------------------------------------------------------ vendor carts (knock-over physics props)
  const stallGeo = mergeGeometries([
    colorBox(1.6, 0.12, 0.9, 0, 0.85, 0, 0x2a1d10),
    colorBox(0.08, 0.62, 0.62, -0.8, 0.31, 0, 0x0c0c0e),
    colorBox(0.08, 0.62, 0.62, 0.8, 0.31, 0, 0x0c0c0e),
    colorBox(0.06, 0.8, 0.06, 0, 0.42, 0.38, 0x0c0c0e),
    colorBox(0.42, 0.26, 0.6, -0.5, 1.04, 0, 0xff8a1e, 0.55),
    colorBox(0.42, 0.22, 0.6, 0, 1.02, 0, 0x6fd23a, 0.45),
    colorBox(0.42, 0.3, 0.6, 0.5, 1.06, 0, 0xe8324a, 0.5),
    colorBox(0.05, 1.35, 0.05, -0.76, 1.56, -0.4, 0x15151a),
    colorBox(0.05, 1.35, 0.05, 0.76, 1.56, -0.4, 0x15151a),
    colorBox(0.05, 1.35, 0.05, -0.76, 1.56, 0.4, 0x15151a),
    colorBox(0.05, 1.35, 0.05, 0.76, 1.56, 0.4, 0x15151a),
    colorBox(1.9, 0.06, 1.25, 0, 2.25, 0, 0xffffff),
    colorBox(1.7, 0.07, 0.05, 0, 2.14, -0.62, streetLight, 3),
    colorBox(0.11, 0.11, 0.11, 0, 1.98, 0, 0xffe2a8, 6),
  ]);
  const stallMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  tintWhiteOnly(stallMat);
  const stallBodies: RAPIER.RigidBody[] = [];
  const stallColors: THREE.Color[] = [];
  const pools: number[] = [];
  const MAX_STALLS = Math.floor(320 * Math.min(1.2, q.particles + 0.3));
  roads.forEach((r, ri) => {
    if (r.c < 2 || r.c > 4 || lens[ri] < 50) return;
    walkPolyline(r.p, 38 + rnd() * 30, 10 + rnd() * 25, (x, z, dx, dz) => {
      if (stallBodies.length >= MAX_STALLS || rnd() < 0.3) return;
      const side = rnd() > 0.5 ? 1 : -1;
      const nx = -dz * side, nz = dx * side;
      const off = r.c <= 3 ? r.w / 2 + 1.45 : r.w / 2 - 0.35;
      const px = x + nx * off, pz = z + nz * off;
      // only in front of real frontages, never at a junction
      if (!occ.has(x + nx * (r.w / 2 + 5), z + nz * (r.w / 2 + 5)) || grid.nearest(px, pz, 1.5, ri)) return;
      const y = r.c <= 3 ? 0.18 : 0.02;
      quat.setFromAxisAngle(UP, Math.atan2(nx, nz) + (rnd() - 0.5) * 0.3);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(px, y, pz).setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
          .setAngularDamping(0.8).setLinearDamping(0.4),
      );
      world.createCollider(RAPIER.ColliderDesc.cuboid(0.85, 1.1, 0.5).setTranslation(0, 1.12, 0).setMass(45).setFriction(0.8).setRestitution(0.1), body);
      body.sleep();
      stallBodies.push(body);
      stallColors.push(new THREE.Color(AWNINGS[Math.floor(rnd() * AWNINGS.length)]).multiplyScalar(0.5));
      pools.push(px - nx * 0.6, pz - nz * 0.6);
    });
  });
  const stallMesh = new THREE.InstancedMesh(stallGeo, stallMat, Math.max(1, stallBodies.length));
  stallMesh.count = stallBodies.length;
  stallMesh.frustumCulled = false;
  stallColors.forEach((c, i) => stallMesh.setColorAt(i, c));
  group.add(stallMesh);
  const syncStalls = (all: boolean) => {
    for (let i = 0; i < stallBodies.length; i++) {
      const b = stallBodies[i];
      if (!all && b.isSleeping()) continue;
      const t = b.translation(), r = b.rotation();
      m4.compose(v.set(t.x, t.y, t.z), quat.set(r.x, r.y, r.z, r.w), one);
      stallMesh.setMatrixAt(i, m4);
    }
    stallMesh.instanceMatrix.needsUpdate = true;
  };
  syncStalls(true);
  // warm bulb light spilling on the ground under each cart
  const poolGeo = new THREE.PlaneGeometry(1, 1);
  poolGeo.rotateX(-Math.PI / 2);
  const poolMesh = new THREE.InstancedMesh(
    poolGeo,
    new THREE.MeshBasicMaterial({
      map: makeGlowTexture(), color: new THREE.Color(0xffc070).multiplyScalar(0.5), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    }),
    Math.max(1, pools.length / 2),
  );
  for (let i = 0; i < pools.length; i += 2) {
    m4.compose(v.set(pools[i], 0.2, pools[i + 1]), quat.identity(), new THREE.Vector3(7, 1, 7));
    poolMesh.setMatrixAt(i / 2, m4);
  }
  poolMesh.count = pools.length / 2;
  poolMesh.frustumCulled = false;
  poolMesh.renderOrder = 2;
  group.add(poolMesh);
  void streetLight;

  // ------------------------------------------------------------ patrol drones
  const droneGeo = mergeGeometries([
    colorBox(0.7, 0.16, 0.7, 0, 0, 0, 0x0a0a0e),
    colorBox(1.5, 0.04, 0.08, 0, 0.06, 0, 0x16161c),
    colorBox(0.08, 0.04, 1.5, 0, 0.06, 0, 0x16161c),
    colorBox(0.1, 0.06, 0.1, 0.34, 0.02, -0.34, 0xff1030, 6),
    colorBox(0.1, 0.06, 0.1, -0.34, 0.02, -0.34, 0x30ff60, 6),
    colorBox(0.2, 0.06, 0.2, 0, -0.1, 0, 0xcfe8ff, 5),
  ]);
  const DRONES = Math.floor(70 * Math.min(1.3, q.particles + 0.2));
  const droneMesh = new THREE.InstancedMesh(droneGeo, new THREE.MeshBasicMaterial({ vertexColors: true }), DRONES);
  droneMesh.frustumCulled = false;
  group.add(droneMesh);
  const drones = Array.from({ length: DRONES }, () => {
    const r = roads[walkable[Math.floor(rnd() * walkable.length)]];
    const k = (Math.floor(rnd() * (r.p.length / 2)) | 0) * 2;
    return { x: r.p[k], z: r.p[k + 1], y: 9 + rnd() * 22, rad: 6 + rnd() * 22, w: (0.15 + rnd() * 0.4) * (rnd() > 0.5 ? 1 : -1), ph: rnd() * 6.28 };
  });

  let respawn = 0;
  return {
    group,
    update(dt, time, player) {
      uTime.value = time;
      // pedestrians
      for (let i = 0; i < PEDS; i++) {
        const p = peds[i];
        const r = roads[p.road];
        p.s += p.speed * p.dir * dt;
        if (p.s < 0 || p.s > lens[p.road]) {
          p.dir = p.dir > 0 ? -1 : 1;
          p.s = Math.max(0, Math.min(lens[p.road], p.s));
        }
        const o = sample(p.road, p.s);
        const base = r.c <= 3 ? r.w / 2 + 0.75 : r.w / 2 - 1.1;
        const off = (base + p.dodge) * p.side;
        const x = o.x - o.dz * off, z = o.z + o.dx * off;
        // jump clear of the player's car
        const d2 = (player.x - x) * (player.x - x) + (player.z - z) * (player.z - z);
        p.dodge += ((d2 < 20 ? 1.6 : 0) - p.dodge) * Math.min(1, dt * (d2 < 20 ? 10 : 1.5));
        quat.setFromAxisAngle(UP, Math.atan2(-o.dx * p.dir, -o.dz * p.dir));
        m4.compose(v.set(x, r.c <= 3 ? 0.17 : 0.02, z), quat, one);
        pedMesh.setMatrixAt(i, m4);
      }
      // recycle a few far-away walkers each frame onto streets near the player
      for (let k = 0; k < 3; k++) {
        respawn = (respawn + 1) % PEDS;
        const p = peds[respawn];
        const r = roads[p.road];
        const mid = (r.p.length >> 2) << 1;
        if (Math.hypot(r.p[mid] - player.x, r.p[mid + 1] - player.z) > 380) spawnPed(p, player);
      }
      pedMesh.instanceMatrix.needsUpdate = true;
      syncStalls(false);
      // drones
      for (let i = 0; i < DRONES; i++) {
        const d = drones[i];
        const a = d.ph + time * d.w;
        v.set(d.x + Math.cos(a) * d.rad, d.y + Math.sin(time * 0.8 + d.ph) * 0.8, d.z + Math.sin(a) * d.rad);
        quat.setFromAxisAngle(UP, -a + (d.w > 0 ? Math.PI : 0));
        m4.compose(v, quat, one);
        droneMesh.setMatrixAt(i, m4);
      }
      droneMesh.instanceMatrix.needsUpdate = true;
    },
  };
}
