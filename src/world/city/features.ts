import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRoadTextures, makeTruckArtTexture } from '../../effects/textures';
import { colorBox } from './props';
import type { FeatureContext } from './types';

const UP = new THREE.Vector3(0, 1, 0);
const hdr = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k);

/**
 * Reusable set pieces that give a city its terrain, skyline traffic and signature drive.
 * City definitions compose these in their `features` hook.
 */

function waterMaterial(ctx: FeatureContext, deep: number, glint: number) {
  const mat = new THREE.ShaderMaterial({
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    uniforms: {
      uTime: { value: 0 }, uDeep: { value: new THREE.Color(deep) }, uGlint: { value: new THREE.Color(glint) },
      uFogColor: { value: ctx.fogColor }, uFogDensity: { value: ctx.fogDensity * 0.6 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying float vDepth;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uDeep; uniform vec3 uGlint; uniform vec3 uFogColor; uniform float uFogDensity;
      varying vec3 vWorld; varying float vDepth;
      void main() {
        vec2 p = vWorld.xz * 0.045;
        float n = sin(p.x * 1.3 + uTime * 0.6) * sin(p.y * 1.7 - uTime * 0.45)
                + 0.5 * sin(p.x * 3.1 - uTime * 0.9) * sin(p.y * 2.3 + uTime * 0.7)
                + 0.25 * sin(p.x * 7.3 + uTime * 1.4) * sin(p.y * 6.1 - uTime * 1.1);
        vec3 view = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - clamp(view.y, 0.0, 1.0), 5.0);
        vec3 col = uDeep + uGlint * smoothstep(0.7, 1.5, n) * 1.6 + uFogColor * fres * 1.4;
        float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
        gl_FragColor = vec4(mix(col, uFogColor, clamp(fog, 0.0, 1.0)), 1.0);
      }`,
  });
  ctx.animate((t) => (mat.uniforms.uTime.value = t));
  return mat;
}

/** A sheet of open water (sea, river, creek) with drifting glints. `rect` is [minX, minZ, maxX, maxZ]. */
export function addWater(ctx: FeatureContext, rect: [number, number, number, number], deep: number, glint: number) {
  const [x0, z0, x1, z1] = rect;
  const mat = waterMaterial(ctx, deep, glint);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((x0 + x1) / 2, 0.12, (z0 + z1) / 2);
  mesh.renderOrder = -8;
  ctx.group.add(mesh);
}

/** Water that follows the map's real shoreline (traced by the converter). */
export function addMappedWater(ctx: FeatureContext, water: NonNullable<import('./types').CityMap['water']>, deep: number, glint: number) {
  const pos: number[] = [];
  const idx: number[] = [];
  const { cell, ox, oz, runs } = water;
  for (let i = 0; i < runs.length; i += 3) {
    const x0 = ox + runs[i] * cell, z0 = oz + runs[i + 1] * cell, x1 = x0 + runs[i + 2] * cell, z1 = z0 + cell;
    const b = pos.length / 3;
    pos.push(x0, 0.12, z0, x1, 0.12, z0, x0, 0.12, z1, x1, 0.12, z1);
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, waterMaterial(ctx, deep, glint));
  mesh.frustumCulled = false;
  mesh.renderOrder = -8;
  ctx.group.add(mesh);
}

/** Small lit boats bobbing on a stretch of water. */
export function addBoats(ctx: FeatureContext, rect: [number, number, number, number], count: number, lamp: number) {
  const geo = mergeGeometries([
    colorBox(2.6, 0.9, 8, 0, 0.5, 0, 0x1a1410),
    colorBox(2.0, 1.1, 2.6, 0, 1.4, 1.6, 0x241a12),
    colorBox(0.12, 4.5, 0.12, 0, 3.2, -1, 0x0c0c0e),
    colorBox(0.3, 0.3, 0.3, 0, 5.5, -1, lamp, 6),
    colorBox(2.7, 0.08, 8.1, 0, 0.98, 0, ctx.neon[0], 2),
  ]);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }), count);
  mesh.frustumCulled = false;
  ctx.group.add(mesh);
  let seed = 4711;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const [x0, z0, x1, z1] = rect;
  const boats = Array.from({ length: count }, () => ({
    x: x0 + rnd() * (x1 - x0), z: z0 + rnd() * (z1 - z0), yaw: rnd() * 6.28, ph: rnd() * 6.28, drift: (rnd() - 0.5) * 1.2,
  }));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  ctx.animate((t) => {
    boats.forEach((b, i) => {
      const span = x1 - x0;
      const x = x0 + ((((b.x - x0 + t * b.drift) % span) + span) % span);
      p.set(x, 0.1 + Math.sin(t * 0.9 + b.ph) * 0.18, b.z);
      e.set(Math.sin(t * 0.8 + b.ph) * 0.05, b.yaw, Math.sin(t * 0.7 + b.ph * 2) * 0.07);
      m.compose(p, q.setFromEuler(e), one);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
}

/** Slow cargo airships carrying holographic billboards across the sky. */
export function addAirships(ctx: FeatureContext, count: number) {
  const hullGeo = new THREE.SphereGeometry(1, 20, 12);
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x1a1d26, roughness: 0.5, metalness: 0.6, emissive: ctx.neon[0], emissiveIntensity: 0.06 });
  const holo = makeTruckArtTexture(ctx.neon[0], ctx.neon[1]);
  const holoMat = new THREE.MeshBasicMaterial({ map: holo, color: new THREE.Color(2.4, 2.4, 2.4), transparent: true, opacity: 0.9, side: THREE.DoubleSide, fog: false });
  let seed = 909;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const R = Math.hypot(ctx.half[0], ctx.half[1]) * 0.75;
  const ships = Array.from({ length: count }, (_, i) => {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.scale.set(13, 13, 46);
    const gondola = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 18), hullMat);
    gondola.position.y = -14;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(27, 0.6, 0.6), new THREE.MeshBasicMaterial({ color: hdr(ctx.neon[i % ctx.neon.length], 3) }));
    strip.position.set(0, -16.2, 0);
    strip.rotation.y = Math.PI / 2;
    g.add(hull, gondola, strip);
    for (const s of [-1, 1]) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(44, 14), holoMat);
      panel.position.set(s * 13.6, -2, 0);
      panel.rotation.y = (s * Math.PI) / 2;
      const nav = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshBasicMaterial({ color: hdr(s < 0 ? 0xff1030 : 0x30ff60, 6) }));
      nav.position.set(s * 13, 0, -30);
      g.add(panel, nav);
    }
    ctx.group.add(g);
    return { g, a: rnd() * 6.28, r: R * (0.45 + rnd() * 0.6), y: 150 + i * 38 + rnd() * 30, w: (0.012 + rnd() * 0.012) * (i % 2 ? 1 : -1) };
  });
  ctx.animate((t) => {
    for (const s of ships) {
      const a = s.a + t * s.w;
      s.g.position.set(Math.cos(a) * s.r, s.y + Math.sin(t * 0.2 + s.a) * 4, Math.sin(a) * s.r);
      s.g.rotation.y = -a + (s.w > 0 ? Math.PI : 0);
    }
    holoMat.opacity = 0.84 + 0.08 * Math.sin(t * 5);
  });
}

/**
 * An elevated expressway: a long, straight, glowing deck on pylons with a ramp at each end —
 * somewhere to hold top speed. Runs along X at depth `z` between x0 and x1.
 */
export function addExpressway(ctx: FeatureContext, x0: number, x1: number, z: number, height = 12, width = 15) {
  const RAMP = 110;
  const len = x1 - x0;
  const neonA = ctx.neon[0], neonB = ctx.neon[1];
  const tex = makeRoadTextures(neonA, neonB);
  tex.map.repeat.set(1, len / 24);
  tex.emissiveMap.repeat.set(1, len / 24);
  const surfMat = new THREE.MeshStandardMaterial({
    map: tex.map, emissive: 0xffffff, emissiveMap: tex.emissiveMap, emissiveIntensity: 2.2, roughness: 0.3, metalness: 0.2, envMapIntensity: 1.4,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.6, metalness: 0.5 });
  // deck
  const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 0.8, width + 1.2), dark);
  deck.position.set((x0 + x1) / 2, height - 0.4, z);
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(width, len), surfMat);
  surf.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
  surf.position.set((x0 + x1) / 2, height + 0.02, z);
  ctx.group.add(deck, surf);
  ctx.addBox(new THREE.Vector3((x0 + x1) / 2, height - 0.4, z), new THREE.Vector3(len, 0.8, width + 1.2));
  // ramps
  const angle = Math.atan2(height, RAMP);
  const rl = Math.hypot(height, RAMP);
  for (const s of [-1, 1]) {
    const cx = (s < 0 ? x0 : x1) + (s * RAMP) / 2;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -s * angle);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(rl, 0.8, width + 1.2), dark);
    ramp.position.set(cx, height / 2 - 0.4, z);
    ramp.quaternion.copy(q);
    const rs = new THREE.Mesh(new THREE.PlaneGeometry(width, rl), surfMat);
    rs.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    const holder = new THREE.Group();
    holder.position.set(cx, height / 2 + 0.03, z);
    holder.quaternion.copy(q);
    holder.add(rs);
    ctx.group.add(ramp, holder);
    ctx.addBox(new THREE.Vector3(cx, height / 2 - 0.4, z), new THREE.Vector3(rl, 0.8, width + 1.2), q);
  }
  // rails, pylons and speed gates (instanced)
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    parts.push(colorBox(len, 0.16, 0.16, (x0 + x1) / 2, height + 1.0, z + side * (width / 2 + 0.3), side < 0 ? neonA : neonB, 3.2));
    parts.push(colorBox(len, 0.9, 0.2, (x0 + x1) / 2, height + 0.45, z + side * (width / 2 + 0.4), 0x101116));
    ctx.addBox(new THREE.Vector3((x0 + x1) / 2, height + 0.6, z + side * (width / 2 + 0.4)), new THREE.Vector3(len, 1.4, 0.3));
  }
  for (let x = x0 + 30; x < x1 - 20; x += 70) {
    parts.push(colorBox(2.4, height - 0.8, 2.4, x, (height - 0.8) / 2, z, 0x121318));
    ctx.addBox(new THREE.Vector3(x, (height - 0.8) / 2, z), new THREE.Vector3(2.4, height - 0.8, 2.4));
  }
  let k = 0;
  for (let x = x0 + 120; x < x1 - 100; x += 240) {
    const c = k++ % 2 ? neonB : neonA;
    for (const side of [-1, 1]) parts.push(colorBox(0.3, 7, 0.3, x, height + 3.5, z + side * (width / 2 + 0.2), c, 3.2));
    parts.push(colorBox(0.3, 0.3, width + 0.7, x, height + 7, z, c, 3.2));
  }
  const extras = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshBasicMaterial({ vertexColors: true }));
  extras.frustumCulled = false;
  ctx.group.add(extras);
}

/**
 * Jump ramps on long straights, each followed by a glowing gateway arch to fly through.
 * Placed automatically on the city's biggest roads.
 */
export function addGateJumps(ctx: FeatureContext, max: number, color: number) {
  const placed: [number, number][] = [];
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.5, metalness: 0.5 });
  const parts: THREE.BufferGeometry[] = [];
  const glowParts: THREE.BufferGeometry[] = [];
  for (const r of ctx.roads) {
    if (placed.length >= max) break;
    if (r.c > 2 || r.w < 9) continue;
    for (let i = 0; i + 3 < r.p.length && placed.length < max; i += 2) {
      const ax = r.p[i], az = r.p[i + 1];
      const dx = r.p[i + 2] - ax, dz = r.p[i + 3] - az;
      const len = Math.hypot(dx, dz);
      if (len < 150) continue;
      const fx = dx / len, fz = dz / len;
      const px = ax + fx * 45, pz = az + fz * 45;
      if (placed.some(([x, z]) => Math.hypot(x - px, z - pz) < 420)) continue;
      if (Math.abs(px) > ctx.half[0] - 60 || Math.abs(pz) > ctx.half[1] - 60) continue;
      placed.push([px, pz]);
      // kicker on one half of the carriageway, so it is always optional
      const yaw = Math.atan2(-fx, -fz);
      const rw = Math.min(6, r.w * 0.42), L = 10, ang = THREE.MathUtils.degToRad(9);
      const sideX = -fz, sideZ = fx; // left of travel
      const off = r.w / 2 - rw / 2 - 0.6;
      const kx = px + sideX * off, kz = pz + sideZ * off;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(ang, yaw, 0, 'YXZ'));
      const y = (L / 2) * Math.sin(ang) - 0.25 * Math.cos(ang) + 0.04;
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.5, L), dark);
      ramp.position.set(kx, y, kz);
      ramp.quaternion.copy(q);
      ctx.group.add(ramp);
      ctx.addBox(new THREE.Vector3(kx, y, kz), new THREE.Vector3(rw, 0.5, L), q);
      const yq = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
      const place = (g: THREE.BufferGeometry, x: number, yy: number, z: number, into: THREE.BufferGeometry[]) => {
        g.applyQuaternion(yq);
        g.translate(x, yy, z);
        into.push(g);
      };
      for (const s of [-1, 1]) place(colorBox(0.14, 0.14, L, s * (rw / 2), 0.9, 0, color, 3), kx, 0, kz, glowParts);
      // pointed gateway 40 m further on, spanning the whole road
      const gx = px + fx * 40, gz = pz + fz * 40;
      const hw = r.w / 2 + 1.6;
      for (const s of [-1, 1]) {
        place(colorBox(1.6, 11, 1.6, s * hw, 5.5, 0, 0x16171d), gx, 0, gz, parts);
        place(colorBox(0.2, 11, 0.5, s * (hw - 0.9), 5.5, 0, color, 3.2), gx, 0, gz, glowParts);
        // two leaning beams meet in a point: the arch
        const beam = colorBox(hw * 1.18, 0.5, 0.5, 0, 0, 0, color, 3.2);
        beam.rotateZ(s * 0.62);
        beam.translate((s * hw) / 2, 14.4, 0);
        place(beam, gx, 0, gz, glowParts);
        const pillar = new THREE.Vector3(s * hw, 5.5, 0).applyQuaternion(yq).add(new THREE.Vector3(gx, 0, gz));
        ctx.addBox(pillar, new THREE.Vector3(1.6, 11, 1.6), yq);
      }
    }
  }
  if (parts.length) {
    const m = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshBasicMaterial({ vertexColors: true }));
    m.frustumCulled = false;
    ctx.group.add(m);
  }
  if (glowParts.length) {
    const m = new THREE.Mesh(mergeGeometries(glowParts), new THREE.MeshBasicMaterial({ vertexColors: true }));
    m.frustumCulled = false;
    ctx.group.add(m);
  }
  return placed.length;
}
