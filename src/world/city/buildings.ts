import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { CityDefinition, MapBuilding } from './types';

const CHUNK = 320;
const NEON = [0x00f0ff, 0xff2bd6, 0x7a5cff, 0xffa630, 0x39a0ff, 0x4dff9a];

const fragment = /* glsl */ `
uniform float uTime;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uStreet;
uniform vec3 uStone;
varying vec2 vUv;
varying vec4 vInfo;
varying vec3 vColor;
varying vec3 vN;
varying vec3 vWorld;
varying float vDepth;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 signColor(float t) { return 0.55 + 0.45 * cos(6.2832 * (t + vec3(0.0, 0.33, 0.67))); }

void main() {
  float style = vInfo.x, seed = vInfo.y, H = vInfo.z;
  vec2 uv = vUv;
  vec3 col;
  float shade = 0.7 + 0.3 * dot(normalize(vN), normalize(vec3(-0.4, 0.6, 0.5)));

  if (vInfo.w > 0.5) {
    // ---- rooftops: dark, with water tanks and clutter
    col = vec3(0.016, 0.016, 0.022);
    vec2 c = floor(vWorld.xz / 2.2);
    col += step(0.94, hash(c + seed)) * vec3(0.03, 0.04, 0.06);
    if (style > 0.5 && style < 1.5) col += vColor * 0.05;
  } else if (style < 0.5) {
    // ---- old city block: shops at street level, flats above
    float grime = 0.72 + 0.28 * hash(vec2(floor(uv.x * 1.3), seed * 7.0));
    col = vColor * 0.06 * grime * shade;
    if (uv.y < 3.6) {
      float sx = uv.x / 4.2;
      float id = floor(sx), fx = fract(sx);
      float r = hash(vec2(id, seed * 13.0));
      float door = step(0.07, fx) * step(fx, 0.93) * step(uv.y, 3.05);
      vec3 lamp = mix(vec3(1.0, 0.82, 0.55), vec3(0.72, 1.0, 0.9), step(0.7, r)); // bulb vs tube-light
      float shelves = 0.55 + 0.45 * step(0.5, fract(uv.y * 1.5));
      vec3 openC = lamp * 1.5 * shelves * (0.5 + 0.5 * hash(vec2(floor(fx * 9.0), id + seed)));
      vec3 shut = vec3(0.05, 0.055, 0.06) * (0.55 + 0.45 * step(0.5, fract(uv.y * 9.0)));
      col = mix(col, mix(shut, openC, step(0.45, r)), door);
    } else if (uv.y < 4.7) {
      // painted / neon signboards over every shop
      float sx = uv.x / 4.2;
      float id = floor(sx), fx = fract(sx);
      float r = hash(vec2(id + 3.0, seed * 17.0));
      float m = step(0.05, fx) * step(fx, 0.95) * step(3.72, uv.y) * step(uv.y, 4.58);
      float glyph = step(0.42, hash(vec2(floor(fx * 16.0), id * 3.0 + seed))) * step(3.9, uv.y) * step(uv.y, 4.4);
      float flick = r > 0.86 ? step(0.35, fract(uTime * (1.0 + r * 3.0) + r * 9.0)) : 1.0;
      vec3 sc = signColor(r * 3.7 + seed);
      col = mix(col, (sc * 0.35 + vec3(1.0) * glyph * 1.5 * sc) * step(0.22, r) * flick, m);
    } else {
      vec2 g = vec2(uv.x / 2.6, (uv.y - 4.7) / 3.3);
      vec2 cell = floor(g), f = fract(g);
      float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.2, f.y) * step(f.y, 0.72);
      float r = hash(cell + seed * 57.0);
      float lit = step(0.7, r);
      vec3 wc = mix(vec3(1.0, 0.7, 0.36), vec3(0.7, 0.95, 1.0), step(0.9, r));
      col = mix(col, mix(vec3(0.012, 0.014, 0.02), wc * (0.6 + 0.9 * fract(r * 9.0)), lit), win);
      col *= 1.0 - 0.5 * step(f.y, 0.06); // balcony ledge
      float ac = step(0.84, hash(cell + seed * 3.0)) * step(0.8, f.x) * step(f.x, 0.97) * step(0.3, f.y) * step(f.y, 0.5);
      col = mix(col, vec3(0.035), ac);
    }
    col += vColor * uStreet * 0.2 * exp(-uv.y / 6.0) * shade; // street-light wash
  } else if (style < 1.5) {
    // ---- neon megastructure
    col = vec3(0.01, 0.011, 0.02);
    vec2 g = vec2(uv.x / 4.0, uv.y / 4.5);
    vec2 cell = floor(g), f = fract(g);
    float win = step(0.15, f.x) * step(f.x, 0.85) * step(0.25, f.y) * step(f.y, 0.8);
    float r = hash(cell + seed * 91.0);
    col += win * step(0.6, r) * mix(vColor, vec3(1.0, 0.82, 0.55), step(0.9, r)) * (0.8 + 1.5 * fract(r * 7.0));
    col += step(0.93, hash(vec2(cell.y, seed * 17.0))) * step(f.y, 0.2) * vColor * 2.4;
    // animated holographic advertising wall
    float face = floor(uv.x / 40.0);
    float pr = hash(vec2(face, seed * 5.0));
    vec2 pp = vec2(fract(uv.x / 40.0), (uv.y - H * 0.42) / (H * 0.3));
    float panel = step(0.55, pr) * step(0.12, pp.x) * step(pp.x, 0.88) * step(0.0, pp.y) * step(pp.y, 1.0);
    vec3 holo = 0.5 + 0.5 * cos(6.2832 * (pp.y * 1.5 + uTime * 0.12 + pr) + vec3(0.0, 2.0, 4.0));
    float scan = 0.7 + 0.3 * sin(uv.y * 3.0 - uTime * 6.0);
    float pattern = step(0.5, hash(floor(vec2(pp.x * 10.0, pp.y * 14.0 + floor(uTime * 0.8 + pr * 10.0)))));
    col = mix(col, holo * scan * (0.5 + 1.5 * pattern) * 1.3, panel);
    col += vColor * 0.3 * exp(-uv.y / 14.0);
  } else if (style < 2.5) {
    // ---- heritage sandstone: arcades, warm floodlights, one neon line of trim
    vec3 stone = uStone * (0.82 + 0.36 * hash(vec2(floor(uv.x / 0.9), floor(uv.y / 0.45)) + seed));
    col = stone * 0.075 * shade;
    vec2 g = vec2(uv.x / 3.4, uv.y / 4.4);
    vec2 cell = floor(g), f = fract(g);
    vec2 q = vec2((f.x - 0.5) * 3.4, f.y * 4.4);
    float w = 0.85;
    float open = max(step(abs(q.x), w) * step(0.5, q.y) * step(q.y, 2.6), step(length(q - vec2(0.0, 2.6)), w) * step(2.6, q.y));
    float r = hash(cell + seed * 23.0);
    vec3 glow = vec3(1.0, 0.64, 0.28) * (0.35 + 1.1 * step(0.4, r));
    col = mix(col, glow * (0.3 + 0.7 * smoothstep(0.5, 3.4, q.y)), open);
    col = mix(col, stone * 0.13, step(4.12, q.y));
    col += stone * vec3(1.0, 0.68, 0.38) * 0.55 * exp(-uv.y / 9.0) * shade;
    col += vec3(0.0, 0.9, 1.0) * 2.2 * step(H - 0.4, uv.y) * step(uv.y, H - 0.14);
  } else {
    // ---- modern plaza / mid-rise
    col = vec3(0.03, 0.034, 0.04) * shade;
    if (uv.y < 4.5) {
      float sx = uv.x / 6.0;
      float fx = fract(sx), r = hash(vec2(floor(sx), seed * 3.0));
      float glass = step(0.05, fx) * step(fx, 0.95) * step(0.3, uv.y) * step(uv.y, 3.8);
      vec3 gc = mix(vec3(0.9, 0.95, 1.0), vec3(1.0, 0.6, 0.85), step(0.6, r)) * (0.7 + 0.7 * hash(vec2(floor(fx * 6.0), r)));
      col = mix(col, gc, glass * step(0.25, r));
    } else {
      vec2 g = vec2(uv.x / 3.0, uv.y / 3.3);
      vec2 cell = floor(g), f = fract(g);
      float win = step(0.08, f.x) * step(f.x, 0.92) * step(0.3, f.y) * step(f.y, 0.85);
      float r = hash(cell + seed * 71.0);
      vec3 wc = mix(vec3(0.75, 0.9, 1.0), vec3(1.0, 0.8, 0.5), step(0.7, r));
      col = mix(col, mix(vec3(0.015, 0.02, 0.03), wc * (0.5 + 0.8 * fract(r * 5.0)), step(0.55, r)), win);
      float strip = step(0.4, hash(vec2(seed * 9.0, 1.0))) * step(abs(fract(uv.x / 30.0) - 0.5), 0.022) * step(6.0, uv.y) * step(uv.y, H - 2.0);
      col += vColor * 3.0 * strip * (0.7 + 0.3 * sin(uTime * 3.0 + uv.y * 0.4));
    }
    col += uStreet * 0.014 * exp(-uv.y / 6.0);
  }
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
  gl_FragColor = vec4(mix(col, uFogColor, clamp(fog, 0.0, 1.0)), 1.0);
}`;

const vertex = /* glsl */ `
attribute vec4 aInfo;
attribute vec3 aColor;
varying vec2 vUv;
varying vec4 vInfo;
varying vec3 vColor;
varying vec3 vN;
varying vec3 vWorld;
varying float vDepth;
void main() {
  vUv = uv;
  vInfo = aInfo;
  vColor = aColor;
  vN = normal;
  vWorld = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

interface ChunkData {
  pos: number[];
  nrm: number[];
  uv: number[];
  info: number[];
  col: number[];
  idx: number[];
}

function hash01(a: number, b: number) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Extrudes every footprint into walls + roof, batched into streamed chunks with one collider each. */
export function buildBuildings(
  buildings: MapBuilding[],
  def: CityDefinition,
  world: RAPIER.World,
  fogColor: THREE.Color,
  fogDensity: number,
) {
  const group = new THREE.Group();
  const chunks = new Map<string, ChunkData>();
  const facades = def.facades.map((c) => new THREE.Color(c));
  const neon = NEON.map((c) => new THREE.Color(c));
  const c2 = new THREE.Vector2();

  const extrude = (ch: ChunkData, pts: number[], y0: number, y1: number, style: number, seed: number, H: number, color: THREE.Color) => {
    const n = pts.length / 2;
    let per = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[j * 2], bz = pts[j * 2 + 1];
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      const nx = dz / len, nz = -dx / len;
      const b = ch.pos.length / 3;
      ch.pos.push(ax, y0, az, bx, y0, bz, ax, y1, az, bx, y1, bz);
      ch.uv.push(per, y0, per + len, y0, per, y1, per + len, y1);
      for (let k = 0; k < 4; k++) {
        ch.nrm.push(nx, 0, nz);
        ch.info.push(style, seed, H, 0);
        ch.col.push(color.r, color.g, color.b);
      }
      ch.idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      per += len;
    }
    // roof
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(pts[i * 2], pts[i * 2 + 1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const b = ch.pos.length / 3;
    for (let i = 0; i < n; i++) {
      ch.pos.push(pts[i * 2], y1, pts[i * 2 + 1]);
      ch.uv.push(0, 0);
      ch.nrm.push(0, 1, 0);
      ch.info.push(style, seed, H, 1);
      ch.col.push(color.r, color.g, color.b);
    }
    for (const t of tris) ch.idx.push(b + t[0], b + t[2], b + t[1]);
  };

  buildings.forEach((bd, bi) => {
    const p = bd.p;
    const n = p.length / 2;
    let cx = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      cx += p[i * 2];
      cz += p[i * 2 + 1];
    }
    cx /= n;
    cz /= n;
    const key = `${Math.floor(cx / CHUNK)},${Math.floor(cz / CHUNK)}`;
    let ch = chunks.get(key);
    if (!ch) chunks.set(key, (ch = { pos: [], nrm: [], uv: [], info: [], col: [], idx: [] }));
    const seed = hash01(cx, cz);
    const color = bd.s === 0 ? facades[Math.floor(seed * 977) % facades.length] : neon[Math.floor(seed * 977) % neon.length];
    extrude(ch, p, 0, bd.h, bd.s, seed, bd.h, color);
    if (bd.s === 1 && seed > 0.3) {
      // megatowers step back near the top for a more interesting skyline
      const k = 0.62 + seed * 0.2;
      const top = bd.h * (1.22 + seed * 0.3);
      const inner: number[] = [];
      for (let i = 0; i < n; i++) inner.push(cx + (p[i * 2] - cx) * k, cz + (p[i * 2 + 1] - cz) * k);
      extrude(ch, inner, bd.h, top, 1, seed + 0.13, top, color);
    }
    void bi;
    void c2;
  });

  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uFogColor: { value: fogColor },
      uFogDensity: { value: fogDensity },
      uStreet: { value: new THREE.Color(def.streetLight) },
      uStone: { value: new THREE.Color(def.heritageStone) },
    },
  });

  let tris = 0;
  for (const ch of chunks.values()) {
    const g = new THREE.BufferGeometry();
    const positions = new Float32Array(ch.pos);
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(ch.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(ch.uv, 2));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(ch.info, 4));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(ch.col, 3));
    const indices = new Uint32Array(ch.idx);
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    g.computeBoundingSphere();
    group.add(new THREE.Mesh(g, material));
    world.createCollider(RAPIER.ColliderDesc.trimesh(positions, indices).setFriction(0.3).setRestitution(0.1));
    tris += indices.length / 3;
  }
  return { group, material, triangles: tris };
}
