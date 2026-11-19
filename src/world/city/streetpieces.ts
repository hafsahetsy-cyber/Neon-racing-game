import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { colorBox } from './props';
import type { FeatureContext } from './types';

/**
 * Street-life set pieces a city can add from its `features` hook:
 * food grills with smoke, kite sellers, and marked shortcut lanes.
 */

const UP = new THREE.Vector3(0, 1, 0);

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** Returns a test for "is this point on (or within `pad` of) a main road?" */
function mainRoadTest(ctx: FeatureContext) {
  const segs: number[] = [];
  for (const r of ctx.roads) {
    if (r.c > 2) continue;
    for (let i = 0; i + 3 < r.p.length; i += 2) segs.push(r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3], r.w / 2);
  }
  return (x: number, z: number, pad = 0) => {
    for (let i = 0; i < segs.length; i += 5) {
      const ax = segs[i], az = segs[i + 1];
      const dx = segs[i + 2] - ax, dz = segs[i + 3] - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < segs[i + 4] + pad) return true;
    }
    return false;
  };
}

interface Spot {
  x: number;
  z: number;
  /** Unit vector pointing from the spot back towards the carriageway. */
  fx: number;
  fz: number;
}

/** Kerbside spots along the roads `pick` selects (it returns the spacing in metres, or 0 to skip). */
function kerbSpots(ctx: FeatureContext, pick: (name: string, cls: number) => number, max: number, gap: number, seed: number): Spot[] {
  const rnd = rng(seed);
  const onMain = mainRoadTest(ctx);
  const out: Spot[] = [];
  for (const r of ctx.roads) {
    const every = pick(r.n, r.c);
    if (!every) continue;
    let next = 6 + rnd() * every;
    let acc = 0;
    for (let i = 0; i + 3 < r.p.length && out.length < max; i += 2) {
      const dx = r.p[i + 2] - r.p[i], dz = r.p[i + 3] - r.p[i + 1];
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      while (next <= acc + len && out.length < max) {
        const t = (next - acc) / len;
        const side = rnd() > 0.5 ? 1 : -1;
        const nx = (-dz / len) * side, nz = (dx / len) * side;
        const off = r.c <= 3 ? r.w / 2 + 1.0 : r.w / 2 - 0.55;
        const x = r.p[i] + dx * t + nx * off, z = r.p[i + 1] + dz * t + nz * off;
        next += every * (0.7 + rnd() * 0.6);
        if (Math.abs(x) > ctx.half[0] - 20 || Math.abs(z) > ctx.half[1] - 20) continue;
        if (r.c > 2 && onMain(x, z, 2)) continue;
        if (out.some((s) => Math.hypot(s.x - x, s.z - z) < gap)) continue;
        out.push({ x, z, fx: -nx, fz: -nz });
      }
      acc += len;
    }
  }
  return out;
}

function placeInstances(ctx: FeatureContext, geo: THREE.BufferGeometry, spots: Spot[]) {
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }), Math.max(1, spots.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  spots.forEach((s, i) => {
    q.setFromAxisAngle(UP, Math.atan2(-s.fx, -s.fz)); // local -Z faces the street
    mesh.setMatrixAt(i, m.compose(p.set(s.x, 0.03, s.z), q, one));
    ctx.addBox(new THREE.Vector3(s.x, 0.6, s.z), new THREE.Vector3(1.4, 1.2, 1.4), q);
  });
  mesh.count = spots.length;
  mesh.frustumCulled = false;
  ctx.group.add(mesh);
}

/**
 * Charcoal grills at the kerb: a bed of glowing embers, skewers, a vendor and a string of bulbs,
 * each sending up a column of lit smoke. Packed closely along any road with "food" in its name.
 */
export function addFoodGrills(ctx: FeatureContext, max: number) {
  const spots = kerbSpots(ctx, (name, c) => (/food/i.test(name) ? 9 : c === 4 ? 210 : c === 3 ? 160 : 0), max, 7, 9001);
  const skin = new THREE.Color(0.34, 0.22, 0.14);
  const parts = [
    colorBox(1.5, 0.75, 0.6, 0, 0.5, 0, 0x0e0e10),
    colorBox(1.4, 0.06, 0.5, 0, 0.9, 0, 0xff5a14, 5), // embers
    colorBox(0.06, 0.5, 0.06, -0.68, 0.25, -0.24, 0x0e0e10),
    colorBox(0.06, 0.5, 0.06, 0.68, 0.25, -0.24, 0x0e0e10),
    colorBox(0.06, 0.5, 0.06, -0.68, 0.25, 0.24, 0x0e0e10),
    colorBox(0.06, 0.5, 0.06, 0.68, 0.25, 0.24, 0x0e0e10),
    // vendor behind the grill
    colorBox(0.42, 0.85, 0.26, 0, 1.15, 0.75, 0xd8d2c4, 0.5),
    colorBox(0.34, 0.75, 0.22, 0, 0.4, 0.75, 0x3a3a44, 0.6),
    colorBox(0.22, 0.24, 0.22, 0, 1.72, 0.75, skin),
    // awning poles, awning, neon strip
    colorBox(0.05, 2.5, 0.05, -0.9, 1.25, 1.1, 0x15151a),
    colorBox(0.05, 2.5, 0.05, 0.9, 1.25, 1.1, 0x15151a),
    colorBox(2.1, 0.05, 1.7, 0, 2.5, 0.35, ctx.neon[1 % ctx.neon.length], 0.35),
    colorBox(1.9, 0.05, 0.05, 0, 2.38, -0.5, ctx.neon[0], 3),
  ];
  for (let i = 0; i < 6; i++) parts.push(colorBox(0.03, 0.03, 0.62, -0.55 + i * 0.22, 0.96, 0, 0x8a6a4a)); // skewers
  for (let i = 0; i < 5; i++) parts.push(colorBox(0.09, 0.09, 0.09, -0.8 + i * 0.4, 2.26, -0.5, 0xffe2a8, 6)); // bulbs
  placeInstances(ctx, mergeGeometries(parts), spots);

  // smoke: a few puffs per grill, animated entirely in the vertex shader
  const PUFFS = 9;
  const pos = new Float32Array(spots.length * PUFFS * 3);
  const seed = new Float32Array(spots.length * PUFFS * 3);
  const rnd = rng(31337);
  spots.forEach((s, i) => {
    for (let k = 0; k < PUFFS; k++) {
      const j = (i * PUFFS + k) * 3;
      pos.set([s.x, 1.0, s.z], j);
      seed.set([rnd(), rnd() - 0.5, rnd() - 0.5], j);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(ctx.fogColor).lerp(new THREE.Color(0xfff0e0), 0.7) } },
    vertexShader: /* glsl */ `
      attribute vec3 aSeed;
      uniform float uTime;
      varying float vAlpha;
      void main() {
        float t = fract(uTime * (0.16 + aSeed.x * 0.08) + aSeed.x * 7.0);
        vec3 p = position + vec3(aSeed.y * 2.6 * t + t * t * 1.4, t * 7.5, aSeed.z * 2.6 * t);
        vAlpha = (1.0 - t) * smoothstep(0.0, 0.12, t) * 0.6;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (0.7 + 3.4 * t) * 620.0 / max(1.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.1, 1.0, d)) * vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
  });
  const smoke = new THREE.Points(geo, mat);
  smoke.frustumCulled = false;
  smoke.renderOrder = 5;
  ctx.group.add(smoke);
  ctx.animate((t) => (mat.uniforms.uTime.value = t));
  return spots.length;
}

/** Kite sellers: a rack of bright kites at the kerb, and a train of kites climbing into the sky above it. */
export function addKiteSellers(ctx: FeatureContext, max: number) {
  const spots = kerbSpots(ctx, (_n, c) => (c === 3 || c === 4 ? 260 : 0), max, 230, 4242);
  const cols = [...ctx.neon, 0x7dff5a, 0xb48cff, 0x39a0ff];
  const parts = [
    colorBox(2.4, 0.06, 0.06, 0, 2.6, 0, 0x15151a),
    colorBox(0.06, 2.6, 0.06, -1.2, 1.3, 0, 0x15151a),
    colorBox(0.06, 2.6, 0.06, 1.2, 1.3, 0, 0x15151a),
    colorBox(2.4, 0.06, 0.06, 0, 1.3, 0, 0x15151a),
    colorBox(1.2, 0.5, 0.6, 0, 0.25, 0.5, 0x2a1d10), // crate of string spools
    colorBox(0.42, 0.85, 0.26, 0.9, 1.15, 0.7, 0xd8d2c4, 0.5), // seller
    colorBox(0.34, 0.75, 0.22, 0.9, 0.4, 0.7, 0x3a3a44, 0.6),
    colorBox(0.22, 0.24, 0.22, 0.9, 1.72, 0.7, new THREE.Color(0.34, 0.22, 0.14)),
  ];
  // kites hung on the rack: flat diamonds
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 4; i++) {
      const k = colorBox(0.62, 0.62, 0.02, 0, 0, 0, cols[(i + row * 3) % cols.length], 2.2);
      k.rotateZ(Math.PI / 4);
      k.translate(-0.84 + i * 0.56, 2.05 - row * 0.95, -0.05);
      parts.push(k);
    }
  placeInstances(ctx, mergeGeometries(parts), spots);

  // the display train of kites above each seller
  const TRAIN = 6;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.9);
  shape.lineTo(0.7, 0);
  shape.lineTo(0, -1.1);
  shape.lineTo(-0.7, 0);
  const kites = new THREE.InstancedMesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false }),
    Math.max(1, spots.length * TRAIN),
  );
  kites.count = spots.length * TRAIN;
  kites.frustumCulled = false;
  for (let i = 0; i < spots.length * TRAIN; i++) kites.setColorAt(i, new THREE.Color(cols[i % cols.length]).multiplyScalar(2));
  ctx.group.add(kites);
  const line = new Float32Array(spots.length * TRAIN * 6);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(line, 3));
  const strings = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xbfb6a8, transparent: true, opacity: 0.5 }));
  strings.frustumCulled = false;
  ctx.group.add(strings);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  ctx.animate((t) => {
    spots.forEach((s, i) => {
      let px = s.x, py = 2.6, pz = s.z;
      for (let k = 0; k < TRAIN; k++) {
        const a = t * 0.7 + i * 1.7 + k * 0.55;
        const h = 5 + k * 3.4;
        // the string leans downwind and wanders more the higher it goes
        p.set(s.x + h * 0.55 + Math.sin(a) * (0.5 + k * 0.35), h + Math.sin(a * 1.3) * 0.4, s.z + Math.cos(a * 0.8) * (0.5 + k * 0.35));
        e.set(-0.7, 1.2 + Math.sin(a) * 0.4, Math.sin(a * 1.6) * 0.3);
        kites.setMatrixAt(i * TRAIN + k, m.compose(p, q.setFromEuler(e), one));
        line.set([px, py, pz, p.x, p.y, p.z], (i * TRAIN + k) * 6);
        px = p.x;
        py = p.y;
        pz = p.z;
      }
    });
    kites.instanceMatrix.needsUpdate = true;
    lineGeo.attributes.position.needsUpdate = true;
  });
  return spots.length;
}

/**
 * Finds the back lanes that really do cut between main roads and marks both mouths of each:
 * a lit signboard, strings of festival bulbs running into the lane, and an amber line on the mini-map.
 */
export function addShortcutLanes(ctx: FeatureContext, max: number, label: string) {
  const onMain = mainRoadTest(ctx);
  const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 160;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#120a06';
  g.fillRect(0, 0, 512, 160);
  g.strokeStyle = hex(ctx.neon[0]);
  g.lineWidth = 8;
  g.strokeRect(8, 8, 496, 144);
  g.fillStyle = hex(ctx.neon[3 % ctx.neon.length]);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '700 74px "Noto Nastaliq Urdu","Segoe UI",Tahoma,Arial,sans-serif';
  g.shadowColor = hex(ctx.neon[0]);
  g.shadowBlur = 16;
  g.fillText(label, 256, 84, 460);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const signMat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.2, 2.2, 2.2) });
  const signGeo = new THREE.PlaneGeometry(3.6, 1.12);

  const parts: THREE.BufferGeometry[] = [];
  const mouths: [number, number][] = [];
  const cols = [...ctx.neon, 0x7dff5a, 0xb48cff];
  let count = 0;
  for (const r of ctx.roads) {
    if (count >= max) break;
    if (r.c !== 4 || r.p.length < 4) continue;
    const n = r.p.length;
    let len = 0;
    for (let i = 0; i + 3 < n; i += 2) len += Math.hypot(r.p[i + 2] - r.p[i], r.p[i + 3] - r.p[i + 1]);
    const a = onMain(r.p[0], r.p[1], 4), b = onMain(r.p[n - 2], r.p[n - 1], 4);
    // a through-lane between two main roads, or a long lane leaving one
    if (!((a && b && len > 60) || ((a || b) && len > 170))) continue;
    const ends: [number, number, number, number][] = [];
    if (a) ends.push([r.p[0], r.p[1], r.p[2] - r.p[0], r.p[3] - r.p[1]]);
    if (b) ends.push([r.p[n - 2], r.p[n - 1], r.p[n - 4] - r.p[n - 2], r.p[n - 3] - r.p[n - 1]]);
    if (ends.some(([x, z]) => mouths.some(([mx, mz]) => Math.hypot(mx - x, mz - z) < 110))) continue;
    r.shortcut = true;
    count++;
    for (const [x, z, ddx, ddz] of ends) {
      mouths.push([x, z]);
      const l = Math.hypot(ddx, ddz) || 1;
      const dx = ddx / l, dz = ddz / l; // pointing into the lane
      const yq = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(-dx, -dz));
      const hw = r.w / 2 + 0.25;
      const put = (geo: THREE.BufferGeometry, along: number) => {
        geo.applyQuaternion(yq);
        geo.translate(x + dx * along, 0, z + dz * along);
        parts.push(geo);
      };
      // rows of bulbs strung across the lane, sagging in the middle
      for (let row = 0; row < 4; row++) {
        const along = 9 + row * 7;
        for (const s of [-1, 1]) put(colorBox(0.1, 5.2, 0.1, s * hw, 2.6, 0, 0x15151a), along);
        const N = 9;
        for (let k = 0; k < N; k++) {
          const u = k / (N - 1) - 0.5;
          put(colorBox(0.16, 0.16, 0.16, u * 2 * hw, 5.1 - (0.25 - u * u) * 2.4, 0, cols[(k + row) % cols.length], 5), along);
        }
      }
      // two faces back to back, so the lettering reads correctly from either direction
      for (const flip of [0, Math.PI]) {
        const sign = new THREE.Mesh(signGeo, signMat);
        sign.position.set(x + dx * 9, 6.2, z + dz * 9);
        sign.quaternion.copy(yq);
        sign.rotateY(flip);
        ctx.group.add(sign);
      }
    }
  }
  if (parts.length) {
    const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshBasicMaterial({ vertexColors: true }));
    mesh.frustumCulled = false;
    ctx.group.add(mesh);
  }
  return count;
}

/**
 * Scatter any piece of street furniture along the kerbs (phone boxes, pillar boxes, benches…).
 * `spacing` returns the metres between pieces for a road class, or 0 to skip that class.
 */
export function addKerbProps(ctx: FeatureContext, geo: THREE.BufferGeometry, spacing: (cls: number) => number, max: number, gap: number, seed: number) {
  const spots = kerbSpots(ctx, (_n, c) => spacing(c), max, gap, seed);
  placeInstances(ctx, geo, spots);
  return spots.length;
}
