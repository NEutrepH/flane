// Recherche d'adresses et de lieux avec Photon (OpenStreetMap), pensé pour la saisie au fil de l'eau.
import type { LngLat } from '../lib/geo';
import { fetchJSON } from '../lib/http';

export interface Place {
  id: string;
  name: string;
  sub: string;
  coord: LngLat;
  country?: string;
}

const PHOTON = 'https://photon.komoot.io';

interface PhotonFeature {
  geometry: { coordinates: LngLat };
  properties: Record<string, string | undefined>;
}

function toPlace(f: PhotonFeature): Place {
  const p = f.properties;
  const street = p.street ? `${p.street}${p.housenumber ? ' ' + p.housenumber : ''}` : '';
  const name = p.name || street || p.city || p.county || 'Lieu sans nom';
  const sub = [street && street !== name ? street : '', p.city && p.city !== name ? p.city : p.county, p.country]
    .filter(Boolean)
    .join(', ');
  return { id: `${p.osm_type ?? ''}${p.osm_id ?? name}`, name, sub, coord: f.geometry.coordinates, country: p.countrycode };
}

export async function searchPlaces(q: string, near: LngLat | undefined, signal?: AbortSignal): Promise<Place[]> {
  const u = new URL(`${PHOTON}/api/`);
  u.searchParams.set('q', q);
  u.searchParams.set('limit', '7');
  u.searchParams.set('lang', 'fr');
  if (near) {
    u.searchParams.set('lat', near[1].toFixed(5));
    u.searchParams.set('lon', near[0].toFixed(5));
    u.searchParams.set('zoom', '14');
    u.searchParams.set('location_bias_scale', '0.3');
  }
  const j = await fetchJSON<{ features?: PhotonFeature[] }>(u.toString(), { signal, timeout: 8000 });
  const seen = new Set<string>();
  return (j.features ?? []).map(toPlace).filter((p) => {
    const k = `${p.name}|${p.sub}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function reverseGeocode(coord: LngLat, signal?: AbortSignal): Promise<Place | null> {
  const u = `${PHOTON}/reverse?lat=${coord[1].toFixed(6)}&lon=${coord[0].toFixed(6)}&lang=fr&limit=1`;
  const j = await fetchJSON<{ features?: PhotonFeature[] }>(u, { signal, timeout: 8000 });
  const f = j.features?.[0];
  if (!f) return null;
  return { ...toPlace(f), coord };
}
