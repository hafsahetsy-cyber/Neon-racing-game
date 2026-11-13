import type { MapRoad } from './types';

const CELL = 32;

export interface RoadHit {
  road: MapRoad;
  index: number;
  /** Distance from the road centreline. */
  dist: number;
  /** Segment index and direction (unit) at the closest point. */
  seg: number;
  dx: number;
  dz: number;
}

/** Spatial hash over road segments: "what road is at this point?" in O(1). */
export class RoadGrid {
  private cells = new Map<number, number[]>(); // packed [roadIndex, segIndex] pairs
  constructor(readonly roads: MapRoad[]) {
    roads.forEach((r, ri) => {
      const p = r.p;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const pad = r.w / 2 + 2;
        const x0 = Math.floor((Math.min(p[i], p[i + 2]) - pad) / CELL);
        const x1 = Math.floor((Math.max(p[i], p[i + 2]) + pad) / CELL);
        const z0 = Math.floor((Math.min(p[i + 1], p[i + 3]) - pad) / CELL);
        const z1 = Math.floor((Math.max(p[i + 1], p[i + 3]) + pad) / CELL);
        for (let cx = x0; cx <= x1; cx++)
          for (let cz = z0; cz <= z1; cz++) {
            const k = (cx + 512) * 4096 + (cz + 512);
            let c = this.cells.get(k);
            if (!c) this.cells.set(k, (c = []));
            c.push(ri, i / 2);
          }
      }
    });
  }

  /** Closest road whose surface (plus `margin`) covers the point, optionally ignoring one road. */
  nearest(x: number, z: number, margin = 0, exclude = -1, maxClass = 9): RoadHit | null {
    const c = this.cells.get((Math.floor(x / CELL) + 512) * 4096 + (Math.floor(z / CELL) + 512));
    if (!c) return null;
    let best: RoadHit | null = null;
    let bestScore = Infinity;
    for (let k = 0; k < c.length; k += 2) {
      const ri = c[k];
      if (ri === exclude) continue;
      const r = this.roads[ri];
      if (r.c > maxClass) continue;
      const i = c[k + 1] * 2;
      const ax = r.p[i], az = r.p[i + 1];
      let dx = r.p[i + 2] - ax, dz = r.p[i + 3] - az;
      const len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      const score = d - r.w / 2;
      if (score <= margin && score < bestScore) {
        bestScore = score;
        const len = Math.sqrt(len2);
        dx /= len;
        dz /= len;
        best = { road: r, index: ri, dist: d, seg: i / 2, dx, dz };
      }
    }
    return best;
  }
}

/** Total length of a flat polyline. */
export function polyLength(p: number[]) {
  let l = 0;
  for (let i = 0; i + 3 < p.length; i += 2) l += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
  return l;
}

/** Calls fn(x, z, dirX, dirZ, distance) every `step` metres along a polyline. */
export function walkPolyline(
  p: number[],
  step: number,
  start: number,
  fn: (x: number, z: number, dx: number, dz: number, s: number) => void,
) {
  let next = start;
  let acc = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1];
    const dx = p[i + 2] - ax, dz = p[i + 3] - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    while (next <= acc + len) {
      const t = (next - acc) / len;
      fn(ax + dx * t, az + dz * t, dx / len, dz / len, next);
      next += step;
    }
    acc += len;
  }
}
