// Test « en vrai » (réseau) : LIVE=1 npx vitest run tests/pipeline.live.test.ts
import { describe, expect, it } from 'vitest';
import { Planner } from '../src/engine/planner';

const live = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.LIVE === '1';

describe.skipIf(!live)('pipeline réel (Maastricht)', () => {
  it('trace une balade gare → Vrijthof qui respecte la durée', async () => {
    const p = new Planner([5.70531, 50.8497], [5.6889, 50.8487], 'walk', { nature: true, patrimoine: true, vue: true, urbain: true }, 'NL');
    const t = Date.now();
    const base = await p.loadBase();
    console.log(`base ${Math.round(base.duration / 60)} min (${base.engine}), max ${p.tmaxmin} min`);
    await p.prepare(undefined, (s) => console.log(`étape ${s} à ${Date.now() - t} ms`));
    console.log(`spots ${p.all.length}, candidats ${p.cands.length}, prêt en ${Date.now() - t} ms`);
    const kinds: Record<string, number> = {};
    p.all.forEach((s) => (kinds[s.kind] = (kinds[s.kind] ?? 0) + 1));
    console.log(kinds);
    console.log(
      p.cands
        .slice(0, 30)
        .map((c) => `${c.kind.padEnd(10)} ${c.score.toFixed(1).padStart(5)} ph=${String(c.photos ?? '-').padStart(2)} ${c.name}${c.wiki ? ` [${c.wiki.lang}:${c.wiki.title}]` : ''}`)
        .join('\n'),
    );
    for (const d of [5, 15, 30]) {
      const m = p.t0min + d;
      const plan = await p.planFor(m);
      const real = Math.round(plan.route.duration / 60);
      console.log(`${m} min demandées → ${real} min (${plan.route.engine}) : ${plan.stops.map((s) => s.spot.name).join(' > ')} | en chemin : ${plan.bonus.map((b) => b.spot.name).join(', ')}`);
      expect(Math.abs(real - m)).toBeLessThanOrEqual(Math.max(4, m * 0.2));
    }
  }, 180000);
});
