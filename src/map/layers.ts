// Calques dessinés par l'app : trajet le plus court (fantôme), balade (rose fluo + décalage bleu, points
// qui avancent dans le sens de la marche), partie déjà parcourue, beaux coins repérés, coups de cœur et
// zone analysée quand on aime un endroit.
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString } from 'geojson';
import { circlePolygon, sliceLine, type LngLat } from '../lib/geo';
import { AMBIENCE_RADIUS } from '../data/context';
import type { Route } from '../data/routing';
import type { Spot } from '../data/spots';
import type { Like } from '../engine/taste';
import { BLUE, CAT_COLOR, FIRST_LABEL, INK, PAPER, PINK } from './style';

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const line = (coords: LngLat[]): Feature<LineString> => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
const W = (base: number) => ['interpolate', ['exponential', 1.5], ['zoom'], 12, base * 0.45, 15, base, 18, base * 1.9];
const ROUND = { 'line-cap': 'round', 'line-join': 'round' } as const;

/** Motifs pointillés décalés pas à pas : les points du tracé avancent dans le sens de la marche. */
const MARCH: number[][] = Array.from({ length: 9 }, (_, i) => {
  const o = i * 0.3;
  return o === 0 ? [0.1, 2.6] : [0, o, 0.1, 2.6 - o];
});

export class RouteLayers {
  private anim = 0;
  private pulse = 0;
  private march: ReturnType<typeof setInterval> | null = null;
  private step = 0;

  constructor(private readonly map: MLMap) {}

  install() {
    const m = this.map;
    for (const id of ['cands', 'base', 'route', 'done', 'likes', 'likezone']) m.addSource(id, { type: 'geojson', data: EMPTY });
    const catColor = ['match', ['get', 'cat'], ...Object.entries(CAT_COLOR).flat(), INK];
    // Les styles sont écrits en JSON brut ; MapLibre les valide à l'exécution.
    const add = (layer: object) => m.addLayer(layer as Parameters<MLMap['addLayer']>[0], FIRST_LABEL);
    add({ id: 'likezone-fill', type: 'fill', source: 'likezone', paint: { 'fill-pattern': 'dots-pink', 'fill-opacity': 0.55 } });
    add({ id: 'likezone-line', type: 'line', source: 'likezone', paint: { 'line-color': PINK, 'line-width': 2.5, 'line-dasharray': [1.5, 1.2] } });
    add({
      id: 'cands-dot',
      type: 'circle',
      source: 'cands',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 1.6, 16, 4.2], 'circle-color': catColor, 'circle-opacity': 0.55 },
    });
    add({ id: 'base-line', type: 'line', source: 'base', layout: ROUND, paint: { 'line-color': INK, 'line-width': W(2.6), 'line-dasharray': [1.2, 1.6], 'line-opacity': 0.55 } });
    add({ id: 'route-shadow', type: 'line', source: 'route', layout: ROUND, paint: { 'line-color': BLUE, 'line-width': W(8), 'line-translate': [2.5, 2.5], 'line-opacity': 0.9 } });
    add({ id: 'route-line', type: 'line', source: 'route', layout: ROUND, paint: { 'line-color': PINK, 'line-width': W(7) } });
    add({ id: 'route-core', type: 'line', source: 'route', layout: ROUND, paint: { 'line-color': PAPER, 'line-width': W(1.5), 'line-dasharray': MARCH[0], 'line-opacity': 0.95 } });
    add({ id: 'done-line', type: 'line', source: 'done', layout: ROUND, paint: { 'line-color': INK, 'line-width': W(4), 'line-opacity': 0.3 } });
    add({
      id: 'likes-dot',
      type: 'circle',
      source: 'likes',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 7],
        'circle-color': PINK,
        'circle-stroke-color': INK,
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 2.2],
      },
    });
    this.startMarching();
  }

  private src(id: string) {
    return this.map.getSource(id) as GeoJSONSource | undefined;
  }

  /** Fait avancer les points du tracé (11 images/s, en pause quand l'app n'est pas à l'écran). */
  private startMarching() {
    this.march = setInterval(() => {
      if (document.visibilityState !== 'visible' || !this.map.getLayer('route-core')) return;
      this.step = (this.step + 1) % MARCH.length;
      this.map.setPaintProperty('route-core', 'line-dasharray', MARCH[this.step]);
    }, 90);
  }

  dispose() {
    if (this.march) clearInterval(this.march);
    cancelAnimationFrame(this.anim);
    cancelAnimationFrame(this.pulse);
  }

  setCandidates(spots: Spot[]) {
    this.src('cands')?.setData({
      type: 'FeatureCollection',
      features: spots.map((s) => ({ type: 'Feature', properties: { cat: s.cat }, geometry: { type: 'Point', coordinates: s.coord } })),
    });
  }

  setLikes(likes: Like[]) {
    this.src('likes')?.setData({
      type: 'FeatureCollection',
      features: likes.map((l) => ({ type: 'Feature', properties: { name: l.name }, geometry: { type: 'Point', coordinates: l.coord } })),
    });
  }

  /** Zone analysée autour d'un coup de cœur : elle pulse pendant l'analyse. */
  setLikeZone(center: LngLat | null, analysing: boolean) {
    cancelAnimationFrame(this.pulse);
    const src = this.src('likezone');
    if (!src) return;
    if (!center) {
      src.setData(EMPTY);
      return;
    }
    src.setData({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circlePolygon(center, AMBIENCE_RADIUS)] } });
    if (!analysing) {
      this.map.setPaintProperty('likezone-fill', 'fill-opacity', 0.45);
      return;
    }
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = (Math.sin(((now - t0) / 1000) * Math.PI * 2) + 1) / 2;
      this.map.setPaintProperty('likezone-fill', 'fill-opacity', 0.25 + 0.5 * k);
      this.pulse = requestAnimationFrame(tick);
    };
    this.pulse = requestAnimationFrame(tick);
  }

  setGhost(route: Route | null) {
    this.src('base')?.setData(route ? line(route.coords) : EMPTY);
  }

  /** Affiche la balade ; si `animate`, le tracé se dessine du départ vers l'arrivée. */
  setRoute(route: Route | null, animate: boolean) {
    cancelAnimationFrame(this.anim);
    const src = this.src('route');
    if (!src) return;
    if (!route || route.coords.length < 2) {
      src.setData(EMPTY);
      return;
    }
    if (!animate) {
      src.setData(line(route.coords));
      return;
    }
    const total = route.cum[route.cum.length - 1];
    const t0 = performance.now();
    const dur = Math.min(1100, 450 + total / 8);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      src.setData(line(e >= 1 ? route.coords : sliceLine(route.coords, route.cum, 0, Math.max(1, total * e))));
      if (k < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
  }

  /** En navigation : la partie parcourue s'efface, il ne reste en rose que ce qui est devant. */
  setProgress(route: Route, progress: number) {
    cancelAnimationFrame(this.anim);
    const total = route.cum[route.cum.length - 1];
    this.src('done')?.setData(progress > 1 ? line(sliceLine(route.coords, route.cum, 0, progress)) : EMPTY);
    const ahead = sliceLine(route.coords, route.cum, progress, total);
    this.src('route')?.setData(ahead.length > 1 ? line(ahead) : EMPTY);
  }

  clearProgress() {
    this.src('done')?.setData(EMPTY);
  }

  setDim(dim: boolean) {
    this.map.setPaintProperty('route-line', 'line-opacity', dim ? 0.4 : 1);
    this.map.setPaintProperty('route-shadow', 'line-opacity', dim ? 0.25 : 0.9);
    this.map.setPaintProperty('route-core', 'line-opacity', dim ? 0 : 0.95);
  }

  set3D(on: boolean) {
    this.map.setLayoutProperty('building-3d', 'visibility', on ? 'visible' : 'none');
  }
}
