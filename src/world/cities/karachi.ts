import * as THREE from 'three';
import type { CityDefinition, LandmarkContext } from '../city/types';

const CYAN = 0x00f0ff;
const glow = (c: number, k: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k) });

/**
 * White-marble mausoleum inspired by Mazar-e-Quaid: tapering cube, pointed arches, dome,
 * on a broad plinth — with a slow holographic halo and sky beams as the 2099 twist.
 */
function mazar(ctx: LandmarkContext) {
  const g = ctx.group;
  const marble = new THREE.MeshStandardMaterial({
    color: 0xf2efe6, roughness: 0.35, metalness: 0.05, emissive: 0xbfc8ff, emissiveIntensity: 0.32, envMapIntensity: 1.2,
  });
  const SQ = Math.SQRT2;
  // plinth: a low frustum the car can drive up
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(52 * SQ, 62 * SQ, 1.6, 4, 1), marble);
  plinth.rotation.y = Math.PI / 4;
  plinth.position.y = 0.8;
  g.add(plinth);
  const hull: number[] = [];
  for (const [r, y] of [[62, 0], [52, 1.6]]) for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) hull.push(sx * r, y, sz * r);
  ctx.addHullCollider(new Float32Array(hull));
  for (const [sx, sz, w, d] of [[0, 1, 104, 0.3], [0, -1, 104, 0.3], [1, 0, 0.3, 104], [-1, 0, 0.3, 104]]) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, d), glow(CYAN, 3));
    trim.position.set(sx * 52, 1.7, sz * 52);
    g.add(trim);
  }
  // main body
  const body = new THREE.Mesh(new THREE.CylinderGeometry(15 * SQ, 18 * SQ, 30, 4, 1), marble);
  body.rotation.y = Math.PI / 4;
  body.position.y = 16.6;
  g.add(body);
  ctx.addBoxCollider(new THREE.Vector3(0, 16.6, 0), new THREE.Vector3(35, 30, 35));
  // pointed arches glowing gold on all four faces
  const arch = new THREE.Shape();
  arch.moveTo(-5, 0);
  arch.lineTo(-5, 11);
  arch.quadraticCurveTo(-5, 18, 0, 21);
  arch.quadraticCurveTo(5, 18, 5, 11);
  arch.lineTo(5, 0);
  const archGeo = new THREE.ShapeGeometry(arch, 10);
  const gold = glow(0xffb040, 2.2);
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(archGeo, gold);
    const a = (i * Math.PI) / 2;
    m.position.set(Math.sin(a) * 17.3, 2.2, Math.cos(a) * 17.3);
    m.rotation.y = a;
    m.rotation.x = -0.1;
    g.add(m);
  }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(13.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), marble);
  dome.position.y = 31.6;
  dome.scale.y = 1.1;
  g.add(dome);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(13.6, 13.6, 0.5, 32), glow(CYAN, 3));
  drum.position.y = 31.7;
  g.add(drum);
  // holographic halo
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(24, 0.22, 8, 96),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(CYAN).multiplyScalar(3.5), transparent: true, opacity: 0.9 }),
  );
  halo.position.y = 40;
  const halo2 = halo.clone();
  halo2.scale.setScalar(0.72);
  g.add(halo, halo2);
  // sky beams from the four corners of the plinth
  const beamMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x9ad8ff).multiplyScalar(0.55), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const beamGeo = new THREE.CylinderGeometry(7, 1.2, 420, 12, 1, true);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    const b = new THREE.Mesh(beamGeo, beamMat);
    b.position.set(sx * 50, 210, sz * 50);
    g.add(b);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 2), glow(0xcfe8ff, 5));
    lamp.position.set(sx * 50, 2.2, sz * 50);
    g.add(lamp);
  }
  ctx.animate((t) => {
    halo.rotation.set(Math.PI / 2 + Math.sin(t * 0.4) * 0.25, t * 0.3, 0);
    halo2.rotation.set(Math.PI / 2 + Math.cos(t * 0.5) * 0.4, -t * 0.45, 0);
    beamMat.opacity = 0.13 + 0.04 * Math.sin(t * 1.7);
  });
}

/**
 * Colonial market hall inspired by Empress Market: four arcaded sandstone wings round a
 * courtyard and a tall clock tower — its clock now a rotating hologram.
 */
function empress(ctx: LandmarkContext) {
  const W = 84, D = 66, T = 12;
  const rect = (cx: number, cz: number, w: number, d: number): [number, number][] => [
    [cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2],
  ];
  ctx.addFootprint(rect(0, -D / 2 + T / 2, W, T), 11.5, 2);
  ctx.addFootprint(rect(0, D / 2 - T / 2, W, T), 11.5, 2);
  ctx.addFootprint(rect(-W / 2 + T / 2, 0, T, D - 2 * T), 11.5, 2);
  ctx.addFootprint(rect(W / 2 - T / 2, 0, T, D - 2 * T), 11.5, 2);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) ctx.addFootprint(rect((sx * (W - T)) / 2, (sz * (D - T)) / 2, T + 2, T + 2), 16, 2);
  // clock tower on the front wing
  const tz = -D / 2 + T / 2;
  ctx.addFootprint(rect(0, tz, 10, 10), 31, 2);
  ctx.addFootprint(rect(0, tz, 7.4, 7.4), 40, 2);
  const g = ctx.group;
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(6.4, 9, 4, 1),
    new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.6, emissive: 0xff8a3c, emissiveIntensity: 0.12 }),
  );
  roof.rotation.y = Math.PI / 4;
  roof.position.set(0, 44.5, tz);
  g.add(roof);
  const spire = new THREE.Mesh(new THREE.BoxGeometry(0.25, 7, 0.25), glow(CYAN, 4));
  spire.position.set(0, 52, tz);
  g.add(spire);
  // holographic clock faces
  const hands: THREE.Mesh[] = [];
  const ring = new THREE.RingGeometry(2.5, 2.9, 40);
  const handGeo = new THREE.PlaneGeometry(0.22, 2.3);
  handGeo.translate(0, 1.15, 0);
  const cy = glow(CYAN, 3.5);
  cy.side = THREE.DoubleSide;
  const mg = glow(0xff2bd6, 3.5);
  mg.side = THREE.DoubleSide;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const face = new THREE.Group();
    face.position.set(Math.sin(a) * 5.25, 26, tz + Math.cos(a) * 5.25);
    face.rotation.y = a;
    face.add(new THREE.Mesh(ring, cy));
    const h1 = new THREE.Mesh(handGeo, mg);
    const h2 = new THREE.Mesh(handGeo, cy);
    h2.scale.y = 0.65;
    face.add(h1, h2);
    hands.push(h1, h2);
    g.add(face);
  }
  ctx.animate((t) => {
    for (let i = 0; i < hands.length; i += 2) {
      hands[i].rotation.z = -t * 0.5;
      hands[i + 1].rotation.z = -t * 0.04;
    }
  });
}

export const karachi: CityDefinition = {
  id: 'karachi',
  name: 'NEO KARACHI',
  tagline: 'Saddar · 2099',
  map: '/cities/karachi/map.json',
  fog: { color: 0x1a0f26, density: 0.00185 },
  sky: { horizon: 0x3a1640, zenith: 0x02030a },
  streetLight: 0xff9a3c,
  facades: [0xd8c9a3, 0xc9a878, 0xd9a59a, 0x9fc7b0, 0x9db8cf, 0xa9a9a4, 0xd1a94a, 0xe6e2d8, 0xb98f6a],
  heritageStone: 0xc89b5e,
  signWords: [
    'چائے', 'بریانی', 'کراچی', 'نہاری', 'حلوہ پوری', 'پان', 'کباب', 'جوس', 'درزی', 'میڈیکل', 'موبائل', 'صرافہ',
    'کتاب گھر', 'بیکری', 'فالودہ', 'سپر اسٹور', 'CHAI', 'BIRYANI', 'NIHARI', 'PAAN', 'MOBILE ZONE', 'TAILOR',
    'SWEETS', 'CYBER CAFE', 'NEON BAZAAR', 'KARACHI 2099', 'HOTEL', 'JEWELLERS', 'RICKSHAW PARTS', 'HOLO SARI',
    'DATA CHAI', 'BUN KABAB',
  ],
  driveSide: 'left',
  spawnNear: [-212, 254],
  landmarks: { mazar, empress },
};
