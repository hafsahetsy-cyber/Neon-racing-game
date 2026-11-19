import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { QualitySettings } from '../../core/Quality';
import { makeGlowTexture } from '../../effects/textures';
import { RoadGrid, polyLength, walkPolyline } from './RoadGrid';
import type { CityDefinition, CityMap } from './types';

const UP = new THREE.Vector3(0, 1, 0);

/** A box with a baked vertex colour (values above 1 glow through bloom). */
export function colorBox(w: number, h: number, d: number, x: number, y: number, z: number, c: THREE.Color | number, k = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  const col = (c instanceof THREE.Color ? c.clone() : new THREE.Color(c)).multiplyScalar(k);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** Coarse "is there a building here" lookup, used to hang signs and wires on real frontages. */
export class Occupancy {
  private cells = new Set<number>();
  constructor(map: CityMap, private size = 6) {
    for (const b of map.buildings) {
      const n = b.p.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = b.p[i * 2], az = b.p[i * 2 + 1];
        const dx = b.p[j * 2] - ax, dz = b.p[j * 2 + 1] - az;
        const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (size * 0.6)));
        for (let k = 0; k <= steps; k++) this.cells.add(this.key(ax + (dx * k) / steps, az + (dz * k) / steps));
      }
    }
  }
  private key(x: number, z: number) {
    return (Math.floor(x / this.size) + 2048) * 8192 + (Math.floor(z / this.size) + 2048);
  }
  has(x: number, z: number) {
    return this.cells.has(this.key(x, z));
  }
}

function signAtlas(def: CityDefinition) {
  const COLS = 4, ROWS = 8;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext('2d')!;
  const cols = [...def.neon.map((n) => '#' + n.toString(16).padStart(6, '0')), '#ffffff', '#ffe9c0'];
  g.fillStyle = '#000';
  g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < COLS * ROWS; i++) {
    const x = (i % COLS) * 256, y = Math.floor(i / COLS) * 128;
    const col = cols[i % cols.length];
    const col2 = cols[(i * 3 + 2) % cols.length];
    g.fillStyle = i % 3 === 0 ? '#12041c' : i % 3 === 1 ? '#03121a' : '#1a0d02';
    g.fillRect(x + 4, y + 4, 248, 120);
    g.strokeStyle = col2;
    g.lineWidth = 5;
    g.strokeRect(x + 8, y + 8, 240, 112);
    const word = def.signWords[i % def.signWords.length];
    g.fillStyle = col;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 64;
    g.font = `700 ${size}px "Noto Nastaliq Urdu","Jameel Noori Nastaleeq","Segoe UI",Tahoma,Arial,sans-serif`;
    while (g.measureText(word).width > 215 && size > 20) {
      size -= 4;
      g.font = `700 ${size}px "Noto Nastaliq Urdu","Jameel Noori Nastaleeq","Segoe UI",Tahoma,Arial,sans-serif`;
    }
    g.shadowColor = col;
    g.shadowBlur = 14;
    g.fillText(word, x + 128, y + 66);
    g.shadowBlur = 0;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return { texture: t, COLS, ROWS };
}

export interface Props {
  group: THREE.Group;
  update(time: number): void;
}

export function buildProps(
  map: CityMap,
  def: CityDefinition,
  grid: RoadGrid,
  occ: Occupancy,
  q: QualitySettings,
  fogColor: THREE.Color,
  fogDensity: number,
): Props {
  const group = new THREE.Group();
  let seed = 1234;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const m4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const street = new THREE.Color(def.streetLight);

  // ------------------------------------------------------------ street lights (main roads)
  const lightGeo = mergeGeometries([
    colorBox(0.2, 9, 0.2, 0, 4.5, 0, 0x0b0b0e),
    colorBox(2.8, 0.12, 0.12, 1.3, 8.95, 0, 0x0b0b0e),
    colorBox(1.1, 0.1, 0.36, 2.3, 8.85, 0, street, 5),
  ]);
  const lights: THREE.Matrix4[] = [];
  const pools: { x: number; z: number; s: number; c: THREE.Color }[] = [];
  const lamps: number[] = [];
  map.roads.forEach((r, ri) => {
    if (r.c > 3) return;
    let i = 0;
    walkPolyline(r.p, 42, 14, (x, z, dx, dz) => {
      const side = r.o ? -1 : i++ % 2 ? 1 : -1;
      const nx = -dz * side, nz = dx * side;
      const px = x + nx * (r.w / 2 + 1), pz = z + nz * (r.w / 2 + 1);
      if (grid.nearest(px, pz, 0.6, ri)) return;
      // local +X must point back at the carriageway
      quat.setFromAxisAngle(UP, Math.atan2(nz, -nx));
      lights.push(new THREE.Matrix4().compose(v.set(px, 0, pz), quat, one));
      lamps.push(px - nx * 2.3, 8.85, pz - nz * 2.3);
      pools.push({ x: x + nx * (r.w / 2 - 2.2), z: z + nz * (r.w / 2 - 2.2), s: 24, c: street.clone().multiplyScalar(0.42) });
    });
  });
  const lightMesh = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ vertexColors: true }), lights.length);
  lights.forEach((m, i) => lightMesh.setMatrixAt(i, m));
  lightMesh.frustumCulled = false;
  group.add(lightMesh);
  // in smog or sea fog every lamp wears a halo
  if (def.atmosphere.halo > 0.01 && lamps.length) {
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(lamps, 3));
    const halos = new THREE.Points(
      hg,
      new THREE.PointsMaterial({
        map: makeGlowTexture(), color: street.clone().multiplyScalar(0.55 * def.atmosphere.halo), size: 7 + 9 * def.atmosphere.halo,
        sizeAttenuation: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    halos.frustumCulled = false;
    halos.renderOrder = 3;
    group.add(halos);
  }

  // ------------------------------------------------------------ utility poles + tangled wires (back streets)
  const poleGeo = mergeGeometries([
    colorBox(0.24, 8.4, 0.24, 0, 4.2, 0, 0x16130f),
    colorBox(1.7, 0.14, 0.14, 0, 7.6, 0, 0x16130f),
    colorBox(1.1, 0.12, 0.12, 0, 6.9, 0, 0x16130f),
    colorBox(0.5, 0.7, 0.4, 0.3, 6.2, 0, 0x1c1c22),
    colorBox(0.12, 0.3, 0.12, 0.3, 5.7, 0, 0xfff0c0, 3),
  ]);
  const poles: THREE.Matrix4[] = [];
  const wire: number[] = [];
  const addWire = (a: THREE.Vector3, b: THREE.Vector3, sag: number) => {
    const SEG = 6;
    let px = a.x, py = a.y, pz = a.z;
    for (let k = 1; k <= SEG; k++) {
      const t = k / SEG;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const y = a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t);
      wire.push(px, py, pz, x, y, z);
      px = x; py = y; pz = z;
    }
  };
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  map.roads.forEach((r, ri) => {
    if (r.c !== 4 || polyLength(r.p) < 60) return;
    let prev: { x: number; z: number; nx: number; nz: number } | null = null;
    walkPolyline(r.p, 30, 6, (x, z, dx, dz) => {
      const nx = -dz, nz = dx;
      const px = x + nx * (r.w / 2 + 0.2), pz = z + nz * (r.w / 2 + 0.2);
      if (grid.nearest(px, pz, 0.5, ri)) {
        prev = null;
        return;
      }
      quat.setFromAxisAngle(UP, Math.atan2(-dx, -dz));
      poles.push(new THREE.Matrix4().compose(v.set(px, 0, pz), quat, one));
      if (prev) {
        for (const off of [-0.75, -0.3, 0.3, 0.75]) {
          a.set(prev.x + prev.nx * off, 7.7, prev.z + prev.nz * off);
          b.set(px + nx * off, 7.7, pz + nz * off);
          addWire(a, b, 0.5 + rnd() * 0.7);
        }
        a.set(prev.x, 6.95, prev.z);
        b.set(px, 6.95, pz);
        addWire(a, b, 1.1 + rnd() * 0.8);
      }
      // service drops fanning out to the buildings on both sides
      for (let k = 0; k < 4; k++) {
        const along = (rnd() - 0.5) * 22;
        const s = k % 2 ? 1 : -1;
        const dist = s > 0 ? 1.5 + rnd() * 2 : r.w + 1.5 + rnd() * 2;
        const tx = px + dx * along + nx * s * dist, tz = pz + dz * along + nz * s * dist;
        if (!occ.has(tx, tz)) continue;
        a.set(px, 7.4 - rnd(), pz);
        b.set(tx, 4 + rnd() * 5, tz);
        addWire(a, b, 0.4 + rnd() * 0.9);
      }
      prev = { x: px, z: pz, nx, nz };
    });
  });
  const poleMesh = new THREE.InstancedMesh(poleGeo, new THREE.MeshBasicMaterial({ vertexColors: true }), poles.length);
  poles.forEach((m, i) => poleMesh.setMatrixAt(i, m));
  poleMesh.frustumCulled = false;
  group.add(poleMesh);
  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
  const wires = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x050507 }));
  wires.frustumCulled = false;
  group.add(wires);

  // ------------------------------------------------------------ neon shop signs jutting over the street
  const atlas = signAtlas(def);
  const sp: number[] = [], suv: number[] = [], sseed: number[] = [], sidx: number[] = [];
  const addSign = (cx: number, cy: number, cz: number, ax: number, az: number, w: number, h: number) => {
    // two faces so the lettering reads correctly from both directions
    for (const f of [1, -1]) {
      const cell = Math.floor(rnd() * atlas.COLS * atlas.ROWS);
      const u0 = (cell % atlas.COLS) / atlas.COLS, v0 = 1 - (Math.floor(cell / atlas.COLS) + 1) / atlas.ROWS;
      const u1 = u0 + 1 / atlas.COLS, v1 = v0 + 1 / atlas.ROWS;
      const i = sp.length / 3;
      const ox = -az * 0.04 * f, oz = ax * 0.04 * f;
      const hx = (ax * w * f) / 2, hz = (az * w * f) / 2;
      sp.push(cx - hx + ox, cy - h / 2, cz - hz + oz, cx + hx + ox, cy - h / 2, cz + hz + oz, cx - hx + ox, cy + h / 2, cz - hz + oz, cx + hx + ox, cy + h / 2, cz + hz + oz);
      suv.push(u0, v0, u1, v0, u0, v1, u1, v1);
      const s = rnd();
      sseed.push(s, s, s, s);
      sidx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  };
  const maxSigns = Math.floor(2600 * Math.min(1.2, q.particles + 0.3) * (def.signDensity ?? 1));
  let signCount = 0;
  map.roads.forEach((r) => {
    if (r.c < 1 || r.c > 4) return;
    walkPolyline(r.p, r.c === 4 ? 13 : 17, 5 + rnd() * 8, (x, z, dx, dz) => {
      for (const side of [-1, 1]) {
        if (signCount >= maxSigns || rnd() < 0.35) continue;
        const nx = -dz * side, nz = dx * side;
        const reach = r.c === 4 ? 0.9 : 3.2;
        if (!occ.has(x + nx * (r.w / 2 + reach + 2.5), z + nz * (r.w / 2 + reach + 2.5))) continue;
        const w = 1.8 + rnd() * 1.4;
        const off = r.w / 2 + reach - w / 2 + 0.6;
        // board hangs perpendicular to the street so drivers read it head-on
        addSign(x + nx * off, 4.6 + rnd() * 5.5, z + nz * off, nx, nz, w, w * 0.5);
        signCount++;
      }
    });
  });
  const signGeo = new THREE.BufferGeometry();
  signGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  signGeo.setAttribute('uv', new THREE.Float32BufferAttribute(suv, 2));
  signGeo.setAttribute('aSeed', new THREE.Float32BufferAttribute(sseed, 1));
  signGeo.setIndex(sidx);
  const signMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: atlas.texture }, uTime: { value: 0 }, uFogColor: { value: fogColor }, uFogDensity: { value: fogDensity } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      varying vec2 vUv; varying float vSeed; varying float vDepth;
      void main() {
        vUv = uv; vSeed = aSeed;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform float uTime; uniform vec3 uFogColor; uniform float uFogDensity;
      varying vec2 vUv; varying float vSeed; varying float vDepth;
      void main() {
        vec3 c = texture2D(uMap, vUv).rgb;
        float flick = 1.0;
        if (vSeed > 0.82) flick = step(0.25, fract(sin(floor(uTime * 9.0) * 12.9898 + vSeed * 78.233) * 43758.5453));
        else if (vSeed > 0.6) flick = 0.75 + 0.25 * sin(uTime * (2.0 + vSeed * 6.0) + vSeed * 40.0);
        c = c * c * 2.6 * flick + vec3(0.004);
        float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
        gl_FragColor = vec4(mix(c, uFogColor, clamp(fog, 0.0, 1.0)), 1.0);
      }`,
  });
  const signs = new THREE.Mesh(signGeo, signMat);
  signs.frustumCulled = false;
  group.add(signs);

  // ------------------------------------------------------------ light pools on the tarmac
  const poolGeo = new THREE.PlaneGeometry(1, 1);
  poolGeo.rotateX(-Math.PI / 2);
  const poolMesh = new THREE.InstancedMesh(
    poolGeo,
    new THREE.MeshBasicMaterial({
      map: makeGlowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    }),
    pools.length,
  );
  pools.forEach((p, i) => {
    m4.compose(v.set(p.x, 0.06, p.z), quat.identity(), new THREE.Vector3(p.s, 1, p.s));
    poolMesh.setMatrixAt(i, m4);
    poolMesh.setColorAt(i, p.c);
  });
  poolMesh.frustumCulled = false;
  poolMesh.renderOrder = 2;
  group.add(poolMesh);

  // ------------------------------------------------------------ park trees
  const canopy = new THREE.IcosahedronGeometry(2.4, 0);
  canopy.translate(0, 4.6, 0);
  {
    const n = canopy.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set([0.012, 0.05 + rnd() * 0.03, 0.03], i * 3);
    canopy.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  const treeGeo = mergeGeometries(
    [colorBox(0.35, 3, 0.35, 0, 1.5, 0, 0x120c08), canopy].map((g) => (g.index ? g.toNonIndexed() : g)),
  );
  const trees: THREE.Matrix4[] = [];
  for (const park of map.parks) {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < park.length; i += 2) {
      minX = Math.min(minX, park[i]); maxX = Math.max(maxX, park[i]);
      minZ = Math.min(minZ, park[i + 1]); maxZ = Math.max(maxZ, park[i + 1]);
    }
    const tries = Math.min(160, Math.floor(((maxX - minX) * (maxZ - minZ)) / 260));
    for (let t = 0; t < tries && trees.length < 900; t++) {
      const x = minX + rnd() * (maxX - minX), z = minZ + rnd() * (maxZ - minZ);
      let inside = false;
      for (let i = 0, j = park.length - 2; i < park.length; j = i, i += 2) {
        if (park[i + 1] > z !== park[j + 1] > z && x < ((park[j] - park[i]) * (z - park[i + 1])) / (park[j + 1] - park[i + 1]) + park[i]) inside = !inside;
      }
      if (!inside || grid.nearest(x, z, 2) || occ.has(x, z)) continue;
      const s = 0.8 + rnd() * 0.9;
      trees.push(new THREE.Matrix4().compose(v.set(x, 0, z), quat.setFromAxisAngle(UP, rnd() * 6.3), new THREE.Vector3(s, s * (0.9 + rnd() * 0.5), s)));
    }
  }
  const treeMesh = new THREE.InstancedMesh(treeGeo, new THREE.MeshBasicMaterial({ vertexColors: true }), Math.max(1, trees.length));
  trees.forEach((m, i) => treeMesh.setMatrixAt(i, m));
  treeMesh.count = trees.length;
  treeMesh.frustumCulled = false;
  group.add(treeMesh);

  // ------------------------------------------------------------ sky lanes: streams of flying traffic overhead
  const LANES = def.skyLanes;
  const PER = Math.floor(34 * Math.min(1.3, q.particles + 0.2));
  const flyGeo = mergeGeometries([
    colorBox(1.4, 0.5, 3.4, 0, 0, 0, 0x08080c),
    colorBox(1.2, 0.12, 0.1, 0, 0, -1.72, 0xeaf4ff, 6),
    colorBox(1.2, 0.12, 0.1, 0, 0, 1.72, 0xff1030, 6),
    colorBox(1.5, 0.06, 2.6, 0, -0.28, 0, def.neon[0], 2.5),
  ]);
  const flyers = new THREE.InstancedMesh(flyGeo, new THREE.MeshBasicMaterial({ vertexColors: true }), Math.max(1, LANES * PER));
  flyers.count = LANES * PER;
  flyers.frustumCulled = false;
  group.add(flyers);
  const R = Math.hypot(map.half[0], map.half[1]) + 300;
  const lanes = Array.from({ length: LANES }, (_, i) => {
    const ang = (i / LANES) * Math.PI + rnd() * 0.4;
    const off = (rnd() - 0.5) * map.half[0] * 1.4;
    return {
      dir: new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang)),
      side: new THREE.Vector3(-Math.sin(ang), 0, Math.cos(ang)).multiplyScalar(off),
      y: 70 + i * 22 + rnd() * 20,
      speed: (38 + rnd() * 30) * (i % 2 ? 1 : -1),
      phase: Array.from({ length: PER }, () => rnd()),
      q: new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(-Math.cos(ang), -Math.sin(ang)) + (i % 2 ? 0 : Math.PI)),
    };
  });

  return {
    group,
    update(time) {
      signMat.uniforms.uTime.value = time;
      let k = 0;
      for (const l of lanes) {
        for (let i = 0; i < PER; i++) {
          let t = (l.phase[i] + (time * l.speed) / (2 * R)) % 1;
          if (t < 0) t += 1;
          const d = (t - 0.5) * 2 * R;
          v.copy(l.dir).multiplyScalar(d).add(l.side);
          v.y = l.y + Math.sin(i * 12.9) * 3;
          m4.compose(v, l.q, one);
          flyers.setMatrixAt(k++, m4);
        }
      }
      flyers.instanceMatrix.needsUpdate = true;
    },
  };
}
