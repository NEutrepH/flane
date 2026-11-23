// Lecture des tuiles vectorielles OpenFreeMap (schéma OpenMapTiles) : les mêmes données que la carte,
// décodées ici pour repérer parcs, berges, monuments, points de vue, rues piétonnes…
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import type { LngLat } from '../lib/geo';
import { fetchJSON } from '../lib/http';

export const TILEJSON = 'https://tiles.openfreemap.org/planet';

let templateP: Promise<string> | null = null;

function tileTemplate(): Promise<string> {
  templateP ??= fetchJSON<{ tiles: string[] }>(TILEJSON, { timeout: 10000 })
    .then((j) => j.tiles[0])
    .catch((e) => {
      templateP = null;
      throw e;
    });
  return templateP;
}

export async function fetchTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<VectorTile> {
  const url = (await tileTemplate()).replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  const res = await fetch(url, { signal });
  if (res.status === 204 || res.status === 404) return new VectorTile(new PbfReader(new Uint8Array(0)));
  if (!res.ok) throw new Error(`tuile ${z}/${x}/${y} : HTTP ${res.status}`);
  return new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer())));
}

export type Props = Record<string, string | number | boolean>;

export interface Feat {
  props: Props;
  points?: LngLat[];
  lines?: LngLat[][];
  /** polygones : [anneau extérieur, ...trous] */
  polys?: LngLat[][][];
}

interface Geometry {
  type: string;
  coordinates: unknown;
}

/** Lit une couche de tuile en coordonnées lng/lat ; `filter` évite de décoder la géométrie inutile. */
export function readLayer(vt: VectorTile, name: string, x: number, y: number, z: number, filter?: (p: Props) => boolean): Feat[] {
  const layer = vt.layers[name];
  if (!layer) return [];
  const out: Feat[] = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    const props = f.properties as Props;
    if (filter && !filter(props)) continue;
    const g = f.toGeoJSON(x, y, z).geometry as unknown as Geometry;
    const feat: Feat = { props };
    switch (g.type) {
      case 'Point':
        feat.points = [g.coordinates as LngLat];
        break;
      case 'MultiPoint':
        feat.points = g.coordinates as LngLat[];
        break;
      case 'LineString':
        feat.lines = [g.coordinates as LngLat[]];
        break;
      case 'MultiLineString':
        feat.lines = g.coordinates as LngLat[][];
        break;
      case 'Polygon':
        feat.polys = [g.coordinates as LngLat[][]];
        break;
      case 'MultiPolygon':
        feat.polys = g.coordinates as LngLat[][][];
        break;
    }
    out.push(feat);
  }
  return out;
}
