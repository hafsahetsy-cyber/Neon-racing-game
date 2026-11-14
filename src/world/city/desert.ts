import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { colorBox } from './props';
import type { FeatureContext } from './types';

/**
 * Desert and waterfront set pieces: drivable dunes, a camel caravan, wind-blown sand,
 * boats on mapped water, a drone light show and a far-off mega spire.
 */

const hdr = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k);

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/**
 * A field of drivable dunes over `rect` [minX, minZ, maxX, maxZ]. Sand is loose: grip drops to `grip`
 * while the car is on it. Returns the height function so other pieces can stand on the dunes.
 */
export function addDunes(ctx: FeatureContext, rect: [number, number, number, number], maxH: number, grip: number, color = 0xc9a063) {
  const [x0, z0, x1, z1] = rect;
  const STEP = 9;
  const nx = Math.ceil((x1 - x0) / STEP), nz = Math.ceil((z1 - z0) / STEP);
  const fade = (v: number, a: number, b: number, w: number) => THREE.MathUtils.smoothstep(v, a, a + w) * (1 - THREE.MathUtils.smoothstep(v, b - w, b));
  const height = (x: number, z: number) => {
    if (x < x0 || x > x1 || z < z0 || z > z1) return 0;
    const ridge = 0.5 + 0.5 * Math.sin(x * 0.047 + Math.sin(z * 0.021) * 1.9);
    const swell = 0.55 + 0.45 * Math.sin(z * 0.034 + x * 0.011 + 1.3);
    const ripple = 0.5 + 0.5 * Math.sin(x * 0.13 + z * 0.09);
    return maxH * (ridge * ridge * swell + ripple * 0.06) * fade(z, z0, z1, 70) * fade(x, x0, x1, 90) + 0.06;
  };
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  const col = new Float32Array((nx + 1) * (nz + 1) * 3);
  const base = new THREE.Color(color);
  const c = new THREE.Color();
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx, z = z0 + ((z1 - z0) * j) / nz;
      const h = height(x, z);
      const k = (j * (nx + 1) + i) * 3;
      pos.set([x, h, z], k);
      // crests catch the light, hollows fall into shadow
      c.copy(base).multiplyScalar(0.7 + 0.5 * (h / (maxH + 0.1)));
      col.set([c.r, c.g, c.b], k);
    }
  const idx = new Uint32Array(nx * nz * 6);
  let n = 0;
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, d = a + nx + 1, e = d + 1;
      idx.set([a, d, b, b, d, e], n);
      n += 6;
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.25 }));
  mesh.frustumCulled = false;
  ctx.group.add(mesh);
  ctx.addTrimesh(pos, idx);
  ctx.addGripZone((x, z) => (x > x0 && x < x1 && z > z0 + 30 && z < z1 ? grip : undefined));
  return height;
}

/** A slow caravan of camels walking the dunes. */
export function addCamels(ctx: FeatureContext, rect: [number, number, number, number], count: number, height: (x: number, z: number) => number) {
  const fur = 0xb89264;
  const geo = mergeGeometries([
    colorBox(0.7, 0.9, 2.2, 0, 1.9, 0, fur),
    colorBox(0.5, 0.55, 0.9, 0, 2.55, 0.1, fur), // hump
    colorBox(0.3, 1.3, 0.34, 0, 2.6, -1.2, fur), // neck
    colorBox(0.3, 0.34, 0.7, 0, 3.25, -1.5, fur), // head
    colorBox(0.18, 1.5, 0.18, -0.24, 0.75, -0.85, fur),
    colorBox(0.18, 1.5, 0.18, 0.24, 0.75, -0.85, fur),
    colorBox(0.18, 1.5, 0.18, -0.24, 0.75, 0.85, fur),
    colorBox(0.18, 1.5, 0.18, 0.24, 0.75, 0.85, fur),
    colorBox(0.74, 0.5, 0.9, 0, 2.2, 0.1, ctx.neon[2 % ctx.neon.length], 0.5), // saddle blanket
    colorBox(0.76, 0.06, 0.92, 0, 2.47, 0.1, ctx.neon[0], 3), // glowing trim
    colorBox(0.1, 0.1, 0.1, 0, 3.0, -1.86, ctx.neon[0], 5), // bridle light
  ]);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }), count);
  mesh.frustumCulled = false;
  ctx.group.add(mesh);
  const [x0, z0, x1, z1] = rect;
  const rnd = rng(8080);
  const lines = 3;
  const camels = Array.from({ length: count }, (_, i) => ({
    lane: z0 + ((z1 - z0) * ((i % lines) + 0.6)) / (lines + 0.4) + (rnd() - 0.5) * 12,
    off: Math.floor(i / lines) * 7 + rnd() * 2 + (i % lines) * 190,
    dir: i % lines === 1 ? -1 : 1,
  }));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const span = x1 - x0 - 120;
  ctx.animate((t) => {
    camels.forEach((cm, i) => {
      const s = (((cm.off + t * 1.3 * cm.dir) % span) + span) % span;
      const x = x0 + 60 + s, z = cm.lane + Math.sin(s * 0.01) * 14;
      const h = height(x, z);
      const slope = (height(x + cm.dir * 2, z) - h) / 2;
      p.set(x, h - 0.05 + Math.abs(Math.sin(t * 2 + i)) * 0.05, z);
      // model faces -Z; walking along ±X
      e.set(Math.atan(slope), cm.dir > 0 ? -Math.PI / 2 : Math.PI / 2, 0, 'YXZ');
      mesh.setMatrixAt(i, m.compose(p, q.setFromEuler(e), one));
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
}

/** Sand streaming low across the ground on the wind, around wherever the camera is. */
export function addSandWind(ctx: FeatureContext, count: number, color = 0xe2c08c) {
  const BOX = new THREE.Vector3(70, 7, 70);
  const drops = new Float32Array(count * 3);
  const rnd = rng(1212);
  for (let i = 0; i < count * 3; i += 3) drops.set([rnd() * BOX.x, rnd() * rnd() * BOX.y, rnd() * BOX.z], i);
  const pos = new Float32Array(count * 6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: hdr(color, 1.1), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 6;
  ctx.group.add(lines);
  let last = 0;
  ctx.animate((t, focus) => {
    const dt = Math.min(0.1, Math.max(0, t - last));
    last = t;
    // gusts: the wind strengthens and slackens
    const gust = 0.65 + 0.35 * Math.sin(t * 0.23) * Math.sin(t * 0.071 + 1);
    const vx = 19 * gust, vz = 7 * gust;
    mat.opacity = 0.1 + 0.2 * gust;
    const ox = focus.x - BOX.x / 2, oz = focus.z - BOX.z / 2;
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      drops[k] += vx * dt;
      drops[k + 2] += vz * dt;
      const x = ox + ((((drops[k] - ox) % BOX.x) + BOX.x) % BOX.x);
      const z = oz + ((((drops[k + 2] - oz) % BOX.z) + BOX.z) % BOX.z);
      const y = 0.15 + drops[k + 1] + Math.sin(t * 1.7 + i) * 0.15;
      pos.set([x, y, z, x - vx * 0.06, y + 0.02, z - vz * 0.06], i * 6);
    }
    geo.attributes.position.needsUpdate = true;
  });
}

/** Passenger boats pottering about on the city's mapped water (abras on a creek). */
export function addWaterTaxis(ctx: FeatureContext, count: number, lamp: number) {
  const geo = mergeGeometries([
    colorBox(2.2, 0.7, 7.5, 0, 0.35, 0, 0x2a1c10),
    colorBox(2.0, 0.08, 5.2, 0, 2.1, 0.2, ctx.neon[2 % ctx.neon.length], 0.4), // canopy
    colorBox(0.07, 1.4, 0.07, -0.95, 1.4, -2.2, 0x14100c),
    colorBox(0.07, 1.4, 0.07, 0.95, 1.4, -2.2, 0x14100c),
    colorBox(0.07, 1.4, 0.07, -0.95, 1.4, 2.6, 0x14100c),
    colorBox(0.07, 1.4, 0.07, 0.95, 1.4, 2.6, 0x14100c),
    colorBox(2.3, 0.07, 7.6, 0, 0.72, 0, ctx.neon[0], 2.4),
    colorBox(0.2, 0.2, 0.2, 0, 2.0, -2.4, lamp, 6),
    colorBox(0.2, 0.2, 0.2, 0, 2.0, 2.8, lamp, 6),
  ]);
  const rnd = rng(606);
  const boats: { x: number; z: number; dx: number; dz: number; ph: number; reach: number }[] = [];
  for (let tries = 0; tries < 6000 && boats.length < count; tries++) {
    const x = (rnd() - 0.5) * 2 * ctx.half[0], z = (rnd() - 0.5) * 2 * ctx.half[1];
    // keep clear of the banks
    if (![[0, 0], [22, 0], [-22, 0], [0, 22], [0, -22]].every(([ox, oz]) => ctx.isWater(x + ox, z + oz))) continue;
    // find the direction with the most open water: that is "along the channel"
    let best = 0, bdx = 1, bdz = 0;
    for (let a = 0; a < Math.PI; a += Math.PI / 8) {
      const dx = Math.cos(a), dz = Math.sin(a);
      let r = 0;
      while (r < 160 && ctx.isWater(x + dx * (r + 10), z + dz * (r + 10)) && ctx.isWater(x - dx * (r + 10), z - dz * (r + 10))) r += 10;
      if (r > best) { best = r; bdx = dx; bdz = dz; }
    }
    if (best < 30) continue;
    boats.push({ x, z, dx: bdx, dz: bdz, ph: rnd() * 6.28, reach: best * 0.8 });
  }
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }), Math.max(1, boats.length));
  mesh.count = boats.length;
  mesh.frustumCulled = false;
  ctx.group.add(mesh);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  ctx.animate((t) => {
    boats.forEach((b, i) => {
      const s = Math.sin(t * 0.07 + b.ph);
      const going = Math.cos(t * 0.07 + b.ph) >= 0 ? 1 : -1;
      p.set(b.x + b.dx * s * b.reach, 0.16 + Math.sin(t * 0.9 + b.ph) * 0.1, b.z + b.dz * s * b.reach);
      e.set(Math.sin(t * 0.8 + b.ph) * 0.03, Math.atan2(-b.dx * going, -b.dz * going), Math.sin(t * 0.7 + b.ph) * 0.05);
      mesh.setMatrixAt(i, m.compose(p, q.setFromEuler(e), one));
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return boats.length;
}

/** A swarm of light drones flying formations over the city: a ring, a crescent and star, then lettering. */
export function addDroneShow(ctx: FeatureContext, cx: number, cz: number, y: number, text: string) {
  const N = 460;
  const R = 120;
  const forms: Float32Array[] = [];
  const rnd = rng(2099);
  // 1: double ring
  const ring = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 * 2, r = i < N / 2 ? R : R * 0.62;
    ring.set([Math.cos(a) * r, Math.sin(a) * r, 0], i * 3);
  }
  forms.push(ring);
  // 2: crescent and star
  const cres = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    if (i < N * 0.72) {
      const outer = i % 2 === 0;
      const a = 0.9 + (i / (N * 0.72)) * (Math.PI * 2 - 1.8);
      if (outer) cres.set([Math.cos(a) * R - 20, Math.sin(a) * R, 0], i * 3);
      else cres.set([Math.cos(a) * R * 0.86 + 12, Math.sin(a) * R * 0.86, 0], i * 3);
    } else {
      const k = (i - N * 0.72) / (N * 0.28);
      const a = k * Math.PI * 2, r = 30 * (0.45 + 0.55 * Math.abs(Math.cos(a * 2.5)));
      cres.set([70 + Math.cos(a) * r, Math.sin(a) * r, 0], i * 3);
    }
  }
  forms.push(cres);
  // 3: lettering, sampled from a canvas
  const cv = document.createElement('canvas');
  cv.width = 260;
  cv.height = 90;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#fff';
  g.font = '900 78px "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 130, 48, 250);
  const img = g.getImageData(0, 0, 260, 90).data;
  const pts: number[] = [];
  for (let yy = 0; yy < 90; yy += 2) for (let xx = 0; xx < 260; xx += 2) if (img[(yy * 260 + xx) * 4 + 3] > 128) pts.push((xx - 130) * 1.05, (45 - yy) * 1.05);
  const word = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const k = Math.floor(rnd() * (pts.length / 2)) * 2;
    word.set([pts[k] ?? 0, pts[k + 1] ?? 0, 0], i * 3);
  }
  forms.push(word);

  const pos = new Float32Array(N * 3);
  const colr = new Float32Array(N * 3);
  const palette = ctx.neon.map((c) => new THREE.Color(c));
  for (let i = 0; i < N; i++) {
    const c = palette[i % palette.length];
    colr.set([c.r * 2.2, c.g * 2.2, c.b * 2.2], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 3.4, sizeAttenuation: true, vertexColors: true, fog: false, transparent: true, depthWrite: false }));
  points.position.set(cx, y, cz);
  points.frustumCulled = false;
  ctx.group.add(points);
  const HOLD = 9, MOVE = 4;
  ctx.animate((t, focus) => {
    const cycle = t / (HOLD + MOVE);
    const a = Math.floor(cycle) % forms.length, b = (a + 1) % forms.length;
    const k = THREE.MathUtils.smootherstep(((cycle % 1) * (HOLD + MOVE) - HOLD) / MOVE, 0, 1);
    const A = forms[a], B = forms[b];
    for (let i = 0; i < N * 3; i += 3) {
      const wob = Math.sin(t * 2 + i) * 0.35;
      pos[i] = A[i] + (B[i] - A[i]) * k + wob;
      pos[i + 1] = A[i + 1] + (B[i + 1] - A[i + 1]) * k + wob;
      pos[i + 2] = Math.sin(k * Math.PI) * Math.sin(i * 0.37) * 26; // scatter in depth while re-forming
    }
    geo.attributes.position.needsUpdate = true;
    // always face the player, so the picture reads from anywhere
    points.rotation.y = Math.atan2(focus.x - cx, focus.z - cz);
  });
}

/** An impossibly tall needle on the horizon — the city's far-off anchor. */
export function addMegaSpire(ctx: FeatureContext, x: number, z: number, height: number) {
  const parts: THREE.BufferGeometry[] = [];
  const tint = (geo: THREE.BufferGeometry, c: THREE.Color) => {
    const n = geo.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return geo;
  };
  const TIERS = 9;
  let y = 0;
  for (let i = 0; i < TIERS; i++) {
    const h = (height / TIERS) * (1.25 - i * 0.05);
    const r0 = 46 * Math.pow(0.78, i), r1 = 46 * Math.pow(0.78, i + 1);
    const body = new THREE.CylinderGeometry(r1, r0, h, 3, 1);
    body.rotateY(i * 0.7);
    body.translate(0, y + h / 2, 0);
    parts.push(tint(body, new THREE.Color(0x3a4a66).lerp(new THREE.Color(ctx.neon[0]), 0.12 + i * 0.05)));
    const band = new THREE.CylinderGeometry(r0 + 0.6, r0 + 0.6, 1.6, 3, 1);
    band.rotateY(i * 0.7);
    band.translate(0, y + 1, 0);
    parts.push(tint(band, hdr(ctx.neon[i % 2], 2.6)));
    y += h;
  }
  const needle = new THREE.CylinderGeometry(0.4, 3, 150, 6, 1);
  needle.translate(0, y + 75, 0);
  parts.push(tint(needle, hdr(ctx.neon[1 % ctx.neon.length], 2.4)));
  const mesh = new THREE.Mesh(mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p))), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  mesh.position.set(x, 0, z);
  mesh.frustumCulled = false;
  ctx.group.add(mesh);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(5, 10, 8), new THREE.MeshBasicMaterial({ color: hdr(0xff2030, 5), fog: false }));
  beacon.position.set(x, y + 152, z);
  ctx.group.add(beacon);
  ctx.animate((t) => (beacon.visible = Math.sin(t * 2.2) > -0.2));
}
