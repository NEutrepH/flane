// Géométrie à l'échelle d'une ville : distances, projections locales, lignes, polygones, tuiles.

export type LngLat = [number, number];
/** ouest, sud, est, nord */
export type BBox = [number, number, number, number];

const R = 6371008.8;
const RAD = Math.PI / 180;

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLng = (b[0] - a[0]) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Cap en degrés (0 = nord, sens horaire). */
export function bearing(a: LngLat, b: LngLat): number {
  const p1 = a[1] * RAD;
  const p2 = b[1] * RAD;
  const dl = (b[0] - a[0]) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Plus petit écart signé de `from` vers `to`, dans ]-180, 180]. */
export function angleDiff(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

export function lerp(a: LngLat, b: LngLat, t: number): LngLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Projection équirectangulaire locale, en mètres, autour d'un point d'origine. */
export class LocalProj {
  readonly kx: number;
  readonly ky = 110540;
  constructor(readonly origin: LngLat) {
    this.kx = 111320 * Math.cos(origin[1] * RAD);
  }
  toXY(p: LngLat): [number, number] {
    return [(p[0] - this.origin[0]) * this.kx, (p[1] - this.origin[1]) * this.ky];
  }
  toLngLat(x: number, y: number): LngLat {
    return [this.origin[0] + x / this.kx, this.origin[1] + y / this.ky];
  }
}

/** Décode une polyline encodée (précision 6 pour Valhalla) en [lng, lat]. */
export function decodePolyline(str: string, precision = 6): LngLat[] {
  const factor = 10 ** precision;
  const out: LngLat[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < str.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    out.push([lng / factor, lat / factor]);
  }
  return out;
}

/** Distances cumulées (m) le long d'une ligne. */
export function cumulative(coords: LngLat[]): number[] {
  const cum = new Array<number>(coords.length);
  if (!coords.length) return cum;
  cum[0] = 0;
  for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + haversine(coords[i - 1], coords[i]);
  return cum;
}

export interface LineHit {
  /** indice du segment [index, index + 1] */
  index: number;
  t: number;
  point: LngLat;
  /** distance latérale (m) */
  dist: number;
  /** distance le long de la ligne (m) */
  along: number;
}

/** Point de la ligne le plus proche de `p`, en cherchant entre les segments `from` et `to`. */
export function nearestOnLine(coords: LngLat[], cum: number[], p: LngLat, from = 0, to = coords.length - 1): LineHit {
  if (coords.length < 2) {
    const q = coords[0] ?? p;
    return { index: 0, t: 0, point: q, dist: haversine(q, p), along: 0 };
  }
  const proj = new LocalProj(p);
  const lo = clamp(from, 0, coords.length - 2);
  const hi = clamp(to, lo + 1, coords.length - 1);
  let best: LineHit = { index: lo, t: 0, point: coords[lo], dist: Infinity, along: cum[lo] };
  for (let i = lo; i < hi; i++) {
    const [ax, ay] = proj.toXY(coords[i]);
    const [bx, by] = proj.toXY(coords[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? clamp(-(ax * dx + ay * dy) / len2, 0, 1) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.dist) {
      best = { index: i, t, point: lerp(coords[i], coords[i + 1], t), dist: d, along: cum[i] + t * (cum[i + 1] - cum[i]) };
    }
  }
  return best;
}

/** Point situé à `along` mètres du début de la ligne. */
export function pointAt(coords: LngLat[], cum: number[], along: number): { point: LngLat; index: number } {
  const n = coords.length;
  if (n < 2 || along <= 0) return { point: coords[0], index: 0 };
  if (along >= cum[n - 1]) return { point: coords[n - 1], index: n - 2 };
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= along) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo];
  return { point: lerp(coords[lo], coords[hi], seg > 0 ? (along - cum[lo]) / seg : 0), index: lo };
}

/** Morceau de ligne entre deux distances. */
export function sliceLine(coords: LngLat[], cum: number[], from: number, to: number): LngLat[] {
  if (coords.length < 2 || to <= from) return [];
  const a = pointAt(coords, cum, from);
  const b = pointAt(coords, cum, to);
  const out: LngLat[] = [a.point];
  for (let i = a.index + 1; i <= b.index; i++) out.push(coords[i]);
  out.push(b.point);
  return out;
}

/** Cap de la ligne autour d'une position (regarde un peu devant pour lisser). */
export function bearingAt(coords: LngLat[], cum: number[], along: number, ahead = 25): number {
  const a = pointAt(coords, cum, Math.max(0, along - 4)).point;
  const b = pointAt(coords, cum, along + ahead).point;
  return bearing(a, b);
}

/**
 * Bouts du trajet parcourus deux fois (aller-retour, même rue dans les deux sens, même pont deux fois).
 * On échantillonne tous les `step` m ; deux échantillons à moins de `tol` m l'un de l'autre, éloignés
 * de plus de `minGap` m le long du trajet et allant dans la même direction (ou l'inverse) sont un
 * repassage. Recroiser son chemin à un carrefour ne compte pas. `pairs` donne les deux passages (en m).
 */
export function repeatedStretches(coords: LngLat[], cum: number[], tol = 14, minGap = 70, step = 10): { length: number; pairs: Array<[number, number]> } {
  const total = cum[cum.length - 1] ?? 0;
  if (coords.length < 2 || total < minGap * 2) return { length: 0, pairs: [] };
  const proj = new LocalProj(coords[0]);
  const samples: Array<{ p: LngLat; along: number; x: number; y: number }> = [];
  for (let d = 0; d <= total; d += step) {
    const p = pointAt(coords, cum, d).point;
    const [x, y] = proj.toXY(p);
    samples.push({ p, along: d, x, y });
  }
  const dir = (k: number): [number, number] => {
    const a = samples[Math.max(0, k - 1)];
    const b = samples[Math.min(samples.length - 1, k + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return [(b.x - a.x) / len, (b.y - a.y) / len];
  };
  const grid = new PointGrid<number>(proj, 25);
  samples.forEach((s, i) => grid.add(s.p, i));
  const flagged = new Set<number>();
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < samples.length; i++) {
    let partner = -1;
    const [ux, uy] = dir(i);
    for (const { data: j } of grid.within(samples[i].p, tol)) {
      if (j <= i || samples[j].along - samples[i].along <= minGap || (partner >= 0 && j >= partner)) continue;
      const [vx, vy] = dir(j);
      if (Math.abs(ux * vx + uy * vy) > 0.7) partner = j;
    }
    if (partner < 0) continue;
    flagged.add(i);
    flagged.add(partner);
    pairs.push([samples[i].along, samples[partner].along]);
  }
  return { length: (flagged.size * step) / 2, pairs };
}

/** Cercle (polygone) de `radius` mètres autour d'un point. */
export function circlePolygon(center: LngLat, radius: number, steps = 48): LngLat[] {
  const proj = new LocalProj(center);
  const ring: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ring.push(proj.toLngLat(Math.cos(a) * radius, Math.sin(a) * radius));
  }
  return ring;
}

export function lineLength(line: LngLat[]): number {
  let d = 0;
  for (let i = 1; i < line.length; i++) d += haversine(line[i - 1], line[i]);
  return d;
}

/** Points régulièrement espacés le long d'une ligne (au moins le milieu). */
export function samplePoints(line: LngLat[], step: number): LngLat[] {
  if (!line.length) return [];
  const cum = cumulative(line);
  const len = cum[cum.length - 1];
  if (!(len > 0)) return [line[0]];
  if (len < step) return [pointAt(line, cum, len / 2).point];
  const out: LngLat[] = [];
  for (let d = step / 2; d < len; d += step) out.push(pointAt(line, cum, d).point);
  return out;
}

export function midpoint(line: LngLat[]): LngLat {
  const cum = cumulative(line);
  return pointAt(line, cum, cum[cum.length - 1] / 2).point;
}

export function ringArea(ring: LngLat[]): number {
  if (ring.length < 3) return 0;
  const proj = new LocalProj(ring[0]);
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = proj.toXY(ring[i]);
    const [xj, yj] = proj.toXY(ring[j]);
    s += xj * yi - xi * yj;
  }
  return Math.abs(s) / 2;
}

export function ringCentroid(ring: LngLat[]): LngLat {
  const proj = new LocalProj(ring[0]);
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = proj.toXY(ring[i]);
    const [xj, yj] = proj.toXY(ring[j]);
    const f = xj * yi - xi * yj;
    a += f;
    cx += (xj + xi) * f;
    cy += (yj + yi) * f;
  }
  if (Math.abs(a) < 1e-6) {
    let sx = 0;
    let sy = 0;
    for (const p of ring) {
      sx += p[0];
      sy += p[1];
    }
    return [sx / ring.length, sy / ring.length];
  }
  return proj.toLngLat(cx / (3 * a), cy / (3 * a));
}

export function pointInRing(p: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  const [x, y] = p;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function bboxOf(points: LngLat[]): BBox {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [x, y] of points) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

export function padBBox(b: BBox, meters: number): BBox {
  const lat = (b[1] + b[3]) / 2;
  const dLat = meters / 110540;
  const dLng = meters / (111320 * Math.cos(lat * RAD));
  return [b[0] - dLng, b[1] - dLat, b[2] + dLng, b[3] + dLat];
}

export function inBBox(p: LngLat, b: BBox): boolean {
  return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
}

/** Boîte englobante de l'ellipse de foyers a, b dont la somme des distances vaut `sum`. */
export function ellipseBBox(a: LngLat, b: LngLat, sum: number, pad = 0): BBox {
  const mid: LngLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const proj = new LocalProj(mid);
  const [ax, ay] = proj.toXY(a);
  const [bx, by] = proj.toXY(b);
  const c = Math.hypot(bx - ax, by - ay) / 2;
  const A = Math.max(sum / 2, c + 1);
  const B = Math.sqrt(A * A - c * c);
  const th = Math.atan2(by - ay, bx - ax);
  const hw = Math.sqrt((A * Math.cos(th)) ** 2 + (B * Math.sin(th)) ** 2) + pad;
  const hh = Math.sqrt((A * Math.sin(th)) ** 2 + (B * Math.cos(th)) ** 2) + pad;
  const sw = proj.toLngLat(-hw, -hh);
  const ne = proj.toLngLat(hw, hh);
  return [sw[0], sw[1], ne[0], ne[1]];
}

// ---- Tuiles « slippy map » ----

export function lngLatToTile(p: LngLat, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((p[0] + 180) / 360) * n);
  const la = p[1] * RAD;
  const y = Math.floor(((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n);
  return [clamp(x, 0, n - 1), clamp(y, 0, n - 1)];
}

export function tileBounds(x: number, y: number, z: number): BBox {
  const n = 2 ** z;
  const lat = (yy: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / n))) / RAD;
  return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)];
}

export function tilesInBBox(b: BBox, z: number): Array<[number, number]> {
  const [x0, y0] = lngLatToTile([b[0], b[3]], z);
  const [x1, y1] = lngLatToTile([b[2], b[1]], z);
  const out: Array<[number, number]> = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y]);
  return out;
}

// ---- Index spatiaux simples (grilles), en mètres locaux ----

interface Seg<T> {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  data: T;
}

function segDist(px: number, py: number, s: Seg<unknown>): number {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - s.ax) * dx + (py - s.ay) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (s.ax + t * dx), py - (s.ay + t * dy));
}

const cellKey = (x: number, y: number) => x * 131071 + y;

export class SegmentGrid<T> {
  private cells = new Map<number, Seg<T>[]>();
  constructor(
    private proj: LocalProj,
    private size = 50,
  ) {}

  add(a: LngLat, b: LngLat, data: T) {
    const [ax, ay] = this.proj.toXY(a);
    const [bx, by] = this.proj.toXY(b);
    const s = this.size;
    const seg: Seg<T> = { ax, ay, bx, by, data };
    const x0 = Math.floor(Math.min(ax, bx) / s);
    const x1 = Math.floor(Math.max(ax, bx) / s);
    const y0 = Math.floor(Math.min(ay, by) / s);
    const y1 = Math.floor(Math.max(ay, by) / s);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 2500) return;
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const k = cellKey(x, y);
        const c = this.cells.get(k);
        if (c) c.push(seg);
        else this.cells.set(k, [seg]);
      }
    }
  }

  addLine(line: LngLat[], data: T) {
    for (let i = 1; i < line.length; i++) this.add(line[i - 1], line[i], data);
  }

  nearest(p: LngLat, maxDist: number, filter?: (d: T) => boolean): { dist: number; data: T } | null {
    const [px, py] = this.proj.toXY(p);
    const s = this.size;
    const r = Math.ceil(maxDist / s);
    const cx = Math.floor(px / s);
    const cy = Math.floor(py / s);
    let best: { dist: number; data: T } | null = null;
    const seen = new Set<Seg<T>>();
    for (let x = cx - r; x <= cx + r; x++) {
      for (let y = cy - r; y <= cy + r; y++) {
        const c = this.cells.get(cellKey(x, y));
        if (!c) continue;
        for (const sg of c) {
          if (seen.has(sg)) continue;
          seen.add(sg);
          if (filter && !filter(sg.data)) continue;
          const d = segDist(px, py, sg);
          if (d <= maxDist && (!best || d < best.dist)) best = { dist: d, data: sg.data };
        }
      }
    }
    return best;
  }
}

export class PointGrid<T> {
  private cells = new Map<number, Array<{ x: number; y: number; data: T }>>();
  constructor(
    private proj: LocalProj,
    private size = 60,
  ) {}

  add(p: LngLat, data: T) {
    const [x, y] = this.proj.toXY(p);
    const k = cellKey(Math.floor(x / this.size), Math.floor(y / this.size));
    const c = this.cells.get(k);
    if (c) c.push({ x, y, data });
    else this.cells.set(k, [{ x, y, data }]);
  }

  within(p: LngLat, r: number): Array<{ dist: number; data: T }> {
    const [px, py] = this.proj.toXY(p);
    const s = this.size;
    const n = Math.ceil(r / s);
    const cx = Math.floor(px / s);
    const cy = Math.floor(py / s);
    const out: Array<{ dist: number; data: T }> = [];
    for (let x = cx - n; x <= cx + n; x++) {
      for (let y = cy - n; y <= cy + n; y++) {
        const c = this.cells.get(cellKey(x, y));
        if (!c) continue;
        for (const it of c) {
          const d = Math.hypot(it.x - px, it.y - py);
          if (d <= r) out.push({ dist: d, data: it.data });
        }
      }
    }
    return out;
  }

  count(p: LngLat, r: number): number {
    return this.within(p, r).length;
  }
}
