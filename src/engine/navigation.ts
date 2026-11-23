// Guidage en direct : où en est-on sur le trajet, prochaine instruction, temps restant,
// sortie de route, spots croisés (« tamponnés »).
import { bearingAt, haversine, nearestOnLine, type LngLat } from '../lib/geo';
import type { Maneuver, Mode, Route } from '../data/routing';
import type { PlanSpot } from './planner';

export interface NavState {
  progress: number;
  offset: number;
  snapped: LngLat;
  bearing: number;
  next: Maneuver | null;
  nextIdx: number;
  distToNext: number;
  after: Maneuver | null;
  remainingDist: number;
  remainingTime: number;
  offRoute: boolean;
  arrived: boolean;
  nextSpot: PlanSpot | null;
  distToSpot: number;
  visited: string[];
  justVisited: PlanSpot | null;
}

/** Temps cumulé (s) à chaque sommet, réparti au prorata des distances dans chaque manœuvre. */
export function buildCumTime(route: Route): number[] {
  const { cum, maneuvers, duration } = route;
  const n = cum.length;
  const t = new Array<number>(n).fill(NaN);
  if (!n) return t;
  t[0] = 0;
  let acc = 0;
  for (const m of maneuvers) {
    const b = Math.min(n - 1, m.begin);
    const e = Math.min(n - 1, m.end);
    const d0 = cum[b];
    const d1 = cum[e];
    for (let i = b; i <= e; i++) t[i] = acc + (d1 > d0 ? (cum[i] - d0) / (d1 - d0) : 0) * m.duration;
    acc += m.duration;
  }
  const total = cum[n - 1] || 1;
  for (let i = 0; i < n; i++) if (!isFinite(t[i])) t[i] = (duration * cum[i]) / total;
  for (let i = 1; i < n; i++) if (t[i] < t[i - 1]) t[i] = t[i - 1];
  return t;
}

function timeAt(cumTime: number[], cum: number[], along: number): number {
  const n = cum.length;
  if (n < 2 || along <= 0) return 0;
  if (along >= cum[n - 1]) return cumTime[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= along) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo];
  const k = seg > 0 ? (along - cum[lo]) / seg : 0;
  return cumTime[lo] + k * (cumTime[hi] - cumTime[lo]);
}

export class Guide {
  private idx = 0;
  private offCount = 0;
  private readonly visited: Set<string>;
  private readonly cumTime: number[];
  private readonly spots: PlanSpot[];

  constructor(
    readonly route: Route,
    spots: PlanSpot[],
    readonly mode: Mode,
    visited: Iterable<string> = [],
  ) {
    this.spots = [...spots].sort((a, b) => a.along - b.along);
    this.cumTime = buildCumTime(route);
    this.visited = new Set(visited);
  }

  isVisited(id: string) {
    return this.visited.has(id);
  }

  get visitedIds() {
    return [...this.visited];
  }

  update(p: LngLat, accuracy = 10): NavState {
    const { coords, cum, maneuvers } = this.route;
    const total = cum[cum.length - 1] ?? 0;
    // On cherche d'abord autour de la dernière position connue (trajets qui se croisent), sinon partout.
    let hit = nearestOnLine(coords, cum, p, this.idx - 3, this.idx + 80);
    if (hit.dist > 30) {
      const all = nearestOnLine(coords, cum, p);
      if (all.dist + 5 < hit.dist) hit = all;
    }
    this.idx = hit.index;
    const progress = hit.along;
    const limit = (this.mode === 'walk' ? 28 : 40) + Math.min(accuracy, 25);
    this.offCount = hit.dist > limit ? this.offCount + 1 : 0;

    let nextIdx = maneuvers.findIndex((m) => m.turn !== 'depart' && cum[Math.min(m.begin, cum.length - 1)] > progress + 2);
    if (nextIdx < 0) nextIdx = maneuvers.length - 1;
    const next = maneuvers[nextIdx] ?? null;
    const distToNext = next ? Math.max(0, cum[Math.min(next.begin, cum.length - 1)] - progress) : 0;

    const remainingDist = Math.max(0, total - progress);
    const remainingTime = Math.max(0, this.cumTime[this.cumTime.length - 1] - timeAt(this.cumTime, cum, progress));
    const end = coords[coords.length - 1];
    const arrived = remainingDist < 18 || (haversine(p, end) < 20 && progress > total * 0.7);

    let justVisited: PlanSpot | null = null;
    for (const s of this.spots) {
      if (this.visited.has(s.spot.id)) continue;
      const near = haversine(p, s.spot.coord) < (s.spot.area ? 70 : 35);
      if ((progress >= s.along - 15 && near) || progress > s.along + 25) {
        this.visited.add(s.spot.id);
        justVisited = s;
      }
    }
    const nextSpot = this.spots.find((s) => !this.visited.has(s.spot.id) && s.along > progress - 15) ?? null;

    return {
      progress,
      offset: hit.dist,
      snapped: hit.point,
      bearing: bearingAt(coords, cum, progress),
      next,
      nextIdx,
      distToNext,
      after: maneuvers[nextIdx + 1] ?? null,
      remainingDist,
      remainingTime,
      offRoute: this.offCount >= 3,
      arrived,
      nextSpot,
      distToSpot: nextSpot ? Math.max(0, nextSpot.along - progress) : 0,
      visited: [...this.visited],
      justVisited,
    };
  }
}
