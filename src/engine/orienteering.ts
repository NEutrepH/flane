// « Problème de la course d'orientation » : partir de A, finir en B, dans un budget de temps,
// en passant par la sélection de spots qui rapporte le plus de « beauté ».
// Heuristique : insertion gloutonne randomisée (GRASP) + 2-opt + déplacements + échanges.

export interface OPItem {
  value: number;
  kind: string;
  cat: string;
  name: string;
}

export interface OPInput {
  items: OPItem[];
  /** matrice de temps (s) : indice 0 = départ, 1 = arrivée, 2 + i = spot i */
  time: number[][];
  budget: number;
  maxStops: number;
  seed?: number;
  /** solution de départ (par ex. celle d'un budget plus court), pour des trajets qui évoluent en douceur */
  init?: number[];
  iterations?: number;
}

export interface OPSolution {
  order: number[];
  time: number;
  value: number;
}

export function pathTime(order: number[], T: number[][]): number {
  let t = 0;
  let prev = 0;
  for (const i of order) {
    t += T[prev][i + 2];
    prev = i + 2;
  }
  return t + T[prev][1];
}

/** Valeur d'un ensemble, avec rendements décroissants : 3 églises valent moins que 3 lieux différents. */
export function setValue(order: number[], items: OPItem[]): number {
  const sorted = [...order].sort((a, b) => items[b].value - items[a].value);
  const kinds = new Map<string, number>();
  const cats = new Map<string, number>();
  const names = new Map<string, number>();
  let v = 0;
  for (const i of sorted) {
    const it = items[i];
    const k = kinds.get(it.kind) ?? 0;
    const c = cats.get(it.cat) ?? 0;
    const n = it.name ? (names.get(it.name) ?? 0) : 0;
    v += it.value * 0.7 ** k * 0.9 ** Math.max(0, c - 1) * 0.35 ** n;
    kinds.set(it.kind, k + 1);
    cats.set(it.cat, c + 1);
    if (it.name) names.set(it.name, n + 1);
  }
  return v;
}

function mulberry32(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bestInsertion(order: number[], c: number, T: number[][]): { pos: number; delta: number } {
  let best = { pos: 0, delta: Infinity };
  for (let p = 0; p <= order.length; p++) {
    const a = p === 0 ? 0 : order[p - 1] + 2;
    const b = p === order.length ? 1 : order[p] + 2;
    const d = T[a][c + 2] + T[c + 2][b] - T[a][b];
    if (d < best.delta) best = { pos: p, delta: d };
  }
  return best;
}

function greedyFill(start: number[], inp: OPInput, rnd: (() => number) | null, rcl = 3): number[] {
  const { items, time: T, budget, maxStops } = inp;
  const cur = [...start];
  let t = pathTime(cur, T);
  let v = setValue(cur, items);
  const used = new Set(cur);
  while (cur.length < maxStops) {
    const options: Array<{ c: number; pos: number; delta: number; dv: number; ratio: number }> = [];
    for (let c = 0; c < items.length; c++) {
      if (used.has(c) || !(items[c].value > 0)) continue;
      const ins = bestInsertion(cur, c, T);
      if (!isFinite(ins.delta) || t + ins.delta > budget) continue;
      const next = [...cur];
      next.splice(ins.pos, 0, c);
      const dv = setValue(next, items) - v;
      if (dv <= 0) continue;
      options.push({ c, pos: ins.pos, delta: ins.delta, dv, ratio: dv / (Math.max(0, ins.delta) + 45) });
    }
    if (!options.length) break;
    options.sort((a, b) => b.ratio - a.ratio);
    const pick = rnd ? options[Math.floor(rnd() * Math.min(rcl, options.length))] : options[0];
    cur.splice(pick.pos, 0, pick.c);
    used.add(pick.c);
    t += pick.delta;
    v += pick.dv;
  }
  return cur;
}

function twoOpt(order: number[], T: number[][]): number[] {
  let best = [...order];
  let bt = pathTime(best, T);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const cand = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        const ct = pathTime(cand, T);
        if (ct + 1e-6 < bt) {
          best = cand;
          bt = ct;
          improved = true;
        }
      }
    }
  }
  return best;
}

/** Déplace un spot ailleurs dans l'ordre si ça raccourcit le trajet. */
function relocate(order: number[], T: number[][]): number[] {
  let best = [...order];
  let bt = pathTime(best, T);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length; i++) {
      const rest = best.filter((_, k) => k !== i);
      const ins = bestInsertion(rest, best[i], T);
      const cand = [...rest];
      cand.splice(ins.pos, 0, best[i]);
      const ct = pathTime(cand, T);
      if (ct + 1e-6 < bt) {
        best = cand;
        bt = ct;
        improved = true;
      }
    }
  }
  return best;
}

/** Remplace un spot par un autre hors trajet si l'ensemble y gagne. */
function swapImprove(order: number[], inp: OPInput): number[] {
  const { items, time: T, budget } = inp;
  let cur = order;
  let v = setValue(cur, items);
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 25) {
    improved = false;
    for (let k = 0; k < cur.length && !improved; k++) {
      const base = cur.filter((_, i) => i !== k);
      for (let c = 0; c < items.length; c++) {
        if (cur.includes(c) || !(items[c].value > 0)) continue;
        const ins = bestInsertion(base, c, T);
        const next = [...base];
        next.splice(ins.pos, 0, c);
        if (pathTime(next, T) > budget) continue;
        const nv = setValue(next, items);
        if (nv > v + 1e-6) {
          cur = next;
          v = nv;
          improved = true;
          break;
        }
      }
    }
  }
  return cur;
}

export function solveOP(inp: OPInput): OPSolution {
  const { items, time: T, budget } = inp;
  const evalSol = (o: number[]): OPSolution => ({ order: o, time: pathTime(o, T), value: setValue(o, items) });
  if (!items.length || pathTime([], T) > budget) return evalSol([]);
  const rnd = mulberry32(inp.seed ?? 7);
  const polish = (o: number[]) => {
    let x = twoOpt(o, T);
    x = relocate(x, T);
    x = greedyFill(x, inp, null);
    x = swapImprove(x, inp);
    x = twoOpt(x, T);
    return greedyFill(x, inp, null);
  };
  const better = (a: OPSolution, b: OPSolution) => a.value > b.value + 1e-6 || (Math.abs(a.value - b.value) <= 1e-6 && a.time < b.time);

  let warm: OPSolution | null = null;
  const init = inp.init?.filter((i) => i >= 0 && i < items.length);
  if (init?.length && init.length <= inp.maxStops && pathTime(init, T) <= budget) warm = evalSol(polish(init));

  let best = warm ?? evalSol([]);
  const iterations = inp.iterations ?? 28;
  for (let it = 0; it < iterations; it++) {
    const s = evalSol(polish(greedyFill([], inp, it === 0 ? null : rnd)));
    if (better(s, best)) best = s;
  }
  // Stabilité : si la solution prolongée vaut presque autant, on la garde (le trajet « grandit » au lieu de sauter).
  if (warm && warm.value >= best.value * 0.97) return warm;
  return best;
}
