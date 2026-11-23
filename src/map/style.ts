// Style de carte « impression riso » sur les tuiles OpenFreeMap (schéma OpenMapTiles) :
// papier crème, parcs en trame de points verts, eau bleue, grands axes jaunes, labels encre.
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Category } from '../data/spots';
import { TILEJSON } from '../data/tiles';

export const INK = '#17162A';
export const PAPER = '#F3EEE3';
export const PINK = '#FF48B0';
export const BLUE = '#0078BF';
export const GREEN = '#00A95C';
export const YELLOW = '#FFE800';
export const ORANGE = '#FF6C2F';
export const PURPLE = '#765BA7';
export const CAT_COLOR: Record<Category, string> = { nature: GREEN, patrimoine: PURPLE, vue: BLUE, urbain: ORANGE };

/** Premier calque de texte : les tracés passent dessous pour garder les noms lisibles. */
export const FIRST_LABEL = 'label-waterway';

const C = {
  land: '#EDE6D6',
  grass: '#DAEACF',
  wood: '#CDE3C3',
  water: '#8EC3E6',
  waterLine: '#4C9BD0',
  building: '#EAE3D4',
  buildingLine: '#D6CCB6',
  road: '#FFFCF4',
  roadCase: '#CEC3AC',
  mid: '#FFF7D1',
  major: '#FFEC70',
  majorCase: '#D8BE3C',
  path: 'rgba(23,22,42,0.45)',
  cycle: 'rgba(0,120,191,0.6)',
  rail: '#A49B87',
  label: 'rgba(23,22,42,0.78)',
  labelSoft: 'rgba(23,22,42,0.52)',
  waterLabel: '#0B5F99',
  parkLabel: '#007A43',
};

type Expr = unknown[];
const NAME: Expr = ['coalesce', ['get', 'name:fr'], ['get', 'name']];
const LINE: Expr = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const POLY: Expr = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
const NOT_TUNNEL: Expr = ['!=', ['get', 'brunnel'], 'tunnel'];
const cls = (...c: string[]): Expr => ['match', ['get', 'class'], c, true, false];
const zoom = (stops: Array<[number, number]>, base = 1.55): Expr => ['interpolate', ['exponential', base], ['zoom'], ...stops.flat()];
const minorW = (e = 0) => zoom([[12, 0.4 + e * 0.3], [14, 1.6 + e * 0.6], [16, 5 + e], [18, 14 + e * 1.4], [20, 34 + e * 2]]);
const midW = (e = 0) => zoom([[11, 0.5 + e * 0.3], [14, 2.6 + e * 0.7], [16, 7 + e], [18, 18 + e * 1.4], [20, 40 + e * 2]]);
const majorW = (e = 0) => zoom([[9, 0.6 + e * 0.3], [12, 1.8 + e * 0.5], [14, 4 + e * 0.8], [16, 9 + e], [18, 22 + e * 1.4], [20, 46 + e * 2]]);
const ROUND = { 'line-cap': 'round', 'line-join': 'round' };
const HALO = { 'text-halo-color': PAPER, 'text-halo-width': 1.4 };

const MINOR = ['minor', 'service', 'track'];
const MID = ['tertiary'];
const MAJOR = ['secondary', 'primary', 'trunk', 'motorway'];

function roads(): unknown[] {
  const t = { source: 'omt', 'source-layer': 'transportation' };
  const f = (classes: string[]) => ['all', LINE, NOT_TUNNEL, cls(...classes)];
  return [
    { id: 'tunnel', type: 'line', ...t, filter: ['all', LINE, ['==', ['get', 'brunnel'], 'tunnel'], cls(...MINOR, ...MID, ...MAJOR)], paint: { 'line-color': C.roadCase, 'line-width': minorW(), 'line-dasharray': [1.5, 1.5], 'line-opacity': 0.6 } },
    { id: 'road-minor-case', type: 'line', ...t, minzoom: 13, filter: f(MINOR), layout: ROUND, paint: { 'line-color': C.roadCase, 'line-width': minorW(1.6) } },
    { id: 'road-mid-case', type: 'line', ...t, filter: f(MID), layout: ROUND, paint: { 'line-color': C.roadCase, 'line-width': midW(1.6) } },
    { id: 'road-major-case', type: 'line', ...t, filter: f(MAJOR), layout: ROUND, paint: { 'line-color': C.majorCase, 'line-width': majorW(2) } },
    { id: 'road-minor', type: 'line', ...t, minzoom: 13, filter: f(MINOR), layout: ROUND, paint: { 'line-color': C.road, 'line-width': minorW() } },
    { id: 'road-mid', type: 'line', ...t, filter: f(MID), layout: ROUND, paint: { 'line-color': C.mid, 'line-width': midW() } },
    { id: 'road-major', type: 'line', ...t, filter: f(MAJOR), layout: ROUND, paint: { 'line-color': C.major, 'line-width': majorW() } },
    {
      id: 'path',
      type: 'line',
      ...t,
      minzoom: 13.5,
      filter: ['all', LINE, NOT_TUNNEL, cls('path'), ['!=', ['get', 'subclass'], 'steps']],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': ['match', ['get', 'subclass'], 'cycleway', C.cycle, C.path], 'line-width': zoom([[14, 0.8], [18, 2.4]], 1.2), 'line-dasharray': [2, 1.2] },
    },
    { id: 'steps', type: 'line', ...t, minzoom: 15, filter: ['all', LINE, cls('path'), ['==', ['get', 'subclass'], 'steps']], paint: { 'line-color': C.path, 'line-width': zoom([[15, 2], [18, 5]], 1.2), 'line-dasharray': [0.3, 0.5] } },
    { id: 'rail', type: 'line', ...t, filter: ['all', LINE, cls('rail', 'transit')], paint: { 'line-color': C.rail, 'line-width': zoom([[12, 0.8], [17, 2]], 1.2), 'line-dasharray': [3, 2] } },
  ];
}

export function buildStyle(): StyleSpecification {
  const s = { source: 'omt' };
  const layers: unknown[] = [
    { id: 'bg', type: 'background', paint: { 'background-color': PAPER } },
    { id: 'landuse-res', type: 'fill', ...s, 'source-layer': 'landuse', filter: cls('residential', 'suburb', 'neighbourhood', 'quarter'), paint: { 'fill-color': C.land, 'fill-opacity': 0.55 } },
    { id: 'landuse-green', type: 'fill', ...s, 'source-layer': 'landuse', filter: cls('cemetery', 'pitch', 'playground', 'grass', 'stadium'), paint: { 'fill-color': C.grass, 'fill-opacity': 0.75 } },
    { id: 'landcover-grass', type: 'fill', ...s, 'source-layer': 'landcover', filter: cls('grass', 'farmland'), paint: { 'fill-color': C.grass, 'fill-opacity': ['match', ['get', 'class'], 'farmland', 0.4, 0.85] } },
    { id: 'landcover-wood', type: 'fill', ...s, 'source-layer': 'landcover', filter: cls('wood'), paint: { 'fill-color': C.wood } },
    { id: 'landcover-wood-dots', type: 'fill', ...s, 'source-layer': 'landcover', filter: cls('wood'), paint: { 'fill-pattern': 'dots-green-dense', 'fill-opacity': 0.5 } },
    {
      id: 'park-dots',
      type: 'fill',
      ...s,
      'source-layer': 'landcover',
      filter: ['match', ['get', 'subclass'], ['park', 'garden', 'village_green', 'recreation_ground'], true, false],
      paint: { 'fill-pattern': 'dots-green', 'fill-opacity': 0.8 },
    },
    { id: 'park-area', type: 'fill', ...s, 'source-layer': 'park', paint: { 'fill-pattern': 'dots-green', 'fill-opacity': 0.22 } },
    { id: 'water', type: 'fill', ...s, 'source-layer': 'water', filter: NOT_TUNNEL, paint: { 'fill-color': C.water } },
    { id: 'water-dots', type: 'fill', ...s, 'source-layer': 'water', minzoom: 13, filter: NOT_TUNNEL, paint: { 'fill-pattern': 'dots-blue', 'fill-opacity': 0.35 } },
    { id: 'water-edge', type: 'line', ...s, 'source-layer': 'water', paint: { 'line-color': C.waterLine, 'line-width': zoom([[12, 0.4], [17, 1.4]], 1), 'line-opacity': 0.7 } },
    {
      id: 'waterway',
      type: 'line',
      ...s,
      'source-layer': 'waterway',
      filter: NOT_TUNNEL,
      layout: ROUND,
      paint: {
        'line-color': C.water,
        'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 11, ['match', ['get', 'class'], ['river', 'canal'], 1.2, 0.4], 17, ['match', ['get', 'class'], ['river', 'canal'], 8, 2.5]],
      },
    },
    {
      id: 'building',
      type: 'fill',
      ...s,
      'source-layer': 'building',
      minzoom: 13.5,
      paint: { 'fill-color': C.building, 'fill-outline-color': C.buildingLine, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 14.5, 1] },
    },
    { id: 'pedestrian-area', type: 'fill', ...s, 'source-layer': 'transportation', filter: ['all', POLY, cls('path', 'pier', 'bridge')], paint: { 'fill-color': '#FAF6EC' } },
    ...roads(),
    {
      id: 'building-3d',
      type: 'fill-extrusion',
      ...s,
      'source-layer': 'building',
      minzoom: 15,
      layout: { visibility: 'none' },
      filter: ['!=', ['get', 'hide_3d'], true],
      paint: {
        'fill-extrusion-color': '#E9E0CD',
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.82,
      },
    },
    {
      id: FIRST_LABEL,
      type: 'symbol',
      ...s,
      'source-layer': 'waterway',
      minzoom: 13,
      filter: ['has', 'name'],
      layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': ['Noto Sans Italic'], 'text-size': 12.5, 'text-letter-spacing': 0.12, 'symbol-spacing': 420 },
      paint: { 'text-color': C.waterLabel, 'text-halo-color': 'rgba(243,238,227,0.8)', 'text-halo-width': 1.2 },
    },
    {
      id: 'label-water',
      type: 'symbol',
      ...s,
      'source-layer': 'water_name',
      minzoom: 13,
      filter: ['has', 'name'],
      layout: { 'text-field': NAME, 'text-font': ['Noto Sans Italic'], 'text-size': 12.5, 'text-max-width': 8 },
      paint: { 'text-color': C.waterLabel, ...HALO },
    },
    {
      id: 'label-street',
      type: 'symbol',
      ...s,
      'source-layer': 'transportation_name',
      minzoom: 14,
      filter: ['has', 'name'],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 18, 13.5],
        'text-max-angle': 30,
        'text-padding': 2,
      },
      paint: { 'text-color': C.labelSoft, ...HALO },
    },
    {
      id: 'label-poi',
      type: 'symbol',
      ...s,
      'source-layer': 'poi',
      minzoom: 15.5,
      filter: ['all', ['has', 'name'], cls('attraction', 'castle', 'place_of_worship', 'museum', 'town_hall', 'park', 'garden')],
      layout: { 'text-field': NAME, 'text-font': ['Noto Sans Italic'], 'text-size': 11, 'text-max-width': 8, 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': ['match', ['get', 'class'], ['park', 'garden'], C.parkLabel, C.labelSoft], ...HALO },
    },
    {
      id: 'label-quarter',
      type: 'symbol',
      ...s,
      'source-layer': 'place',
      minzoom: 12,
      maxzoom: 16.5,
      filter: cls('suburb', 'quarter', 'neighbourhood'),
      layout: {
        'text-field': ['upcase', NAME],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 9.5, 16, 12],
        'text-letter-spacing': 0.24,
        'text-max-width': 7,
      },
      paint: { 'text-color': 'rgba(23,22,42,0.4)', ...HALO },
    },
    {
      id: 'label-city',
      type: 'symbol',
      ...s,
      'source-layer': 'place',
      maxzoom: 14,
      filter: cls('city', 'town', 'village'),
      layout: { 'text-field': ['upcase', NAME], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 12, 18], 'text-letter-spacing': 0.18 },
      paint: { 'text-color': INK, 'text-halo-color': PAPER, 'text-halo-width': 1.6 },
    },
  ];
  return {
    version: 8,
    name: 'Flâne riso',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { omt: { type: 'vector', url: TILEJSON } },
    layers,
  } as unknown as StyleSpecification;
}
