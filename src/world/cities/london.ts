import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addWaterTaxis } from '../city/desert';
import { colorBox } from '../city/props';
import { addKerbProps } from '../city/streetpieces';
import type { CityDefinition, LandmarkContext } from '../city/types';
import { addSearchlights, addTubeRun } from '../city/urban';

const RED = 0xff2a3a;
const WHITE = 0xf2f6ff;
const glow = (c: number, k: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k) });

/**
 * A gothic clock tower inspired by the one at Westminster: a tall stone shaft, a belfry stage
 * with four great dials, and a slate spire — the dials now sheets of light.
 */
function clock(ctx: LandmarkContext) {
  const g = ctx.group;
  const stone = new THREE.MeshStandardMaterial({ color: 0xc9b98f, roughness: 0.7, emissive: 0xffd9a0, emissiveIntensity: 0.16 });
  const slate = new THREE.MeshStandardMaterial({ color: 0x2c313a, roughness: 0.5, metalness: 0.2 });
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(11, 60, 11), stone);
  shaft.position.y = 30;
  g.add(shaft);
  ctx.addBoxCollider(new THREE.Vector3(0, 40, 0), new THREE.Vector3(12.5, 80, 12.5));
  // vertical ribs up the shaft
  for (const [x, z] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(1.4, 74, 1.4), stone);
    rib.position.set(x * 5.4, 37, z * 5.4);
    g.add(rib);
    const pin = new THREE.Mesh(new THREE.ConeGeometry(1.1, 7, 4), slate);
    pin.position.set(x * 5.4, 77.5, z * 5.4);
    pin.rotation.y = Math.PI / 4;
    g.add(pin);
  }
  const belfry = new THREE.Mesh(new THREE.BoxGeometry(12.4, 13, 12.4), stone);
  belfry.position.y = 66.5;
  g.add(belfry);
  const hands: THREE.Mesh[] = [];
  const dialMat = glow(0xfff1cf, 2.2);
  dialMat.side = THREE.DoubleSide;
  const handMat = new THREE.MeshBasicMaterial({ color: 0x14161a, side: THREE.DoubleSide });
  const handGeo = new THREE.PlaneGeometry(0.42, 4.3);
  handGeo.translate(0, 2.15, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const face = new THREE.Group();
    face.position.set(Math.sin(a) * 6.28, 66.5, Math.cos(a) * 6.28);
    face.rotation.y = a;
    face.add(new THREE.Mesh(new THREE.CircleGeometry(4.9, 40), dialMat));
    const rim = new THREE.Mesh(new THREE.RingGeometry(4.9, 5.4, 40), new THREE.MeshBasicMaterial({ color: 0x1a1c20, side: THREE.DoubleSide }));
    const h1 = new THREE.Mesh(handGeo, handMat);
    const h2 = new THREE.Mesh(handGeo, handMat);
    h2.scale.set(1.3, 0.62, 1);
    h1.position.z = h2.position.z = 0.05;
    face.add(rim, h1, h2);
    hands.push(h1, h2);
    g.add(face);
  }
  const spire = new THREE.Mesh(new THREE.ConeGeometry(8.6, 22, 4), slate);
  spire.position.y = 84;
  spire.rotation.y = Math.PI / 4;
  g.add(spire);
  const finial = new THREE.Mesh(new THREE.BoxGeometry(0.3, 8, 0.3), glow(0xffc24a, 4));
  finial.position.y = 99;
  g.add(finial);
  for (const y of [60.2, 72.8]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(12.8, 0.3, 12.8), glow(0xffc24a, 2.4));
    band.position.y = y;
    g.add(band);
  }
  ctx.animate((t) => {
    for (let i = 0; i < hands.length; i += 2) {
      hands[i].rotation.z = -t * 0.45;
      hands[i + 1].rotation.z = -t * 0.0375;
    }
  });
}

/** A great observation wheel on the river bank, turning slowly, its rim and pods lit. */
function wheel(ctx: LandmarkContext) {
  const g = ctx.group;
  const R = 58, HUB = 66;
  const steel = new THREE.MeshStandardMaterial({ color: 0xdfe4ea, roughness: 0.35, metalness: 0.7, emissive: 0xbcd0ff, emissiveIntensity: 0.25 });
  const rotor = new THREE.Group();
  rotor.position.y = HUB;
  g.add(rotor);
  for (const r of [R, R - 2.2]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.42, 8, 96), r === R ? glow(WHITE, 2.4) : steel);
    rotor.add(rim);
  }
  const spokeGeo = new THREE.CylinderGeometry(0.1, 0.1, R - 2, 5);
  spokeGeo.translate(0, (R - 2) / 2, 0);
  for (let i = 0; i < 32; i++) {
    const s = new THREE.Mesh(spokeGeo, steel);
    s.rotation.z = (i / 32) * Math.PI * 2;
    rotor.add(s);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 5, 16), steel);
  hub.rotation.x = Math.PI / 2;
  rotor.add(hub);
  // pods hang from the rim and stay upright as it turns
  const PODS = 28;
  const podGeo = new THREE.CapsuleGeometry(1.5, 2.4, 4, 10);
  podGeo.rotateZ(Math.PI / 2);
  const pods = new THREE.InstancedMesh(podGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), PODS);
  for (let i = 0; i < PODS; i++) pods.setColorAt(i, new THREE.Color(i % 7 === 0 ? RED : 0xdff0ff).multiplyScalar(i % 7 === 0 ? 3 : 1.7));
  pods.frustumCulled = false;
  g.add(pods);
  // A-frame legs leaning in from one side
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 76, 8), steel);
    leg.position.set(sx * 16, HUB / 2, -11);
    leg.rotation.set(-0.32, 0, sx * 0.24);
    g.add(leg);
    ctx.addBoxCollider(new THREE.Vector3(sx * 24, 5, -22), new THREE.Vector3(4, 10, 4));
  }
  const m = new THREE.Matrix4();
  ctx.animate((t) => {
    const a0 = t * 0.05;
    rotor.rotation.z = a0;
    for (let i = 0; i < PODS; i++) {
      const a = a0 + (i / PODS) * Math.PI * 2;
      pods.setMatrixAt(i, m.makeTranslation(Math.cos(a) * (R + 2.4), HUB + Math.sin(a) * (R + 2.4), 0));
    }
    pods.instanceMatrix.needsUpdate = true;
  });
}

/**
 * A domed cathedral inspired by the one on Ludgate Hill: a cross-shaped stone body, a colonnaded
 * drum under a great lead dome and lantern, and twin west towers.
 */
function dome(ctx: LandmarkContext) {
  const rect = (cx: number, cz: number, w: number, d: number): [number, number][] => [
    [cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2],
  ];
  ctx.addFootprint(rect(0, 0, 34, 120), 30, 2); // nave and choir
  ctx.addFootprint(rect(0, 4, 76, 34), 30, 2); // transepts
  ctx.addFootprint(rect(-15, -56, 12, 12), 58, 2); // west towers
  ctx.addFootprint(rect(15, -56, 12, 12), 58, 2);
  const g = ctx.group;
  const stone = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.65, emissive: 0xfff0d8, emissiveIntensity: 0.14 });
  const lead = new THREE.MeshStandardMaterial({ color: 0x7c8a94, roughness: 0.4, metalness: 0.35, emissive: 0x9fc0e0, emissiveIntensity: 0.1 });
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(17, 18, 17, 40), stone);
  drum.position.set(0, 38.5, 4);
  g.add(drum);
  // colonnade round the drum
  const colGeo = new THREE.CylinderGeometry(0.55, 0.55, 12, 8);
  const cols = new THREE.InstancedMesh(colGeo, stone, 32);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    cols.setMatrixAt(i, m.makeTranslation(Math.cos(a) * 19.4, 39, 4 + Math.sin(a) * 19.4));
  }
  g.add(cols);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(19.6, 0.5, 6, 60), stone);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, 45.4, 4);
  g.add(ring);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(16.5, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), lead);
  cap.position.set(0, 47, 4);
  cap.scale.y = 1.18;
  g.add(cap);
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.2, 9, 12), stone);
  lantern.position.set(0, 70.5, 4);
  g.add(lantern);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 10), glow(0xffc24a, 3));
  ball.position.set(0, 77, 4);
  g.add(ball);
  const trim = new THREE.Mesh(new THREE.TorusGeometry(17.2, 0.16, 6, 80), glow(0xfff0d0, 2.2));
  trim.rotation.x = Math.PI / 2;
  trim.position.set(0, 47.1, 4);
  g.add(trim);
  for (const x of [-15, 15]) {
    const top = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), lead);
    top.position.set(x, 58, -56);
    top.scale.y = 1.5;
    g.add(top);
  }
}

/** Street furniture: red call boxes with glowing panes, and red pillar boxes. */
function streetFurniture() {
  const R = 0xb0141e;
  const callBox = mergeGeometries([
    colorBox(0.95, 2.3, 0.95, 0, 1.15, 0, R),
    colorBox(0.72, 1.45, 0.98, 0, 1.25, 0, 0xfff2cf, 1.6),
    colorBox(0.98, 1.45, 0.72, 0, 1.25, 0, 0xfff2cf, 1.6),
    colorBox(1.0, 0.22, 1.0, 0, 2.2, 0, R),
    colorBox(0.8, 0.14, 0.8, 0, 2.38, 0, R),
    colorBox(0.7, 0.14, 1.01, 0, 2.2, 0, 0xffffff, 1.8),
  ]);
  const pillar = mergeGeometries([
    colorBox(0.5, 1.25, 0.5, 0, 0.625, 0, R),
    colorBox(0.58, 0.12, 0.58, 0, 1.3, 0, R),
    colorBox(0.3, 0.05, 0.52, 0, 1.0, 0, 0x101014),
    colorBox(0.56, 0.1, 0.56, 0, 0.05, 0, 0x101014),
  ]);
  return { callBox, pillar };
}

export const london: CityDefinition = {
  id: 'london',
  name: 'NEO LONDON',
  tagline: 'The Thames · 2099',
  blurb: 'Rain on slate roofs, sooty brick, a grey river, and one long tunnel of light.',
  codePrefix: 'LDN',
  map: '/cities/london/map.json',
  fog: { color: 0x6f7a88, density: 0.0026 },
  sky: { horizon: 0x8c97a6, zenith: 0x3c475c },
  // blue hour under solid cloud: no sun to speak of, everything lit by the sky and by windows
  atmosphere: {
    daylight: 0.5,
    sun: { dir: [0.3, 0.72, 0.4], color: 0xd2dcec, size: 0.6, intensity: 0.7 },
    skyMid: 0x66728a,
    stars: 0,
    hemi: { sky: 0xb4c0d2, ground: 0x44464a, intensity: 0.95 },
    ambient: 0.2,
    halo: 0.6,
    fogBreath: 0.25,
    clouds: { cover: 0.9, color: 0x8a94a4 },
  },
  // muted, cool and contrasty: almost the opposite of the other cities
  grade: { saturation: -0.36, contrast: 0.12, brightness: -0.01, bloom: 0.55 },
  rain: 0.85,
  neon: [RED, WHITE, 0x4aa8ff, 0xffc24a],
  trimColor: 0xfff0d0,
  holoAds: 0,
  envGlow: 0.12, // wet roads reflect grey sky, not neon
  ground: 0x2c2e33,
  signDensity: 0.28,
  architecture: 'victorian',
  streetLight: 0xffe6c0,
  facades: [0x8a4a36, 0x9a6a4a, 0x6e4a3a, 0xb8a078, 0xa89068, 0x70584a, 0x5c4c46, 0xc4b08a],
  heritageStone: 0xd6d0c2,
  signWords: [
    'PUB', 'FISH & CHIPS', 'TEA ROOMS', 'BOOKS', 'TAILOR', 'CURRY HOUSE', 'VINYL', 'LONDON 2099', 'THEATRE', 'MARKET',
    'CHEMIST', 'BAKERY', 'OFF LICENCE', 'NEWSAGENT', 'THE CROWN', 'PIE & MASH', 'ANTIQUES', 'UMBRELLAS', 'CAB OFFICE',
    'THE ANCHOR', 'BARBER', 'CAFE', 'HATTER', 'CLOCKMAKER',
  ],
  driveSide: 'left',
  trafficMix: { cab: 0.3, decker: 0.16, car: 0.36, bike: 0.18 },
  skyLanes: 2,
  spawnNear: [-1143, 553],
  // steady and minor-key, in a Dorian mode
  music: { bpm: 100, root: 61.74, scale: [0, 2, 3, 5, 7, 9, 10], progression: [0, 3, 6, 5] },
  water: { deep: 0x1c2630, glint: 0xb8c8d8, grip: 0.55 },
  landmarks: { clock, wheel, dome },
  features: (ctx) => {
    const [hx, hz] = ctx.half;
    // signature drive: the Tube Run, an enclosed tunnel of pulsing rings along the northern edge
    addTubeRun(ctx, -hx + 160, hx - 160, -hz - 36);
    // searchlights raking the cloud base
    addSearchlights(ctx, [[-1219, 620], [-852, 330], [596, -900], [-200, -300], [900, 200], [1300, -700], [-600, -800]]);
    // boats on the Thames, call boxes and pillar boxes on the pavements
    addWaterTaxis(ctx, 22, 0xfff0d0);
    const f = streetFurniture();
    addKerbProps(ctx, f.callBox, (c) => (c <= 2 ? 190 : 0), 70, 120, 1837);
    addKerbProps(ctx, f.pillar, (c) => (c <= 3 ? 150 : 0), 110, 60, 1840);
  },
};
