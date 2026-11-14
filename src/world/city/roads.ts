import * as THREE from 'three';
import { RoadGrid, walkPolyline } from './RoadGrid';
import type { MapRoad } from './types';

function tex(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Tired city asphalt: patched, cracked, oil-stained. `lanes` > 0 paints worn markings. */
function asphaltTexture(lanes: number, oneway: boolean, seed: number): THREE.Texture {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const W = 256;
  const H = lanes > 0 ? 1024 : 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#17171a';
  g.fillRect(0, 0, W, H);
  // aggregate speckle
  for (let i = 0; i < W * H * 0.09; i++) {
    const v = 18 + rnd() * 34;
    g.fillStyle = `rgba(${v},${v},${v + 3},0.55)`;
    g.fillRect(rnd() * W, rnd() * H, 1.3, 1.3);
  }
  // resurfacing patches — the signature of a much-repaired road
  for (let i = 0; i < (lanes > 0 ? 9 : 7); i++) {
    const v = 8 + rnd() * 22;
    g.fillStyle = `rgba(${v},${v},${v + 2},${0.45 + rnd() * 0.4})`;
    const w = 20 + rnd() * 90;
    const h = 30 + rnd() * 160;
    g.fillRect(rnd() * (W - w), rnd() * H, w, h);
  }
  // tyre-polished lanes
  const n = Math.max(1, lanes);
  for (let l = 0; l < n; l++) {
    const cx = ((l + 0.5) / n) * W;
    for (const off of [-0.2, 0.2]) {
      const gr = g.createLinearGradient(cx + (off - 0.09) * (W / n), 0, cx + (off + 0.09) * (W / n), 0);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(0.5, 'rgba(0,0,0,0.3)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }
  }
  // cracks
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    let x = rnd() * W, y = rnd() * H;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 7; k++) {
      x += (rnd() - 0.5) * 30;
      y += (rnd() - 0.2) * 34;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // oil stains + a manhole
  for (let i = 0; i < 6; i++) {
    const x = rnd() * W, y = rnd() * H, r = 6 + rnd() * 16;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const mx = 40 + rnd() * (W - 80), my = rnd() * H;
  g.fillStyle = '#0b0b0c';
  g.beginPath();
  g.arc(mx, my, 9, 0, 6.3);
  g.fill();
  g.strokeStyle = '#2c2c30';
  g.lineWidth = 2;
  g.stroke();

  if (lanes > 0) {
    // markings (texture covers 16 m of road)
    const m = H / 16;
    g.fillStyle = 'rgba(214,168,40,0.9)';
    g.fillRect(W * 0.035, 0, 3, H);
    g.fillRect(W * 0.965 - 3, 0, 3, H);
    for (let l = 1; l < lanes; l++) {
      const x = (l / lanes) * W;
      if (!oneway && lanes % 2 === 0 && l === lanes / 2) {
        g.fillStyle = 'rgba(214,168,40,0.95)';
        g.fillRect(x - 4, 0, 2.5, H);
        g.fillRect(x + 1.5, 0, 2.5, H);
      } else {
        g.fillStyle = 'rgba(225,225,220,0.92)';
        g.fillRect(x - 1.5, 0.5 * m, 3, 3 * m);
        g.fillRect(x - 1.5, 8.5 * m, 3, 3 * m);
      }
    }
    // wear the paint away
    for (let i = 0; i < 2600; i++) {
      const v = 16 + rnd() * 20;
      g.fillStyle = `rgba(${v},${v},${v},0.8)`;
      g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 3, 1 + rnd() * 5);
    }
  }
  // dusty, sandy edges
  for (const [x0, x1] of [[0, 0.07], [1, 0.93]]) {
    const gr = g.createLinearGradient(x0 * W, 0, x1 * W, 0);
    gr.addColorStop(0, 'rgba(120,96,64,0.55)');
    gr.addColorStop(1, 'rgba(120,96,64,0)');
    g.fillStyle = gr;
    g.fillRect(Math.min(x0, x1) * W, 0, 0.07 * W, H);
  }
  return tex(c);
}

function curbTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c9a21c';
  g.fillRect(0, 0, 32, 16);
  g.fillStyle = '#0c0c0c';
  g.fillRect(32, 0, 32, 16);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(40,34,26,${Math.random() * 0.5})`;
    g.fillRect(Math.random() * 64, Math.random() * 16, 3, 2);
  }
  return tex(c);
}

function paverTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3a3733';
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      const v = 44 + Math.random() * 26;
      g.fillStyle = `rgb(${v + 6},${v + 2},${v - 4})`;
      g.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
    }
  for (let i = 0; i < 500; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.35})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  return tex(c);
}

class Strip {
  pos: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  quad(a: number[], b: number[], c: number[], d: number[], uvs: number[], flip = false) {
    const i = this.pos.length / 3;
    this.pos.push(...a, ...b, ...c, ...d);
    this.uv.push(...uvs);
    if (flip) this.idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
    else this.idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
  }
  mesh(mat: THREE.Material, up = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    if (up) {
      const n = new Float32Array(this.pos.length);
      for (let i = 1; i < n.length; i += 3) n[i] = 1;
      g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    } else g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    return m;
  }
}

/**
 * Builds every road surface, junction fill, footpath and striped curb for a city.
 * Roads sit on flat ground, so they are drawn in class order without depth writes
 * (no z-fighting where streets overlap at junctions).
 */
export function buildRoads(roads: MapRoad[], grid: RoadGrid): THREE.Group {
  const group = new THREE.Group();
  const Y = 0.03;
  const strips = new Map<string, { strip: Strip; lanes: number; oneway: boolean; order: number }>();
  const caps = new Strip();

  roads.forEach((r) => {
    const major = r.c <= 3;
    const lanes = major ? Math.max(2, Math.min(5, r.l)) : 0;
    const key = major ? `${lanes}${r.o}` : 'minor';
    let e = strips.get(key);
    if (!e) strips.set(key, (e = { strip: new Strip(), lanes, oneway: !!r.o, order: major ? -4 : -6 }));
    const st = e.strip;
    const p = r.p;
    const n = p.length / 2;
    const hw = r.w / 2;
    let dist = 0;
    const base = st.pos.length / 3;
    for (let i = 0; i < n; i++) {
      const x = p[i * 2], z = p[i * 2 + 1];
      // segment directions either side of this vertex
      let d0x = 0, d0z = 0, d1x = 0, d1z = 0;
      if (i > 0) {
        d0x = x - p[i * 2 - 2];
        d0z = z - p[i * 2 - 1];
        const l = Math.hypot(d0x, d0z) || 1;
        dist += l;
        d0x /= l;
        d0z /= l;
      }
      if (i < n - 1) {
        d1x = p[i * 2 + 2] - x;
        d1z = p[i * 2 + 3] - z;
        const l = Math.hypot(d1x, d1z) || 1;
        d1x /= l;
        d1z /= l;
      }
      if (i === 0) { d0x = d1x; d0z = d1z; }
      if (i === n - 1) { d1x = d0x; d1z = d0z; }
      // right-hand normals, mitred
      let nx = -d0z - d1z, nz = d0x + d1x;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl;
      nz /= nl;
      const miter = 1 / Math.max(0.5, nx * -d0z + nz * d0x);
      const ox = nx * hw * miter, oz = nz * hw * miter;
      const v = dist / (major ? 16 : 8);
      st.pos.push(x - ox, Y, z - oz, x + ox, Y, z + oz);
      st.uv.push(0, v, 1, v);
      if (i < n - 1) {
        const a = base + i * 2;
        st.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    // round junction fills at both ends
    for (const i of [0, n - 1]) {
      const cx = p[i * 2], cz = p[i * 2 + 1];
      const b = caps.pos.length / 3;
      caps.pos.push(cx, Y, cz);
      caps.uv.push(0.5, 0.5);
      const SEG = 10;
      for (let k = 0; k <= SEG; k++) {
        const a = (k / SEG) * Math.PI * 2;
        caps.pos.push(cx + Math.cos(a) * hw, Y, cz + Math.sin(a) * hw);
        caps.uv.push(0.5 + Math.cos(a) * 0.3, 0.5 + Math.sin(a) * 0.3);
        if (k < SEG) caps.idx.push(b, b + k + 2, b + k + 1);
      }
    }
  });

  const roadMat = (map: THREE.Texture) =>
    new THREE.MeshStandardMaterial({
      map,
      emissive: 0xffffff,
      emissiveMap: map,
      emissiveIntensity: 0.22,
      roughness: 0.58,
      metalness: 0,
      envMapIntensity: 0.3,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
  const minorTex = asphaltTexture(0, false, 3);
  const capMesh = caps.mesh(roadMat(minorTex));
  capMesh.renderOrder = -7;
  group.add(capMesh);
  let seed = 11;
  for (const [key, e] of strips) {
    const t = key === 'minor' ? minorTex : asphaltTexture(e.lanes, e.oneway, seed++);
    const m = e.strip.mesh(roadMat(t));
    m.renderOrder = e.order + (key === 'minor' ? 0 : e.lanes * 0.1);
    group.add(m);
  }

  // ---------------------------------------------------------------- footpaths + striped curbs on main roads
  const top = new Strip();
  const face = new Strip();
  const H = 0.17;
  roads.forEach((r, ri) => {
    if (r.c > 3) return;
    for (const side of [-1, 1]) {
      const inner = r.w / 2 + 0.12;
      const outer = inner + 2.1;
      let prev: { x: number; z: number; dx: number; dz: number; s: number } | null = null;
      walkPolyline(r.p, 6, 0, (x, z, dx, dz, s) => {
        const cur = { x, z, dx, dz, s };
        if (prev) {
          const mx = (prev.x + x) / 2, mz = (prev.z + z) / 2;
          const nx = (-(prev.dz + dz) / 2) * side, nz = ((prev.dx + dx) / 2) * side;
          // leave gaps wherever another street joins or crosses
          const blocked =
            grid.nearest(mx + nx * (inner + 1), mz + nz * (inner + 1), 0.4, ri) ||
            grid.nearest(mx + nx * outer, mz + nz * outer, 0.2, ri);
          if (!blocked) {
            const a0 = [prev.x - prev.dz * side * inner, prev.z + prev.dx * side * inner];
            const a1 = [prev.x - prev.dz * side * outer, prev.z + prev.dx * side * outer];
            const b0 = [x - dz * side * inner, z + dx * side * inner];
            const b1 = [x - dz * side * outer, z + dx * side * outer];
            const u0 = prev.s / 2, u1 = s / 2;
            top.quad([a0[0], H, a0[1]], [a1[0], H, a1[1]], [b0[0], H, b0[1]], [b1[0], H, b1[1]], [u0, 0, u0, 1, u1, 0, u1, 1], side < 0);
            const f0 = prev.s / 2.4, f1 = s / 2.4;
            face.quad([a0[0], 0, a0[1]], [a0[0], H, a0[1]], [b0[0], 0, b0[1]], [b0[0], H, b0[1]], [f0, 0, f0, 1, f1, 0, f1, 1]);
          }
        }
        prev = cur;
      });
    }
  });
  const paver = paverTexture();
  const topMesh = top.mesh(
    new THREE.MeshStandardMaterial({ map: paver, roughness: 0.85, metalness: 0, envMapIntensity: 0.5 }),
  );
  const curb = curbTexture();
  const faceMesh = face.mesh(
    new THREE.MeshStandardMaterial({
      map: curb, emissive: 0xffffff, emissiveMap: curb, emissiveIntensity: 0.3, roughness: 0.7, side: THREE.DoubleSide,
    }),
    false,
  );
  group.add(topMesh, faceMesh);
  return group;
}

/** Top-down map image for the HUD mini-map. */
export function drawMiniMap(roads: MapRoad[], half: [number, number], landmarks: { x: number; z: number }[]) {
  const scale = 0.28; // px per metre
  const c = document.createElement('canvas');
  c.width = Math.ceil(half[0] * 2 * scale);
  c.height = Math.ceil(half[1] * 2 * scale);
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(8,6,18,0.9)';
  g.fillRect(0, 0, c.width, c.height);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const pass = (filter: (r: MapRoad) => boolean, color: string, widthMul: number, min: number) => {
    g.strokeStyle = color;
    for (const r of roads) {
      if (!filter(r)) continue;
      g.lineWidth = Math.max(min, r.w * scale * widthMul);
      g.beginPath();
      for (let i = 0; i < r.p.length; i += 2) {
        const x = (r.p[i] + half[0]) * scale, y = (r.p[i + 1] + half[1]) * scale;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
  };
  pass((r) => r.c >= 4, 'rgba(90,110,160,0.55)', 0.9, 1);
  pass((r) => r.c === 3, 'rgba(0,200,230,0.75)', 1, 1.6);
  pass((r) => r.c <= 2, 'rgba(0,240,255,1)', 1, 2.4);
  pass((r) => !!r.shortcut, 'rgba(255,166,48,1)', 1, 1.8);
  for (const l of landmarks) {
    g.fillStyle = '#ffa630';
    g.beginPath();
    g.arc((l.x + half[0]) * scale, (l.z + half[1]) * scale, 4, 0, 6.3);
    g.fill();
  }
  return { canvas: c, scale, half };
}
