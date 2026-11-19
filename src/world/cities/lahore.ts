import * as THREE from 'three';
import { addBoats, addGateJumps, addWater } from '../city/features';
import { addFoodGrills, addKiteSellers, addShortcutLanes } from '../city/streetpieces';
import type { CityDefinition, LandmarkContext } from '../city/types';

// Lahore glows amber and crimson, never the cool cyan of the coast
const CYAN = 0xffa630;
const MAGENTA = 0xff3355;
const glow = (c: number, k: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k) });

/**
 * Tower inspired by Minar-e-Pakistan: a petalled base opening like a flower, a tapering
 * fluted shaft with three balconies and a small dome — plus holographic rings that ride
 * up and down the shaft, and a beam into the haze.
 */
function minar(ctx: LandmarkContext) {
  const g = ctx.group;
  const stone = new THREE.MeshStandardMaterial({
    color: 0xf1ebdd, roughness: 0.4, metalness: 0.05, emissive: 0xffd9a8, emissiveIntensity: 0.3, envMapIntensity: 1.1,
  });
  // star-shaped plinth: two squares, one turned 45°
  const hull: number[] = [];
  for (const rot of [0, Math.PI / 4]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(30, 34, 1.4, 4, 1), stone);
    p.rotation.y = rot;
    p.position.y = 0.7;
    g.add(p);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    hull.push(Math.cos(a) * 34, 0, Math.sin(a) * 34, Math.cos(a) * 28, 1.4, Math.sin(a) * 28);
  }
  ctx.addHullCollider(new Float32Array(hull));
  // petals
  const petalGeo = new THREE.BoxGeometry(5.2, 9, 0.9);
  petalGeo.translate(0, 4.5, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const petal = new THREE.Mesh(petalGeo, stone);
    petal.position.set(Math.sin(a) * 9.5, 1.4, Math.cos(a) * 9.5);
    petal.rotation.set(0, a, 0);
    petal.rotateX(0.5);
    g.add(petal);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.2, 0.3), glow(i % 2 ? CYAN : MAGENTA, 3));
    tip.position.set(Math.sin(a) * 13.9, 9.4, Math.cos(a) * 13.9);
    tip.rotation.y = a;
    g.add(tip);
  }
  // shaft
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 5.4, 58, 16, 1), stone);
  shaft.position.y = 30.4;
  g.add(shaft);
  ctx.addBoxCollider(new THREE.Vector3(0, 30, 0), new THREE.Vector3(11, 60, 11));
  for (const [y, r] of [[22, 5.2], [38, 4.2], [52, 3.3]] as const) {
    const balcony = new THREE.Mesh(new THREE.CylinderGeometry(r + 1.1, r + 0.5, 1, 16), stone);
    balcony.position.y = y;
    g.add(balcony);
    const band = new THREE.Mesh(new THREE.TorusGeometry(r + 1.15, 0.12, 6, 40), glow(0xffa630, 3));
    band.rotation.x = Math.PI / 2;
    band.position.y = y + 0.55;
    g.add(band);
  }
  const cap = new THREE.Mesh(new THREE.SphereGeometry(2.6, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), stone);
  cap.position.y = 59.4;
  cap.scale.y = 1.5;
  g.add(cap);
  const spire = new THREE.Mesh(new THREE.BoxGeometry(0.2, 6, 0.2), glow(CYAN, 4));
  spire.position.y = 66;
  g.add(spire);
  // travelling hologram rings
  const rings: THREE.Mesh[] = [];
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(CYAN).multiplyScalar(3), transparent: true, opacity: 0.85 });
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(8, 0.14, 6, 64), ringMat);
    r.rotation.x = Math.PI / 2;
    rings.push(r);
    g.add(r);
  }
  const beamMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xffd9a8).multiplyScalar(0.5), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(9, 1.5, 420, 14, 1, true), beamMat);
  beam.position.y = 275;
  g.add(beam);
  ctx.animate((t) => {
    rings.forEach((r, i) => {
      const k = (t * 0.12 + i / 3) % 1;
      r.position.y = 6 + k * 54;
      r.scale.setScalar(1.25 - k * 0.75);
      r.rotation.z = t * (i % 2 ? 0.6 : -0.6);
    });
    beamMat.opacity = 0.13 + 0.04 * Math.sin(t * 1.3);
  });
}

/**
 * Great mosque inspired by Badshahi: an arcaded red-sandstone courtyard, a prayer hall under
 * three white domes, four corner minarets and a towering gate — with a ring of light
 * turning slowly over the courtyard.
 */
function badshahi(ctx: LandmarkContext) {
  const S = 150, T = 9;
  const rect = (cx: number, cz: number, w: number, d: number): [number, number][] => [
    [cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2],
  ];
  // courtyard arcades
  ctx.addFootprint(rect(0, S / 2 - T / 2, S, T), 9, 2);
  ctx.addFootprint(rect(-S / 2 + T / 2, 0, T, S - 2 * T), 9, 2);
  ctx.addFootprint(rect(S / 2 - T / 2, 0, T, S - 2 * T), 9, 2);
  // prayer hall along the far side, and the gatehouse opposite
  const hz = -S / 2 + 13;
  ctx.addFootprint(rect(0, hz, 96, 26), 17, 2);
  ctx.addFootprint(rect(0, hz, 30, 28), 24, 2);
  ctx.addFootprint(rect(0, S / 2 - 9, 30, 20), 22, 2);
  const g = ctx.group;
  const marble = new THREE.MeshStandardMaterial({
    color: 0xf4f0e8, roughness: 0.3, metalness: 0.05, emissive: 0xcfd6ff, emissiveIntensity: 0.34, envMapIntensity: 1.2,
  });
  const sandstone = new THREE.MeshStandardMaterial({ color: 0x9c3f2a, roughness: 0.7, emissive: 0xff5a2a, emissiveIntensity: 0.1 });
  // three bulbous domes
  for (const [x, r, y] of [[0, 12.5, 24], [-31, 9, 17], [31, 9, 17]] as const) {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r * 0.86, 3, 28), marble);
    drum.position.set(x, y + 1.5, hz);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 18), marble);
    dome.position.set(x, y + 3 + r * 0.72, hz);
    dome.scale.y = 1.08;
    const trim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.86, 0.14, 6, 48), glow(CYAN, 3));
    trim.rotation.x = Math.PI / 2;
    trim.position.set(x, y + 3, hz);
    const finial = new THREE.Mesh(new THREE.BoxGeometry(0.18, r * 0.6, 0.18), glow(0xffd23f, 4));
    finial.position.set(x, y + 3 + r * 1.85, hz);
    g.add(drum, dome, trim, finial);
  }
  // four corner minarets
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    const x = (sx * S) / 2, z = (sz * S) / 2;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.6, 50, 8, 1), sandstone);
    shaft.position.set(x, 25, z);
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(4, 3.2, 1.2, 8), marble);
    gallery.position.set(x, 50.6, z);
    const cupola = new THREE.Mesh(new THREE.SphereGeometry(2.9, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), marble);
    cupola.position.set(x, 54.4, z);
    cupola.scale.y = 1.3;
    for (const py of [51.8, 53.2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.2, 8), glow(0xffa630, 2.5));
      post.position.set(x, py, z);
      g.add(post);
    }
    const band = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.12, 6, 32), glow(MAGENTA, 3));
    band.rotation.x = Math.PI / 2;
    band.position.set(x, 30, z);
    g.add(shaft, gallery, cupola, band);
    ctx.addBoxCollider(new THREE.Vector3(x, 25, z), new THREE.Vector3(7, 50, 7));
  }
  // ring of light over the courtyard
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(46, 0.3, 8, 120),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(CYAN).multiplyScalar(3), transparent: true, opacity: 0.85 }),
  );
  halo.position.y = 46;
  g.add(halo);
  ctx.animate((t) => halo.rotation.set(Math.PI / 2 + Math.sin(t * 0.3) * 0.12, 0, t * 0.15));
}

/** Basant never ended: neon kites drifting over the old city. */
function kites(ctx: { group: THREE.Group; animate: (fn: (t: number) => void) => void; half: [number, number] }) {
  const N = 150;
  const shape = new THREE.Shape();
  shape.moveTo(0, 1.6);
  shape.lineTo(1.2, 0);
  shape.lineTo(0, -1.9);
  shape.lineTo(-1.2, 0);
  const mesh = new THREE.InstancedMesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false }),
    N,
  );
  mesh.frustumCulled = false;
  const cols = [CYAN, MAGENTA, 0xffd23f, 0x7dff5a, 0xff5a36, 0xb48cff];
  let seed = 515;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const data = Array.from({ length: N }, (_, i) => {
    mesh.setColorAt(i, new THREE.Color(cols[i % cols.length]).multiplyScalar(1.8));
    return {
      x: (rnd() - 0.5) * ctx.half[0] * 1.7, z: (rnd() - 0.5) * ctx.half[1] * 1.7, y: 45 + rnd() * 90,
      ph: rnd() * 6.28, sp: 0.3 + rnd() * 0.6, s: 1.2 + rnd() * 1.6,
    };
  });
  ctx.group.add(mesh);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  ctx.animate((t) => {
    for (let i = 0; i < N; i++) {
      const k = data[i];
      const a = t * k.sp + k.ph;
      p.set(k.x + Math.sin(a) * 9, k.y + Math.sin(a * 1.7) * 4, k.z + Math.cos(a * 0.8) * 9);
      e.set(-0.9 + Math.sin(a * 2.1) * 0.2, k.ph + Math.sin(a) * 0.5, Math.sin(a * 1.3) * 0.35);
      m.compose(p, q.setFromEuler(e), sc.setScalar(k.s));
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
}

export const lahore: CityDefinition = {
  id: 'lahore',
  name: 'NEO LAHORE',
  tagline: 'Walled City · 2099',
  blurb: 'Mughal sandstone, thirteen gates, and a sky full of neon kites.',
  codePrefix: 'LHR',
  map: '/cities/lahore/map.json',
  fog: { color: 0x8a4a3a, density: 0.0027 },
  sky: { horizon: 0xb8532f, zenith: 0x1a1430 },
  // a winter dusk: a huge red sun sinking into smog, every lamp wearing a halo
  atmosphere: {
    daylight: 0.42,
    sun: { dir: [-0.78, 0.15, -0.42], color: 0xff7a3a, size: 3.2, intensity: 1.1 },
    skyMid: 0x8a3a5a,
    stars: 0.12,
    hemi: { sky: 0xb86a6a, ground: 0x3a2418, intensity: 0.75 },
    ambient: 0.35,
    halo: 0.95,
    fogBreath: 0.12,
  },
  neon: [0xffa630, 0xff3355, 0xff6a1a, 0xffd23f],
  architecture: 'mughal',
  // warm, soft and smoky
  grade: { saturation: 0.04, contrast: -0.04, bloom: 1.0 },
  trafficMix: { tonga: 0.2, rickshaw: 0.32, bike: 0.28, car: 0.14, bus: 0.06 },
  skyLanes: 1,
  skylineGap: [-Math.PI * 0.75 - 0.55, -Math.PI * 0.75 + 0.55],
  streetLight: 0xffb060,
  facades: [0xb5533c, 0xc4703e, 0xd8b08a, 0xa8452e, 0xd9c7a8, 0x8f5a44, 0xcfa26a, 0xe2d6c2, 0x9fb3a0],
  heritageStone: 0xb04a30,
  signWords: [
    'لاہور', 'لسی', 'نہاری', 'پائے', 'حلیم', 'چنے', 'فالودہ', 'قلفی', 'انارکلی', 'فوڈ اسٹریٹ', 'حلوہ پوری', 'تکہ',
    'کڑاہی', 'پان', 'چائے', 'زیورات', 'LASSI', 'PAYE', 'NIHARI', 'FOOD STREET', 'ANARKALI', 'KARAHI', 'TIKKA', 'QULFI',
    'LAHORE 2099', 'HAVELI', 'BASANT', 'NEON GALI', 'CHAI', 'SWEETS', 'CYBER DHABA', 'KITE SHOP',
  ],
  driveSide: 'left',
  spawnNear: [-95, -829],
  // slower, and in a Bhairavi-like mode
  music: { bpm: 96, root: 69.3, scale: [0, 1, 3, 5, 7, 8, 10], progression: [0, 5, 3, 6] },
  landmarks: { minar, badshahi },
  features: (ctx) => {
    const [hx, hz] = ctx.half;
    kites(ctx);
    // the Ravi beyond the north-western edge, with slow boats on it
    addWater(ctx, [-hx - 1800, -hz - 900, -hx - 62, hz + 900], 0x1a0d0a, 0xff9a50);
    addBoats(ctx, [-hx - 520, -hz, -hx - 120, hz], 14, 0xffc070);
    // signature drive: kickers on the big roads, each launching you through a glowing gateway
    addGateJumps(ctx, 7, ctx.neon[0]);
    // the galis that really are quicker: lit, signed, and amber on the mini-map
    addShortcutLanes(ctx, 40, 'گلی · SHORTCUT');
    // street life: charcoal grills smoking along Food Street and the lanes, and kite sellers
    addFoodGrills(ctx, 90);
    addKiteSellers(ctx, 16);
  },
};
