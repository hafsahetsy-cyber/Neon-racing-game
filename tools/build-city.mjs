// Converts an OpenStreetMap extract (Overpass "out geom" JSON) into the compact
// map format the game loads.  Usage: node tools/build-city.mjs karachi
// Map data © OpenStreetMap contributors, ODbL.
//
// The raw extract is not committed. To (re)download it, POST this Overpass query to
// https://overpass-api.de/api/interpreter and save the result as tools/data/<city>_osm.json
// (bbox = south,west,north,east from the table below):
//   [out:json][timeout:90];(way["highway"](BBOX);way["building"](BBOX);way["leisure"="park"](BBOX););out geom tags;
import fs from 'node:fs';

const CITIES = {
  karachi: {
    src: 'tools/data/karachi_osm.json',
    out: 'public/cities/karachi/map.json',
    bbox: [24.85, 67.016, 24.88, 67.046], // south, west, north, east
    landmarks: [
      { id: 'mazar', name: 'Mazar-e-Quaid', lat: 24.8753, lon: 67.0409, clear: 120 },
      { id: 'empress', name: 'Empress Market', lat: 24.8627, lon: 67.0289, clear: 58 },
    ],
    // race routes: [lat, lon] waypoints, joined along real roads
    routes: [
      { name: 'SADDAR SPRINT', blurb: 'A quick loop of the old bazaar streets.',
        via: [[24.8627, 67.0302], [24.8612, 67.0252], [24.8560, 67.0290], [24.8600, 67.0335], [24.8627, 67.0302]] },
      { name: 'MAZAR RUN', blurb: 'Empress Market to the mausoleum, flat out.',
        via: [[24.8627, 67.0302], [24.8725, 67.0355], [24.8745, 67.0395]] },
      { name: 'OLD CITY GRAND TOUR', blurb: 'Every district, one long lap.',
        via: [[24.8627, 67.0302], [24.8545, 67.0225], [24.8520, 67.0305], [24.8600, 67.0400], [24.8725, 67.0355], [24.8765, 67.0240], [24.8627, 67.0302]] },
    ],
  },
  lahore: {
    src: 'tools/data/lahore_osm.json',
    out: 'public/cities/lahore/map.json',
    bbox: [31.57, 74.296, 31.598, 74.33],
    // the Walled City's lanes are far narrower than a normal street, and few footprints are mapped
    laneWidth: 4.4,
    infill: true,
    landmarks: [
      { id: 'minar', name: 'Minar-e-Pakistan', lat: 31.5925, lon: 74.3095, clear: 70 },
      { id: 'badshahi', name: 'Badshahi Mosque', lat: 31.588, lon: 74.3098, clear: 120 },
    ],
    routes: [
      { name: 'WALLED CITY DASH', blurb: 'Bhatti Gate to Delhi Gate round the old walls.',
        via: [[31.5785, 74.3085], [31.5765, 74.314], [31.5775, 74.32], [31.5823, 74.3255]] },
      { name: 'MINAR LOOP', blurb: 'From the Minar past Data Darbar and back.',
        via: [[31.5915, 74.312], [31.585, 74.308], [31.579, 74.305], [31.5765, 74.314], [31.5895, 74.319], [31.5915, 74.312]] },
      { name: 'THIRTEEN GATES', blurb: 'The full circuit of the Walled City.',
        via: [[31.5915, 74.312], [31.5895, 74.319], [31.586, 74.3265], [31.5823, 74.3255], [31.5775, 74.32], [31.5765, 74.314], [31.5785, 74.3085], [31.585, 74.308], [31.5915, 74.312]] },
    ],
  },
};

const city = CITIES[process.argv[2] ?? 'karachi'];
if (!city) throw new Error('unknown city');
const [S, W, N, E] = city.bbox;
const lat0 = (S + N) / 2;
const lon0 = (W + E) / 2;
const KX = Math.cos((lat0 * Math.PI) / 180) * 111320;
const KZ = 110540;
const proj = (lat, lon) => [(lon - lon0) * KX, -(lat - lat0) * KZ];
const HX = ((E - W) / 2) * KX;
const HZ = ((N - S) / 2) * KZ;
const r1 = (v) => Math.round(v * 10) / 10;

// class: [index, default lanes per direction-set, lane width]
const CLASSES = {
  motorway: 0, trunk: 0, trunk_link: 1, motorway_link: 1,
  primary: 1, primary_link: 2, secondary: 2, secondary_link: 3,
  tertiary: 3, tertiary_link: 3, busway: 3,
  residential: 4, living_street: 4, unclassified: 4, pedestrian: 4,
  service: 5,
};
const DEF_LANES = [3, 3, 2, 2, 1.6, 1.1];

function rng(seed) {
  let s = (seed % 2147483646) + 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    const [ax, az] = pts[a], [bx, bz] = pts[b];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / len;
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Simplify a closed ring (no duplicate end point) by splitting it at its two most distant vertices. */
function simplifyRing(ring, tol) {
  if (ring.length < 5) return ring;
  let far = 0, md = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > md) { md = d; far = i; }
  }
  const a = simplify(ring.slice(0, far + 1), tol);
  const b = simplify([...ring.slice(far), ring[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

const inside = ([x, z], m = 0) => Math.abs(x) <= HX + m && Math.abs(z) <= HZ + m;
const osm = JSON.parse(fs.readFileSync(city.src, 'utf8'));

// ------------------------------------------------------------------ roads
const roads = [];
const graphRuns = []; // unsimplified geometry, so junction vertices survive for route finding
for (const e of osm.elements) {
  const t = e.tags ?? {};
  if (!t.highway || !(t.highway in CLASSES) || !e.geometry) continue;
  if (t.area === 'yes' || t.tunnel === 'yes') continue;
  const c = CLASSES[t.highway];
  const pts = e.geometry.map((g) => proj(g.lat, g.lon));
  // split into runs that are inside the playable area
  let run = [];
  const runs = [];
  for (const p of pts) {
    if (inside(p, 40)) run.push(p);
    else { if (run.length > 1) runs.push(run); run = []; }
  }
  if (run.length > 1) runs.push(run);
  const oneway = t.oneway === 'yes' || t.junction === 'roundabout';
  let lanes = parseFloat(t.lanes);
  if (!Number.isFinite(lanes)) lanes = oneway ? DEF_LANES[c] : Math.max(2, DEF_LANES[c]);
  lanes = Math.min(lanes, 5);
  let w = c >= 4 ? (city.laneWidth ?? 5.8) : lanes * 3.5 + 1.2;
  if (c === 5) w = 4;
  if (t.highway === 'pedestrian') w = city.laneWidth ? city.laneWidth + 1 : 6;
  const name = t['name:en'] ?? t.name ?? '';
  for (const r of runs) {
    if (c <= 4 && t.highway !== 'pedestrian') graphRuns.push({ c, pts: r });
    const s = simplify(r, 0.4);
    let len = 0;
    for (let i = 1; i < s.length; i++) len += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
    if (len < 8 || (c === 5 && len < 45)) continue;
    roads.push({ c, w: r1(w), o: oneway ? 1 : 0, l: Math.round(lanes), n: name, p: s.flat().map(r1), b: t.bridge === 'yes' ? 1 : 0 });
  }
}

// spatial grid of road samples (to evict buildings standing in the carriageway)
const CELL = 40;
const grid = new Map();
const key = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
for (const r of roads) {
  const p = r.p;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const [ax, az, bx, bz] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 3));
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
      const kk = key(x, z);
      if (!grid.has(kk)) grid.set(kk, []);
      grid.get(kk).push([x, z, r.w * 0.5 * (r.c >= 4 ? 0.55 : 0.8)]);
    }
  }
}
const pointInPoly = (x, z, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const distSeg = (x, z, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
};
function onRoad(poly, minX, maxX, minZ, maxZ) {
  for (let cx = Math.floor((minX - 12) / CELL); cx <= Math.floor((maxX + 12) / CELL); cx++)
    for (let cz = Math.floor((minZ - 12) / CELL); cz <= Math.floor((maxZ + 12) / CELL); cz++) {
      const cell = grid.get(`${cx},${cz}`);
      if (!cell) continue;
      for (const [x, z, r] of cell) {
        if (x < minX - r || x > maxX + r || z < minZ - r || z > maxZ + r) continue;
        if (pointInPoly(x, z, poly)) return true;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (distSeg(x, z, poly[j], poly[i]) < r) return true;
      }
    }
  return false;
}

// ------------------------------------------------------------------ buildings
const lm = city.landmarks.map((l) => ({ ...l, pos: proj(l.lat, l.lon) }));
const HERITAGE = /church|cathedral|mosque|masjid|temple|mandir|court|assembly|museum|hall|mansion|market|house|school|convent|barracks|club|clock|trust|mahal|shrine|library|college/i;
const buildings = [];
let evicted = 0;
for (const e of osm.elements) {
  const t = e.tags ?? {};
  if (!t.building || !e.geometry || e.geometry.length < 4) continue;
  let poly = e.geometry.map((g) => proj(g.lat, g.lon));
  poly.pop();
  poly = simplifyRing(poly, 0.35);
  if (poly.length < 3) continue;
  let area = 0, cx = 0, cz = 0, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    area += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    cx += poly[i][0]; cz += poly[i][1];
    minX = Math.min(minX, poly[i][0]); maxX = Math.max(maxX, poly[i][0]);
    minZ = Math.min(minZ, poly[i][1]); maxZ = Math.max(maxZ, poly[i][1]);
  }
  cx /= poly.length; cz /= poly.length;
  if (area < 0) poly.reverse();
  area = Math.abs(area) / 2;
  if (area < 14 || area > 30000 || !inside([cx, cz], 0)) continue;
  if (lm.some((l) => l.clear && Math.hypot(cx - l.pos[0], cz - l.pos[1]) < l.clear)) continue;
  if (onRoad(poly, minX, maxX, minZ, maxZ)) { evicted++; continue; }

  const rnd = rng(e.id);
  const name = t['name:en'] ?? t.name ?? '';
  const levels = parseFloat(t['building:levels']);
  const heritage = !!t.historic || !!t.heritage || t.amenity === 'place_of_worship' || HERITAGE.test(name) || HERITAGE.test(t.building);
  let style = 0;
  let h;
  if (heritage) {
    style = 2;
    h = (Number.isFinite(levels) ? Math.min(levels, 5) : 2 + Math.floor(rnd() * 2)) * 4.4 + 2;
  } else if (area > 420 && rnd() < 0.17) {
    style = 1; // neon megastructure growing out of a real footprint
    h = 70 + Math.pow(rnd(), 1.6) * 190;
  } else if (area > 220 && rnd() < 0.3) {
    style = 3; // modern plaza / mid-rise
    h = (Number.isFinite(levels) ? Math.max(levels, 7) : 7 + Math.floor(rnd() * 9)) * 3.3;
  } else {
    h = (Number.isFinite(levels) ? Math.min(levels, 8) : 2 + Math.floor(rnd() * 4.5)) * 3.3 + rnd();
  }
  const b = { s: style, h: r1(h), p: poly.flat().map(r1) };
  if (name) b.n = name;
  buildings.push(b);
}

// ------------------------------------------------------------------ parks
const parks = [];
for (const e of osm.elements) {
  const t = e.tags ?? {};
  if (t.leisure !== 'park' || !e.geometry) continue;
  const poly = simplifyRing(e.geometry.map((g) => proj(g.lat, g.lon)).slice(0, -1), 1);
  if (poly.length >= 3 && poly.some((p) => inside(p))) parks.push(poly.flat().map(r1));
}

// ------------------------------------------------------------------ infill
// Where the map has streets but few building footprints (common outside big-city centres),
// line the empty frontages with generated buildings so streets still feel enclosed.
let infilled = 0;
if (city.infill) {
  const C = 2; // occupancy cell, metres
  const GW = Math.ceil((HX * 2 + 80) / C), GH = Math.ceil((HZ * 2 + 80) / C);
  const occ = new Uint8Array(GW * GH);
  const ci = (x, z) => {
    const gx = Math.floor((x + HX + 40) / C), gz = Math.floor((z + HZ + 40) / C);
    return gx < 0 || gz < 0 || gx >= GW || gz >= GH ? -1 : gz * GW + gx;
  };
  const stamp = (x, z, r) => {
    for (let dx = -r; dx <= r; dx += C) for (let dz = -r; dz <= r; dz += C) {
      if (dx * dx + dz * dz > r * r + C) continue;
      const i = ci(x + dx, z + dz);
      if (i >= 0) occ[i] = 1;
    }
  };
  const fillPoly = (poly) => {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const [x, z] of poly) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    for (let x = minX; x <= maxX; x += C) for (let z = minZ; z <= maxZ; z += C) {
      if (!pointInPoly(x, z, poly)) continue;
      const i = ci(x, z);
      if (i >= 0) occ[i] = 1;
    }
  };
  for (const r of roads) {
    const p = r.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const len = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
      const n = Math.max(1, Math.ceil(len / 1.5));
      for (let k = 0; k <= n; k++) stamp(p[i] + ((p[i + 2] - p[i]) * k) / n, p[i + 1] + ((p[i + 3] - p[i + 1]) * k) / n, r.w / 2 + 0.6);
    }
  }
  const toPoly = (flat) => { const o = []; for (let i = 0; i < flat.length; i += 2) o.push([flat[i], flat[i + 1]]); return o; };
  for (const b of buildings) fillPoly(toPoly(b.p));
  for (const pk of parks) fillPoly(toPoly(pk));
  for (const l of lm) if (l.clear) stamp(l.pos[0], l.pos[1], l.clear);

  const rnd = rng(77123);
  const tryRect = (cx, cz, ax, az, nx, nz, w, d) => {
    // corners: frontage along (ax, az), depth along (nx, nz) away from the road
    const pts = [
      [cx - (ax * w) / 2, cz - (az * w) / 2],
      [cx + (ax * w) / 2, cz + (az * w) / 2],
      [cx + (ax * w) / 2 + nx * d, cz + (az * w) / 2 + nz * d],
      [cx - (ax * w) / 2 + nx * d, cz - (az * w) / 2 + nz * d],
    ];
    for (let u = -w / 2; u <= w / 2; u += C * 0.9) for (let v = 0; v <= d; v += C * 0.9) {
      const x = cx + ax * u + nx * v, z = cz + az * u + nz * v;
      if (!inside([x, z], -4)) return null;
      const i = ci(x, z);
      if (i < 0 || occ[i]) return null;
    }
    return pts;
  };
  for (const r of roads) {
    if (r.c === 0) continue;
    const major = r.c <= 2;
    const p = r.p;
    for (const side of [-1, 1]) {
      let carry = rnd() * 6;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const sx = p[i + 2] - p[i], sz = p[i + 3] - p[i + 1];
        const len = Math.hypot(sx, sz);
        if (len < 1) continue;
        const ax = sx / len, az = sz / len;
        const nx = -az * side, nz = ax * side;
        let s = carry;
        while (s < len) {
          const w = major ? 12 + rnd() * 14 : 7 + rnd() * 9;
          if (s + w > len + 3) break;
          const setback = r.w / 2 + (r.c <= 3 ? 3.2 : 1.0);
          const cx = p[i] + ax * (s + w / 2) + nx * setback, cz = p[i + 1] + az * (s + w / 2) + nz * setback;
          let pts = null;
          for (const d of major ? [22, 14, 9] : [13, 9, 6]) {
            pts = tryRect(cx, cz, ax, az, nx, nz, w - 0.6, d);
            if (pts) break;
          }
          if (pts) {
            fillPoly(pts);
            let area = 0;
            for (let a = 0, b = 3; a < 4; b = a++) area += pts[b][0] * pts[a][1] - pts[a][0] * pts[b][1];
            if (area < 0) pts.reverse();
            const roll = rnd();
            let style = 0, h = (2 + Math.floor(rnd() * 4)) * 3.3 + rnd();
            if (major && roll < 0.07) { style = 1; h = 70 + Math.pow(rnd(), 1.6) * 170; }
            else if (r.c <= 3 && roll < 0.3) { style = 3; h = (6 + Math.floor(rnd() * 8)) * 3.3; }
            else if (roll > 0.94) { style = 2; h = (2 + Math.floor(rnd() * 2)) * 4.4 + 2; } // the odd haveli
            buildings.push({ s: style, h: r1(h), p: pts.flat().map(r1) });
            infilled++;
          }
          s += w + (rnd() < 0.12 ? 3 + rnd() * 5 : 0.4);
        }
        carry = Math.max(0, s - len);
      }
    }
  }
}

// ------------------------------------------------------------------ race routes
// Checkpoint routes follow the real road network: shortest path between named waypoints,
// with a checkpoint dropped every ~280 m.
function buildRoutes(defs) {
  const nodes = new Map(); // key -> { x, z, edges: [[key, cost]] }
  const nk = (p) => `${Math.round(p[0])},${Math.round(p[1])}`;
  const node = (p) => {
    const k = nk(p);
    if (!nodes.has(k)) nodes.set(k, { x: p[0], z: p[1], edges: [] });
    return k;
  };
  for (const g of graphRuns) {
    const w = g.c <= 2 ? 1 : g.c === 3 ? 1.25 : 1.9; // prefer main roads
    for (let i = 1; i < g.pts.length; i++) {
      const a = node(g.pts[i - 1]), b = node(g.pts[i]);
      if (a === b) continue;
      const d = Math.hypot(g.pts[i][0] - g.pts[i - 1][0], g.pts[i][1] - g.pts[i - 1][1]) * w;
      nodes.get(a).edges.push([b, d]);
      nodes.get(b).edges.push([a, d]);
    }
  }
  const mainKeys = new Set();
  for (const g of graphRuns) if (g.c <= 3) for (const p of g.pts) mainKeys.add(nk(p));
  const nearest = (x, z) => {
    let best = null, bd = Infinity;
    for (const k of mainKeys) {
      const n = nodes.get(k);
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  };
  const path = (from, to) => {
    const dist = new Map([[from, 0]]);
    const prev = new Map();
    const heap = [[0, from]];
    while (heap.length) {
      let mi = 0;
      for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[mi][0]) mi = i;
      const [d, k] = heap.splice(mi, 1)[0];
      if (k === to) break;
      if (d > (dist.get(k) ?? Infinity)) continue;
      for (const [nb, c] of nodes.get(k).edges) {
        const nd = d + c;
        if (nd < (dist.get(nb) ?? Infinity)) { dist.set(nb, nd); prev.set(nb, k); heap.push([nd, nb]); }
      }
    }
    if (!prev.has(to)) return null;
    const out = [];
    for (let k = to; k; k = prev.get(k)) out.push([nodes.get(k).x, nodes.get(k).z]);
    return out.reverse();
  };
  const routes = [];
  for (const def of defs) {
    const keys = def.via.map(([lat, lon]) => nearest(...proj(lat, lon)));
    let line = [];
    let ok = true;
    for (let i = 1; i < keys.length; i++) {
      const seg = path(keys[i - 1], keys[i]);
      if (!seg) { ok = false; break; }
      line = line.concat(i === 1 ? seg : seg.slice(1));
    }
    if (!ok || line.length < 2) { console.warn('route failed:', def.name); continue; }
    let total = 0;
    const cps = [];
    let next = 280;
    for (let i = 1; i < line.length; i++) {
      const d = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
      while (total + d >= next) {
        const t = (next - total) / d;
        cps.push([r1(line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t), r1(line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t)]);
        next += 280;
      }
      total += d;
    }
    const end = line[line.length - 1];
    const last = cps[cps.length - 1];
    if (last && Math.hypot(last[0] - end[0], last[1] - end[1]) < 120) cps.pop();
    cps.push([r1(end[0]), r1(end[1])]);
    // start heading: along the first stretch of the route
    let k = 1;
    while (k < line.length - 1 && Math.hypot(line[k][0] - line[0][0], line[k][1] - line[0][1]) < 25) k++;
    const yaw = Math.atan2(-(line[k][0] - line[0][0]), -(line[k][1] - line[0][1]));
    routes.push({ name: def.name, blurb: def.blurb, len: Math.round(total), start: [r1(line[0][0]), r1(line[0][1]), Math.round(yaw * 1000) / 1000], cps });
  }
  return routes;
}
const routes = buildRoutes(city.routes ?? []);

const out = {
  attribution: 'Map data © OpenStreetMap contributors (ODbL)',
  half: [Math.round(HX), Math.round(HZ)],
  landmarks: lm.map((l) => ({ id: l.id, name: l.name, x: r1(l.pos[0]), z: r1(l.pos[1]) })),
  roads,
  buildings,
  parks,
  routes,
};
fs.mkdirSync(city.out.replace(/\/[^/]+$/, ''), { recursive: true });
fs.writeFileSync(city.out, JSON.stringify(out));
const byClass = [0, 0, 0, 0, 0, 0];
roads.forEach((r) => byClass[r.c]++);
const byStyle = [0, 0, 0, 0];
buildings.forEach((b) => byStyle[b.s]++);
console.log(`half ${out.half} | roads ${roads.length} ${byClass} | buildings ${buildings.length} (old,tower,heritage,plaza) ${byStyle} evicted ${evicted} infill ${infilled} | parks ${parks.length} | ${(fs.statSync(city.out).size / 1024).toFixed(0)} KB`);
console.log(out.landmarks);
