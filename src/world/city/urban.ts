import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRoadTextures } from '../../effects/textures';
import { colorBox } from './props';
import type { FeatureContext } from './types';

/** Big-city set pieces: an enclosed speed tunnel and searchlights raking the clouds. */

const hdr = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k);

/**
 * A long tiled tunnel at street level with a chain of light rings that pulse past you —
 * the faster you go, the more it strobes. Runs along X at depth `z` from x0 to x1.
 */
export function addTubeRun(ctx: FeatureContext, x0: number, x1: number, z: number, radius = 7.5) {
  const len = x1 - x0;
  const cx = (x0 + x1) / 2;
  const tex = makeRoadTextures(ctx.neon[1 % ctx.neon.length], ctx.neon[0]);
  tex.map.repeat.set(1, len / 24);
  tex.emissiveMap.repeat.set(1, len / 24);
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 1.7, len),
    new THREE.MeshStandardMaterial({ map: tex.map, emissive: 0xffffff, emissiveMap: tex.emissiveMap, emissiveIntensity: 2, roughness: 0.25, metalness: 0.2, envMapIntensity: 1.3 }),
  );
  road.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
  road.position.set(cx, 0.06, z);
  ctx.group.add(road);
  // the vault: a half-cylinder of dark glazed tile, seen from inside
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, len, 24, 1, true, 0, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x1c2026, roughness: 0.28, metalness: 0.3, side: THREE.DoubleSide, envMapIntensity: 1.2 }),
  );
  // lay the half-cylinder along X with its arc overhead and the open side on the road
  shell.geometry.rotateZ(Math.PI / 2);
  shell.position.set(cx, 0, z);
  ctx.group.add(shell);
  for (const s of [-1, 1]) ctx.addBox(new THREE.Vector3(cx, 2.5, z + s * (radius - 0.3)), new THREE.Vector3(len, 5, 0.6));
  // portals
  const parts: THREE.BufferGeometry[] = [];
  for (const px of [x0, x1]) {
    parts.push(colorBox(1.2, radius + 1.5, 0.9, px, (radius + 1.5) / 2, z - radius - 0.4, 0x14161a));
    parts.push(colorBox(1.2, radius + 1.5, 0.9, px, (radius + 1.5) / 2, z + radius + 0.4, 0x14161a));
    parts.push(colorBox(1.2, 1.4, radius * 2 + 1.8, px, radius + 1.4, z, 0x14161a));
    parts.push(colorBox(0.3, 0.5, radius * 1.3, px + (px === x0 ? -0.7 : 0.7), radius + 1.4, z, ctx.neon[0], 3));
  }
  // a continuous strip light along the crown of the vault
  parts.push(colorBox(len, 0.12, 0.3, cx, radius - 0.15, z, ctx.neon[1 % ctx.neon.length], 2.2));
  const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshBasicMaterial({ vertexColors: true }));
  mesh.frustumCulled = false;
  ctx.group.add(mesh);
  // rings: instanced so a wave of brightness can run down the tube
  const STEP = 16;
  const N = Math.floor(len / STEP);
  const ringGeo = new THREE.TorusGeometry(radius - 0.35, 0.16, 6, 28, Math.PI);
  ringGeo.rotateY(Math.PI / 2);
  const rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), N);
  const m = new THREE.Matrix4();
  for (let i = 0; i < N; i++) rings.setMatrixAt(i, m.makeTranslation(x0 + STEP * (i + 0.5), 0, z));
  rings.frustumCulled = false;
  ctx.group.add(rings);
  const a = hdr(ctx.neon[0], 3), b = hdr(ctx.neon[1 % ctx.neon.length], 1.1), c = new THREE.Color();
  ctx.animate((t) => {
    for (let i = 0; i < N; i++) {
      const wave = Math.pow(0.5 + 0.5 * Math.sin(i * 0.55 - t * 7), 6);
      rings.setColorAt(i, c.copy(b).lerp(a, wave));
    }
    if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
  });
}

/** Searchlights sweeping the cloud base from the given ground positions. */
export function addSearchlights(ctx: FeatureContext, spots: [number, number][], color = 0xdfe8ff) {
  const mat = new THREE.MeshBasicMaterial({
    color: hdr(color, 0.5), transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const geo = new THREE.CylinderGeometry(16, 0.8, 520, 12, 1, true);
  geo.translate(0, 260, 0);
  const lights = spots.map(([x, z], i) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 4, z);
    pivot.add(new THREE.Mesh(geo, mat));
    const base = new THREE.Mesh(new THREE.BoxGeometry(2, 1.4, 2), new THREE.MeshBasicMaterial({ color: hdr(color, 4) }));
    base.position.set(x, 3.4, z);
    ctx.group.add(pivot, base);
    return { pivot, ph: i * 1.7, sp: 0.16 + (i % 3) * 0.05 };
  });
  ctx.animate((t) => {
    for (const l of lights) {
      // lean over and swing slowly round, like a beam hunting through cloud
      l.pivot.rotation.set(0.42 + 0.2 * Math.sin(t * l.sp * 1.3 + l.ph), t * l.sp + l.ph, 0, 'YXZ');
    }
    mat.opacity = 0.1 + 0.03 * Math.sin(t * 0.9);
  });
}
