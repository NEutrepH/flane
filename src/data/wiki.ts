// Wikipédia et Wikimedia Commons : notoriété, photos et petites histoires des lieux.
// Limites Wikimedia (2026) : 200 requêtes/min pour un navigateur, 3 requêtes simultanées au plus.
// On regroupe donc les demandes (20 titres par appel), on met tout en cache, et on fait une pause
// d'une minute dès que Wikimedia répond « trop de requêtes ».
import { cached, cacheGet, cacheSet } from '../lib/cache';
import { fetchJSON, HttpError } from '../lib/http';
import type { LngLat } from '../lib/geo';

export interface Article {
  lang: string;
  title: string;
  coord: LngLat;
  type: string | null;
}

const DAY = 864e5;
/** Hors navigateur (tests), Wikimedia exige un nom de client. Un navigateur envoie le sien. */
const HEADERS: Record<string, string> | undefined = typeof window === 'undefined' ? { 'User-Agent': 'Flane-dev/0.1 (local test)' } : undefined;
let pausedUntil = 0;

async function wm<T>(url: string, signal?: AbortSignal, timeout = 9000): Promise<T> {
  if (Date.now() < pausedUntil) throw new HttpError(429, 'Wikimedia en pause (trop de requêtes)');
  try {
    return await fetchJSON<T>(url, { signal, timeout, init: HEADERS ? { headers: HEADERS } : undefined });
  } catch (e) {
    if (e instanceof HttpError && (e.status === 429 || e.status === 503)) pausedUntil = Date.now() + 60_000;
    throw e;
  }
}

/** Articles géolocalisés autour d'un point (500 au plus, rayon 10 km au plus). */
export async function geosearch(lang: string, center: LngLat, radius: number, signal?: AbortSignal): Promise<Article[]> {
  const r = Math.round(Math.min(10000, Math.max(100, radius)) / 100) * 100;
  const key = `c:geo:${lang}:${center[0].toFixed(3)},${center[1].toFixed(3)}:${r}`;
  return cached(key, 7 * DAY, async () => {
    const u =
      `https://${lang}.wikipedia.org/w/api.php?action=query&list=geosearch&format=json&origin=*` +
      `&gscoord=${center[1].toFixed(6)}%7C${center[0].toFixed(6)}&gsradius=${r}&gslimit=500&gsprop=type`;
    const j = await wm<{ query?: { geosearch?: Array<{ title: string; lat: number; lon: number; type?: string }> } }>(u, signal, 10000);
    return (j.query?.geosearch ?? []).map((g) => ({ lang, title: g.title, coord: [g.lon, g.lat] as LngLat, type: g.type ?? null }));
  });
}

export interface WikiDetail {
  title: string;
  extract: string;
  thumb?: string;
  url?: string;
  /** titre de l'article français équivalent */
  fr?: string;
}

interface DetailPage {
  title: string;
  missing?: string;
  extract?: string;
  fullurl?: string;
  thumbnail?: { source: string };
  langlinks?: Array<{ lang: string; '*': string }>;
}

/** Résumé, image et équivalent français de plusieurs articles, par paquets de 20 titres. */
export async function wikiDetails(lang: string, titles: string[], signal?: AbortSignal): Promise<Map<string, WikiDetail>> {
  const out = new Map<string, WikiDetail>();
  const todo: string[] = [];
  for (const t of new Set(titles)) {
    const hit = cacheGet<WikiDetail | null>(`c:wd:${lang}:${t}`);
    if (hit === undefined) todo.push(t);
    else if (hit) out.set(t, hit);
  }
  for (let i = 0; i < todo.length; i += 20) {
    const chunk = todo.slice(i, i + 20);
    const u =
      `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1` +
      `&prop=extracts%7Cpageimages%7Clanglinks%7Cinfo&exintro=1&explaintext=1&exsentences=3&exlimit=20` +
      `&piprop=thumbnail&pithumbsize=480&pilimit=20&lllang=fr&lllimit=50&inprop=url&titles=${encodeURIComponent(chunk.join('|'))}`;
    const j = await wm<{ query?: { normalized?: Array<{ from: string; to: string }>; redirects?: Array<{ from: string; to: string }>; pages?: Record<string, DetailPage> } }>(
      u,
      signal,
    );
    const alias = new Map<string, string>();
    for (const n of j.query?.normalized ?? []) alias.set(n.from, n.to);
    for (const r of j.query?.redirects ?? []) alias.set(r.from, r.to);
    const byTitle = new Map(Object.values(j.query?.pages ?? {}).map((p) => [p.title, p]));
    for (const t of chunk) {
      let final = t;
      for (let k = 0; k < 3 && alias.has(final); k++) final = alias.get(final)!;
      const p = byTitle.get(final);
      const d: WikiDetail | null =
        p && p.missing === undefined
          ? { title: p.title, extract: p.extract ?? '', thumb: p.thumbnail?.source, url: p.fullurl, fr: lang === 'fr' ? p.title : p.langlinks?.[0]?.['*'] }
          : null;
      cacheSet(`c:wd:${lang}:${t}`, d, 14 * DAY);
      if (d) out.set(t, d);
    }
  }
  return out;
}

/** Nombre de photos Wikimedia prises autour d'un point (signal de beauté) et une jolie vignette. */
export async function commonsPhotos(coord: LngLat, radius: number, signal?: AbortSignal): Promise<{ count: number; thumb?: string }> {
  const key = `c:cm:${coord[0].toFixed(4)},${coord[1].toFixed(4)}:${radius}`;
  return cached(key, 30 * DAY, async () => {
    const u =
      `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch` +
      `&ggscoord=${coord[1].toFixed(6)}%7C${coord[0].toFixed(6)}&ggsradius=${radius}&ggslimit=40&ggsnamespace=6` +
      `&prop=imageinfo&iiprop=url%7Csize%7Cmime&iiurlwidth=480`;
    const j = await wm<{ query?: { pages?: Record<string, { imageinfo?: Array<{ thumburl?: string; width: number; height: number; mime?: string }> }> } }>(u, signal, 7000);
    const pages = Object.values(j.query?.pages ?? {});
    const good = pages
      .map((p) => p.imageinfo?.[0])
      .filter((ii) => ii && ii.thumburl && /jpeg|png|webp/.test(ii.mime ?? '') && ii.width >= 800 && ii.width >= ii.height * 0.9);
    return { count: pages.length, thumb: good[0]?.thumburl };
  });
}
