// Le planificateur : trajet le plus court, repérage des spots autour, matrice des temps,
// puis pour chaque durée choisie, la balade qui rapporte le plus de beaux endroits.
import { bboxOf, clamp, ellipseBBox, haversine, inBBox, LocalProj, nearestOnLine, padBBox, repeatedStretches, tilesInBBox, type LngLat } from '../lib/geo';
import { cacheGet, cacheSet } from '../lib/cache';
import { isAbort, pool, sleep } from '../lib/http';
import { directRoute, getMatrix, getRoute, MAX_STOPS, SPEED, type Mode, type Route, type RoutePoint, type Waypoint } from '../data/routing';
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
const TILE_CACHE_VERSION = 'v5';
/** Taille maximale de la matrice des temps (départ + arrivée + points des spots). */
const MAX_NODES = 46;
const ALL_ON: Prefs = { nature: true, patrimoine: true, vue: true, urbain: true };

export type PrepStep = 1 | 2 | 3 | 4;

/**
 * À quelle distance d'un spot il suffit de passer pour l'avoir « vu » : une église se voit de la rue,
 * un parc se traverse par n'importe quelle allée, mais un pont doit être franchi et un belvédère atteint.
 */
export function passRadius(s: Spot): number {
  switch (s.kind) {
    case 'bridge':
      return 10;
    case 'viewpoint':
    case 'peak':
      return 15;
    case 'water':
    case 'street':
    case 'market':
      return 20;
    case 'park':
    case 'garden':
    case 'green':
      return Math.round(clamp(Math.sqrt(s.area ?? 6000) / 2, 25, 80));
    case 'square':
      return Math.round(clamp(Math.sqrt(s.area ?? 2000) / 2, 15, 50));
    default:
      return 30;
  }
}

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
  /** pour chaque candidat : ses points dans la matrice (un, ou les deux bouts d'un tronçon) */
  private nodeOf: number[][] = [];
  /** positions des points de la matrice (m, repère local), pour repérer les allers-retours */
  private xy: Array<[number, number]> = [];
  /** beauté perdue par mètre refait en sens inverse */
  private reversalWeight: number;
  /** correction cumulée de la matrice, apprise sur les itinéraires réels */
  private kAdj = 1;
  /** spots dépréciés parce qu'ils ont provoqué des allers-retours sur un tracé réel (facteur de valeur) */
  private penalty = new Map<string, number>();
  /** tracés essayés au dernier calcul (pour le débogage) */
  trace: Array<{ order: number[]; route: Route; repeated: number; predicted: number }> = [];
  private queue: Promise<unknown> = Promise.resolve();
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
    /** bonus personnel d'un spot selon les coups de cœur (1 = neutre) */
    private taste: (s: Spot) => number = () => 1,
  ) {
    this.ab = haversine(origin, dest);
    this.loop = this.ab < 80;
    this.reversalWeight = mode === 'walk' ? 0.02 : 0.007;
  }

  /** Change le goût (coups de cœur ajoutés ou retirés en cours de route). */
  setTaste(taste: (s: Spot) => number) {
    this.taste = taste;
    for (const s of this.all) s.score = scoreSpot(s) * taste(s);
    this.sols.clear();
  }

  /** Règle l'importance des allers-retours (0 = ignorés) ; sert aussi aux mesures. */
  setReversalWeight(w: number) {
    this.reversalWeight = w;
    this.sols.clear();
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
    spots.forEach((s) => (s.score = scoreSpot(s) * this.taste(s)));

    this.all = spots;
    this.cands = this.selectCandidates(spots);
    // Points de la matrice : départ, arrivée, puis chaque spot (ses deux bouts s'il se traverse ou se longe).
    const points: LngLat[] = [this.origin, this.dest];
    this.nodeOf = this.cands.map((c) => {
      if (c.ends && points.length + 2 <= MAX_NODES) {
        points.push(c.ends[0], c.ends[1]);
        return [points.length - 2, points.length - 1];
      }
      points.push(c.coord);
      return [points.length - 1];
    });
    const proj = new LocalProj(this.origin);
    this.xy = points.map((p) => proj.toXY(p));

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
      ? getMatrix(points, this.mode, signal).then(({ m }) => {
          const k = this.calibration(m);
          this.T = m.map((row) => row.map((v) => v * k));
        })
      : Promise.resolve();
    await Promise.all([photosP, matrixP]);
    onStep(4);
    for (const s of this.cands) {
      // Un « lieu remarquable » que personne ne prend en photo n'est sans doute pas visible de la rue.
      if (s.kind === 'landmark' && s.photos !== undefined && s.photos < 2) s.base *= 0.55;
      s.score = scoreSpot(s) * this.taste(s);
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
    // Un spot au pied du départ ou de l'arrivée n'apporte rien (on y passe de toute façon) et force
    // un aller-retour en fin de balade ; il reste annoncé « en chemin ».
    const sorted = [...spots]
      .filter((s) => haversine(s.coord, this.dest) > 160 && haversine(s.coord, this.origin) > 80)
      .sort((a, b) => b.score - a.score);
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

  /** Le spot comme étape « on passe devant », avec un rayon plus large à vélo. */
  waypoint(s: Spot): Waypoint {
    return { coord: s.coord, radius: Math.round(passRadius(s) * (this.mode === 'bike' ? 1.5 : 1)) };
  }

  setPrefs(prefs: Prefs) {
    this.prefs = prefs;
    this.sols.clear();
  }

  /** Meilleure sélection de spots pour une durée (min). On part de la solution de la durée voisine déjà
   * calculée : en glissant, le trajet s'allonge au lieu de changer du tout au tout. */
  solve(minutes: number): OPSolution {
    const target = Math.round(minutes);
    const empty: OPSolution = { order: [], flips: [], time: this.t0, value: 0 };
    if (!this.ready || !this.cands.length || target <= this.t0min) return empty;
    const hit = this.sols.get(target);
    if (hit) return hit;
    const items = this.cands.map((c, i) => ({
      value: scoreSpot(c, this.prefs) * this.taste(c) * Math.min(this.penalty.get(c.id) ?? 1, cacheGet(`c:dead:${c.id}`) ? 0.5 : 1),
      kind: c.kind,
      cat: c.cat,
      name: c.name,
      nodes: this.nodeOf[i],
    }));
    let init: number[] | undefined;
    for (let d = 1; d <= 30 && !init; d++) init = (this.sols.get(target - d) ?? this.sols.get(target + d))?.order;
    const sol = solveOP({
      items,
      time: this.T,
      budget: target * 60 - 15,
      maxPoints: MAX_STOPS,
      init,
      seed: 11,
      iterations: 14,
      xy: this.xy,
      reversalWeight: this.reversalWeight,
      timeBonus: this.mode === 'walk' ? 0.003 : 0.0015,
    });
    this.sols.set(target, sol);
    return sol;
  }

  /** Étapes de l'itinéraire : un tronçon (pont, rue, berge) devient ses deux bouts dans le sens choisi. */
  private routeFor(sol: OPSolution, signal?: AbortSignal): Promise<Route> {
    const key = sol.order.map((i, k) => `${i}${sol.flips[k] ? 'r' : ''}`).join(',');
    let p = this.routes.get(key);
    if (!p) {
      const pts: RoutePoint[] = [this.origin];
      sol.order.forEach((i, k) => {
        const c = this.cands[i];
        if (this.nodeOf[i].length === 2 && c.ends) {
          const [a, b] = sol.flips[k] ? [c.ends[1], c.ends[0]] : c.ends;
          const radius = c.kind === 'bridge' ? 8 : 15;
          pts.push({ coord: a, radius }, { coord: b, radius });
        } else pts.push(this.waypoint(c));
      });
      pts.push(this.dest);
      p = getRoute(pts, this.mode, { passBy: true, signal });
      this.routes.set(key, p);
      p.catch(() => this.routes.delete(key));
    }
    return p;
  }

  /**
   * Balade complète (itinéraire réel + spots placés le long) pour une durée en minutes.
   * On vérifie le vrai tracé et on recommence (4 tracés au plus) tant que :
   * - la durée s'écarte de la demande → la matrice des temps est recalée (les durées suivantes en profitent) ;
   * - des bouts de rue sont parcourus deux fois → le spot au bout de l'aller-retour est déprécié.
   * On garde le meilleur tracé essayé.
   */
  planFor(minutes: number, signal?: AbortSignal): Promise<Plan> {
    // Un calcul à la fois : chacun peut recaler la matrice et déprécier des spots.
    const run = this.queue.then(() => this.computePlan(minutes, signal));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async computePlan(minutes: number, signal?: AbortSignal): Promise<Plan> {
    if (!this.base) throw new Error('Trajet de base manquant');
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const target = minutes * 60;
    const tol = Math.max(90, target * 0.07);
    const tried: Array<{ order: number[]; route: Route; repeated: number; predicted: number }> = [];
    this.trace = tried;
    for (let round = 0; round < 4; round++) {
      const sol = this.solve(minutes);
      if (!sol.order.length || tried.some((t) => t.order.join(',') === sol.order.join(','))) break;
      const route = await this.routeFor(sol, signal);
      const rep = this.repeated(route);
      tried.push({ order: sol.order, route, repeated: rep.length, predicted: sol.time });
      const durOk = Math.abs(route.duration - target) <= tol;
      const repOk = rep.length <= Math.max(40, route.distance * 0.02);
      if (durOk && repOk) break;
      let changed = false;
      if (!durOk && sol.time > 0) {
        const nextK = clamp(this.kAdj * clamp(route.duration / sol.time, 0.8, 1.25), 0.7, 1.4);
        if (Math.abs(nextK - this.kAdj) > 0.02) {
          const f = nextK / this.kAdj;
          this.kAdj = nextK;
          this.T = this.T.map((row) => row.map((v) => v * f));
          changed = true;
        }
      }
      if (!repOk) {
        for (const i of this.culprits(route, sol.order, rep.pairs)) {
          const id = this.cands[i].id;
          this.penalty.set(id, (this.penalty.get(id) ?? 1) * 0.2);
          // On s'en souvient pour les prochaines recherches (cul-de-sac, cour fermée…).
          cacheSet(`c:dead:${id}`, 1, 60 * 864e5);
          changed = true;
        }
      }
      if (!changed) break;
      this.sols.clear();
    }
    if (!tried.length) return this.decorate(this.base, [], minutes, false);
    // Mètres refaits (comptés double : c'est ce qui agace le plus) + écart de durée hors tolérance
    // (converti en mètres de marche) : le plus petit gagne.
    const speed = SPEED[this.mode];
    const badness = (t: (typeof tried)[number]) => 2 * t.repeated + speed * Math.max(0, Math.abs(t.route.duration - target) - tol);
    const best = tried.reduce((a, b) => (badness(b) < badness(a) ? b : a));
    return this.decorate(
      best.route,
      best.order.map((i) => this.cands[i]),
      minutes,
      true,
    );
  }

  /** Bouts de rue parcourus deux fois. Dans une boucle, sortir et rentrer par la même rue est normal : ignoré. */
  private repeated(route: Route) {
    const rep = repeatedStretches(route.coords, route.cum);
    if (!this.loop) return rep;
    const total = route.cum[route.cum.length - 1] ?? 0;
    const pairs = rep.pairs.filter(([a, b]) => !(a < 150 && b > total - 150));
    return { length: (rep.length * pairs.length) / Math.max(1, rep.pairs.length), pairs };
  }

  /** Spots au bout des allers-retours : chaque bout refait est attribué à l'étape la plus proche de son milieu. */
  private culprits(route: Route, order: number[], pairs: Array<[number, number]>): number[] {
    const { coords, cum } = route;
    let from = 0;
    const along = order.map((i) => {
      const hit = nearestOnLine(coords, cum, this.cands[i].coord, from, coords.length - 1);
      from = hit.index;
      return hit.along;
    });
    const blame = new Map<number, number>();
    for (const [a, b] of pairs) {
      const mid = (a + b) / 2;
      let bestK = -1;
      let bestD = Infinity;
      along.forEach((x, k) => {
        if (x >= a - 20 && x <= b + 20 && Math.abs(x - mid) < bestD) {
          bestD = Math.abs(x - mid);
          bestK = k;
        }
      });
      if (bestK >= 0) blame.set(bestK, (blame.get(bestK) ?? 0) + 10);
    }
    return [...blame.entries()].filter(([, m]) => m >= 30).map(([k]) => order[k]);
  }

  /** Oublie ce qui a été appris (recalage, spots dépréciés) : sert aux mesures comparatives. */
  resetLearning() {
    if (this.kAdj !== 1) {
      const f = 1 / this.kAdj;
      this.T = this.T.map((row) => row.map((v) => v * f));
      this.kAdj = 1;
    }
    this.penalty.clear();
    this.sols.clear();
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
  /** Met en cache les itinéraires de quelques durées types, sans rien recaler (le calcul principal s'en charge). */
  async prefetch(signal?: AbortSignal) {
    const marks = [5, 10, 15, 20, 30].map((d) => this.t0min + d).filter((m) => m <= this.tmaxmin);
    for (const m of marks) {
      if (signal?.aborted) return;
      const sol = this.solve(m);
      if (!sol.order.length) continue;
      try {
        await this.routeFor(sol, signal);
      } catch {
        /* préchargement facultatif */
      }
      await sleep(150);
    }
  }
}

export { ALL_ON };
