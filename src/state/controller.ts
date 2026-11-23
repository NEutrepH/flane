// Chef d'orchestre : recherche → trajet le plus court → repérage des spots → curseur de durée → navigation.
import type { Map as MLMap } from 'maplibre-gl';
import { bboxOf, type LngLat } from '../lib/geo';
import { isAbort } from '../lib/http';
import { prefGet, prefSet } from '../lib/cache';
import { reverseGeocode, type Place } from '../data/geocode';
import { getRoute, SPEED, type Mode } from '../data/routing';
import type { Category, Spot } from '../data/spots';
import { wikiDetails } from '../data/wiki';
import { Planner, type Plan, type PrepStep } from '../engine/planner';
import { Guide, type NavState } from '../engine/navigation';
import { Simulator } from '../engine/simulator';
import { getState as get, setState as set, type UserPos } from './store';

/** Sans GPS (ordinateur, refus), on part de la gare de Maastricht. */
export const DEMO_ORIGIN: Place = { id: 'demo', name: 'Gare de Maastricht', sub: 'Départ de démo (pas de GPS)', coord: [5.70531, 50.8497], country: 'NL' };
export const DEFAULT_CENTER: LngLat = [5.6889, 50.8487];

let map: MLMap | null = null;
let planner: Planner | null = null;
let planCtrl: AbortController | null = null;
let routeCtrl: AbortController | null = null;
let routeTimer: ReturnType<typeof setTimeout> | undefined;
let guide: Guide | null = null;
let sim: Simulator | null = null;
let geoWatch: number | null = null;
let wakeLock: { release(): Promise<void> } | null = null;
let rerouting = false;
let lastSpoken = '';
const spokenSpots = new Set<string>();
let toastSeq = 0;
let stampSeq = 0;

export function registerMap(m: MLMap | null) {
  map = m;
}

/** Pour le débogage en développement : le planificateur en cours. */
export const debug = {
  get planner() {
    return planner;
  },
};

const nextFrame = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(fn));

// ---------- Petits messages ----------

export function toast(text: string, ms = 3200) {
  const id = ++toastSeq;
  set({ toast: { id, text } });
  setTimeout(() => {
    if (get().toast?.id === id) set({ toast: null });
  }, ms);
}

// ---------- Géolocalisation ----------

export function initGeolocation() {
  if (geoWatch !== null) return;
  if (!('geolocation' in navigator)) {
    set({ geo: 'unavailable' });
    return;
  }
  geoWatch = navigator.geolocation.watchPosition(onGeo, onGeoError, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
  setTimeout(() => {
    if (get().geo === 'pending') set({ geo: 'unavailable' });
  }, 8000);
}

function onGeo(pos: GeolocationPosition) {
  const c = pos.coords;
  const user: UserPos = { coord: [c.longitude, c.latitude], accuracy: c.accuracy, heading: c.heading ?? null, speed: c.speed ?? null, ts: pos.timestamp };
  const first = !get().user;
  set({ user, geo: 'granted' });
  if (first && get().phase === 'explore') map?.easeTo({ center: user.coord, zoom: 15.5, duration: 1200 });
  if (get().phase === 'nav' && !get().simulating) feedNav(user);
}

function onGeoError(err: GeolocationPositionError) {
  if (err.code === err.PERMISSION_DENIED) set({ geo: 'denied' });
  else if (get().geo === 'pending') set({ geo: 'unavailable' });
}

export function effectiveOrigin(): Place {
  const s = get();
  if (s.origin) return s.origin;
  if (s.user) return { id: 'me', name: 'Ma position', sub: '', coord: s.user.coord };
  return DEMO_ORIGIN;
}

// ---------- Destinations récentes ----------

export function recentPlaces(): Place[] {
  return prefGet<Place[]>('recent', []);
}

function pushRecent(p: Place) {
  if (p.id === 'loop' || p.id === 'me' || p.id === 'demo') return;
  prefSet('recent', [p, ...recentPlaces().filter((r) => r.id !== p.id)].slice(0, 6));
}

// ---------- Planification ----------

export async function chooseDestination(place: Place) {
  pushRecent(place);
  set({ dest: place, phase: 'plan', focus: null });
  await replan();
}

export async function chooseLoop() {
  const o = effectiveOrigin();
  await chooseDestination({ ...o, id: 'loop', name: 'Retour au départ', sub: 'Balade en boucle' });
}

export async function chooseOrigin(place: Place | null) {
  set({ origin: place });
  if (get().dest?.id === 'loop') {
    const o = effectiveOrigin();
    set({ dest: { ...o, id: 'loop', name: 'Retour au départ', sub: 'Balade en boucle' } });
  }
  if (get().dest) await replan();
}

export async function onMapLongPress(coord: LngLat) {
  if (get().phase === 'nav' || get().phase === 'arrived') return;
  const place = await reverseGeocode(coord).catch(() => null);
  await chooseDestination(place ?? { id: `pt:${coord[0].toFixed(5)},${coord[1].toFixed(5)}`, name: 'Point sur la carte', sub: '', coord });
}

async function replan() {
  const s = get();
  if (!s.dest) return;
  planCtrl?.abort();
  routeCtrl?.abort();
  clearTimeout(routeTimer);
  const ctrl = new AbortController();
  planCtrl = ctrl;
  const origin = effectiveOrigin();
  const p = new Planner(origin.coord, s.dest.coord, s.mode, s.prefs, s.dest.country ?? origin.country);
  planner = p;
  set({ base: null, plan: null, preview: null, candidates: [], planLoading: true, focus: null, prep: { status: 'loading', step: 0 } });
  try {
    const base = await p.loadBase(ctrl.signal);
    if (planner !== p) return;
    const t0 = p.t0min;
    const tmax = p.tmaxmin;
    const minutes = p.loop ? Math.min(tmax, 25) : t0;
    set({ base, t0, tmax, minutes, plan: p.decorate(base, [], minutes, false), planLoading: false });
    nextFrame(fitPlan);
    if (!p.scenicPossible) {
      set({ prep: { status: 'unavailable', step: 0, message: s.mode === 'walk' ? 'Trop loin pour flâner à pied. Essaie le vélo.' : 'Trop loin pour une balade à vélo.' } });
      return;
    }
    await p.prepare(ctrl.signal, (step: PrepStep) => {
      if (planner === p) set({ prep: { status: 'loading', step } });
    });
    if (planner !== p) return;
    const found = p.cands.length > 0;
    set({ candidates: p.cands, prep: found ? { status: 'ready', step: 4 } : { status: 'unavailable', step: 4, message: 'Pas de beaux coins repérés par ici.' } });
    await applyMinutes(get().minutes, true);
    void p.prefetch(ctrl.signal);
  } catch (e) {
    if (isAbort(e) || planner !== p) return;
    console.error('[flane]', e);
    if (!get().base) {
      set({ planLoading: false, prep: { status: 'error', step: 0, message: "Impossible de calculer l'itinéraire pour l'instant." } });
      toast("Le serveur d'itinéraires ne répond pas. Réessaie dans un instant.");
    } else {
      set({ prep: { status: 'error', step: 0, message: 'Repérage des beaux coins impossible pour le moment.' } });
    }
  }
}

export function retry() {
  void replan();
}

/** Appelé en continu par le curseur : aperçu immédiat des spots, itinéraire réel un peu après. */
export function setMinutes(value: number, force = false) {
  const p = planner;
  if (!p) return;
  const { t0, tmax } = get();
  const m = Math.round(Math.min(Math.max(value, t0), tmax));
  if (!force && m === get().minutes) return;
  set({ minutes: m });
  if (p.ready && m > p.t0min) {
    const sol = p.solve(m);
    set({ preview: { minutes: m, stops: sol.order.map((i) => p.cands[i]), time: sol.time } });
  } else set({ preview: null });
  clearTimeout(routeTimer);
  routeTimer = setTimeout(() => void applyMinutes(m), 200);
}

async function applyMinutes(m: number, force = false) {
  const p = planner;
  if (!p?.base) return;
  routeCtrl?.abort();
  const ctrl = new AbortController();
  routeCtrl = ctrl;
  set({ planLoading: true });
  try {
    const plan = await p.planFor(m, ctrl.signal);
    if (planner !== p || (!force && get().minutes !== m)) return;
    set({ plan, planLoading: false, preview: null });
    nextFrame(() => ensureVisible(plan.route.coords));
    void hydrate(plan);
  } catch (e) {
    if (isAbort(e)) return;
    console.error('[flane]', e);
    set({ planLoading: false, preview: null });
    toast('Itinéraire indisponible pour cette durée, réessaie.');
  }
}

/** Récupère textes et photos Wikipédia des spots affichés (en français si possible), par paquets. */
async function hydrate(plan: Plan) {
  const spots = [...plan.stops, ...plan.bonus].map((p) => p.spot).filter((s) => s.wiki && s.extract === undefined);
  if (!spots.length) return;
  try {
    const byLang = new Map<string, Spot[]>();
    for (const s of spots) byLang.set(s.wiki!.lang, [...(byLang.get(s.wiki!.lang) ?? []), s]);
    const needFr: Array<{ s: Spot; fr: string }> = [];
    for (const [lang, list] of byLang) {
      const det = await wikiDetails(lang, list.map((s) => s.wiki!.title));
      for (const s of list) {
        const d = det.get(s.wiki!.title);
        s.extract = d?.extract ?? '';
        if (!d) continue;
        s.link = d.url;
        if (d.thumb) s.thumb = d.thumb;
        if (lang !== 'fr' && d.fr) needFr.push({ s, fr: d.fr });
      }
    }
    if (needFr.length) {
      const det = await wikiDetails('fr', needFr.map((n) => n.fr));
      for (const { s, fr } of needFr) {
        const d = det.get(fr);
        if (!d?.extract) continue;
        s.extract = d.extract;
        s.link = d.url ?? s.link;
        if (d.thumb) s.thumb = d.thumb;
      }
    }
  } catch (e) {
    console.warn('[flane] Wikipédia indisponible', e);
  }
  const cur = get().plan;
  if (cur && cur.route === plan.route) set({ plan: { ...cur } });
}

export function togglePref(cat: Category) {
  const prefs = { ...get().prefs, [cat]: !get().prefs[cat] };
  if (!Object.values(prefs).some(Boolean)) return;
  prefSet('prefs', prefs);
  set({ prefs });
  if (planner) {
    planner.setPrefs(prefs);
    setMinutes(get().minutes, true);
  }
}

export function setMode(mode: Mode) {
  if (mode === get().mode) return;
  prefSet('mode', mode);
  set({ mode });
  if (get().dest) void replan();
}

// ---------- Caméra ----------

/** Marges à laisser autour du trajet pour qu'il ne passe pas sous les panneaux. */
export function uiPadding() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
  const search = rect('.search');
  const sheet = rect('.sheet');
  if (W >= 900) {
    const right = Math.max(search?.right ?? 0, sheet?.right ?? 0);
    return { top: 70, bottom: 70, left: right + 50, right: 70 };
  }
  const pad = { top: (search?.bottom ?? 80) + 30, bottom: H - (sheet?.top ?? H - 320) + 30, left: 34, right: 34 };
  const room = H - 140;
  if (pad.top + pad.bottom > room) {
    const k = room / (pad.top + pad.bottom);
    pad.top *= k;
    pad.bottom *= k;
  }
  return pad;
}

/** MapLibre garde en mémoire la marge passée à easeTo et l'ajoute aux recadrages suivants : on la remet à zéro. */
const NO_PAD = { top: 0, right: 0, bottom: 0, left: 0 };

export function fitPlan() {
  const s = get();
  const r = s.plan?.route ?? s.base;
  if (!map || !r) return;
  const pts = [...r.coords, ...(s.plan?.stops.map((x) => x.spot.coord) ?? [])];
  const b = bboxOf(pts);
  map.setPadding(NO_PAD);
  map.fitBounds(
    [
      [b[0], b[1]],
      [b[2], b[3]],
    ],
    { padding: uiPadding(), duration: 900, maxZoom: 17, pitch: 0, bearing: 0 },
  );
}

function ensureVisible(coords: LngLat[]) {
  if (!map || get().phase !== 'plan') return;
  const pad = uiPadding();
  const el = map.getContainer();
  const W = el.clientWidth;
  const H = el.clientHeight;
  const step = Math.max(1, Math.floor(coords.length / 150));
  for (let i = 0; i < coords.length; i += step) {
    const p = map.project(coords[i]);
    if (p.x < pad.left || p.x > W - pad.right || p.y < pad.top || p.y > H - pad.bottom) {
      fitPlan();
      return;
    }
  }
}

export function focusSpot(id: string | null, fly = true) {
  const next = get().focus === id ? null : id;
  set({ focus: next });
  if (!next || !fly || !map) return;
  const st = get();
  const spot =
    st.plan?.stops.find((p) => p.spot.id === next)?.spot ?? st.plan?.bonus.find((p) => p.spot.id === next)?.spot ?? st.preview?.stops.find((s) => s.id === next);
  if (!spot) return;
  const pad = uiPadding();
  map.setPadding(NO_PAD);
  map.easeTo({ center: spot.coord, offset: [(pad.left - pad.right) / 2, (pad.top - pad.bottom) / 2], duration: 700 });
}

// ---------- Navigation ----------

export function startNav(simulate = false) {
  const s = get();
  const plan = s.plan;
  if (!plan) return;
  guide = new Guide(plan.route, [...plan.stops, ...plan.bonus], s.mode);
  spokenSpots.clear();
  lastSpoken = '';
  set({
    phase: 'nav',
    simulating: simulate,
    nav: null,
    follow: true,
    stamp: null,
    focus: null,
    trip: { startedAt: Date.now(), minutes: Math.round(plan.route.duration / 60), baseMinutes: s.t0, distance: plan.route.distance, visited: [], simulated: simulate },
  });
  void requestWakeLock();
  void requestCompass();
  if (simulate) {
    sim = new Simulator(
      plan.route,
      SPEED[s.mode],
      (fix) => {
        const user: UserPos = { coord: fix.coord, accuracy: fix.accuracy, heading: fix.heading, speed: fix.speed, ts: Date.now() };
        set({ user });
        feedNav(user);
      },
      s.mode === 'walk' ? 8 : 5,
    );
    sim.start();
  } else if (s.user) feedNav(s.user);
  else toast('En attente du GPS…');
}

function feedNav(user: UserPos) {
  if (!guide || get().phase !== 'nav') return;
  const st = guide.update(user.coord, user.accuracy);
  set({ nav: st });
  if (st.justVisited) onVisited(st.justVisited.spot);
  speakGuidance(st);
  if (st.arrived) {
    finishNav();
    return;
  }
  if (st.offRoute && !rerouting && !get().simulating) void reroute(user.coord);
}

function onVisited(spot: Spot) {
  const trip = get().trip;
  if (trip && !trip.visited.some((v) => v.id === spot.id)) set({ trip: { ...trip, visited: [...trip.visited, spot] } });
  const id = ++stampSeq;
  set({ stamp: { id, spot } });
  setTimeout(() => {
    if (get().stamp?.id === id) set({ stamp: null });
  }, 3800);
  navigator.vibrate?.([30, 40, 30]);
}

/** Sorti du trajet : on repart de la position actuelle vers les spots restants puis l'arrivée. */
async function reroute(from: LngLat) {
  const p = planner;
  const plan = get().plan;
  if (!p || !plan || !guide) return;
  rerouting = true;
  toast('On recalcule ton chemin…', 2000);
  try {
    const remaining = plan.stops.filter((ps) => !guide!.isVisited(ps.spot.id)).map((ps) => ps.spot);
    const route = await getRoute([from, ...remaining.map((s) => p.waypoint(s)), p.dest], get().mode, { passBy: true });
    if (get().phase !== 'nav' || !guide) return;
    const next = p.decorate(route, remaining, plan.minutes, plan.scenic);
    guide = new Guide(route, [...next.stops, ...next.bonus], get().mode, guide.visitedIds);
    set({ plan: next });
  } catch (e) {
    console.warn('[flane] recalcul impossible', e);
  } finally {
    rerouting = false;
  }
}

function finishNav() {
  const trip = get().trip;
  stopSources();
  set({ phase: 'arrived', nav: null, stamp: null, trip: trip ? { ...trip, endedAt: Date.now() } : null });
}

export function stopNav() {
  stopSources();
  set({ phase: 'plan', nav: null, stamp: null });
  nextFrame(fitPlan);
}

function stopSources() {
  sim?.stop();
  sim = null;
  guide = null;
  void wakeLock?.release().catch(() => {});
  wakeLock = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

export function newWalk() {
  planCtrl?.abort();
  routeCtrl?.abort();
  clearTimeout(routeTimer);
  planner = null;
  stopSources();
  set({ phase: 'explore', dest: null, base: null, plan: null, preview: null, candidates: [], prep: { status: 'idle', step: 0 }, nav: null, trip: null, stamp: null, focus: null });
  const u = get().user;
  map?.setPadding(NO_PAD);
  map?.easeTo({ ...(u ? { center: u.coord, zoom: 15.5 } : {}), pitch: 0, bearing: 0, duration: 900 });
}

export function recenter() {
  set({ follow: true });
}

// ---------- Écran allumé, boussole, voix ----------

async function requestWakeLock() {
  try {
    const wl = (navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (wl) wakeLock = await wl.request('screen');
  } catch {
    /* refusé ou non pris en charge */
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && get().phase === 'nav') void requestWakeLock();
  });
}

async function requestCompass() {
  const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
  try {
    if (DOE?.requestPermission && (await DOE.requestPermission()) !== 'granted') return;
  } catch {
    return;
  }
  window.addEventListener('deviceorientation', onOrient as EventListener, true);
}

let lastCompass = 0;
function onOrient(e: DeviceOrientationEvent & { webkitCompassHeading?: number }) {
  const h = e.webkitCompassHeading ?? (e.absolute && e.alpha != null ? (360 - e.alpha) % 360 : null);
  if (h == null) return;
  const now = performance.now();
  if (now - lastCompass < 250) return;
  lastCompass = now;
  set({ compass: h });
}

function speak(text: string) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR';
  u.rate = 1.03;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function speakGuidance(st: NavState) {
  if (!get().voice) return;
  const walk = get().mode === 'walk';
  if (st.nextSpot && st.distToSpot < (walk ? 45 : 90) && !spokenSpots.has(st.nextSpot.spot.id)) {
    spokenSpots.add(st.nextSpot.spot.id);
    speak(`${st.nextSpot.bonus ? 'Juste là' : 'Prochain spot'} : ${st.nextSpot.spot.name}.`);
    return;
  }
  if (st.next && st.next.turn !== 'straight' && st.distToNext < (walk ? 25 : 60) && lastSpoken !== String(st.nextIdx)) {
    lastSpoken = String(st.nextIdx);
    speak(st.next.verbal ?? st.next.text);
  }
}

export function toggleVoice() {
  const voice = !get().voice;
  prefSet('voice', voice);
  set({ voice });
  if (voice) speak('Guidage vocal activé.');
  else if ('speechSynthesis' in window) speechSynthesis.cancel();
}
