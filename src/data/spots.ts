// Les « spots » : endroits qui valent le détour, extraits des tuiles puis enrichis avec Wikipédia.
import {
  haversine,
  LocalProj,
  midpoint,
  PointGrid,
  pointInRing,
  ringArea,
  ringCentroid,
  SegmentGrid,
  tileBounds,
  lineLength,
  cumulative,
  pointAt,
  type LngLat,
} from '../lib/geo';
import { readLayer, type Props } from './tiles';
import { TileContext, type Traits } from './context';
import type { VectorTile } from '@mapbox/vector-tile';
import type { Article } from './wiki';

export type Category = 'nature' | 'patrimoine' | 'vue' | 'urbain';
export const CATEGORIES: Category[] = ['nature', 'patrimoine', 'vue', 'urbain'];

export type SpotKind =
  | 'viewpoint'
  | 'park'
  | 'garden'
  | 'green'
  | 'water'
  | 'bridge'
  | 'church'
  | 'castle'
  | 'ruins'
  | 'monument'
  | 'museum'
  | 'attraction'
  | 'townhall'
  | 'heritage'
  | 'artwork'
  | 'mural'
  | 'square'
  | 'street'
  | 'market'
  | 'landmark'
  | 'peak'
  | 'harbor'
  | 'fountain';

export interface Spot {
  id: string;
  name: string;
  /** nom local (ex. néerlandais) quand le nom affiché est la version française */
  alt?: string;
  kind: SpotKind;
  cat: Category;
  coord: LngLat;
  /** intérêt intrinsèque (0–10) avant bonus */
  base: number;
  score: number;
  area?: number;
  vibe?: number;
  photos?: number;
  wiki?: { lang: string; title: string };
  wikiLangs?: number;
  thumb?: string;
  extract?: string;
  link?: string;
  /** spot qui se traverse (pont) ou se longe (rue piétonne, berge) : ses deux bouts */
  ends?: [LngLat, LngLat];
  /** ambiance mesurée autour du spot */
  ctx?: Traits;
}

export const CATEGORY_LABEL: Record<Category, string> = {
  nature: 'Nature & eau',
  patrimoine: 'Patrimoine',
  vue: 'Points de vue',
  urbain: 'Vibe urbaine',
};

export const KIND_LABEL: Record<SpotKind, string> = {
  viewpoint: 'Point de vue',
  park: 'Parc',
  garden: 'Jardin',
  green: 'Coin de verdure',
  water: "Bord de l'eau",
  bridge: 'Pont',
  church: 'Église',
  castle: 'Château',
  ruins: 'Ruines',
  monument: 'Monument',
  museum: 'Musée',
  attraction: 'Curiosité',
  townhall: 'Hôtel de ville',
  heritage: 'Lieu historique',
  artwork: "Œuvre d'art",
  mural: 'Street art',
  square: 'Place',
  street: 'Rue piétonne',
  market: 'Marché',
  landmark: 'Lieu remarquable',
  peak: 'Hauteur',
  harbor: 'Port',
  fountain: 'Fontaine',
};

const VIBE = new Set(['cafe', 'restaurant', 'bar', 'beer', 'ice_cream', 'bakery', 'fast_food', 'clothing_store', 'shop', 'alcohol_shop', 'theatre', 'cinema', 'music', 'library']);

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const str = (v: unknown) => (v == null ? '' : String(v).trim());

function names(p: Props): { name: string; alt?: string } {
  const local = str(p.name) || str(p['name:latin']);
  const fr = str(p['name:fr']);
  if (fr && fr !== local) return { name: cap(fr), alt: local || undefined };
  return { name: cap(local) };
}

interface PoiRule {
  kind: SpotKind;
  cat: Category;
  base: number;
  needName?: boolean;
}

function poiRule(cls: string, sub: string, name: string): PoiRule | null {
  switch (sub) {
    case 'viewpoint':
      return { kind: 'viewpoint', cat: 'vue', base: 8.5 };
    case 'castle':
      return { kind: 'castle', cat: 'patrimoine', base: 8, needName: true };
    case 'ruins':
      return { kind: 'ruins', cat: 'patrimoine', base: 6.5 };
    case 'monument':
      return { kind: 'monument', cat: 'patrimoine', base: 5.5, needName: true };
    case 'memorial':
      return { kind: 'monument', cat: 'patrimoine', base: 3, needName: true };
    case 'attraction':
      return { kind: 'attraction', cat: 'patrimoine', base: 5, needName: true };
    case 'artwork':
      return /mural|graffiti|street.?art|fresque|muurschildering|wandbild/i.test(name)
        ? { kind: 'mural', cat: 'urbain', base: 4.5 }
        : { kind: 'artwork', cat: 'urbain', base: name ? 3.5 : 2.2 };
    case 'museum':
      return { kind: 'museum', cat: 'patrimoine', base: 3.8, needName: true };
    case 'gallery':
    case 'arts_centre':
      return { kind: 'artwork', cat: 'urbain', base: 3, needName: true };
    case 'fountain':
      return { kind: 'fountain', cat: 'urbain', base: 3.5 };
    case 'garden':
      return { kind: 'garden', cat: 'nature', base: 5, needName: true };
    case 'park':
      return { kind: 'park', cat: 'nature', base: 4.5, needName: true };
    case 'townhall':
      return /stadhuis|h[oô]tel de ville|town ?hall|rathaus|mairie|city hall|ayuntamiento|municipio/i.test(name)
        ? { kind: 'townhall', cat: 'patrimoine', base: 5.5 }
        : null;
    case 'marketplace':
      return { kind: 'market', cat: 'urbain', base: 4.2 };
    case 'marina':
    case 'dock':
      return { kind: 'harbor', cat: 'nature', base: 4, needName: true };
    case 'board':
      return cls === 'information' ? { kind: 'heritage', cat: 'patrimoine', base: 3.2, needName: true } : null;
    case 'archaeological_site':
      return { kind: 'heritage', cat: 'patrimoine', base: 4.5 };
    case 'city_gate':
      return { kind: 'heritage', cat: 'patrimoine', base: 5.5 };
  }
  if (cls === 'place_of_worship') return { kind: 'church', cat: 'patrimoine', base: sub === 'christian' ? 4 : 3, needName: true };
  if (cls === 'castle') return { kind: 'castle', cat: 'patrimoine', base: 7, needName: true };
  return null;
}

const GREEN_SUB = new Set(['park', 'garden', 'forest', 'wood', 'village_green', 'recreation_ground', 'grass', 'meadow', 'grassland']);
const BIG_GREEN = new Set(['park', 'garden', 'forest', 'wood', 'village_green', 'recreation_ground']);
const WALKABLE = new Set(['path', 'minor', 'service', 'track', 'tertiary', 'living_street', 'pedestrian']);
const BRIDGE_CLASSES = new Set(['path', 'minor', 'service', 'tertiary', 'secondary', 'primary', 'bridge', 'pedestrian', 'living_street', 'track']);
/** Un vrai nom de pont (« Sint Servaasbrug », « Pont Neuf »), pas la rue qui y mène (« Brugstraat »). */
const BRIDGE_NAME = /(brug|bridge|brücke|brucke)$|^(pont|puente|ponte|pons)\b/i;
/** Prestataires (bateaux, visites guidées, location…) : des points d'intérêt OSM, pas des lieux à voir. */
const OPERATOR =
  /rederij|rondvaart|boottocht|sightseeing|excursion|escape ?room|hop.on|city ?sights|(free|city|walking|bike|boat|bus|segway|food|f\(r\)ee)[ -]?tours?\b|\btours? (by|operator)|visites? guidées?|guided tours?|verhuur|rental|location de (vélos?|bateaux?)|reisbureau|office de tourisme|tourist ?info|\bvvv\b/i;

export function isOperator(name: string): boolean {
  return OPERATOR.test(name);
}

/** Noms génériques : ne comptent pas comme doublons entre eux. */
export const GENERIC_NAME = /^(point de vue|belvédère|coin de verdure|sous-bois|place piétonne|au bord de l'eau|pont)$/i;

const spotId = (kind: SpotKind, c: LngLat) => `${kind}:${c[0].toFixed(5)},${c[1].toFixed(5)}`;

/** Bout de ligne de part et d'autre de la distance `d` (± `half` m) ; rien si c'est trop court pour « se longer ». */
function segmentAround(line: LngLat[], cum: number[], d: number, half: number): [LngLat, LngLat] | undefined {
  const len = cum[cum.length - 1];
  const a = pointAt(line, cum, Math.max(0, d - half)).point;
  const b = pointAt(line, cum, Math.min(len, d + half)).point;
  return haversine(a, b) >= 40 ? [a, b] : undefined;
}

/** Les deux points les plus éloignés d'un contour (les deux bouts d'un pont dessiné en surface). */
function farthestPair(ring: LngLat[]): [LngLat, LngLat] {
  let best: [LngLat, LngLat] = [ring[0], ring[0]];
  let max = -1;
  for (let i = 0; i < ring.length; i++) {
    for (let j = i + 1; j < ring.length; j++) {
      const d = haversine(ring[i], ring[j]);
      if (d > max) {
        max = d;
        best = [ring[i], ring[j]];
      }
    }
  }
  return best;
}

/** Garde le meilleur spot (par `base`) dans chaque rayon, en ne comparant que des spots de même nature. */
export function thin(spots: Spot[], radius: number, max = Infinity): Spot[] {
  const kept: Spot[] = [];
  for (const s of [...spots].sort((a, b) => b.base - a.base)) {
    if (kept.length >= max) break;
    if (kept.some((k) => k.kind === s.kind && haversine(k.coord, s.coord) < radius)) continue;
    kept.push(s);
  }
  return kept;
}

/** Extrait les spots d'une tuile vectorielle (seuls ceux situés dans la tuile, pour éviter les doublons). */
export function extractSpots(vt: VectorTile, z: number, x: number, y: number): Spot[] {
  const [w, s, e, n] = tileBounds(x, y, z);
  const inTile = (p: LngLat) => p[0] >= w && p[0] < e && p[1] >= s && p[1] < n;
  const proj = new LocalProj([(w + e) / 2, (s + n) / 2]);
  const out: Spot[] = [];
  const add = (sp: Omit<Spot, 'id' | 'score'>) => out.push({ ...sp, id: spotId(sp.kind, sp.coord), score: sp.base });

  // --- Noms de rues (pour nommer ponts, places et belvédères) ---
  type NameRef = { name: string; subclass: string };
  const streetNames = new SegmentGrid<NameRef>(proj, 50);
  const nameFeats = readLayer(vt, 'transportation_name', x, y, z, (p) => !!p.name);
  for (const f of nameFeats) {
    const ref = { name: names(f.props).name, subclass: str(f.props.subclass) };
    for (const line of f.lines ?? []) streetNames.addLine(line, ref);
  }

  // --- POI : vie de quartier (cafés, boutiques…) puis lieux remarquables ---
  const pois = readLayer(vt, 'poi', x, y, z);
  const vibe = new PointGrid<null>(proj, 60);
  for (const f of pois) if (VIBE.has(str(f.props.class)) && f.points?.[0]) vibe.add(f.points[0], null);

  const parkPois: Array<{ coord: LngLat; name: string; alt?: string; rule: PoiRule }> = [];
  for (const f of pois) {
    const coord = f.points?.[0];
    if (!coord || !inTile(coord)) continue;
    const cls = str(f.props.class);
    const sub = str(f.props.subclass);
    const { name, alt } = names(f.props);
    if (isOperator(`${name} ${alt ?? ''}`)) continue;
    const rule = poiRule(cls, sub, `${name} ${alt ?? ''}`);
    if (!rule || (rule.needName && !name)) continue;
    if (rule.kind === 'park' || rule.kind === 'garden') {
      parkPois.push({ coord, name, alt, rule });
      continue;
    }
    let base = rule.base;
    let v: number | undefined;
    if (rule.kind === 'market') {
      v = vibe.count(coord, 70);
      base += Math.min(2, v * 0.12);
    }
    let label = name;
    if (!label && rule.kind === 'viewpoint') {
      const street = streetNames.nearest(coord, 80)?.data.name;
      label = street ? `Belvédère, ${street}` : 'Belvédère';
    }
    add({ name: label || KIND_LABEL[rule.kind], alt, kind: rule.kind, cat: rule.cat, coord, base, vibe: v });
  }

  // --- Parcs et jardins : surface du polygone vert qui contient le point ---
  const greens: Array<{ ring: LngLat[]; area: number; sub: string }> = [];
  for (const f of readLayer(vt, 'landcover', x, y, z, (p) => GREEN_SUB.has(str(p.subclass)))) {
    for (const poly of f.polys ?? []) {
      const area = ringArea(poly[0]) - poly.slice(1).reduce((acc, h) => acc + ringArea(h), 0);
      if (area > 300) greens.push({ ring: poly[0], area, sub: str(f.props.subclass) });
    }
  }
  for (const pp of parkPois) {
    let best: (typeof greens)[number] | null = null;
    for (const g of greens) if (g.area < (best?.area ?? Infinity) && pointInRing(pp.coord, g.ring)) best = g;
    const area = best?.area ?? 6000;
    let coord = pp.coord;
    if (best) {
      const c = ringCentroid(best.ring);
      if (pointInRing(c, best.ring)) coord = c;
    }
    add({
      name: pp.name,
      alt: pp.alt,
      kind: pp.rule.kind,
      cat: 'nature',
      coord,
      area,
      base: pp.rule.base + Math.min(3.5, Math.max(0, 1.6 * Math.log10(area / 4000))),
    });
  }
  for (const g of greens) {
    if (!BIG_GREEN.has(g.sub) || g.area < 15000) continue;
    if (parkPois.some((pp) => pointInRing(pp.coord, g.ring))) continue;
    const c = ringCentroid(g.ring);
    if (!inTile(c) || !pointInRing(c, g.ring)) continue;
    add({
      name: g.sub === 'forest' || g.sub === 'wood' ? 'Sous-bois' : 'Coin de verdure',
      kind: 'green',
      cat: 'nature',
      coord: c,
      area: g.area,
      base: 3 + Math.min(3, 1.4 * Math.log10(g.area / 15000)),
    });
  }

  // --- Eau : polygones (rivières, lacs, étangs) et cours d'eau ---
  type WaterRef = { cls: string; name: string; big: boolean };
  const water = new SegmentGrid<WaterRef>(proj, 50);
  for (const f of readLayer(vt, 'water', x, y, z, (p) => p.class !== 'swimming_pool' && p.brunnel !== 'tunnel')) {
    const cls = str(f.props.class);
    for (const poly of f.polys ?? []) {
      const area = ringArea(poly[0]);
      if (area < 400) continue;
      const ref = { cls, name: '', big: cls === 'river' || cls === 'ocean' || area > 40000 };
      for (const ring of poly) water.addLine(ring, ref);
    }
  }
  for (const f of readLayer(vt, 'waterway', x, y, z, (p) => ['river', 'canal', 'stream'].includes(str(p.class)) && p.brunnel !== 'tunnel')) {
    const cls = str(f.props.class);
    const { name } = names(f.props);
    if (cls === 'stream' && !name) continue;
    for (const line of f.lines ?? []) water.addLine(line, { cls, name, big: cls === 'river' });
  }
  const waterNames = new PointGrid<string>(proj, 120);
  for (const f of readLayer(vt, 'water_name', x, y, z)) {
    const { name } = names(f.props);
    for (const p of f.points ?? []) if (name) waterNames.add(p, name);
  }
  const nameOfWater = (p: LngLat, ref: WaterRef) =>
    ref.name || water.nearest(p, 400, (d) => !!d.name)?.data.name || waterNames.within(p, 300).sort((a, b) => a.dist - b.dist)[0]?.data || '';

  // --- Berges : chemins qui longent l'eau ---
  const transport = readLayer(vt, 'transportation', x, y, z, (p) => WALKABLE.has(str(p.class)) || p.brunnel === 'bridge');
  const shore: Spot[] = [];
  for (const f of transport) {
    if (f.props.brunnel || !f.lines) continue;
    const isPath = f.props.class === 'path' || f.props.class === 'track';
    for (const line of f.lines) {
      const cum = cumulative(line);
      const len = cum[cum.length - 1];
      if (!(len > 0)) continue;
      const at: number[] = [];
      if (len < 90) at.push(len / 2);
      else for (let d = 45; d < len; d += 90) at.push(d);
      for (const d of at) {
        const pt = pointAt(line, cum, d).point;
        if (!inTile(pt)) continue;
        const hit = water.nearest(pt, 30);
        if (!hit) continue;
        const wname = nameOfWater(pt, hit.data);
        const base = 4 + (hit.data.big ? 1.2 : hit.data.cls === 'canal' ? 0.8 : 0.3) + (isPath ? 0.7 : 0) - hit.dist / 60;
        // Une berge se longe : on la prend sur ~160 m de ce chemin.
        const ends = segmentAround(line, cum, d, 80);
        shore.push({ id: spotId('water', pt), name: wname || "Au bord de l'eau", kind: 'water', cat: 'nature', coord: pt, base, score: base, ends });
      }
    }
  }
  out.push(...thin(shore, 150, 30));

  // --- Ponts au-dessus de l'eau ---
  const bridges: Spot[] = [];
  for (const f of transport) {
    if (f.props.brunnel !== 'bridge' || !BRIDGE_CLASSES.has(str(f.props.class))) continue;
    const geoms = f.lines ?? (f.polys ?? []).map((pl) => pl[0]);
    for (const g of geoms) {
      if (g.length < 2) continue;
      const len = lineLength(g);
      const mid = f.lines ? midpoint(g) : ringCentroid(g);
      if (!inTile(mid)) continue;
      const hit = water.nearest(mid, 45);
      if (!hit) continue;
      const named = streetNames.nearest(mid, 30, (d) => BRIDGE_NAME.test(d.name));
      const wname = nameOfWater(mid, hit.data);
      const base = 4.5 + (f.props.class === 'path' ? 1 : 0) + (hit.data.big ? 1.2 : 0) + Math.min(1, len / 150);
      // Un pont se traverse : on garde ses deux bouts (une rive, l'autre).
      const ends = f.lines ? ([g[0], g[g.length - 1]] as [LngLat, LngLat]) : farthestPair(g);
      bridges.push({
        id: spotId('bridge', mid),
        name: named?.data.name || (wname ? `Pont sur ${wname}` : 'Pont'),
        kind: 'bridge',
        cat: 'vue',
        coord: mid,
        base,
        score: base,
        ends: haversine(ends[0], ends[1]) >= 25 ? ends : undefined,
      });
    }
  }
  out.push(...thin(bridges, 60));

  // --- Places piétonnes ---
  for (const f of transport) {
    if (f.props.class !== 'path' || f.props.subclass !== 'pedestrian' || !f.polys) continue;
    for (const poly of f.polys) {
      const area = ringArea(poly[0]);
      if (area < 1200) continue;
      const c = ringCentroid(poly[0]);
      if (!inTile(c)) continue;
      const v = vibe.count(c, 70);
      const named = streetNames.nearest(c, 60, (d) => d.subclass === 'pedestrian');
      add({
        name: named?.data.name || 'Place piétonne',
        kind: 'square',
        cat: 'urbain',
        coord: c,
        area,
        vibe: v,
        base: 3.6 + Math.min(1.5, Math.log10(area / 1200)) + Math.min(2, v * 0.12),
      });
    }
  }

  // --- Rues piétonnes animées ---
  for (const f of nameFeats) {
    if (f.props.subclass !== 'pedestrian') continue;
    const { name, alt } = names(f.props);
    for (const line of f.lines ?? []) {
      const cum = cumulative(line);
      const len = cum[cum.length - 1];
      if (!(len >= 50)) continue;
      const at = len > 350 ? [len / 3, (2 * len) / 3] : [len / 2];
      for (const d of at) {
        const pt = pointAt(line, cum, d).point;
        if (!inTile(pt)) continue;
        const v = vibe.count(pt, 45);
        // Une rue piétonne se parcourt : jusqu'à ~260 m autour du point.
        const ends = segmentAround(line, cum, d, Math.min(130, len / 2));
        add({ name, alt, kind: 'street', cat: 'urbain', coord: pt, vibe: v, base: 3 + Math.min(2.5, v * 0.13), ends });
      }
    }
  }

  // Ambiance autour de chaque spot (eau, verdure, vieilles pierres…) : sert à proposer des lieux qui
  // ressemblent à ceux que tu as aimés.
  const ambience = new TileContext(vt, z, x, y);
  for (const sp of out) sp.ctx = ambience.at(sp.coord);
  return out;
}

// ---- Fusion entre tuiles ----

export function normalizeName(s: string): string[] {
  const STOP = new Set([
    'de', 'het', 'van', 'la', 'le', 'les', 'du', 'des', 'the', 'of', 'and', 'et', 'en', 'der', 'die', 'das', 'sint', 'saint', 'sainte', 'st', 'ste', 'onze', 'lieve',
    'kerk', 'eglise', 'church', 'kirche', 'iglesia', 'chiesa', 'maastricht',
  ]);
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

function similarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  let hit = 0;
  for (const t of a) if (b.some((u) => u === t || (t.length >= 5 && u.length >= 5 && (u.includes(t) || t.includes(u))))) hit++;
  return hit / Math.min(a.length, b.length);
}

/** Supprime les doublons (même endroit vu dans deux tuiles, ou même nom tout proche). */
export function dedupe(spots: Spot[]): Spot[] {
  const byId = new Map<string, Spot>();
  for (const s of spots) if (!byId.has(s.id) || byId.get(s.id)!.base < s.base) byId.set(s.id, s);
  const sorted = [...byId.values()].sort((a, b) => b.base - a.base);
  const kept: Spot[] = [];
  const proj = new LocalProj(sorted[0]?.coord ?? [0, 0]);
  const grid = new PointGrid<Spot>(proj, 80);
  for (const s of sorted) {
    const near = grid.within(s.coord, 60);
    const dup = near.some(({ dist, data: k }) => (k.kind === s.kind && dist < 35) || (k.name === s.name && s.name.length > 3 && dist < 60));
    if (dup) continue;
    kept.push(s);
    grid.add(s.coord, s);
  }
  return kept;
}

// ---- Wikipédia : notoriété des spots et lieux remarquables manquants ----

/** Spots qu'on peut rattacher à un article tout proche même sans nom ressemblant (un bâtiment, un monument). */
const WEAK_KINDS = new Set<SpotKind>(['church', 'castle', 'ruins', 'monument', 'attraction', 'museum', 'townhall', 'heritage', 'viewpoint']);
const AREA_KINDS = new Set<SpotKind>(['park', 'garden', 'green', 'square', 'water']);
const LANG_RANK: Record<string, number> = { fr: 0, en: 1 };
const SKIP_TITLE = /^(liste|list of|bataille|battle of|siège|siege of|traité|treaty of|histoire|history of|gare |station )/i;
/** « Wyck, Maastricht » : convention anglaise pour un quartier ou un village, pas un lieu précis. */
const PLACE_COMMA = /^[^,()]+, [A-ZÀ-Ý][\p{L}' -]+$/u;
/** Articles géolocalisés qui ne sont pas des lieux à voir en passant. */
const NOT_A_PLACE =
  /^chez |restaurant|h[oô]tel(?! de ville)|hotel|caf[eé]\b|brasserie|winkel|store|boutique|boulangerie|bakery|formation|district|quartier|neighbou?rhood|wijk|province|municipality|commune|university|université|universiteit|school|école|academy|académie|academie|conservato|hogeschool|college|hospital|hôpital|ziekenhuis/i;
const SKIP_TYPES = new Set(['city', 'adm1st', 'adm2nd', 'adm3rd', 'country', 'edu', 'railwaystation', 'airport', 'event', 'satellite', 'state']);
/** Types d'articles qui deviennent un spot s'ils n'en recoupent aucun : monuments, sommets, plans d'eau, forêts. */
const CREATE_TYPES = new Set(['landmark', 'mountain', 'waterbody', 'forest', 'isle']);

/**
 * Associe les articles aux spots proches au nom ressemblant (bonus de notoriété), puis crée des spots
 * « lieu remarquable » pour les articles en français/anglais sans spot correspondant.
 */
export function enrichWithWiki(spots: Spot[], articles: Article[], creationLangs: string[]): Spot[] {
  if (!spots.length && !articles.length) return spots;
  const proj = new LocalProj(spots[0]?.coord ?? articles[0].coord);
  const grid = new PointGrid<Spot>(proj, 100);
  spots.forEach((s) => grid.add(s.coord, s));
  const langsBySpot = new Map<string, Set<string>>();
  const created: Array<Spot & { langs: Set<string> }> = [];

  for (const a of articles) {
    if (a.type && SKIP_TYPES.has(a.type)) continue;
    const at = normalizeName(a.title);
    let best: { s: Spot; score: number } | null = null;
    for (const { dist, data: s } of grid.within(a.coord, 160)) {
      if (dist > (AREA_KINDS.has(s.kind) ? 160 : 80)) continue;
      const sim = Math.max(similarity(at, normalizeName(s.name)), s.alt ? similarity(at, normalizeName(s.alt)) : 0);
      const ok = sim >= 0.34 || (dist <= 25 && WEAK_KINDS.has(s.kind) && a.type === 'landmark' && !NOT_A_PLACE.test(a.title));
      if (!ok) continue;
      const score = sim - dist / 200;
      if (!best || score > best.score) best = { s, score };
    }
    if (best) {
      const s = best.s;
      if (!s.wiki || (LANG_RANK[a.lang] ?? 9) < (LANG_RANK[s.wiki.lang] ?? 9)) s.wiki = { lang: a.lang, title: a.title };
      const set = langsBySpot.get(s.id) ?? new Set<string>();
      set.add(a.lang);
      langsBySpot.set(s.id, set);
      continue;
    }
    if (!creationLangs.includes(a.lang) || !CREATE_TYPES.has(a.type ?? '') || SKIP_TITLE.test(a.title) || NOT_A_PLACE.test(a.title) || PLACE_COMMA.test(a.title) || isOperator(a.title)) continue;
    // Un article sur un objet dans une église ou un musée déjà repéré : le lieu suffit.
    if (grid.within(a.coord, 40).some(({ data }) => WEAK_KINDS.has(data.kind))) continue;
    const name = a.title.replace(/\s*\(.*\)\s*$/, '');
    const same = created.find((c) => haversine(c.coord, a.coord) < 50 || (similarity(normalizeName(c.name), at) >= 0.5 && haversine(c.coord, a.coord) < 250));
    if (same) {
      same.langs.add(a.lang);
      if ((LANG_RANK[a.lang] ?? 9) < (LANG_RANK[same.wiki!.lang] ?? 9)) {
        same.wiki = { lang: a.lang, title: a.title };
        same.name = name;
      }
      continue;
    }
    const kind: SpotKind = a.type === 'mountain' ? 'peak' : a.type === 'waterbody' ? 'water' : a.type === 'forest' ? 'green' : 'landmark';
    const cat: Category = kind === 'peak' ? 'vue' : kind === 'landmark' ? 'patrimoine' : 'nature';
    created.push({ id: spotId(kind, a.coord), name, kind, cat, coord: a.coord, base: 5, score: 5, wiki: { lang: a.lang, title: a.title }, langs: new Set([a.lang]) });
  }

  for (const s of spots) {
    const set = langsBySpot.get(s.id);
    if (set) s.wikiLangs = set.size;
  }
  const extra: Spot[] = created.map(({ langs, ...s }) => ({ ...s, wikiLangs: langs.size, base: s.base + (langs.size > 1 ? 1 : 0) }));
  return [...spots, ...extra];
}

/** Score final d'un spot selon ses bonus et les ambiances choisies. */
export function scoreSpot(s: Spot, prefs?: Record<Category, boolean>): number {
  const wiki = s.wiki ? 1.3 + 0.12 * Math.min(3, (s.wikiLangs ?? 1) - 1) : 1;
  const photos = 1 + 0.42 * Math.log10(1 + (s.photos ?? 0));
  const pref = !prefs || prefs[s.cat] ? 1 : 0.12;
  return s.base * wiki * photos * pref;
}
