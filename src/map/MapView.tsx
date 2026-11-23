import { useEffect, useRef } from 'react';
import { Map as MLMap, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { buildStyle } from './style';
import { patternImage } from './patterns';
import { RouteLayers } from './layers';
import { Markers, type PinData } from './markers';
import { useApp, type AppState } from '../state/store';
import { DEFAULT_CENTER, effectiveOrigin, focusSpot, onMapLongPress, registerMap } from '../state/controller';

// MapLibre v6 cherche son worker à côté de son propre fichier ; avec Vite on lui donne l'adresse.
setWorkerUrl(workerUrl);

function pinsFor(s: AppState): PinData[] {
  if (s.phase !== 'plan' && s.phase !== 'nav') return [];
  if (s.preview && s.phase === 'plan') {
    return s.preview.stops.map((sp, i) => ({ id: sp.id, coord: sp.coord, n: i + 1, cat: sp.cat, name: sp.name, bonus: false, visited: false, focus: s.focus === sp.id, preview: true }));
  }
  const plan = s.plan;
  if (!plan) return [];
  const visited = new Set(s.nav?.visited ?? []);
  return [...plan.stops, ...plan.bonus].map((ps) => ({
    id: ps.spot.id,
    coord: ps.spot.coord,
    n: ps.n,
    cat: ps.spot.cat,
    name: ps.spot.name,
    bonus: ps.bonus,
    visited: visited.has(ps.spot.id),
    focus: s.focus === ps.spot.id,
    preview: false,
  }));
}

export function MapView() {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const map = new MLMap({
      container: el.current!,
      style: buildStyle(),
      center: useApp.getState().user?.coord ?? DEFAULT_CENTER,
      zoom: 15,
      attributionControl: false,
      maxPitch: 70,
      fadeDuration: 120,
    });
    registerMap(map);
    map.setMissingStyleImageResolver((id) => {
      if (map.hasImage(id)) return;
      const img = patternImage(id);
      if (img) map.addImage(id, img, { pixelRatio: 2 });
    });
    const layers = new RouteLayers(map);
    const markers = new Markers(map, (id) => focusSpot(id, false));
    let ready = false;
    let prev: AppState | null = null;

    const apply = (s: AppState) => {
      if (!ready) return;
      const p = prev;
      prev = s;
      const changed = (...keys: Array<keyof AppState>) => !p || keys.some((k) => p[k] !== s[k]);

      if (changed('candidates', 'phase')) layers.setCandidates(s.phase === 'plan' ? s.candidates : []);
      if (changed('plan', 'base', 'phase')) {
        layers.setGhost(s.phase === 'plan' && s.plan?.scenic ? s.base : null);
        if (s.phase === 'plan' || s.phase === 'explore') {
          const fresh = !!s.plan && p?.plan?.route !== s.plan.route;
          layers.setRoute(s.plan?.route ?? null, fresh && s.phase === 'plan');
        }
      }
      if (changed('planLoading', 'preview')) layers.setDim(s.planLoading && !!s.preview);
      if (changed('phase')) {
        layers.set3D(s.phase === 'nav');
        if (s.phase !== 'nav') layers.clearProgress();
        if (s.phase === 'arrived') layers.setRoute(null, false);
      }
      if (s.phase === 'nav' && s.plan && s.nav && changed('nav', 'plan')) layers.setProgress(s.plan.route, s.nav.progress);

      if (changed('user', 'compass', 'phase', 'nav')) {
        const moving = (s.user?.speed ?? 0) > 0.7 && s.user?.heading != null;
        const heading = s.phase === 'nav' ? (moving ? s.user!.heading : (s.compass ?? s.nav?.bearing ?? null)) : s.compass;
        markers.setUser(s.user?.coord ?? null, heading, s.phase === 'nav');
      }
      if (changed('dest', 'origin', 'user', 'phase', 'base')) {
        const loop = s.dest?.id === 'loop';
        const showA = s.phase === 'plan' && (!!s.origin || !s.user);
        markers.setEnds(showA ? effectiveOrigin().coord : null, s.dest && !loop && s.phase !== 'explore' && s.phase !== 'arrived' ? s.dest.coord : null);
      }
      if (changed('plan', 'preview', 'focus', 'nav', 'phase')) markers.setPins(pinsFor(s));

      if (s.phase === 'nav' && s.follow && s.nav && changed('nav', 'follow', 'phase')) {
        map.easeTo({
          center: s.nav.offRoute && s.user ? s.user.coord : s.nav.snapped,
          bearing: s.nav.bearing,
          pitch: 55,
          zoom: s.mode === 'walk' ? 17.3 : 16.3,
          duration: changed('follow', 'phase') ? 900 : 450,
          easing: (t) => t,
          padding: { top: Math.round(window.innerHeight * 0.38), bottom: 120, left: 0, right: 0 },
        });
      }
    };

    map.on('load', () => {
      layers.install();
      ready = true;
      apply(useApp.getState());
    });
    const unsub = useApp.subscribe(apply);
    map.on('contextmenu', (e) => void onMapLongPress([e.lngLat.lng, e.lngLat.lat]));
    map.on('dragstart', () => {
      if (useApp.getState().phase === 'nav') useApp.setState({ follow: false });
    });
    return () => {
      unsub();
      markers.clear();
      map.remove();
      registerMap(null);
    };
  }, []);

  return <div ref={el} className="map" />;
}
