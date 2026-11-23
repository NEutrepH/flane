// Ambiance mesurée sur des lieux connus de Maastricht : LIVE=1 npx vitest run tests/ambience.live.test.ts
import { describe, expect, it } from 'vitest';
import { ambienceAt, TRAITS } from '../src/data/context';
import type { LngLat } from '../src/lib/geo';

const live = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.LIVE === '1';

const PLACES: Array<[string, LngLat]> = [
  ['Pont Saint-Servais', [5.6962, 50.8494]],
  ['Stadspark', [5.6878, 50.8445]],
  ['Vrijthof', [5.6889, 50.8487]],
  ['Markt', [5.6912, 50.8515]],
  ['Jekerkwartier', [5.6895, 50.8462]],
  ['Gare', [5.7053, 50.8497]],
];

describe.skipIf(!live)('ambiance de lieux connus', () => {
  it('mesure des ambiances cohérentes', async () => {
    const rows: string[] = [];
    const got: Record<string, Record<string, number>> = {};
    for (const [name, p] of PLACES) {
      const t = await ambienceAt(p);
      got[name] = t;
      rows.push(`${name.padEnd(20)} ${TRAITS.map((k) => `${k} ${String(Math.round(t[k] * 100)).padStart(3)}`).join('  ')}`);
    }
    console.log(rows.join('\n'));
    expect(got['Pont Saint-Servais'].eau).toBeGreaterThan(0.5);
    expect(got['Stadspark'].verdure).toBeGreaterThan(0.5);
    expect(got['Markt'].animation).toBeGreaterThan(got['Stadspark'].animation);
  }, 60000);
});
