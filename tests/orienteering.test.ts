import { describe, expect, it } from 'vitest';
import { evaluator, pathTime, reversal, solveOP, type OPItem } from '../src/engine/orienteering';

type XY = [number, number];
const matrix = (pts: XY[]) => pts.map((a) => pts.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])));

// Plan fictif en mètres, on marche à 1 m/s : départ (0,0), arrivée (1000,0), 8 spots ponctuels autour.
function scenario() {
  const pts: XY[] = [
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
  const kinds = ['park', 'viewpoint', 'bridge', 'street', 'water', 'castle', 'artwork', 'square'];
  const cats = ['nature', 'vue', 'vue', 'urbain', 'nature', 'patrimoine', 'urbain', 'urbain'];
  const values = [5, 8, 6, 3, 4, 9, 2, 3];
  const items: OPItem[] = values.map((value, i) => ({ value, kind: kinds[i], cat: cats[i], name: `spot ${i}`, nodes: [i + 2] }));
  return { T: matrix(pts), items, xy: pts };
}

describe('balade sous contrainte de temps', () => {
  it("ne dépasse jamais le budget ni le nombre de points de passage", () => {
    const { T, items } = scenario();
    for (const budget of [1000, 1300, 1800, 2500, 4000]) {
      const s = solveOP({ items, time: T, budget, maxPoints: 4 });
      expect(s.time).toBeLessThanOrEqual(budget);
      expect(s.order.length).toBeLessThanOrEqual(4);
      expect(pathTime(s.order, { items, time: T })).toBeCloseTo(s.time, 6);
    }
  });

  it('sans minute de plus, garde le chemin direct', () => {
    const { T, items } = scenario();
    expect(solveOP({ items, time: T, budget: 1000, maxPoints: 8 }).order).toEqual([]);
  });

  it('avec un petit détour, prend le spot posé sur le chemin', () => {
    const { T, items } = scenario();
    const s = solveOP({ items, time: T, budget: 1100, maxPoints: 8 });
    expect(s.order).toContain(0);
    expect(s.time).toBeLessThanOrEqual(1100);
  });

  it('plus de temps donne au moins autant de beauté (et le trajet grandit au lieu de sauter)', () => {
    const { T, items } = scenario();
    let prev: number[] = [];
    let prevValue = -1;
    for (const budget of [1100, 1300, 1600, 2000, 2600, 3500]) {
      const s = solveOP({ items, time: T, budget, maxPoints: 8, init: prev });
      expect(s.value).toBeGreaterThanOrEqual(prevValue - 1e-9);
      prev = s.order;
      prevValue = s.value;
    }
  });

  it('donne toujours la même réponse pour la même question', () => {
    const { T, items } = scenario();
    const a = solveOP({ items, time: T, budget: 2400, maxPoints: 6, seed: 3 });
    const b = solveOP({ items, time: T, budget: 2400, maxPoints: 6, seed: 3 });
    expect(a.order).toEqual(b.order);
  });
});

describe('ponts, rues et berges : on les traverse', () => {
  // Départ (0,0), arrivée (1000,0) ; un pont dont les bouts sont donnés « à l'envers » : (600,0) puis (400,0).
  const pts: XY[] = [
    [0, 0],
    [1000, 0],
    [600, 0],
    [400, 0],
  ];
  const T = matrix(pts);
  const bridge: OPItem = { value: 6, kind: 'bridge', cat: 'vue', name: 'pont', nodes: [2, 3] };

  it('choisit le sens qui évite le demi-tour', () => {
    const e = evaluator({ items: [bridge], time: T })([0]);
    expect(e.flips).toEqual([true]);
    expect(e.time).toBeCloseTo(1000, 6);
  });

  it('un tronçon compte pour deux points de passage', () => {
    const s = solveOP({ items: [bridge], time: T, budget: 1000, maxPoints: 1 });
    expect(s.order).toEqual([]);
    expect(solveOP({ items: [bridge], time: T, budget: 1000, maxPoints: 2 }).order).toEqual([0]);
  });

  it('repère un demi-tour sur un spot en cul-de-sac', () => {
    const xy: XY[] = [
      [0, 0],
      [1000, 0],
      [500, 300],
      [500, 0],
    ];
    expect(reversal([0, 2, 1], xy)).toBeLessThan(1);
    expect(reversal([0, 3, 2, 3, 1], xy)).toBeGreaterThan(250);
  });

  it('préfère un spot sur le chemin à un spot qui oblige à revenir sur ses pas', () => {
    // Le spot 1, un peu plus beau, est derrière le départ : y aller puis repartir = refaire 300 m.
    const xy: XY[] = [
      [0, 0],
      [1000, 0],
      [500, 0],
      [-300, 0],
    ];
    const items: OPItem[] = [
      { value: 5, kind: 'park', cat: 'nature', name: 'sur le chemin', nodes: [2] },
      { value: 5.5, kind: 'park', cat: 'nature', name: 'derrière', nodes: [3] },
    ];
    const T = matrix(xy);
    expect(solveOP({ items, time: T, budget: 1700, maxPoints: 1 }).order).toEqual([1]);
    expect(solveOP({ items, time: T, budget: 1700, maxPoints: 1, xy, reversalWeight: 0.02 }).order).toEqual([0]);
  });
});
