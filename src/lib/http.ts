// Appels réseau JSON avec délai maximum, annulation et petite file de concurrence.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

interface Opts {
  signal?: AbortSignal;
  timeout?: number;
  init?: RequestInit;
}

export function isAbort(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'name' in e && (e as { name: string }).name === 'AbortError';
}

export async function fetchJSON<T = unknown>(url: string, { signal, timeout = 10000, init }: Opts = {}): Promise<T> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(new DOMException('Aborted', 'AbortError'));
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(new DOMException('Délai dépassé', 'TimeoutError')), timeout);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const msg = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : `HTTP ${res.status}`;
      throw new HttpError(res.status, msg, body);
    }
    return body as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function postJSON<T = unknown>(url: string, data: unknown, opts: Omit<Opts, 'init'> = {}): Promise<T> {
  return fetchJSON<T>(url, {
    ...opts,
    init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) },
  });
}

/** Exécute `fn` sur chaque élément avec au plus `limit` appels simultanés. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
