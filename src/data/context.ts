// Ambiance d'un lieu : ce qu'il y a autour (eau, verdure, vieilles pierres, vue, animation, calme, art),
// calculée sur les tuiles de la carte. Sert à comprendre pourquoi un endroit plaît et à en trouver d'autres.
import type { VectorTile } from '@mapbox/vector-tile';
import { cumulative, LocalProj, lngLatToTile, PointGrid, pointAt, pointInRing, ringArea, SegmentGrid, tileBounds, type LngLat } from '../lib/geo';
import { fetchTile, readLayer } from './tiles';
import type { Spot, SpotKind } from './spots';

export type Trait = 'eau' | 'verdure' | 'patrimoine' | 'vue' | 'animation' | 'calme' | 'art';
export const TRAITS: Trait[] = ['eau', 'verdure', 'patrimoine', 'vue', 'animation', 'calme', 'art'];
export type Traits = Record<Trait, number>;

/** Pour une phrase : « Tu aimes … » */
export const TRAIT_LABEL: Record<Trait, string> = {
  eau: "le bord de l'eau",
  verdure: 'la verdure',
  patrimoine: 'les vieilles pierres',
  vue: 'la vue',
  animation: "l'animation",
  calme: 'le calme',
  art: "l'art dans la rue",
};

export const TRAIT_SHORT: Record<Trait, string> = {
  eau: 'Eau',
  verdure: 'Verdure',
  patrimoine: 'Patrimoine',
  vue: 'Vue',
  animation: 'Animation',
  calme: 'Calme',
  art: 'Art de rue',
};

/** Rayon (m) de ce qu'on « ressent » autour d'un point. */
export const AMBIENCE_RADIUS = 110;

const str = (v: unknown) => (v == null ? '' : String(v));
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** 0 → 0, puis tend vers 1 : n éléments « valent » 63 % quand n = k. */
const sat = (n: number, k: number) => 1 - Math.exp(-n / k);
const round2 = (v: number) => Math.round(v * 100) / 100;

const VIBE = new Set(['cafe', 'restaurant', 'bar', 'beer', 'ice_cream', 'bakery', 'fast_food', 'clothing_store', 'shop', 'alcohol_shop', 'theatre', 'cinema', 'music', 'library']);
const HERITAGE: Record<string, number> = {
  monument: 1,
  memorial: 0.5,
  ruins: 1.5,
  castle: 2,
  museum: 0.8,
  attraction: 0.8,
  board: 0.6,
  archaeological_site: 1,
  city_gate: 1.5,
  townhall: 1,
};
const GREEN_SUB = new Set(['park', 'garden', 'forest', 'wood', 'village_green', 'recreation_ground', 'grass', 'meadow', 'grassland']);
const TRAFFIC: Record<string, number> = { motorway: 1.5, trunk: 1.3, primary: 1, secondary: 0.8, busway: 0.8, tertiary: 0.5, minor: 0.15 };

interface Green {
  ring: LngLat[];
  b: [number, number, number, number];
}

/** Index des éléments d'une tuile, pour mesurer l'ambiance de n'importe quel point de la tuile. */
export class TileContext {
  private water: SegmentGrid<{ big: boolean }>;
  private greens: Green[] = [];
  private heritage: PointGrid<number>;
  private vibe: PointGrid<null>;
  private art: PointGrid<null>;
  private views: PointGrid<null>;
  private bridges: SegmentGrid<null>;
  private traffic: PointGrid<number>;
  private paths: SegmentGrid<null>;

  constructor(vt: VectorTile, z: number, x: number, y: number) {
    const [w, s, e, n] = tileBounds(x, y, z);
    const proj = new LocalProj([(w + e) / 2, (s + n) / 2]);
    this.water = new SegmentGrid(proj, 50);
    this.heritage = new PointGrid(proj, 60);
    this.vibe = new PointGrid(proj, 60);
    this.art = new PointGrid(proj, 60);
    this.views = new PointGrid(proj, 60);
    this.bridges = new SegmentGrid(proj, 50);
    this.traffic = new PointGrid(proj, 60);
    this.paths = new SegmentGrid(proj, 50);

    for (const f of readLayer(vt, 'water', x, y, z, (p) => p.class !== 'swimming_pool' && p.brunnel !== 'tunnel')) {
      for (const poly of f.polys ?? []) {
        const area = ringArea(poly[0]);
        if (area < 300) continue;
        const big = str(f.props.class) === 'river' || area > 40000;
        for (const ring of poly) this.water.addLine(ring, { big });
      }
    }
    for (const f of readLayer(vt, 'waterway', x, y, z, (p) => ['river', 'canal', 'stream'].includes(str(p.class)) && p.brunnel !== 'tunnel')) {
      for (const line of f.lines ?? []) this.water.addLine(line, { big: str(f.props.class) !== 'stream' });
    }

    for (const f of readLayer(vt, 'landcover', x, y, z, (p) => GREEN_SUB.has(str(p.subclass)) || p.class === 'wood')) {
      for (const poly of f.polys ?? []) this.addGreen(poly[0]);
    }
    for (const f of readLayer(vt, 'park', x, y, z)) for (const poly of f.polys ?? []) this.addGreen(poly[0]);
    for (const f of readLayer(vt, 'landuse', x, y, z, (p) => p.class === 'cemetery' || p.class === 'grass')) {
      for (const poly of f.polys ?? []) this.addGreen(poly[0]);
    }

    for (const f of readLayer(vt, 'poi', x, y, z)) {
      const p = f.points?.[0];
      if (!p) continue;
      const cls = str(f.props.class);
      const sub = str(f.props.subclass);
      if (VIBE.has(cls)) this.vibe.add(p, null);
      const h = HERITAGE[sub] ?? (cls === 'place_of_worship' ? 1 : cls === 'castle' ? 2 : 0);
      if (h) this.heritage.add(p, h);
      if (sub === 'artwork' || sub === 'fountain') this.art.add(p, null);
      if (sub === 'viewpoint') this.views.add(p, null);
    }
    for (const f of readLayer(vt, 'mountain_peak', x, y, z)) for (const p of f.points ?? []) this.views.add(p, null);

    for (const f of readLayer(vt, 'transportation', x, y, z)) {
      const cls = str(f.props.class);
      for (const line of f.lines ?? []) {
        if (f.props.brunnel === 'bridge' && cls !== 'rail' && cls !== 'transit') this.bridges.addLine(line, null);
        const weight = TRAFFIC[cls];
        if (weight && f.props.brunnel !== 'tunnel') {
          const cum = cumulative(line);
          const len = cum[cum.length - 1];
          for (let d = 10; d < len; d += 20) this.traffic.add(pointAt(line, cum, d).point, weight);
        }
        if (cls === 'path' || cls === 'track') this.paths.addLine(line, null);
      }
      if (cls === 'path') for (const poly of f.polys ?? []) this.paths.addLine(poly[0], null);
    }
  }

  private addGreen(ring: LngLat[]) {
    if (ring.length < 4) return;
    let w = Infinity;
    let s = Infinity;
    let e = -Infinity;
    let n = -Infinity;
    for (const [x, y] of ring) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
    this.greens.push({ ring, b: [w, s, e, n] });
  }

  /** Ambiance (0 à 1 pour chaque trait) dans un rayon `R` autour du point. */
  at(p: LngLat, R = AMBIENCE_RADIUS): Traits {
    const near = this.water.nearest(p, R);
    const eau = near ? clamp01((1 - near.dist / R) * (near.data.big ? 1 : 0.7)) : 0;

    // Verdure : part des points d'une petite grille autour du lieu qui tombent dans un espace vert.
    const proj = new LocalProj(p);
    let inside = 0;
    let total = 0;
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        const dx = (i / 2) * R * 0.8;
        const dy = (j / 2) * R * 0.8;
        if (dx * dx + dy * dy > (R * 0.85) ** 2) continue;
        total++;
        const q = proj.toLngLat(dx, dy);
        if (this.greens.some((g) => q[0] >= g.b[0] && q[0] <= g.b[2] && q[1] >= g.b[1] && q[1] <= g.b[3] && pointInRing(q, g.ring))) inside++;
      }
    }
    const verdure = total ? Math.sqrt(inside / total) : 0;

    // Une basilique ou un rempart se voit de plus loin qu'une terrasse : rayon plus large.
    const heritage = this.heritage.within(p, R * 1.6).reduce((acc, h) => acc + h.data * (1 - h.dist / (R * 2)), 0);
    const patrimoine = sat(heritage, 1.8);

    const viewpoint = this.views.within(p, R).reduce((m, v) => Math.max(m, 1 - v.dist / R), 0);
    // Un pont n'ouvre la vue que s'il passe au-dessus de l'eau (pas un pont routier ou ferroviaire).
    const onBridge = near && near.dist < 60 && this.bridges.nearest(p, 35) ? 0.75 : 0;
    const openWater = near && near.data.big && near.dist < 50 ? 0.55 : 0;
    const vue = Math.max(viewpoint, onBridge, openWater);

    const nearPath = !!this.paths.nearest(p, 30);
    const animation = clamp01(sat(this.vibe.count(p, R), 9) + (nearPath ? 0.08 : 0));

    // Calme : peu de circulation (mètres de grands axes pondérés) et pas trop de monde.
    const traffic = this.traffic.within(p, R).reduce((acc, r) => acc + r.data * 20 * (1 - r.dist / (R * 1.2)), 0);
    const calme = clamp01(Math.exp(-traffic / 220) + (nearPath ? 0.12 : 0) - 0.3 * animation);

    const art = sat(this.art.count(p, R), 3);
    return roundTraits({ eau, verdure, patrimoine, vue, animation, calme, art });
  }
}

export function roundTraits(t: Traits): Traits {
  const out = {} as Traits;
  for (const k of TRAITS) out[k] = round2(t[k]);
  return out;
}

export const ZERO_TRAITS: Traits = { eau: 0, verdure: 0, patrimoine: 0, vue: 0, animation: 0, calme: 0, art: 0 };

/** Ambiance probable d'un spot dont on n'a pas mesuré les alentours (ex. lieu venu de Wikipédia). */
export function defaultTraits(kind: SpotKind): Traits {
  const t = { ...ZERO_TRAITS };
  switch (kind) {
    case 'water':
    case 'harbor':
      return { ...t, eau: 0.9, calme: 0.5, vue: 0.4 };
    case 'park':
    case 'garden':
    case 'green':
      return { ...t, verdure: 0.9, calme: 0.6 };
    case 'bridge':
      return { ...t, eau: 0.7, vue: 0.8 };
    case 'viewpoint':
    case 'peak':
      return { ...t, vue: 1, calme: 0.5 };
    case 'street':
    case 'square':
    case 'market':
      return { ...t, animation: 0.8, patrimoine: 0.4 };
    case 'artwork':
    case 'mural':
      return { ...t, art: 1, animation: 0.3 };
    case 'fountain':
      return { ...t, art: 0.5, animation: 0.4 };
    default:
      return { ...t, patrimoine: 0.9 };
  }
}

export const traitsOf = (s: Spot): Traits => s.ctx ?? defaultTraits(s.kind);

const memo = new Map<string, Promise<TileContext>>();

/** Ambiance autour d'un point quelconque (une tuile à lire, souvent déjà dans le cache du navigateur). */
export async function ambienceAt(p: LngLat, signal?: AbortSignal): Promise<Traits> {
  const [x, y] = lngLatToTile(p, 14);
  const key = `${x}/${y}`;
  let ctx = memo.get(key);
  if (!ctx) {
    ctx = fetchTile(14, x, y, signal).then((vt) => new TileContext(vt, 14, x, y));
    memo.set(key, ctx);
    ctx.catch(() => memo.delete(key));
  }
  return (await ctx).at(p);
}
