import * as THREE from 'three';
import { addCamels, addDroneShow, addDunes, addMegaSpire, addPalmIsland, addSailTower, addSandWind, addWaterTaxis } from '../city/desert';
import { addBoats, addWater } from '../city/features';
import type { CityDefinition, LandmarkContext } from '../city/types';

const GOLD = 0xffc24a;
const WHITE = 0xffffff;
const glow = (c: number, k: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k) });

/**
 * Coral-stone fort inspired by Al Fahidi: a walled courtyard with one round and one square tower,
 * and a dhow on display — its sail now a sheet of golden light.
 */
function fort(ctx: LandmarkContext) {
  const S = 42, T = 5;
  const rect = (cx: number, cz: number, w: number, d: number): [number, number][] => [
    [cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2],
  ];
  ctx.addFootprint(rect(0, -S / 2 + T / 2, S, T), 7.5, 2);
  ctx.addFootprint(rect(0, S / 2 - T / 2, S, T), 7.5, 2);
  ctx.addFootprint(rect(-S / 2 + T / 2, 0, T, S - 2 * T), 7.5, 2);
  ctx.addFootprint(rect(S / 2 - T / 2, 0, T, S - 2 * T), 7.5, 2);
  ctx.addFootprint(rect(S / 2 - 4, S / 2 - 4, 9, 9), 13, 2); // square watchtower
  const g = ctx.group;
  const stone = new THREE.MeshStandardMaterial({ color: 0xd9bd92, roughness: 0.85, emissive: 0xffb060, emissiveIntensity: 0.12 });
  // round tower on the opposite corner
  const round = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.6, 12, 20), stone);
  round.position.set(-S / 2 + 3, 6, -S / 2 + 3);
  g.add(round);
  ctx.addBoxCollider(new THREE.Vector3(-S / 2 + 3, 6, -S / 2 + 3), new THREE.Vector3(10, 12, 10));
  for (const y of [12.1, 8]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(5.3, 0.12, 6, 40), glow(GOLD, 3));
    band.rotation.x = Math.PI / 2;
    band.position.set(-S / 2 + 3, y, -S / 2 + 3);
    g.add(band);
  }
  // the dhow, drawn up in front of the gate
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a2f1a, roughness: 0.8, emissive: 0xff8a3c, emissiveIntensity: 0.08 });
  const dhow = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 1.2, 15, 12, 1, false, 0, Math.PI), wood);
  hull.rotation.set(0, 0, Math.PI / 2);
  hull.rotation.y = Math.PI / 2;
  hull.scale.set(1, 1, 0.9);
  hull.position.y = 2.6;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.3, 14), wood);
  deck.position.y = 2.7;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 13, 8), wood);
  mast.position.set(0, 9, -1.5);
  mast.rotation.x = -0.12;
  const sailShape = new THREE.Shape();
  sailShape.moveTo(0, 0);
  sailShape.lineTo(11, 2.5);
  sailShape.lineTo(1.5, 12);
  const sailMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(GOLD).multiplyScalar(1.6), transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sail = new THREE.Mesh(new THREE.ShapeGeometry(sailShape), sailMat);
  sail.position.set(0, 3.4, -5.5);
  sail.rotation.y = -Math.PI / 2;
  dhow.add(hull, deck, mast, sail);
  dhow.position.set(0, 0, S / 2 + 16);
  dhow.rotation.y = Math.PI / 2;
  g.add(dhow);
  ctx.addBoxCollider(new THREE.Vector3(0, 2, S / 2 + 16), new THREE.Vector3(15, 4, 5));
  ctx.animate((t) => (sailMat.opacity = 0.45 + 0.15 * Math.sin(t * 1.4)));
}

/**
 * Clocktower inspired by Deira's: four legs sweeping up into pointed arches under a crown of
 * clock faces, now told in light.
 */
function clocktower(ctx: LandmarkContext) {
  const g = ctx.group;
  const white = new THREE.MeshStandardMaterial({ color: 0xf2ede2, roughness: 0.4, emissive: 0xffe0b0, emissiveIntensity: 0.3 });
  const legGeo = new THREE.BoxGeometry(1.5, 17, 1.5);
  legGeo.translate(0, 8.5, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const leg = new THREE.Mesh(legGeo, white);
    leg.position.set(Math.cos(a) * 8, 0, Math.sin(a) * 8);
    // lean each leg in towards the centre so the four meet under the crown
    leg.rotation.set(0, -a, 0);
    leg.rotateZ(0.36);
    g.add(leg);
    ctx.addBoxCollider(new THREE.Vector3(Math.cos(a) * 7, 4, Math.sin(a) * 7), new THREE.Vector3(2.4, 8, 2.4));
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.16, 17, 0.16), glow(GOLD, 3));
    edge.geometry.translate(0, 8.5, 0);
    edge.position.copy(leg.position);
    edge.rotation.copy(leg.rotation);
    edge.translateX(0.85);
    g.add(edge);
  }
  const crown = new THREE.Mesh(new THREE.BoxGeometry(6.4, 6.4, 6.4), white);
  crown.position.y = 19.4;
  g.add(crown);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(4.2, 5, 4), white);
  cap.rotation.y = Math.PI / 4;
  cap.position.y = 25.1;
  g.add(cap);
  const spire = new THREE.Mesh(new THREE.BoxGeometry(0.2, 6, 0.2), glow(GOLD, 4));
  spire.position.y = 30.5;
  g.add(spire);
  const hands: THREE.Mesh[] = [];
  const ring = new THREE.RingGeometry(2.2, 2.55, 40);
  const handGeo = new THREE.PlaneGeometry(0.2, 2);
  handGeo.translate(0, 1, 0);
  const gold = glow(GOLD, 3.5);
  gold.side = THREE.DoubleSide;
  const wht = glow(WHITE, 3);
  wht.side = THREE.DoubleSide;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const face = new THREE.Group();
    face.position.set(Math.sin(a) * 3.3, 19.4, Math.cos(a) * 3.3);
    face.rotation.y = a;
    const h1 = new THREE.Mesh(handGeo, wht);
    const h2 = new THREE.Mesh(handGeo, gold);
    h2.scale.y = 0.62;
    face.add(new THREE.Mesh(ring, gold), h1, h2);
    hands.push(h1, h2);
    g.add(face);
  }
  // fountain ring at the foot
  const pool = new THREE.Mesh(new THREE.TorusGeometry(12.5, 0.25, 6, 60), glow(0x6fe0ff, 2.6));
  pool.rotation.x = Math.PI / 2;
  pool.position.y = 0.3;
  g.add(pool);
  ctx.animate((t) => {
    for (let i = 0; i < hands.length; i += 2) {
      hands[i].rotation.z = -t * 0.5;
      hands[i + 1].rotation.z = -t * 0.04;
    }
  });
}

export const dubai: CityDefinition = {
  id: 'dubai',
  name: 'NEO DUBAI',
  tagline: 'The Creek · 2099',
  blurb: 'Gold light on the Creek, wind towers under glass needles, and dunes at the edge of town.',
  codePrefix: 'DXB',
  map: '/cities/dubai/map.json',
  fog: { color: 0xb88a5c, density: 0.00185 },
  sky: { horizon: 0xc98338, zenith: 0x2a3c6e },
  // the last gold hour: a low sun over the water, dust in the air, blue coming down from above
  atmosphere: {
    daylight: 0.62,
    sun: { dir: [0.62, 0.2, 0.55], color: 0xffb347, size: 2.4, intensity: 1.5 },
    skyMid: 0xd09a62,
    stars: 0,
    hemi: { sky: 0xd9a876, ground: 0x5a4428, intensity: 0.95 },
    ambient: 0.25,
    halo: 0.3,
    fogBreath: 0.35, // gusts of dust
    shimmer: 1,
  },
  neon: [GOLD, WHITE, 0xff8a3c, 0x6fe0ff],
  architecture: 'gulf',
  streetLight: 0xffd9a0,
  facades: [0xe6d3b0, 0xf0e6d2, 0xd9b98a, 0xcfa77a, 0xe8cdb4, 0xbfa27a, 0xf4efe4, 0xd6c2a2],
  heritageStone: 0xd8b98a,
  signWords: [
    'دبي', 'ذهب', 'شاي', 'شاورما', 'قهوة', 'عطور', 'توابل', 'سوق', 'مطعم', 'صرافة', 'تمور', 'لؤلؤ',
    'GOLD SOUK', 'KARAK', 'SHAWARMA', 'SPICE', 'ABRA', 'PERFUME', 'DUBAI 2099', 'SOUK', 'TEXTILE', 'DATES', 'OUD',
    'FALCON', 'PEARL', 'CAFE', 'EXCHANGE', 'DHOW', 'SAFFRON', 'NEON SOUK', 'MAJLIS', 'JEWELLERS',
  ],
  driveSide: 'right',
  trafficMix: { car: 0.66, bus: 0.1, bike: 0.24 },
  skyLanes: 6, // flying taxis, in disciplined lanes
  spawnNear: [0, -332],
  // faster, in a Hijaz-like mode
  music: { bpm: 110, root: 65.41, scale: [0, 1, 4, 5, 7, 8, 11], progression: [0, 1, 0, 4] },
  water: { deep: 0x16222e, glint: 0xffc070, grip: 0.55 },
  extend: { south: 720 },
  // open desert to the south, open sea to the north
  skylineGap: [[Math.PI / 2 - 0.85, Math.PI / 2 + 0.85], [-Math.PI / 2 - 0.95, -Math.PI / 2 + 0.95]],
  landmarks: { fort, clocktower },
  features: (ctx) => {
    const [hx, hz] = ctx.half;
    addSandWind(ctx, 520);
    // signature drive: dunes beyond the southern edge, where the sand takes a third of your grip
    const rect: [number, number, number, number] = [-hx - 40, hz + 18, hx + 40, hz + 700];
    const height = addDunes(ctx, rect, 7.5, 0.62);
    addCamels(ctx, rect, 24, height);
    // abras on the Creek, a drone show above it, and one impossible needle on the horizon
    addWaterTaxis(ctx, 30, 0xffe2b0);
    addDroneShow(ctx, 0, -40, 210, 'DXB');
    addMegaSpire(ctx, hx + 1100, -hz - 300, 900);
    // the Gulf beyond the northern edge: dhows, a palm-shaped island of light, a sail of a tower
    addWater(ctx, [-hx - 2600, -hz - 3000, hx + 2600, -hz - 62], 0x16222e, 0xffc070);
    addBoats(ctx, [-hx, -hz - 600, hx, -hz - 130], 18, 0xffe2b0);
    addPalmIsland(ctx, -350, -hz - 1250, 520);
    addSailTower(ctx, 620, -hz - 760, 250);
  },
};
