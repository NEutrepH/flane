// Mesure « en vrai » des allers-retours : LIVE=1 npx vitest run tests/backtrack.live.test.ts
import { describe, it } from 'vitest';
import { Planner, type Plan } from '../src/engine/planner';
import { getRoute, type Route } from '../src/data/routing';
import { nearestOnLine, repeatedStretches, type LngLat } from '../src/lib/geo';
import type { Spot } from '../src/data/spots';

const live = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.LIVE === '1';

const TRIPS: Array<{ name: string; from: LngLat; to: LngLat }> = [
  { name: 'gare → Vrijthof', from: [5.70531, 50.8497], to: [5.6889, 50.8487] },
  { name: 'Vrijthof → Sint-Pietersberg', from: [5.6889, 50.8487], to: [5.6868, 50.8335] },
  { name: 'boucle depuis le Markt', from: [5.6912, 50.8515], to: [5.6912, 50.8515] },
];

/** Sépare les vrais allers-retours (on revient sur ses pas juste après un spot) du reste. */
function analyse(route: Route, stops: Spot[]) {
  const { coords, cum } = route;
  let from = 0;
  const along = stops.map((s) => {
    const h = nearestOnLine(coords, cum, s.coord, from, coords.length - 1);
    from = h.index;
    return h.along;
  });
  const rep = repeatedStretches(coords, cum);
  const spokes = new Map<string, number>();
  let other = 0;
  for (const [a, b] of rep.pairs) {
    const mid = (a + b) / 2;
    const k = along.findIndex((s) => a <= s + 15 && s - 15 <= b && Math.abs(mid - s) < 35);
    if (k >= 0) spokes.set(stops[k].name, (spokes.get(stops[k].name) ?? 0) + 10);
    else other += 10;
  }
  const spokeTotal = [...spokes.values()].reduce((x, y) => x + y, 0);
  return { spokeTotal, other, detail: [...spokes.entries()].map(([n, m]) => `${n} ${m * 2} m`).join(', ') };
}

const line = (label: string, route: Route, stops: Spot[]) => {
  const a = analyse(route, stops);
  return `${label.padEnd(12)} ${String(Math.round(route.duration / 60)).padStart(3)}′  allers-retours ${String(a.spokeTotal * 2).padStart(4)} m · autres repassages ${String(a.other).padStart(4)} m  ${a.detail ? '← ' + a.detail : ''}`;
};

describe.skipIf(!live)('allers-retours sur de vraies balades', () => {
  it('distingue allers-retours et autres repassages', async () => {
    const sum: Record<string, { spokes: number; other: number; n: number }> = {};
    const add = (k: string, route: Route, stops: Spot[]) => {
      const a = analyse(route, stops);
      sum[k] ??= { spokes: 0, other: 0, n: 0 };
      sum[k].spokes += a.spokeTotal * 2;
      sum[k].other += a.other;
      sum[k].n++;
    };
    for (const trip of TRIPS) {
      const p = new Planner(trip.from, trip.to, 'walk', { nature: true, patrimoine: true, vue: true, urbain: true }, 'NL');
      await p.loadBase();
      await p.prepare(undefined, () => {});
      const lines: string[] = [];
      for (const d of [15, 25, 40]) {
        const m = p.t0min + d;
        p.resetLearning();
        p.setReversalWeight(0);
        const old = p.solve(m).order.map((i) => p.cands[i]);
        const A = await getRoute([trip.from, ...old.map((s) => s.coord), trip.to], 'walk');
        lines.push(line(`${m}′ avant`, A, old));
        add('avant', A, old);
        for (const [label, w] of [['nouveau', 0], ['+ angle', 0.02]] as const) {
          p.resetLearning();
          p.setReversalWeight(w);
          const plan: Plan = await p.planFor(m);
          const stops = plan.stops.map((s) => s.spot);
          lines.push(line(`${m}′ ${label}`, plan.route, stops));
          add(label, plan.route, stops);
        }
      }
      console.log(`${trip.name}\n  ${lines.join('\n  ')}`);
    }
    console.log(
      Object.entries(sum)
        .map(([k, v]) => `${k} : allers-retours ${Math.round(v.spokes / v.n)} m par balade, autres repassages ${Math.round(v.other / v.n)} m`)
        .join('\n'),
    );
  }, 400000);
});
