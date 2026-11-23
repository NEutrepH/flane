// « Problème de la course d'orientation » : partir de A, finir en B, dans un budget de temps,
// en passant par la sélection de spots qui rapporte le plus de « beauté ».
// - Un spot est un point (monument, belvédère…) ou un tronçon à deux bouts qu'on traverse ou qu'on longe
//   (pont, rue piétonne, berge) : l'algorithme choisit le sens qui enchaîne le mieux.
// - Les demi-tours (repartir vers d'où l'on vient) coûtent de la beauté.
// Heuristique : insertion gloutonne randomisée (GRASP) + 2-opt + déplacements + échanges.

export interface OPItem {
  value: number;
  kind: string;
  cat: string;
  name: string;
  /** indices dans la matrice : un point, ou les deux bouts d'un tronçon */
  nodes: number[];
}

export interface OPInput {
  items: OPItem[];
  /** matrice de temps (s) entre points : 0 = départ, 1 = arrivée, puis les points des spots */
  time: number[][];
  budget: number;
  /** points de passage au plus (un tronçon en compte deux) */
  maxPoints: number;
  seed?: number;
  /** solution de départ (par ex. celle d'une durée voisine), pour des trajets qui évoluent en douceur */
  init?: number[];
  iterations?: number;
  /** positions des points de la matrice (m, repère local) : sert à repérer les demi-tours */
  xy?: Array<[number, number]>;
  /** beauté perdue par mètre refait en sens inverse (0 : on ignore les demi-tours) */
  reversalWeight?: number;
  /** petit bonus par seconde utilisée : à beauté presque égale, on préfère la balade qui remplit le temps demandé */
  timeBonus?: number;
}

export interface OPSolution {
  order: number[];
  /** pour chaque tronçon : vrai si on le prend du 2e bout vers le 1er */
  flips: boolean[];
  time: number;
  /** beauté totale, demi-tours déduits */
  value: number;
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

/**
 * Mètres probablement refaits en sens inverse le long d'une suite de points : à chaque point, on compare la
 * direction d'arrivée et celle de départ. Demi-tour complet → la plus courte des deux branches est refaite.
 */
export function reversal(seq: number[], xy: Array<[number, number]>): number {
  let r = 0;
  for (let j = 1; j < seq.length - 1; j++) {
    const [px, py] = xy[seq[j - 1]];
    const [cx, cy] = xy[seq[j]];
    const [nx, ny] = xy[seq[j + 1]];
    const ax = cx - px;
    const ay = cy - py;
    const bx = nx - cx;
    const by = ny - cy;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1 || lb < 1) continue;
    const cos = (ax * bx + ay * by) / (la * lb);
    if (cos < 0) r += -cos * Math.min(la, lb);
  }
  return r;
}

export const pointsUsed = (order: number[], items: OPItem[]) => order.reduce((n, i) => n + items[i].nodes.length, 0);

type Evaluate = (order: number[]) => OPSolution;

/** Évalue un ordre : sens de passage optimal des tronçons (programmation dynamique), temps, beauté nette. */
export function evaluator(inp: Pick<OPInput, 'items' | 'time' | 'xy' | 'reversalWeight'>): Evaluate {
  const { items, time: T } = inp;
  const w = inp.xy && inp.reversalWeight ? inp.reversalWeight : 0;
  const memo = new Map<string, OPSolution>();
  return (order) => {
    const key = order.join(',');
    const hit = memo.get(key);
    if (hit) return hit;
    const k = order.length;
    const back = new Int8Array(k * 2);
    let prevNodes = [0];
    let prevTimes = [0];
    for (let s = 0; s < k; s++) {
      const n = items[order[s]].nodes;
      const nextNodes: number[] = [];
      const nextTimes: number[] = [];
      for (let o = 0; o < n.length; o++) {
        const entry = n[o];
        const exit = n.length === 1 ? n[0] : n[1 - o];
        const inner = entry === exit ? 0 : T[entry][exit];
        let best = Infinity;
        let bi = 0;
        for (let p = 0; p < prevNodes.length; p++) {
          const t = prevTimes[p] + T[prevNodes[p]][entry] + inner;
          if (t < best) {
            best = t;
            bi = p;
          }
        }
        back[s * 2 + o] = bi;
        nextNodes.push(exit);
        nextTimes.push(best);
      }
      prevNodes = nextNodes;
      prevTimes = nextTimes;
    }
    let time = Infinity;
    let o = 0;
    for (let p = 0; p < prevNodes.length; p++) {
      const t = prevTimes[p] + T[prevNodes[p]][1];
      if (t < time) {
        time = t;
        o = p;
      }
    }
    const flips = new Array<boolean>(k).fill(false);
    const seq: number[] = [];
    for (let s = k - 1; s >= 0; s--) {
      const n = items[order[s]].nodes;
      if (n.length === 1) seq.push(n[0]);
      else {
        flips[s] = o === 1;
        seq.push(n[1 - o], n[o]);
      }
      o = back[s * 2 + o];
    }
    seq.reverse();
    let value = setValue(order, items);
    if (w) value -= w * reversal([0, ...seq, 1], inp.xy!);
    const sol: OPSolution = { order, flips, time, value };
    memo.set(key, sol);
    return sol;
  };
}

/** Temps d'un ordre de passage (sens des tronçons optimisé). */
export function pathTime(order: number[], inp: Pick<OPInput, 'items' | 'time'>): number {
  return evaluator(inp)(order).time;
}

/** Meilleure place (et sens) pour insérer un spot, à sens des autres inchangés : un tri rapide avant l'évaluation exacte. */
function screenInsert(cur: OPSolution, c: number, inp: OPInput): { pos: number; delta: number } {
  const { items, time: T } = inp;
  const ends = cur.order.map((i, s) => {
    const n = items[i].nodes;
    return n.length === 1 ? [n[0], n[0]] : cur.flips[s] ? [n[1], n[0]] : [n[0], n[1]];
  });
  const n = items[c].nodes;
  const opts = n.length === 1 ? [[n[0], n[0]]] : [n, [n[1], n[0]]];
  let best = { pos: 0, delta: Infinity };
  for (let p = 0; p <= ends.length; p++) {
    const a = p === 0 ? 0 : ends[p - 1][1];
    const b = p === ends.length ? 1 : ends[p][0];
    for (const [en, ex] of opts) {
      const d = T[a][en] + (en === ex ? 0 : T[en][ex]) + T[ex][b] - T[a][b];
      if (d < best.delta) best = { pos: p, delta: d };
    }
  }
  return best;
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

function greedyFill(start: number[], inp: OPInput, ev: Evaluate, rnd: (() => number) | null, rcl = 3): number[] {
  const { items, budget, maxPoints } = inp;
  let cur = ev(start);
  const used = new Set(cur.order);
  let pts = pointsUsed(cur.order, items);
  for (;;) {
    const options: Array<{ c: number; e: OPSolution; ratio: number }> = [];
    for (let c = 0; c < items.length; c++) {
      if (used.has(c) || !(items[c].value > 0) || pts + items[c].nodes.length > maxPoints) continue;
      const scr = screenInsert(cur, c, inp);
      if (!isFinite(scr.delta) || cur.time + scr.delta > budget * 1.03) continue;
      const next = [...cur.order];
      next.splice(scr.pos, 0, c);
      const e = ev(next);
      const dv = e.value - cur.value + (inp.timeBonus ?? 0) * (e.time - cur.time);
      if (e.time > budget || dv <= 0) continue;
      options.push({ c, e, ratio: dv / (Math.max(0, e.time - cur.time) + 45) });
    }
    if (!options.length) break;
    options.sort((a, b) => b.ratio - a.ratio);
    const pick = rnd ? options[Math.floor(rnd() * Math.min(rcl, options.length))] : options[0];
    cur = pick.e;
    used.add(pick.c);
    pts += items[pick.c].nodes.length;
  }
  return cur.order;
}

/** Plus de beauté nette d'abord, puis plus court, sans dépasser le budget. */
function better(c: OPSolution, b: OPSolution, budget: number): boolean {
  if (c.time > budget) return false;
  return c.value > b.value + 1e-9 || (Math.abs(c.value - b.value) <= 1e-9 && c.time + 1e-6 < b.time);
}

function twoOpt(order: number[], inp: OPInput, ev: Evaluate): number[] {
  let best = ev(order);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.order.length - 1; i++) {
      for (let j = i + 1; j < best.order.length; j++) {
        const o = best.order;
        const cand = ev([...o.slice(0, i), ...o.slice(i, j + 1).reverse(), ...o.slice(j + 1)]);
        if (better(cand, best, inp.budget)) {
          best = cand;
          improved = true;
        }
      }
    }
  }
  return best.order;
}

/** Déplace un spot ailleurs dans l'ordre si ça raccourcit le trajet ou évite un demi-tour. */
function relocate(order: number[], inp: OPInput, ev: Evaluate): number[] {
  let best = ev(order);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.order.length && !improved; i++) {
      const rest = best.order.filter((_, k) => k !== i);
      for (let p = 0; p <= rest.length; p++) {
        if (p === i) continue;
        const cand = [...rest];
        cand.splice(p, 0, best.order[i]);
        const e = ev(cand);
        if (better(e, best, inp.budget)) {
          best = e;
          improved = true;
          break;
        }
      }
    }
  }
  return best.order;
}

/** Remplace un spot par un autre hors trajet si l'ensemble y gagne. */
function swapImprove(order: number[], inp: OPInput, ev: Evaluate): number[] {
  const { items, budget, maxPoints } = inp;
  let cur = ev(order);
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 4) {
    improved = false;
    for (let k = 0; k < cur.order.length && !improved; k++) {
      const base = ev(cur.order.filter((_, i) => i !== k));
      const pts = pointsUsed(base.order, items);
      for (let c = 0; c < items.length; c++) {
        if (cur.order.includes(c) || !(items[c].value > 0) || pts + items[c].nodes.length > maxPoints) continue;
        const scr = screenInsert(base, c, inp);
        if (base.time + scr.delta > budget * 1.03) continue;
        const next = [...base.order];
        next.splice(scr.pos, 0, c);
        const e = ev(next);
        const gain = e.value - cur.value + (inp.timeBonus ?? 0) * (e.time - cur.time);
        if (e.time <= budget && gain > 1e-6) {
          cur = e;
          improved = true;
          break;
        }
      }
    }
  }
  return cur.order;
}

export function solveOP(inp: OPInput): OPSolution {
  const { items, budget } = inp;
  const ev = evaluator(inp);
  const empty = ev([]);
  if (!items.length || empty.time > budget) return empty;
  const rnd = mulberry32(inp.seed ?? 7);
  const polish = (o: number[]) => {
    let x = twoOpt(o, inp, ev);
    x = relocate(x, inp, ev);
    x = greedyFill(x, inp, ev, null);
    x = swapImprove(x, inp, ev);
    x = twoOpt(x, inp, ev);
    return greedyFill(x, inp, ev, null);
  };
  // Comparaison des solutions complètes : la beauté, plus un petit bonus pour le temps utilisé
  // (la durée demandée fait partie du contrat). L'ordre de passage, lui, reste optimisé au plus court.
  const score = (s: OPSolution) => s.value + (inp.timeBonus ?? 0) * s.time;
  const beats = (a: OPSolution, b: OPSolution) => score(a) > score(b) + 1e-6 || (Math.abs(score(a) - score(b)) <= 1e-6 && a.time < b.time);

  let warm: OPSolution | null = null;
  const init = [...new Set(inp.init ?? [])].filter((i) => i >= 0 && i < items.length && items[i].value > 0);
  if (init.length && pointsUsed(init, items) <= inp.maxPoints && ev(init).time <= budget) warm = ev(polish(init));

  let best = warm ?? empty;
  const iterations = inp.iterations ?? 24;
  for (let it = 0; it < iterations; it++) {
    const s = ev(polish(greedyFill([], inp, ev, it === 0 ? null : rnd)));
    if (beats(s, best)) best = s;
  }
  // Stabilité : si la solution prolongée vaut presque autant et remplit le temps, on la garde
  // (le trajet « grandit » au lieu de sauter).
  if (warm && warm.time >= budget * 0.9 && score(warm) >= score(best) * 0.97) return warm;
  return best;
}
