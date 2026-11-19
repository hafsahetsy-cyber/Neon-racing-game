import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { colorBox } from './props';
import type { CityDefinition, MapBuilding } from './types';

const CHUNK = 320;
const NEON = [0x00f0ff, 0xff2bd6, 0x7a5cff, 0xffa630, 0x39a0ff, 0x4dff9a];

const fragment = /* glsl */ `
uniform float uTime;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uStreet;
uniform vec3 uStone;
uniform vec3 uSun;
uniform vec3 uSunDir;
uniform vec3 uTrim;
uniform float uDay;
uniform float uArch;
uniform float uHolo;
uniform float uNeonK;
uniform float uLitK;
varying vec2 vUv;
varying vec4 vInfo;
varying vec3 vColor;
varying vec3 vN;
varying vec3 vWorld;
varying float vDepth;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 signColor(float t) { return 0.55 + 0.45 * cos(6.2832 * (t + vec3(0.0, 0.33, 0.67))); }

// London: sooty stock brick in running bond, white sash windows under stone lintels,
// painted timber shopfronts with gilt lettering instead of neon.
vec3 victorian(vec2 uv, float seed, float H, vec3 base, float shade, vec3 day) {
  vec3 light = vec3(0.06 * shade) + day;
  vec2 bq = vec2(uv.x / 0.46, uv.y / 0.15);
  bq.x += 0.5 * mod(floor(bq.y), 2.0);
  vec2 bf = fract(bq);
  float mortar = step(0.07, bf.x) * step(0.14, bf.y);
  float soot = 0.72 + 0.28 * hash(vec2(floor(uv.x * 0.7), seed * 7.0));
  vec3 col = base * (0.8 + 0.35 * hash(floor(bq) + seed * 3.0)) * mix(0.55, 1.0, mortar) * soot * light;
  vec3 stone = vec3(0.72, 0.7, 0.64) * (0.2 + light * 1.7);
  vec3 skyGlass = vec3(0.1, 0.13, 0.17) * (0.3 + 2.0 * uDay);
  if (uv.y < 3.6) {
    float sx = uv.x / 5.2;
    float id = floor(sx), fx = fract(sx);
    float r = hash(vec2(id, seed * 13.0));
    vec3 paint = r < 0.3 ? vec3(0.05, 0.17, 0.12) : r < 0.55 ? vec3(0.06, 0.09, 0.22) : r < 0.78 ? vec3(0.3, 0.05, 0.06) : vec3(0.045, 0.045, 0.05);
    col = paint * (0.22 + light * 2.4);
    float glassM = step(0.1, fx) * step(fx, 0.9) * step(0.6, uv.y) * step(uv.y, 2.95);
    vec3 inside = vec3(1.0, 0.84, 0.6) * (0.55 + 0.55 * hash(vec2(floor(fx * 7.0), id + seed)));
    vec3 glass = mix(skyGlass, inside, step(0.28, r));
    glass *= 1.0 - 0.75 * step(0.955, fract(fx * 4.0));
    col = mix(col, glass, glassM);
  } else if (uv.y < 4.7) {
    float sx = uv.x / 5.2;
    float id = floor(sx), fx = fract(sx);
    float r = hash(vec2(id, seed * 13.0));
    vec3 paint = r < 0.3 ? vec3(0.05, 0.17, 0.12) : r < 0.55 ? vec3(0.06, 0.09, 0.22) : r < 0.78 ? vec3(0.3, 0.05, 0.06) : vec3(0.045, 0.045, 0.05);
    col = paint * (0.26 + light * 2.4);
    float glyph = step(0.5, hash(vec2(floor(fx * 18.0), id + seed))) * step(0.2, fx) * step(fx, 0.8) * step(3.95, uv.y) * step(uv.y, 4.35);
    col = mix(col, vec3(0.95, 0.75, 0.35) * (0.45 + light * 2.0), glyph);
    col = mix(col, stone, step(4.58, uv.y));
  } else {
    vec2 g = vec2(uv.x / 2.4, (uv.y - 4.7) / 3.2);
    vec2 cell = floor(g), f = fract(g);
    float win = step(0.31, f.x) * step(f.x, 0.69) * step(0.17, f.y) * step(f.y, 0.75);
    float frame = step(0.27, f.x) * step(f.x, 0.73) * step(0.13, f.y) * step(f.y, 0.79);
    float r2 = hash(cell + seed * 57.0);
    vec3 warm = mix(vec3(1.0, 0.74, 0.42), vec3(0.85, 0.9, 1.0), step(0.93, r2));
    vec3 glass = mix(skyGlass, warm * (0.7 + 0.7 * fract(r2 * 9.0)), step(0.6, r2));
    float bars = max(step(abs(f.y - 0.46), 0.012), step(abs(f.x - 0.5), 0.012));
    col = mix(col, vec3(0.84, 0.82, 0.78) * (0.25 + light * 1.8), frame);
    col = mix(col, glass, win * (1.0 - bars));
    col = mix(col, stone, step(0.25, f.x) * step(f.x, 0.75) * step(0.8, f.y) * step(f.y, 0.87));
    col = mix(col, stone, step(H - 0.45, uv.y));
  }
  return col;
}

void main() {
  float style = vInfo.x, seed = vInfo.y, H = vInfo.z;
  vec2 uv = vUv;
  vec3 col;
  float shade = 0.7 + 0.3 * dot(normalize(vN), normalize(vec3(-0.4, 0.6, 0.5)));
  // daylight: sun-facing walls catch the light, the rest sit in sky-lit shade
  vec3 day = uSun * uDay * (0.2 + 0.8 * max(dot(normalize(vN), uSunDir), 0.0));

  if (vInfo.w > 1.5) {
    // ---- pitched slate roof, wet under the sky
    float course = floor(uv.y / 0.32);
    float tile = hash(vec2(floor(uv.x / 0.5 + 0.5 * mod(course, 2.0)), course) + seed);
    col = vec3(0.14, 0.15, 0.18) * (0.8 + 0.3 * tile) * (0.75 + 0.25 * step(0.1, fract(uv.y / 0.32))) * (vec3(0.05) + day * 1.5);
    col += vec3(0.2, 0.24, 0.3) * uDay * 0.22 * max(normalize(vN).y, 0.0);
  } else if (vInfo.w > 0.5) {
    // ---- rooftops: dark, with water tanks and clutter
    col = vec3(0.016, 0.016, 0.022) + vec3(0.22, 0.2, 0.18) * uSun * uDay;
    vec2 c = floor(vWorld.xz / 2.2);
    col += step(0.94, hash(c + seed)) * vec3(0.03, 0.04, 0.06);
    if (style > 0.5 && style < 1.5) col += vColor * 0.05;
  } else if (style < 0.5) {
    // ---- old city block: shops at street level, flats above
    float grime = 0.72 + 0.28 * hash(vec2(floor(uv.x * 1.3), seed * 7.0));
    col = vColor * grime * (0.06 * shade + day);
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
      if (uArch > 1.5) {
        // Gulf: narrow, deep-set openings against the heat
        win = step(0.31, f.x) * step(f.x, 0.69) * step(0.12, f.y) * step(f.y, 0.6);
      } else if (uArch > 0.5) {
        // Mughal: tall pointed-arch openings
        float t = clamp((f.y - 0.48) / 0.32, 0.0, 1.0);
        win = step(abs(f.x - 0.5), 0.25 * (1.0 - t * t)) * step(0.16, f.y) * step(f.y, 0.8);
      }
      float r = hash(cell + seed * 57.0);
      float lit = step(0.7, r);
      vec3 wc = mix(vec3(1.0, 0.7, 0.36), vec3(0.7, 0.95, 1.0), step(0.9, r));
      col = mix(col, mix(vec3(0.012, 0.014, 0.02), wc * (0.6 + 0.9 * fract(r * 9.0)), lit), win);
      col *= 1.0 - 0.5 * step(f.y, 0.06); // balcony ledge
      if (uArch > 1.5) {
        // carved gypsum screen above each opening, a row of timber beam-ends, a stepped parapet
        float scr = step(0.31, f.x) * step(f.x, 0.69) * step(0.66, f.y) * step(f.y, 0.84);
        float pat = step(0.5, fract((f.x + f.y) * 20.0)) * step(0.5, fract((f.x - f.y) * 20.0));
        col = mix(col, vColor * 0.5 * (0.06 * shade + day) + vec3(1.0, 0.78, 0.45) * pat * 0.3 * lit, scr);
        col *= 1.0 - 0.55 * step(0.9, f.y) * step(f.y, 0.96) * step(0.5, fract(f.x * 5.0));
        col *= 1.0 - 0.4 * step(H - 0.7, uv.y) * step(0.6, fract(uv.x / 2.2));
      } else if (uArch > 0.5) {
        // jharoka: a screened balcony box on some bays, lamplight glowing through the lattice
        float jh = step(0.7, hash(cell * 1.7 + seed * 9.0));
        float box = step(0.08, f.x) * step(f.x, 0.92) * step(0.06, f.y) * step(f.y, 0.46) * jh;
        float jali = step(0.5, fract(f.x * 15.0)) * step(0.5, fract(f.y * 17.0));
        vec3 wood = vColor * 0.45 * (0.06 * shade + day);
        col = mix(col, wood + vec3(1.0, 0.58, 0.22) * jali * 0.7 * step(0.35, r), box);
        // crenellated parapet along the roofline
        col *= 1.0 - 0.45 * step(H - 0.9, uv.y) * step(0.5, fract(uv.x / 1.5));
      }
      float ac = step(0.84, hash(cell + seed * 3.0)) * step(0.8, f.x) * step(f.x, 0.97) * step(0.3, f.y) * step(f.y, 0.5);
      col = mix(col, vec3(0.035), ac);
    }
    if (uArch > 2.5) col = victorian(uv, seed, H, vColor, shade, day);
    col += vColor * uStreet * 0.2 * exp(-uv.y / 6.0) * shade; // street-light wash
  } else if (style < 1.5) {
    // ---- neon megastructure
    col = vec3(0.01, 0.011, 0.02) + vec3(0.16, 0.18, 0.24) * day;
    vec2 g = vec2(uv.x / 4.0, uv.y / 4.5);
    vec2 cell = floor(g), f = fract(g);
    float win = step(0.15, f.x) * step(f.x, 0.85) * step(0.25, f.y) * step(f.y, 0.8);
    float r = hash(cell + seed * 91.0);
    // curtain wall: grey glass catching the sky between thin mullions (shows through when neon is low)
    float mull = 1.0 - step(0.06, f.x) * step(f.x, 0.94) * step(0.05, f.y) * step(f.y, 0.95);
    vec3 curtain = mix(vec3(0.08, 0.1, 0.13) * (0.4 + 2.2 * uDay) * (0.85 + 0.3 * hash(vec2(cell.x, seed))), vec3(0.18, 0.19, 0.21) * (0.2 + day * 2.0), mull);
    col = mix(curtain, col, uNeonK);
    vec3 plain = mix(vec3(1.0, 0.86, 0.62), vec3(0.85, 0.92, 1.0), step(0.5, fract(r * 13.0)));
    vec3 wcol = mix(plain, mix(vColor, vec3(1.0, 0.82, 0.55), step(0.9, r)), uNeonK);
    col += win * step(1.0 - uLitK, r) * wcol * (0.8 + 1.5 * fract(r * 7.0)) * mix(0.6, 1.0, uNeonK);
    col += step(0.93, hash(vec2(cell.y, seed * 17.0))) * step(f.y, 0.2) * vColor * 2.4 * uNeonK;
    // animated holographic advertising wall
    float face = floor(uv.x / 40.0);
    float pr = hash(vec2(face, seed * 5.0));
    vec2 pp = vec2(fract(uv.x / 40.0), (uv.y - H * 0.42) / (H * 0.3));
    float panel = uHolo * step(0.55, pr) * step(0.12, pp.x) * step(pp.x, 0.88) * step(0.0, pp.y) * step(pp.y, 1.0);
    vec3 holo = 0.5 + 0.5 * cos(6.2832 * (pp.y * 1.5 + uTime * 0.12 + pr) + vec3(0.0, 2.0, 4.0));
    float scan = 0.7 + 0.3 * sin(uv.y * 3.0 - uTime * 6.0);
    float pattern = step(0.5, hash(floor(vec2(pp.x * 10.0, pp.y * 14.0 + floor(uTime * 0.8 + pr * 10.0)))));
    col = mix(col, holo * scan * (0.5 + 1.5 * pattern) * 1.3, panel);
    col += vColor * 0.3 * exp(-uv.y / 14.0) * uNeonK;
  } else if (style < 2.5) {
    // ---- heritage sandstone: arcades, warm floodlights, one neon line of trim
    vec3 stone = uStone * (0.82 + 0.36 * hash(vec2(floor(uv.x / 0.9), floor(uv.y / 0.45)) + seed));
    col = stone * (0.075 * shade + day);
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
    col += uTrim * 2.2 * step(H - 0.4, uv.y) * step(uv.y, H - 0.14);
  } else {
    // ---- modern plaza / mid-rise
    col = vec3(0.03, 0.034, 0.04) * shade + vec3(0.3, 0.32, 0.36) * day;
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

export function hash01(a: number, b: number) {
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
  const neon = (def.neon.length ? def.neon : NEON).map((c) => new THREE.Color(c));
  const c2 = new THREE.Vector2();

  const extrude = (ch: ChunkData, pts: number[], y0: number, y1: number, style: number, seed: number, H: number, color: THREE.Color, pitch = 0) => {
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
    if (pitch > 0) {
      // hipped roof: every eave rises to a single apex over the middle of the footprint
      let ax = 0, az = 0;
      for (let i = 0; i < n; i++) {
        ax += pts[i * 2];
        az += pts[i * 2 + 1];
      }
      ax /= n;
      az /= n;
      let run = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const x0 = pts[i * 2], z0 = pts[i * 2 + 1], x1 = pts[j * 2], z1 = pts[j * 2 + 1];
        const len = Math.hypot(x1 - x0, z1 - z0);
        if (len < 0.05) continue;
        // face normal, forced to point upward
        const ux = x1 - x0, uz = z1 - z0, vx = ax - x0, vy = pitch, vz = az - z0;
        let nx = -uz * vy, ny = uz * vx - ux * vz, nz = ux * vy;
        const flip = ny < 0;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx = ((flip ? -1 : 1) * nx) / nl;
        ny = ((flip ? -1 : 1) * ny) / nl;
        nz = ((flip ? -1 : 1) * nz) / nl;
        const slope = Math.hypot(Math.hypot((x0 + x1) / 2 - ax, (z0 + z1) / 2 - az), pitch);
        const b = ch.pos.length / 3;
        ch.pos.push(x0, y1, z0, x1, y1, z1, ax, y1 + pitch, az);
        ch.uv.push(run, 0, run + len, 0, run + len / 2, slope);
        for (let k = 0; k < 3; k++) {
          ch.nrm.push(nx, ny, nz);
          ch.info.push(style, seed, H, 2);
          ch.col.push(color.r, color.g, color.b);
        }
        ch.idx.push(b, b + 1, b + 2);
        run += len;
      }
      return;
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
    extrude(ch, p, 0, bd.h, bd.s, seed, bd.h, color, roofPitch(bd, def));
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
      uSun: { value: new THREE.Color(def.atmosphere.sun.color) },
      uSunDir: { value: new THREE.Vector3(...def.atmosphere.sun.dir).normalize() },
      uTrim: { value: new THREE.Color(def.trimColor ?? def.neon[0]) },
      uHolo: { value: def.holoAds ?? 1 },
      uNeonK: { value: def.towers?.neon ?? 1 },
      uLitK: { value: def.towers?.lit ?? 0.4 },
      uDay: { value: def.atmosphere.daylight },
      uArch: { value: { colonial: 0, mughal: 1, gulf: 2, victorian: 3 }[def.architecture] },
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
  group.add(buildRoofProps(buildings, def));
  return { group, material, triangles: tris };
}

/** Height of a building's pitched roof, or 0 where the city (or the building) has flat roofs. */
export function roofPitch(b: MapBuilding, def: CityDefinition) {
  if (def.architecture !== 'victorian' || b.s !== 0) return 0;
  let area = 0;
  const n = b.p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) area += b.p[j * 2] * b.p[i * 2 + 1] - b.p[i * 2] * b.p[j * 2 + 1];
  area = Math.abs(area) / 2;
  if (area > 560) return 0;
  return THREE.MathUtils.clamp(Math.sqrt(area / Math.PI) * 0.55, 1.6, 5);
}

function tint(g: THREE.BufferGeometry, color: number, k = 1) {
  const c = new THREE.Color(color).multiplyScalar(k);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/**
 * What sits on the roofs is as much a city's signature as its facades:
 * Karachi's black water tanks and antenna masts, Lahore's little domes and onion-capped towers.
 */
function buildRoofProps(buildings: MapBuilding[], def: CityDefinition): THREE.Group {
  const g = new THREE.Group();
  const mughal = def.architecture === 'mughal';
  const gulf = def.architecture === 'gulf';
  const vict = def.architecture === 'victorian';
  const lit = 0.25 + def.atmosphere.daylight * 1.1; // unlit materials: brighten by hand at dusk/day
  const small: THREE.Matrix4[] = [];
  const caps: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (const b of buildings) {
    const n = b.p.length / 2;
    let cx = 0, cz = 0, area = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      cx += b.p[i * 2];
      cz += b.p[i * 2 + 1];
      area += b.p[j * 2] * b.p[i * 2 + 1] - b.p[i * 2] * b.p[j * 2 + 1];
    }
    cx /= n;
    cz /= n;
    const R = Math.sqrt(Math.abs(area) / 2 / Math.PI);
    const seed = hash01(cx, cz);
    if (b.s === 1) {
      const stepped = seed > 0.3;
      const top = stepped ? b.h * (1.22 + seed * 0.3) : b.h;
      const k = THREE.MathUtils.clamp((R * (stepped ? 0.62 + seed * 0.2 : 1)) / 9, 0.7, 2.4);
      caps.push(new THREE.Matrix4().compose(p.set(cx, top, cz), q.identity(), s.setScalar(k)));
    } else if (b.s !== 3 && R > 3.2) {
      const chance = mughal ? (b.s === 2 ? 0.75 : 0.17) : gulf ? (b.s === 2 ? 0.9 : 0.26) : vict ? (b.s === 0 ? 0.7 : 0) : 0.2;
      if (hash01(cx * 1.31, cz * 0.77) > chance) continue;
      const k = THREE.MathUtils.clamp(R * 0.26, 0.8, mughal ? 2.4 : gulf ? 1.8 : 1.4);
      // chimneys stand part-way down the slope, not on the apex
      const pitch = roofPitch(b, def);
      small.push(new THREE.Matrix4().compose(p.set(cx + (pitch ? R * 0.38 : 0), b.h + pitch * 0.45, cz), q.identity(), s.setScalar(k)));
    }
  }
  const smallGeo = vict
    ? // a brick chimney stack with its pots
      mergeGeometries([
        colorBox(1.0, 2.0, 0.6, 0, 1.0, 0, 0x6a4636, lit),
        colorBox(1.14, 0.14, 0.74, 0, 2.05, 0, 0x4a3a34, lit),
        tint(new THREE.CylinderGeometry(0.13, 0.16, 0.5, 8), 0xa8623c, lit).translate(-0.26, 2.36, 0),
        tint(new THREE.CylinderGeometry(0.13, 0.16, 0.5, 8), 0xa8623c, lit).translate(0.26, 2.36, 0),
      ])
    : gulf
    ? // barjeel: the wind tower that cooled every old Gulf house
      mergeGeometries([
        tint(new THREE.BoxGeometry(1.7, 3.6, 1.7), 0xd9c3a0, lit).translate(0, 1.8, 0),
        colorBox(1.9, 0.18, 1.9, 0, 3.7, 0, 0xbfa780, lit),
        colorBox(1.72, 1.5, 0.5, 0, 2.6, 0, 0x1a130c),
        colorBox(0.5, 1.5, 1.72, 0, 2.6, 0, 0x1a130c),
        colorBox(1.74, 0.08, 1.74, 0, 1.75, 0, def.neon[0], 2.2),
      ])
    : mughal
    ? (() => {
        const dome = tint(new THREE.SphereGeometry(1.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xd9cdb8, lit);
        dome.scale(1, 1.25, 1);
        dome.translate(0, 0.5, 0);
        return mergeGeometries([dome, tint(new THREE.CylinderGeometry(1.55, 1.7, 0.5, 14), 0xb9a48a, lit).translate(0, 0.25, 0), colorBox(0.1, 1.1, 0.1, 0, 2.8, 0, def.neon[0], 3)]);
      })()
    : mergeGeometries([
        tint(new THREE.CylinderGeometry(1.0, 1.0, 1.7, 12), 0x0b0b0e, 1 + lit).translate(0, 1.75, 0),
        colorBox(1.6, 0.9, 1.6, 0, 0.45, 0, 0x16161a),
      ]);
  const capGeo = vict
    ? // a shard of glass: one clean spike with lit edges
      mergeGeometries([
        tint(new THREE.ConeGeometry(6.2, 38, 4, 1), 0x7a8798, lit).translate(0, 19, 0),
        colorBox(0.22, 38.5, 0.22, 0, 19.2, 0, def.neon[1 % def.neon.length], 2.2),
        colorBox(8.8, 0.25, 8.8, 0, 0.15, 0, def.neon[0], 2.2),
        colorBox(0.7, 0.7, 0.7, 0, 38.6, 0, 0xff1030, 6),
      ])
    : gulf
    ? // glass needles: a tapering crown and a long lit spire
      mergeGeometries([
        tint(new THREE.CylinderGeometry(1.2, 5.5, 14, 4, 1), 0x6a7890, lit).translate(0, 7, 0),
        tint(new THREE.CylinderGeometry(0.12, 1.1, 34, 6, 1), def.neon[1 % def.neon.length], 2.4).translate(0, 31, 0),
        colorBox(7.8, 0.3, 7.8, 0, 0.2, 0, def.neon[0], 2.6),
        colorBox(0.8, 0.8, 0.8, 0, 48.4, 0, 0xff1030, 6),
      ])
    : mughal
    ? (() => {
        const onion = tint(new THREE.SphereGeometry(5, 18, 12), 0xe6dccb, lit);
        onion.scale(1, 1.25, 1);
        onion.translate(0, 6.6, 0);
        const ring = tint(new THREE.TorusGeometry(4.6, 0.22, 6, 32), def.neon[0], 3);
        ring.rotateX(Math.PI / 2);
        ring.translate(0, 1.6, 0);
        return mergeGeometries([onion, tint(new THREE.CylinderGeometry(4.6, 5.2, 1.6, 18), 0xbfa98c, lit).translate(0, 0.8, 0), ring, colorBox(0.3, 7, 0.3, 0, 16, 0, def.neon[1], 3.5)]);
      })()
    : mergeGeometries([
        colorBox(0.6, 24, 0.6, 0, 12, 0, 0x0c0c10),
        colorBox(5, 0.25, 0.25, 0, 9, 0, 0x0c0c10),
        colorBox(0.25, 0.25, 3.4, 0, 15, 0, 0x0c0c10),
        colorBox(4, 2.2, 4, 0, 1.1, 0, 0x101014),
        colorBox(0.7, 0.7, 0.7, 0, 24.4, 0, 0xff1030, 6),
        colorBox(4.1, 0.2, 4.1, 0, 2.3, 0, def.neon[0], 2.5),
      ]);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  for (const [geo, list] of [[smallGeo, small], [capGeo, caps]] as const) {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.count = list.length;
    mesh.frustumCulled = false;
    g.add(mesh);
  }
  return g;
}
