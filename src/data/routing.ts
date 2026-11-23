// Itinéraires et matrices de temps.
// - Itinéraire : Valhalla (instructions en français, 10 points max), repli OSRM.
// - Matrice : OSRM (jusqu'à ~60 points), repli Valhalla par morceaux de 100 paires, puis estimation.
import { bearing, cumulative, decodePolyline, haversine, pointAt, type LngLat } from '../lib/geo';
import { fetchJSON, isAbort, pool, postJSON } from '../lib/http';

export type Mode = 'walk' | 'bike';

export type Turn =
  | 'depart'
  | 'arrive'
  | 'straight'
  | 'slight-left'
  | 'left'
  | 'sharp-left'
  | 'slight-right'
  | 'right'
  | 'sharp-right'
  | 'uturn'
  | 'roundabout'
  | 'steps'
  | 'ferry'
  | 'merge';

export interface Maneuver {
  turn: Turn;
  text: string;
  /** phrase d'annonce (« Tournez à gauche sur… ») pour la voix */
  verbal?: string;
  street?: string;
  distance: number;
  duration: number;
  /** indices de début et fin dans `coords` */
  begin: number;
  end: number;
}

export interface Route {
  coords: LngLat[];
  cum: number[];
  duration: number;
  distance: number;
  maneuvers: Maneuver[];
  engine: 'valhalla' | 'osrm' | 'direct';
}

const VALHALLA = 'https://valhalla1.openstreetmap.de';
const OSRM_HOST = 'https://routing.openstreetmap.de';
const OSRM_PROFILE: Record<Mode, [string, string]> = { walk: ['routed-foot', 'foot'], bike: ['routed-bike', 'bike'] };

/** Vitesses moyennes (m/s) pour les estimations et l'aperçu. */
export const SPEED: Record<Mode, number> = { walk: 1.38, bike: 4.3 };
/**
 * Points de passage au plus entre départ et arrivée (un pont, une rue ou une berge en compte deux).
 * Au-delà de 8, l'itinéraire est demandé en plusieurs morceaux (limite Valhalla : 10 points par demande).
 */
export const MAX_STOPS = 18;

// Même réglage pour le trajet le plus court et la balade : ce sont les spots qui font passer par les
// beaux coins. Favoriser les allées piétonnes fait zigzaguer entre trottoirs et rue (instructions
// absurdes, trajets plus longs que prévu), on l'a donc retiré.
function costing(mode: Mode) {
  if (mode === 'walk') return { costing: 'pedestrian', costing_options: { pedestrian: { alley_factor: 1.5, driveway_factor: 5 } } };
  return {
    costing: 'bicycle',
    costing_options: { bicycle: { bicycle_type: 'Hybrid', cycling_speed: 16, use_roads: 0.3, use_hills: 0.35, avoid_bad_surfaces: 0.35, use_living_streets: 0.7 } },
  };
}

function vTurn(t: number): Turn {
  switch (t) {
    case 1:
    case 2:
    case 3:
      return 'depart';
    case 4:
    case 5:
    case 6:
      return 'arrive';
    case 9:
    case 18:
    case 20:
    case 23:
      return 'slight-right';
    case 10:
      return 'right';
    case 11:
      return 'sharp-right';
    case 12:
    case 13:
      return 'uturn';
    case 14:
      return 'sharp-left';
    case 15:
      return 'left';
    case 16:
    case 19:
    case 21:
    case 24:
      return 'slight-left';
    case 25:
    case 37:
    case 38:
      return 'merge';
    case 26:
    case 27:
      return 'roundabout';
    case 28:
    case 29:
      return 'ferry';
    case 40:
      return 'steps';
    default:
      return 'straight';
  }
}

interface ValhallaManeuver {
  type: number;
  instruction: string;
  verbal_pre_transition_instruction?: string;
  street_names?: string[];
  begin_street_names?: string[];
  length: number;
  time: number;
  begin_shape_index: number;
  end_shape_index: number;
}

interface ValhallaRoute {
  trip: { summary: { time: number; length: number }; legs: Array<{ shape: string; maneuvers: ValhallaManeuver[] }> };
}

/** Étape d'un itinéraire : un point, ou un spot devant lequel il suffit de passer (à `radius` mètres près). */
export interface Waypoint {
  coord: LngLat;
  radius?: number;
}
export type RoutePoint = LngLat | Waypoint;
const coordOf = (p: RoutePoint): LngLat => (Array.isArray(p) ? p : p.coord);

interface PassOpts {
  /** il suffit de passer à `radius` mètres des étapes (n'importe quelle rue proche convient) */
  passBy: boolean;
  /** pas de demi-tour sur les étapes */
  noUturn: boolean;
}

/** Le serveur Valhalla gratuit accepte 10 points par itinéraire : au-delà, on découpe. */
const VALHALLA_MAX_POINTS = 10;

/** Itinéraire Valhalla de n'importe quelle longueur : morceaux de 10 points raccordés dans le sens de la marche. */
async function valhallaLong(points: RoutePoint[], mode: Mode, opts: PassOpts, signal?: AbortSignal): Promise<Route> {
  if (points.length <= VALHALLA_MAX_POINTS) return valhallaRoute(points, mode, opts, signal);
  const parts: Route[] = [];
  let heading: number | undefined;
  for (let start = 0; start < points.length - 1; start += VALHALLA_MAX_POINTS - 1) {
    const end = Math.min(points.length - 1, start + VALHALLA_MAX_POINTS - 1);
    // Les points de raccord sont exacts (même rue dans les deux morceaux) ; le second morceau repart
    // dans la direction d'arrivée du premier pour ne pas faire demi-tour au raccord.
    const chunk = points.slice(start, end + 1).map((p, i, arr) => (i === 0 || i === arr.length - 1 ? coordOf(p) : p));
    const r = await valhallaRoute(chunk, mode, opts, signal, heading);
    parts.push(r);
    const total = r.cum[r.cum.length - 1] ?? 0;
    heading = r.coords.length >= 2 ? bearing(pointAt(r.coords, r.cum, Math.max(0, total - 20)).point, r.coords[r.coords.length - 1]) : undefined;
  }
  return mergeRoutes(parts);
}

function mergeRoutes(parts: Route[]): Route {
  const coords: LngLat[] = [];
  const maneuvers: Maneuver[] = [];
  let duration = 0;
  let distance = 0;
  parts.forEach((r, pi) => {
    const offset = coords.length ? coords.length - 1 : 0;
    coords.push(...(coords.length ? r.coords.slice(1) : r.coords));
    r.maneuvers.forEach((m, mi) => {
      if (pi < parts.length - 1 && mi === r.maneuvers.length - 1 && m.turn === 'arrive') return;
      if (pi > 0 && mi === 0 && m.turn === 'depart') return;
      maneuvers.push({ ...m, begin: m.begin + offset, end: m.end + offset });
    });
    duration += r.duration;
    distance += r.distance;
  });
  return { coords, cum: cumulative(coords), duration, distance, maneuvers, engine: parts[0].engine };
}

async function valhallaRoute(points: RoutePoint[], mode: Mode, { passBy, noUturn }: PassOpts, signal?: AbortSignal, startHeading?: number): Promise<Route> {
  const body = {
    locations: points.map((p, i) => {
      const [lon, lat] = coordOf(p);
      const end = i === 0 || i === points.length - 1;
      // Avec un rayon et sans classement des rues candidates, Valhalla prend la rue la plus commode
      // à moins de `radius` mètres du spot. « through » interdit en plus le demi-tour sur l'étape.
      const loc: Record<string, unknown> = { lon: +lon.toFixed(6), lat: +lat.toFixed(6), type: end ? 'break' : noUturn ? 'through' : 'via' };
      if (!end && passBy && !Array.isArray(p) && p.radius) {
        loc.radius = p.radius;
        loc.rank_candidates = false;
      }
      if (i === 0 && startHeading !== undefined) {
        loc.heading = Math.round(startHeading);
        loc.heading_tolerance = 70;
      }
      return loc;
    }),
    ...costing(mode),
    directions_options: { language: 'fr-FR', units: 'kilometers' },
  };
  const j = await postJSON<ValhallaRoute>(`${VALHALLA}/route`, body, { signal, timeout: 15000 });
  const coords: LngLat[] = [];
  const maneuvers: Maneuver[] = [];
  for (const leg of j.trip.legs) {
    const shape = decodePolyline(leg.shape, 6);
    const offset = coords.length ? coords.length - 1 : 0;
    coords.push(...(coords.length ? shape.slice(1) : shape));
    for (const m of leg.maneuvers) {
      maneuvers.push({
        turn: vTurn(m.type),
        text: m.instruction,
        verbal: m.verbal_pre_transition_instruction,
        street: m.street_names?.[0] ?? m.begin_street_names?.[0],
        distance: m.length * 1000,
        duration: m.time,
        begin: m.begin_shape_index + offset,
        end: m.end_shape_index + offset,
      });
    }
  }
  return { coords, cum: cumulative(coords), duration: j.trip.summary.time, distance: j.trip.summary.length * 1000, maneuvers: dropJitter(maneuvers), engine: 'valhalla' };
}

/** Retire les micro-instructions sur des allées sans nom (on change de trottoir) : le tracé ne change pas. */
export function dropJitter(maneuvers: Maneuver[]): Maneuver[] {
  return maneuvers.filter((m, i) => i === 0 || i === maneuvers.length - 1 || m.turn === 'arrive' || m.turn === 'depart' || m.street || m.distance >= 15);
}

// ---- OSRM (repli) : on fabrique nous-mêmes les instructions en français ----

const MOD_FR: Record<string, string> = {
  left: 'à gauche',
  right: 'à droite',
  'slight left': 'légèrement à gauche',
  'slight right': 'légèrement à droite',
  'sharp left': 'franchement à gauche',
  'sharp right': 'franchement à droite',
  straight: 'tout droit',
};

interface OsrmStep {
  name: string;
  distance: number;
  duration: number;
  geometry: { coordinates: LngLat[] };
  maneuver: { type: string; modifier?: string; exit?: number };
}

function oTurn(m: OsrmStep['maneuver']): Turn {
  if (m.type === 'depart') return 'depart';
  if (m.type === 'arrive') return 'arrive';
  if (m.type === 'roundabout' || m.type === 'rotary' || m.type === 'roundabout turn') return 'roundabout';
  switch (m.modifier) {
    case 'left':
      return 'left';
    case 'right':
      return 'right';
    case 'slight left':
      return 'slight-left';
    case 'slight right':
      return 'slight-right';
    case 'sharp left':
      return 'sharp-left';
    case 'sharp right':
      return 'sharp-right';
    case 'uturn':
      return 'uturn';
    default:
      return 'straight';
  }
}

function oText(st: OsrmStep): string {
  const { type, modifier, exit } = st.maneuver;
  const on = st.name ? ` sur ${st.name}` : '';
  if (type === 'depart') return `Partez${on}.`;
  if (type === 'arrive') return 'Vous êtes arrivé à destination.';
  if (type === 'roundabout' || type === 'rotary') return `Au rond-point, prenez la ${exit === 1 ? '1re' : `${exit ?? 1}e`} sortie${on}.`;
  if (modifier === 'uturn') return `Faites demi-tour${on}.`;
  if (type === 'new name' || type === 'continue' || modifier === 'straight' || !modifier) return `Continuez${on || ' tout droit'}.`;
  return `Tournez ${MOD_FR[modifier] ?? ''}${on}.`;
}

async function osrmRoute(points: RoutePoint[], mode: Mode, passBy: boolean, signal?: AbortSignal): Promise<Route> {
  const [svc, prof] = OSRM_PROFILE[mode];
  const path = points
    .map(coordOf)
    .map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`)
    .join(';');
  const url = `${OSRM_HOST}/${svc}/route/v1/${prof}/${path}?overview=false&geometries=geojson&steps=true&continue_straight=${passBy}`;
  const j = await fetchJSON<{ code: string; message?: string; routes?: Array<{ duration: number; distance: number; legs: Array<{ steps: OsrmStep[] }> }> }>(
    url,
    { signal, timeout: 15000 },
  );
  if (j.code !== 'Ok' || !j.routes?.length) throw new Error(j.message || 'Itinéraire introuvable');
  const r = j.routes[0];
  const coords: LngLat[] = [];
  const maneuvers: Maneuver[] = [];
  r.legs.forEach((leg, li) => {
    for (const st of leg.steps) {
      const g = st.geometry.coordinates;
      const begin = coords.length ? coords.length - 1 : 0;
      coords.push(...(coords.length ? g.slice(1) : g));
      const t = st.maneuver.type;
      if ((t === 'arrive' && li < r.legs.length - 1) || (t === 'depart' && li > 0)) continue;
      maneuvers.push({ turn: oTurn(st.maneuver), text: oText(st), street: st.name || undefined, distance: st.distance, duration: st.duration, begin, end: coords.length - 1 });
    }
  });
  return { coords, cum: cumulative(coords), duration: r.duration, distance: r.distance, maneuvers, engine: 'osrm' };
}

/**
 * Itinéraire passant par les points dans l'ordre. `passBy` : il suffit de passer près des spots ;
 * `noUturn` : sans demi-tour sur les étapes. Si le serveur refuse, on retombe sur un passage simple.
 */
export async function getRoute(
  points: RoutePoint[],
  mode: Mode,
  opts: { passBy?: boolean; noUturn?: boolean; signal?: AbortSignal } = {},
): Promise<Route> {
  const multi = points.length > 2;
  const tries: PassOpts[] = [{ passBy: multi && !!opts.passBy, noUturn: multi && !!opts.noUturn }];
  if (tries[0].noUturn) tries.push({ passBy: tries[0].passBy, noUturn: false });
  if (tries[0].passBy) tries.push({ passBy: false, noUturn: false });
  let error: unknown;
  for (const t of tries) {
    try {
      return await valhallaLong(points, mode, t, opts.signal);
    } catch (e) {
      if (isAbort(e)) throw e;
      error = error ?? e;
    }
  }
  console.warn('[flane] Valhalla indisponible, repli OSRM', error);
  return osrmRoute(points, mode, multi && !!opts.noUturn, opts.signal);
}

// ---- Matrices de temps ----

async function osrmTable(points: LngLat[], mode: Mode, signal?: AbortSignal): Promise<number[][]> {
  const [svc, prof] = OSRM_PROFILE[mode];
  const path = points.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(';');
  const j = await fetchJSON<{ code: string; durations?: Array<Array<number | null>> }>(`${OSRM_HOST}/${svc}/table/v1/${prof}/${path}?annotations=duration`, {
    signal,
    timeout: 20000,
  });
  if (j.code !== 'Ok' || !j.durations) throw new Error('matrice OSRM');
  return j.durations.map((row) => row.map((v) => (v == null ? Infinity : v)));
}

async function valhallaMatrix(points: LngLat[], mode: Mode, signal?: AbortSignal): Promise<number[][]> {
  const n = points.length;
  const locs = points.map((p) => ({ lon: +p[0].toFixed(6), lat: +p[1].toFixed(6) }));
  const rows = Math.max(1, Math.floor(100 / n));
  const chunks: Array<[number, number]> = [];
  for (let i = 0; i < n; i += rows) chunks.push([i, Math.min(n, i + rows)]);
  const out: number[][] = new Array(n);
  await pool(chunks, 3, async ([a, b]) => {
    const j = await postJSON<{ sources_to_targets: Array<Array<{ time: number | null }>> }>(
      `${VALHALLA}/sources_to_targets`,
      { sources: locs.slice(a, b), targets: locs, ...costing(mode) },
      { signal, timeout: 20000 },
    );
    j.sources_to_targets.forEach((row, k) => (out[a + k] = row.map((c) => (c.time == null ? Infinity : c.time))));
  });
  return out;
}

function estimateMatrix(points: LngLat[], mode: Mode): number[][] {
  return points.map((a) => points.map((b) => (haversine(a, b) * 1.3) / SPEED[mode]));
}

export async function getMatrix(points: LngLat[], mode: Mode, signal?: AbortSignal): Promise<{ m: number[][]; engine: 'osrm' | 'valhalla' | 'estimate' }> {
  try {
    return { m: await osrmTable(points, mode, signal), engine: 'osrm' };
  } catch (e) {
    if (isAbort(e)) throw e;
    console.warn('[flane] matrice OSRM indisponible', e);
  }
  try {
    return { m: await valhallaMatrix(points, mode, signal), engine: 'valhalla' };
  } catch (e) {
    if (isAbort(e)) throw e;
    console.warn('[flane] matrice Valhalla indisponible, estimation', e);
  }
  return { m: estimateMatrix(points, mode), engine: 'estimate' };
}

/** Itinéraire « vol d'oiseau » pour une boucle dont départ et arrivée sont confondus. */
export function directRoute(a: LngLat, b: LngLat, mode: Mode): Route {
  const coords: LngLat[] = [a, b];
  const d = haversine(a, b);
  const duration = d / SPEED[mode];
  return {
    coords,
    cum: [0, d],
    duration,
    distance: d,
    maneuvers: [
      { turn: 'depart', text: 'Partez.', distance: d, duration, begin: 0, end: 1 },
      { turn: 'arrive', text: 'Vous êtes arrivé.', distance: 0, duration: 0, begin: 1, end: 1 },
    ],
    engine: 'direct',
  };
}
