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
  let w = c >= 4 ? 5.8 : lanes * 3.5 + 1.2;
  if (c === 5) w = 4;
  if (t.highway === 'pedestrian') w = 6;
  const name = t['name:en'] ?? t.name ?? '';
  for (const r of runs) {
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

const out = {
  attribution: 'Map data © OpenStreetMap contributors (ODbL)',
  half: [Math.round(HX), Math.round(HZ)],
  landmarks: lm.map((l) => ({ id: l.id, name: l.name, x: r1(l.pos[0]), z: r1(l.pos[1]) })),
  roads,
  buildings,
  parks,
};
fs.mkdirSync(city.out.replace(/\/[^/]+$/, ''), { recursive: true });
fs.writeFileSync(city.out, JSON.stringify(out));
const byClass = [0, 0, 0, 0, 0, 0];
roads.forEach((r) => byClass[r.c]++);
const byStyle = [0, 0, 0, 0];
buildings.forEach((b) => byStyle[b.s]++);
console.log(`half ${out.half} | roads ${roads.length} ${byClass} | buildings ${buildings.length} (old,tower,heritage,plaza) ${byStyle} evicted ${evicted} | parks ${parks.length} | ${(fs.statSync(city.out).size / 1024).toFixed(0)} KB`);
console.log(out.landmarks);
