// Ton goût : chaque coup de cœur retient ce qui rend le lieu spécial (par rapport au reste de la balade),
// et les balades suivantes favorisent les spots qui ont la même ambiance.
import { TRAITS, TRAIT_LABEL, type Trait, type Traits } from '../data/context';
import type { LngLat } from '../lib/geo';

export interface Like {
  id: string;
  coord: LngLat;
  ts: number;
  name: string;
  /** ambiance mesurée autour du lieu */
  ctx: Traits;
  /** ce qui le distingue du reste de la balade : c'est ça qui forge le goût */
  signal: Traits;
  spotId?: string;
}

export interface Taste {
  /** poids de chaque trait, le plus fort vaut 1 */
  weights: Traits;
  /** 0 → 1 selon le nombre de coups de cœur (3 suffisent pour personnaliser pleinement) */
  confidence: number;
  count: number;
}

/** Un coup de cœur compte moitié moins au bout de deux mois. */
const HALF_LIFE_DAYS = 60;
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Ce qui distingue un lieu de la balade en cours (moyenne des spots du trajet), ou son ambiance brute. */
export function signalOf(ctx: Traits, baseline: Traits | null): Traits {
  const out = {} as Traits;
  for (const t of TRAITS) out[t] = round2(Math.max(0, ctx[t] - (baseline ? 0.5 * baseline[t] : 0)));
  return out;
}

/** Les raisons d'un coup de cœur, de la plus forte à la plus faible (3 au plus). */
export function reasons(like: Pick<Like, 'ctx' | 'signal'>, max = 3): Trait[] {
  const strong = TRAITS.filter((t) => like.signal[t] >= 0.2).sort((a, b) => like.signal[b] - like.signal[a]);
  if (strong.length) return strong.slice(0, max);
  return [...TRAITS].sort((a, b) => like.ctx[b] - like.ctx[a]).slice(0, Math.min(2, max));
}

/** « Le bord de l'eau et le calme. » */
export function phrase(traits: Trait[]): string {
  if (!traits.length) return 'Un coin à part.';
  const words = traits.map((t) => TRAIT_LABEL[t]);
  const text = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} et ${words[words.length - 1]}`;
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

export function tasteOf(likes: Like[], now = Date.now()): Taste | null {
  if (!likes.length) return null;
  const w = {} as Traits;
  for (const t of TRAITS) w[t] = 0;
  for (const l of likes) {
    const k = 0.5 ** ((now - l.ts) / 864e5 / HALF_LIFE_DAYS);
    for (const t of TRAITS) w[t] += k * l.signal[t];
  }
  const max = Math.max(...TRAITS.map((t) => w[t]));
  if (!(max > 0)) return null;
  for (const t of TRAITS) w[t] = round2(w[t] / max);
  return { weights: w, confidence: Math.min(1, likes.length / 3), count: likes.length };
}

/** Les traits dominants du goût, du plus fort au plus faible. */
export function topTraits(taste: Taste, max = 2): Trait[] {
  return [...TRAITS].filter((t) => taste.weights[t] >= 0.3).sort((a, b) => taste.weights[b] - taste.weights[a]).slice(0, max);
}

/** À quel point l'ambiance d'un lieu correspond au goût (0 à 1). */
export function affinity(traits: Traits, taste: Taste): number {
  let num = 0;
  let den = 0;
  for (const t of TRAITS) {
    num += taste.weights[t] * traits[t];
    den += taste.weights[t];
  }
  return den > 0 ? num / den : 0;
}

/** Multiplicateur de beauté personnalisé : jusqu'à ×1,9 pour un lieu qui colle parfaitement au goût. */
export function tasteBoost(traits: Traits, taste: Taste | null): number {
  return taste ? 1 + 0.9 * taste.confidence * affinity(traits, taste) : 1;
}

function cosine(a: Traits, b: Traits): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (const t of TRAITS) {
    ab += a[t] * b[t];
    aa += a[t] * a[t];
    bb += b[t] * b[t];
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

/** Le coup de cœur qui ressemble le plus à ce lieu. */
export function closestLike(traits: Traits, likes: Like[]): { like: Like; sim: number } | null {
  let best: { like: Like; sim: number } | null = null;
  for (const like of likes) {
    const sim = cosine(traits, like.signal);
    if (!best || sim > best.sim) best = { like, sim };
  }
  return best;
}

/** Un spot « pour toi » : il colle au goût, et ressemble franchement à un lieu aimé. */
export function forYou(traits: Traits, taste: Taste | null, likes: Like[]): Like | null {
  if (!taste || affinity(traits, taste) < 0.45) return null;
  const c = closestLike(traits, likes);
  return c && c.sim >= 0.6 ? c.like : null;
}
