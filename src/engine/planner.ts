// Le planificateur : trajet le plus court, repérage des spots autour, matrice des temps,
// puis pour chaque durée choisie, la balade qui rapporte le plus de beaux endroits.
import { bboxOf, clamp, ellipseBBox, haversine, inBBox, nearestOnLine, padBBox, tilesInBBox, type LngLat } from '../lib/geo';
import { cacheGet, cacheSet } from '../lib/cache';
import { isAbort, pool, sleep } from '../lib/http';
import { directRoute, getMatrix, getRoute, MAX_STOPS, type Mode, type Route } from '../data/routing';
import { fetchTile } from '../data/tiles';
import { dedupe, enrichWithWiki, extractSpots, GENERIC_NAME, normalizeName, scoreSpot, type Category, type Spot } from '../data/spots';
import { commonsPhotos, geosearch } from '../data/wiki';
import { solveOP, type OPSolution } from './orienteering';

export type Prefs = Record<Category, boolean>;

export interface PlanSpot {
  spot: Spot;
  /** position le long du trajet (m) */
  along: number;
  /** temps depuis le départ (s) */
  eta: number;
  /** numéro d'étape (0 pour un bonus croisé en chemin) */
  n: number;
  bonus: boolean;
}

export interface Plan {
  minutes: number;
  route: Route;
  stops: PlanSpot[];
  bonus: PlanSpot[];
  scenic: boolean;
}

const LOCAL_LANG: Record<string, string> = {
  NL: 'nl', BE: 'nl', FR: 'fr', LU: 'fr', MC: 'fr', DE: 'de', AT: 'de', CH: 'de', ES: 'es', IT: 'it', PT: 'pt', PL: 'pl', CZ: 'cs', DK: 'da', SE: 'sv', NO: 'no',
};
// À changer dès que l'extraction des spots change : les tuiles déjà analysées sont réanalysées.
const TILE_CACHE_VERSION = 'v3';
const ALL_ON: Prefs = { nature: true, patrimoine: true, vue: true, urbain: true };

export type PrepStep = 1 | 2 | 3 | 4;

export class Planner {
  base: Route | null = null;
  /** secondes */
  t0 = 0;
  tmax = 0;
  all: Spot[] = [];
  cands: Spot[] = [];
  ready = false;
  scenicPossible = true;
  readonly loop: boolean;
  private T: number[][] = [];
  /** correction cumulée de la matrice, apprise sur les itinéraires réels */
  private kAdj = 1;
  private sols = new Map<number, OPSolution>();
  private routes = new Map<string, Promise<Route>>();
  private readonly ab: number;
  private vStraight = 1;
  private sumMax = 0;

  constructor(
    readonly origin: LngLat,
    readonly dest: LngLat,
    readonly mode: Mode,
    private prefs: Prefs,
    readonly country?: string,
  ) {
    this.ab = haversine(origin, dest);
    this.loop = this.ab < 80;
  }

  get t0min() {
    return this.loop ? 0 : Math.max(1, Math.round(this.t0 / 60));
  }
  get tmaxmin() {
    return Math.round(this.tmax / 60);
  }

  async loadBase(signal?: AbortSignal): Promise<Route> {
    this.base = this.loop ? directRoute(this.origin, this.dest, this.mode) : await getRoute([this.origin, this.dest], this.mode, { signal });
    const t0 = (this.t0 = this.base.duration);
    const walk = this.mode === 'walk';
    this.tmax = walk
      ? Math.min(Math.max(t0 + 50 * 60, 2.5 * t0), t0 + 120 * 60, 200 * 60)
      : Math.min(Math.max(t0 + 40 * 60, 2 * t0), t0 + 90 * 60, 180 * 60);
    this.scenicPossible = this.tmax > t0 + 4 * 60 && t0 < (walk ? 150 : 120) * 60;
    this.vStraight = this.ab > 300 ? clamp(this.ab / t0, walk ? 0.8 : 2.2, walk ? 1.3 : 4.2) : walk ? 1.0 : 3.0;
    this.sumMax = this.ab + (this.tmax - t0) * this.vStraight * 1.05 + 80;
    return this.base;
  }

  /** Repère et note les spots dans la zone atteignable, puis calcule la matrice des temps. */
  async prepare(signal: AbortSignal | undefined, onStep: (step: PrepStep) => void): Promise<void> {
    const S = this.sumMax;
    const bbox = ellipseBBox(this.origin, this.dest, S, 120);
    let z = this.mode === 'walk' ? 14 : 13;
    let tiles = tilesInBBox(bbox, z);
    while (tiles.length > 30 && z > 12) tiles = tilesInBBox(bbox, --z);

    onStep(1);
    const mid: LngLat = [(this.origin[0] + this.dest[0]) / 2, (this.origin[1] + this.dest[1]) / 2];
    const radius = Math.min(10000, S / 2 + 250);
    const langs = [...new Set(['fr', 'en', LOCAL_LANG[this.country?.toUpperCase() ?? ''] ?? 'en'])];
    const wikiP = Promise.all(
      langs.map((l) =>
        geosearch(l, mid, radius, signal).catch((e) => {
          if (isAbort(e)) throw e;
          return [];
        }),
      ),
    );
    const perTile = await pool(tiles, 6, async ([x, y]) => {
      const key = `c:sp:${TILE_CACHE_VERSION}:${z}/${x}/${y}`;
      const hit = cacheGet<Spot[]>(key);
      if (hit) return hit;
      try {
        const sp = extractSpots(await fetchTile(z, x, y, signal), z, x, y);
        cacheSet(key, sp, 21 * 864e5);
        return sp;
      } catch (e) {
        if (isAbort(e)) throw e;
        console.warn('[flane] tuile illisible', z, x, y, e);
        return [];
      }
    });

    onStep(2);
    const articles = (await wikiP).flat();
    // Copie : les spots du cache ne doivent pas garder les bonus d'une session précédente.
    let spots = dedupe(perTile.flat().map((s) => ({ ...s })));
    spots = enrichWithWiki(spots, articles, ['fr', 'en']);
    spots = spots.filter((s) => haversine(this.origin, s.coord) + haversine(s.coord, this.dest) <= S);
    spots.forEach((s) => (s.score = scoreSpot(s)));

    this.all = spots;
    this.cands = this.selectCandidates(spots);

    // Photos des 12 meilleurs candidats (Wikimedia : ~1 s par requête, 3 à la fois au plus),
    // en même temps que la matrice des temps. Les autres gardent leur note sans bonus photo.
    onStep(3);
    const photoTargets = [...this.cands].sort((a, b) => b.score - a.score).slice(0, 12);
    const photosP = pool(photoTargets, 3, async (s) => {
      try {
        const r = await commonsPhotos(s.coord, ['park', 'green', 'square', 'garden'].includes(s.kind) ? 120 : 60, signal);
        s.photos = r.count;
        if (!s.thumb && r.thumb) s.thumb = r.thumb;
      } catch (e) {
        if (isAbort(e)) throw e;
      }
    });
    const matrixP = this.cands.length
      ? getMatrix([this.origin, this.dest, ...this.cands.map((c) => c.coord)], this.mode, signal).then(({ m }) => {
          const k = this.calibration(m);
          this.T = m.map((row) => row.map((v) => v * k));
        })
      : Promise.resolve();
    await Promise.all([photosP, matrixP]);
    onStep(4);
    for (const s of this.cands) {
      // Un « lieu remarquable » que personne ne prend en photo n'est sans doute pas visible de la rue.
      if (s.kind === 'landmark' && s.photos !== undefined && s.photos < 2) s.base *= 0.55;
      s.score = scoreSpot(s);
    }
    this.ready = true;
  }

  /** Les temps de la matrice (OSRM) sont recalés sur ceux de l'itinéraire réel (Valhalla). */
  private calibration(m: number[][]): number {
    const def = this.mode === 'walk' ? 0.92 : 1;
    if (!this.base || this.loop || this.ab < 300) return def;
    const raw = m[0][1];
    if (!(raw > 30) || !isFinite(raw)) return def;
    return clamp(this.base.duration / raw, 0.7, 1.4);
  }

  /** ~30 candidats bien répartis : proches du trajet direct comme plus lointains, et de toutes les ambiances. */
  private selectCandidates(spots: Spot[]): Spot[] {
    const dMax = Math.max(1, this.sumMax - this.ab);
    const spacing = this.mode === 'walk' ? 70 : 160;
    const edges = [0.15, 0.35, 0.6, 1.01];
    const quotas = [9, 8, 7, 6];
    const sorted = [...spots].sort((a, b) => b.score - a.score);
    const detour = new Map(sorted.map((s) => [s.id, (haversine(this.origin, s.coord) + haversine(s.coord, this.dest) - this.ab) / dMax]));
    const chosen: Spot[] = [];
    const byName = new Map<string, Spot[]>();
    const nameKey = (s: Spot) => (GENERIC_NAME.test(s.name) ? '' : normalizeName(s.name).join(' '));
    const farEnough = (s: Spot) => {
      if (!chosen.every((c) => haversine(c.coord, s.coord) >= spacing)) return false;
      const prev = byName.get(nameKey(s));
      if (!prev) return true;
      // Un même nom une seule fois, sauf les berges d'une longue rivière (deux fois, bien espacées).
      return s.kind === 'water' && prev.length < 2 && prev.every((p) => haversine(p.coord, s.coord) > 400);
    };
    const take = (s: Spot) => {
      chosen.push(s);
      const k = nameKey(s);
      if (k) byName.set(k, [...(byName.get(k) ?? []), s]);
    };
    let lo = 0;
    edges.forEach((hi, bi) => {
      const bucket = sorted.filter((s) => detour.get(s.id)! >= lo && detour.get(s.id)! < hi);
      const perCat = new Map<string, number>();
      let taken = 0;
      for (const s of bucket) {
        if (taken >= quotas[bi]) break;
        const cc = perCat.get(s.cat) ?? 0;
        if (cc >= Math.ceil(quotas[bi] * 0.5) && bucket.some((o) => o.cat !== s.cat && !chosen.includes(o))) continue;
        if (!farEnough(s)) continue;
        take(s);
        perCat.set(s.cat, cc + 1);
        taken++;
      }
      lo = hi;
    });
    for (const s of sorted) {
      if (chosen.length >= 30) break;
      if (!chosen.includes(s) && farEnough(s)) take(s);
    }
    return chosen;
  }

  setPrefs(prefs: Prefs) {
    this.prefs = prefs;
    this.sols.clear();
  }

  /** Meilleure sélection de spots pour une durée (min). Les durées sont résolues dans l'ordre croissant,
   * chacune partant de la précédente : en glissant, le trajet s'allonge au lieu de changer du tout au tout. */
  solve(minutes: number): OPSolution {
    const target = Math.round(minutes);
    const empty: OPSolution = { order: [], time: this.t0, value: 0 };
    if (!this.ready || !this.cands.length || target <= this.t0min) return empty;
    const hit = this.sols.get(target);
    if (hit) return hit;
    const items = this.cands.map((c) => ({ value: scoreSpot(c, this.prefs), kind: c.kind, cat: c.cat, name: c.name }));
    let start = this.t0min + 1;
    for (let m = target - 1; m > this.t0min; m--) {
      if (this.sols.has(m)) {
        start = m + 1;
        break;
      }
    }
    let last = this.sols.get(start - 1);
    for (let m = start; m <= target; m++) {
      const sol = solveOP({ items, time: this.T, budget: m * 60 - 15, maxStops: MAX_STOPS, init: last?.order, seed: 11, iterations: 18 });
      this.sols.set(m, sol);
      last = sol;
    }
    return this.sols.get(target) ?? empty;
  }

  private routeFor(order: number[], signal?: AbortSignal): Promise<Route> {
    const key = order.join(',');
    let p = this.routes.get(key);
    if (!p) {
      p = getRoute([this.origin, ...order.map((i) => this.cands[i].coord), this.dest], this.mode, { scenic: true, signal });
      this.routes.set(key, p);
      p.catch(() => this.routes.delete(key));
    }
    return p;
  }

  /** Balade complète (itinéraire réel + spots placés le long) pour une durée en minutes. */
  async planFor(minutes: number, signal?: AbortSignal): Promise<Plan> {
    if (!this.base) throw new Error('Trajet de base manquant');
    let sol = this.solve(minutes);
    if (!sol.order.length) return this.decorate(this.base, [], minutes, false);
    let route = await this.routeFor(sol.order, signal);

    // Recalage : la matrice (OSRM) et l'itinéraire réel (Valhalla) ne marchent pas tout à fait
    // à la même vitesse selon les quartiers. Si l'écart est net, on corrige la matrice et on
    // retente (deux fois au plus) : les durées suivantes en profitent aussi.
    const target = minutes * 60;
    for (let round = 0; round < 2; round++) {
      const err = route.duration - target;
      if (Math.abs(err) <= Math.max(90, target * 0.07) || !(sol.time > 0)) break;
      const nextK = clamp(this.kAdj * clamp(route.duration / sol.time, 0.8, 1.25), 0.7, 1.4);
      if (Math.abs(nextK - this.kAdj) <= 0.02) break;
      const f = nextK / this.kAdj;
      this.kAdj = nextK;
      this.T = this.T.map((row) => row.map((v) => v * f));
      this.sols.clear();
      const retry = this.solve(minutes);
      if (!retry.order.length || retry.order.join(',') === sol.order.join(',')) break;
      const r2 = await this.routeFor(retry.order, signal);
      if (Math.abs(r2.duration - target) >= Math.abs(err)) break;
      sol = retry;
      route = r2;
    }
    return this.decorate(
      route,
      sol.order.map((i) => this.cands[i]),
      minutes,
      true,
    );
  }

  /** Place les étapes le long de l'itinéraire et ajoute les beaux coins croisés en chemin. */
  decorate(route: Route, stops: Spot[], minutes: number, scenic: boolean): Plan {
    const { coords, cum } = route;
    const total = cum[cum.length - 1] || 1;
    let from = 0;
    const placed: PlanSpot[] = stops.map((s, i) => {
      const hit = nearestOnLine(coords, cum, s.coord, from, coords.length - 1);
      from = hit.index;
      return { spot: s, along: hit.along, eta: route.duration * (hit.along / total), n: i + 1, bonus: false };
    });
    const chosen = new Set(stops.map((s) => s.id));
    const seenNames = new Set(stops.map((s) => s.name));
    const maxD = this.mode === 'walk' ? 28 : 40;
    const box = padBBox(bboxOf(coords), 60);
    const bonus: PlanSpot[] = [];
    for (const s of [...this.all].sort((a, b) => b.score - a.score)) {
      if (bonus.length >= 6) break;
      if (chosen.has(s.id) || s.score < 4 || !inBBox(s.coord, box)) continue;
      // « Place piétonne », « Au bord de l'eau »… : trop vagues pour être annoncés en passant.
      if (GENERIC_NAME.test(s.name) || seenNames.has(s.name)) continue;
      const hit = nearestOnLine(coords, cum, s.coord);
      if (hit.dist > maxD) continue;
      if ([...placed, ...bonus].some((p) => Math.abs(p.along - hit.along) < 90)) continue;
      bonus.push({ spot: s, along: hit.along, eta: route.duration * (hit.along / total), n: 0, bonus: true });
      seenNames.add(s.name);
    }
    bonus.sort((a, b) => a.along - b.along);
    return { minutes, route, stops: placed, bonus, scenic };
  }

  /** Précharge quelques durées types pour que le curseur réponde tout de suite. */
  async prefetch(signal?: AbortSignal) {
    const marks = [5, 10, 15, 20, 30].map((d) => this.t0min + d).filter((m) => m <= this.tmaxmin);
    for (const m of marks) {
      if (signal?.aborted) return;
      const sol = this.solve(m);
      if (!sol.order.length || this.routes.has(sol.order.join(','))) continue;
      try {
        await this.planFor(m, signal);
      } catch {
        /* préchargement facultatif */
      }
      await sleep(150);
    }
  }
}

export { ALL_ON };
