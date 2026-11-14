import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { QualitySettings } from '../core/Quality';
import { makeChevronTexture, makeGlowTexture, makeGroundTextures, makeRoadTextures, makeTruckArtTexture } from '../effects/textures';
import { makeSky, makeTowerMaterial } from './materials';

const CYAN = 0x00f0ff;
const MAGENTA = 0xff2bd6;
const AMBER = 0xffa630;
const VIOLET = 0x7a5cff;
const UP = new THREE.Vector3(0, 1, 0);

/** Collects unit boxes into a single InstancedMesh. */
class BoxBatch {
  private items: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  add(pos: THREE.Vector3, size: THREE.Vector3, quat: THREE.Quaternion, color: THREE.Color) {
    this.items.push({ m: new THREE.Matrix4().compose(pos, quat, size), c: color });
  }
  build(material: THREE.Material) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, this.items.length);
    this.items.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m);
      mesh.setColorAt(i, it.c);
    });
    mesh.frustumCulled = false;
    return mesh;
  }
}

export interface World {
  group: THREE.Group;
  spawn: { position: THREE.Vector3; yaw: number };
  update(dt: number, time: number, focus: THREE.Vector3, player?: THREE.Vector3): void;
  fogColor: THREE.Color;
  fogDensity: number;
  /** Top-down map image (px per metre = scale) for the HUD. */
  minimap?: { canvas: HTMLCanvasElement; scale: number; half: [number, number] };
  roadNameAt?(x: number, z: number): string;
  /** 0 dry .. 1 soaked: roads turn glossy, fog thickens. */
  setWet?(k: number): void;
  attribution?: string;
  /** Checkpoint race routes available in this world. */
  routes?: import('../race/Race').Route[];
}

/**
 * Phase 1 proving ground: a 1.9 km neon circuit with a long straight, a stunt
 * park (ramps of three sizes), a drift pad and knock-over props.
 */
export function buildTestTrack(world: RAPIER.World, quality: QualitySettings): World {
  const group = new THREE.Group();
  const fogColor = new THREE.Color(0x150a2a);
  const fogDensity = 0.0021;

  const neon = new BoxBatch();
  const dark = new BoxBatch();
  const pools: { p: THREE.Vector3; c: THREE.Color; s: number }[] = [];
  const q0 = new THREE.Quaternion();
  const hdr = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k);

  const fixedBox = (pos: THREE.Vector3, size: THREE.Vector3, quat = q0, friction = 0.9) => {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
        .setFriction(friction),
    );
  };

  // ---------------------------------------------------------------- ground
  const G = 1600;
  const gt = makeGroundTextures();
  gt.map.repeat.set(G / 24, G / 24);
  gt.roughnessMap.repeat.set(G / 60, G / 60);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(G, G),
    new THREE.MeshStandardMaterial({
      map: gt.map,
      roughnessMap: gt.roughnessMap,
      roughness: 1,
      metalness: 0.1,
      envMapIntensity: 1.0,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);
  fixedBox(new THREE.Vector3(0, -1, 0), new THREE.Vector3(G, 2, G));

  // ---------------------------------------------------------------- circuit
  const pts = [
    [0, 300], [0, 100], [0, -100], [0, -280], [50, -370], [160, -400], [270, -350], [310, -230],
    [250, -120], [230, -10], [300, 90], [330, 210], [270, 320], [150, 380], [40, 370],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const ROAD_W = 20;
  const SEG = 700;
  const length = curve.getLength();
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const frames: { p: THREE.Vector3; t: THREE.Vector3; s: THREE.Vector3 }[] = [];
  for (let i = 0; i <= SEG; i++) {
    const u = i / SEG;
    const p = curve.getPointAt(u % 1);
    const t = curve.getTangentAt(u % 1).normalize();
    const s = new THREE.Vector3().crossVectors(t, UP).normalize();
    frames.push({ p, t, s });
    const l = p.clone().addScaledVector(s, -ROAD_W / 2);
    const r = p.clone().addScaledVector(s, ROAD_W / 2);
    pos.push(l.x, 0.04, l.z, r.x, 0.04, r.z);
    const v = (u * length) / 24;
    uv.push(0, v, 1, v);
    if (i < SEG) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  roadGeo.setIndex(idx);
  roadGeo.computeVertexNormals();
  const rt = makeRoadTextures(CYAN, AMBER);
  const road = new THREE.Mesh(
    roadGeo,
    new THREE.MeshStandardMaterial({
      map: rt.map,
      emissive: 0xffffff,
      emissiveMap: rt.emissiveMap,
      emissiveIntensity: 2.4,
      roughness: 0.22,
      metalness: 0.25,
      envMapIntensity: 2.2,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  group.add(road);

  // pylons + gates along the circuit
  const step = Math.round(SEG / (length / 16));
  let gateN = 0;
  for (let i = 0; i < SEG; i += step) {
    const f = frames[i];
    const yaw = Math.atan2(-f.t.x, -f.t.z);
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const n = i / step;
    for (const side of [-1, 1]) {
      const c = side < 0 ? CYAN : MAGENTA;
      const base = f.p.clone().addScaledVector(f.s, side * (ROAD_W / 2 + 1.2));
      neon.add(base.clone().setY(0.75), new THREE.Vector3(0.14, 1.5, 0.14), q, hdr(c, 3.2));
      dark.add(base.clone().setY(0.1), new THREE.Vector3(0.5, 0.2, 0.5), q, new THREE.Color(0x15151c));
      if (n % 2 === 0) pools.push({ p: base.clone().setY(0.07), c: hdr(c, 0.55), s: 6 });
    }
    // an arch every ~130 m
    if (n % 8 === 0) {
      const c = gateN++ % 2 ? MAGENTA : CYAN;
      const half = ROAD_W / 2 + 2.6;
      const H = 9.5;
      for (const side of [-1, 1]) {
        const b = f.p.clone().addScaledVector(f.s, side * half);
        dark.add(b.clone().setY(H / 2), new THREE.Vector3(0.9, H, 0.9), q, new THREE.Color(0x101018));
        neon.add(b.clone().setY(H / 2).addScaledVector(f.s, -side * 0.5), new THREE.Vector3(0.12, H, 0.3), q, hdr(c, 3.5));
        fixedBox(b.clone().setY(H / 2), new THREE.Vector3(0.9, H, 0.9), q);
        pools.push({ p: b.clone().setY(0.07).addScaledVector(f.s, -side * 2), c: hdr(c, 0.9), s: 14 });
      }
      dark.add(f.p.clone().setY(H + 0.4), new THREE.Vector3(half * 2 + 0.9, 0.9, 0.9), q, new THREE.Color(0x101018));
      neon.add(f.p.clone().setY(H - 0.15), new THREE.Vector3(half * 2, 0.14, 0.4), q, hdr(c, 3.5));
    }
  }

  // ---------------------------------------------------------------- stunt park (infield, west of the straight)
  const chevron = makeChevronTexture(AMBER);
  const rampMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a24, emissive: 0xffffff, emissiveMap: chevron, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.5,
  });
  const addRamp = (x: number, z: number, width: number, len: number, angleDeg: number, yaw = 0) => {
    const a = THREE.MathUtils.degToRad(angleDeg);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(a, yaw, 0, 'YXZ'));
    const th = 0.5;
    const y = (len / 2) * Math.abs(Math.sin(a)) - (th / 2) * Math.cos(a) + 0.02;
    const p = new THREE.Vector3(x, y, z);
    const size = new THREE.Vector3(width, th, len);
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const uvA = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) * (width / 4), uvA.getY(i) * (len / 4));
    const m = new THREE.Mesh(geo, rampMat);
    m.position.copy(p);
    m.quaternion.copy(q);
    group.add(m);
    fixedBox(p, size, q, 1);
    // glowing side rails
    for (const s of [-1, 1]) {
      const rp = new THREE.Vector3(s * (width / 2), th / 2 + 0.06, 0).applyQuaternion(q).add(p);
      neon.add(rp, new THREE.Vector3(0.12, 0.12, len), q, hdr(AMBER, 3));
    }
    pools.push({ p: new THREE.Vector3(x, 0.07, z), c: hdr(AMBER, 0.6), s: width * 1.6 });
  };
  addRamp(-40, 40, 9, 14, 9); // warm-up kicker
  addRamp(-70, 0, 10, 18, 15); // proper jump
  addRamp(-105, -40, 12, 26, 21); // send it
  addRamp(6, -120, 7, 12, 8); // on the straight, right lane
  addRamp(-70, -90, 10, 18, -15); // landing ramp for the middle jump

  // drift pad
  const padC = new THREE.Vector3(-230, 0, 60);
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const p = padC.clone().add(new THREE.Vector3(Math.cos(a) * 62, 0, Math.sin(a) * 62));
    neon.add(p.clone().setY(0.6), new THREE.Vector3(0.16, 1.2, 0.16), q0, hdr(i % 2 ? VIOLET : MAGENTA, 3.2));
    if (i % 2 === 0) pools.push({ p: p.clone().setY(0.07), c: hdr(MAGENTA, 0.5), s: 7 });
  }
  dark.add(padC.clone().setY(13), new THREE.Vector3(5, 26, 5), q0, new THREE.Color(0x0e0e16));
  fixedBox(padC.clone().setY(13), new THREE.Vector3(5, 26, 5));
  for (let i = 0; i < 6; i++)
    neon.add(padC.clone().setY(3 + i * 4), new THREE.Vector3(5.3, 0.25, 5.3), q0, hdr(i % 2 ? CYAN : MAGENTA, 3.4));
  pools.push({ p: padC.clone().setY(0.07), c: hdr(MAGENTA, 0.45), s: 40 });
  for (const off of [[-22, -26], [26, -18], [8, 30]]) {
    const p = padC.clone().add(new THREE.Vector3(off[0], 0, off[1]));
    dark.add(p.clone().setY(2), new THREE.Vector3(1.6, 4, 1.6), q0, new THREE.Color(0x0e0e16));
    neon.add(p.clone().setY(4.1), new THREE.Vector3(1.8, 0.2, 1.8), q0, hdr(CYAN, 3.2));
    fixedBox(p.clone().setY(2), new THREE.Vector3(1.6, 4, 1.6));
    pools.push({ p: p.clone().setY(0.07), c: hdr(CYAN, 0.8), s: 12 });
  }

  // perimeter wall
  const W = G / 2 - 40;
  for (const [x, z, sx, sz] of [[0, -W, W * 2, 2], [0, W, W * 2, 2], [-W, 0, 2, W * 2], [W, 0, 2, W * 2]]) {
    dark.add(new THREE.Vector3(x, 3, z), new THREE.Vector3(sx, 6, sz), q0, new THREE.Color(0x0c0c14));
    neon.add(new THREE.Vector3(x, 6.1, z), new THREE.Vector3(sx, 0.2, sz + 0.1), q0, hdr(VIOLET, 2.5));
    fixedBox(new THREE.Vector3(x, 3, z), new THREE.Vector3(sx, 6, sz));
  }

  // holographic truck-art billboards beside the straight
  const holo = makeTruckArtTexture(CYAN, MAGENTA);
  const holoMat = new THREE.MeshBasicMaterial({
    map: holo, color: new THREE.Color(2.2, 2.2, 2.2), transparent: true, opacity: 0.92, side: THREE.DoubleSide,
  });
  for (const [x, z, ry] of [[-26, 150, 0.5], [30, -40, -0.6], [-28, -220, 0.5], [205, -200, 1.2], [345, 60, -1.3]]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(28, 14), holoMat);
    b.position.set(x, 17, z);
    b.rotation.y = ry;
    group.add(b);
    for (const s of [-10, 10]) {
      const p = new THREE.Vector3(s, 0, 0).applyAxisAngle(UP, ry).add(new THREE.Vector3(x, 5, z));
      dark.add(p, new THREE.Vector3(0.7, 10, 0.7), q0, new THREE.Color(0x101018));
      fixedBox(p, new THREE.Vector3(0.7, 10, 0.7));
    }
    pools.push({ p: new THREE.Vector3(x, 0.07, z), c: hdr(CYAN, 0.8), s: 40 });
  }

  // ---------------------------------------------------------------- build batches
  group.add(neon.build(new THREE.MeshBasicMaterial({ color: 0xffffff })));
  group.add(dark.build(new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.7, envMapIntensity: 1.2 })));

  const poolGeo = new THREE.PlaneGeometry(1, 1);
  poolGeo.rotateX(-Math.PI / 2);
  const poolMesh = new THREE.InstancedMesh(
    poolGeo,
    new THREE.MeshBasicMaterial({
      map: makeGlowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }),
    pools.length,
  );
  const mtx = new THREE.Matrix4();
  pools.forEach((pl, i) => {
    mtx.compose(pl.p, q0, new THREE.Vector3(pl.s, 1, pl.s));
    poolMesh.setMatrixAt(i, mtx);
    poolMesh.setColorAt(i, pl.c);
  });
  poolMesh.frustumCulled = false;
  poolMesh.renderOrder = 2;
  group.add(poolMesh);

  // ---------------------------------------------------------------- skyline backdrop
  const towerMat = makeTowerMaterial(fogColor, fogDensity * 0.55);
  const towers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), towerMat, quality.skyline);
  const tints = [CYAN, MAGENTA, VIOLET, AMBER, 0x39a0ff];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < quality.skyline; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 820 + rnd() * 520;
    const h = 60 + Math.pow(rnd(), 2.2) * 420;
    const w = 28 + rnd() * 50;
    mtx.compose(
      new THREE.Vector3(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r),
      new THREE.Quaternion().setFromAxisAngle(UP, Math.round(rnd() * 2) * (Math.PI / 4)),
      new THREE.Vector3(w, h, w * (0.7 + rnd() * 0.6)),
    );
    towers.setMatrixAt(i, mtx);
    towers.setColorAt(i, new THREE.Color(tints[Math.floor(rnd() * tints.length)]));
  }
  towers.frustumCulled = false;
  group.add(towers);

  const sky = makeSky(new THREE.Color(0x2a1050), new THREE.Color(0x02030a));
  group.add(sky);

  // ---------------------------------------------------------------- lights
  group.add(new THREE.HemisphereLight(0x4a55ff, 0x1a0825, 0.55));
  const moon = new THREE.DirectionalLight(0x8f7bff, 0.7);
  moon.position.set(-120, 200, 80);
  group.add(moon);

  // ---------------------------------------------------------------- knock-over props
  const PROP_N = 70;
  const coneGeo = new THREE.CylinderGeometry(0.08, 0.34, 0.9, 10);
  const propMesh = new THREE.InstancedMesh(
    coneGeo,
    new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff5a1f, emissiveIntensity: 1.5, roughness: 0.5 }),
    PROP_N,
  );
  propMesh.frustumCulled = false;
  group.add(propMesh);
  const propBodies: RAPIER.RigidBody[] = [];
  const addProp = (x: number, z: number) => {
    if (propBodies.length >= PROP_N) return;
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0.46, z).setAngularDamping(0.6).setLinearDamping(0.2));
    world.createCollider(RAPIER.ColliderDesc.cone(0.45, 0.32).setMass(4).setFriction(0.7).setRestitution(0.3), b);
    propBodies.push(b);
  };
  for (let i = 0; i < 12; i++) addProp(-6 + (i % 2) * 5.5 - 2.5, 180 - i * 22); // slalom on the straight's left lane
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) addProp(-150 + c * 1.6, 120 + r * 1.6); // bowling block
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    addProp(padC.x + Math.cos(a) * 30, padC.z + Math.sin(a) * 30);
  }
  for (let i = 0; i < 18; i++) addProp(-105 + (i % 6) * 2 - 5, -75 - Math.floor(i / 6) * 2); // wall after the big jump
  propMesh.count = propBodies.length;
  const pq = new THREE.Quaternion();
  const pp = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  const spawn = { position: new THREE.Vector3(0, 0.6, 250), yaw: 0 };

  return {
    group,
    spawn,
    fogColor,
    fogDensity,
    update(_dt, time, focus) {
      for (let i = 0; i < propBodies.length; i++) {
        const b = propBodies[i];
        const t = b.translation();
        const r = b.rotation();
        mtx.compose(pp.set(t.x, t.y, t.z), pq.set(r.x, r.y, r.z, r.w), one);
        propMesh.setMatrixAt(i, mtx);
      }
      propMesh.instanceMatrix.needsUpdate = true;
      sky.position.copy(focus);
      (sky.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
      towerMat.uniforms.uTime.value = time;
      holoMat.opacity = 0.86 + 0.08 * Math.sin(time * 7) * Math.sin(time * 1.3);
    },
  };
}
