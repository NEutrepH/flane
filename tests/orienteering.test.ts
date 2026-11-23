import { describe, expect, it } from 'vitest';
import { pathTime, solveOP, type OPItem } from '../src/engine/orienteering';

// Plan fictif en mètres, on marche à 1 m/s : départ (0,0), arrivée (1000,0), 8 spots autour.
function scenario() {
  const pts: Array<[number, number]> = [
    [0, 0],
    [1000, 0],
    [500, 50],
    [300, 400],
    [700, -300],
    [200, 50],
    [800, 60],
    [500, 900],
    [-200, 200],
    [1200, -100],
  ];
  const T = pts.map((a) => pts.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])));
  const kinds = ['park', 'viewpoint', 'bridge', 'street', 'water', 'castle', 'artwork', 'square'];
  const cats = ['nature', 'vue', 'vue', 'urbain', 'nature', 'patrimoine', 'urbain', 'urbain'];
  const values = [5, 8, 6, 3, 4, 9, 2, 3];
  const items: OPItem[] = values.map((value, i) => ({ value, kind: kinds[i], cat: cats[i], name: `spot ${i}` }));
  return { T, items };
}

describe('balade sous contrainte de temps', () => {
  it("ne dépasse jamais le budget ni le nombre d'étapes", () => {
    const { T, items } = scenario();
    for (const budget of [1000, 1300, 1800, 2500, 4000]) {
      const s = solveOP({ items, time: T, budget, maxStops: 4 });
      expect(s.time).toBeLessThanOrEqual(budget);
      expect(s.order.length).toBeLessThanOrEqual(4);
      expect(pathTime(s.order, T)).toBeCloseTo(s.time, 6);
    }
  });

  it('sans minute de plus, garde le chemin direct', () => {
    const { T, items } = scenario();
    expect(solveOP({ items, time: T, budget: 1000, maxStops: 8 }).order).toEqual([]);
  });

  it('avec un petit détour, prend le spot posé sur le chemin', () => {
    const { T, items } = scenario();
    const s = solveOP({ items, time: T, budget: 1100, maxStops: 8 });
    expect(s.order).toContain(0);
    expect(s.time).toBeLessThanOrEqual(1100);
  });

  it('plus de temps donne au moins autant de beauté (et le trajet grandit au lieu de sauter)', () => {
    const { T, items } = scenario();
    let prev: number[] = [];
    let prevValue = -1;
    for (const budget of [1100, 1300, 1600, 2000, 2600, 3500]) {
      const s = solveOP({ items, time: T, budget, maxStops: 8, init: prev });
      expect(s.value).toBeGreaterThanOrEqual(prevValue - 1e-9);
      prev = s.order;
      prevValue = s.value;
    }
  });

  it('donne toujours la même réponse pour la même question', () => {
    const { T, items } = scenario();
    const a = solveOP({ items, time: T, budget: 2400, maxStops: 6, seed: 3 });
    const b = solveOP({ items, time: T, budget: 2400, maxStops: 6, seed: 3 });
    expect(a.order).toEqual(b.order);
  });
});
