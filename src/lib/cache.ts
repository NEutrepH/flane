// Petit cache localStorage avec date d'expiration. Tout est optionnel : si le stockage
// est indisponible (navigation privée, quota plein), l'app continue sans cache.

const PREFIX = 'flane:';

export function cacheGet<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return undefined;
    const { e, v } = JSON.parse(raw) as { e: number; v: T };
    if (e && e < Date.now()) {
      localStorage.removeItem(PREFIX + key);
      return undefined;
    }
    return v;
  } catch {
    return undefined;
  }
}

export function cacheSet(key: string, value: unknown, ttlMs = 14 * 864e5): void {
  let raw: string;
  try {
    raw = JSON.stringify({ e: ttlMs ? Date.now() + ttlMs : 0, v: value });
  } catch {
    return;
  }
  try {
    localStorage.setItem(PREFIX + key, raw);
  } catch {
    evict();
    try {
      localStorage.setItem(PREFIX + key, raw);
    } catch {
      /* stockage plein : on s'en passe */
    }
  }
}

/** Supprime la moitié des entrées de cache (clés « c: »), jamais les préférences. */
function evict() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX + 'c:')) keys.push(k);
    }
    keys.slice(0, Math.ceil(keys.length / 2)).forEach((k) => localStorage.removeItem(k));
  } catch {
    /* rien */
  }
}

const inflight = new Map<string, Promise<unknown>>();

/** Valeur en cache, sinon calculée une seule fois même si plusieurs appels arrivent en même temps. */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = fn()
    .then((v) => {
      cacheSet(key, v, ttlMs);
      return v;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function prefGet<T>(key: string, fallback: T): T {
  const v = cacheGet<T>('p:' + key);
  return v === undefined ? fallback : v;
}

export function prefSet(key: string, value: unknown) {
  cacheSet('p:' + key, value, 0);
}
