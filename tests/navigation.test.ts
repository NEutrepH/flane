import { describe, expect, it } from 'vitest';
import { Guide } from '../src/engine/navigation';
import { cumulative, type LngLat } from '../src/lib/geo';
import { dropJitter, type Maneuver, type Route } from '../src/data/routing';
import type { PlanSpot } from '../src/engine/planner';
import type { Spot } from '../src/data/spots';

// Une rue vers le nord (≈ 222 m) puis vers l'est (≈ 140 m).
const coords: LngLat[] = [
  [5.7, 50.85],
  [5.7, 50.851],
  [5.7, 50.852],
  [5.701, 50.852],
  [5.702, 50.852],
];
const cum = cumulative(coords);
const route: Route = {
  coords,
  cum,
  duration: 300,
  distance: cum[cum.length - 1],
  engine: 'valhalla',
  maneuvers: [
    { turn: 'depart', text: 'Partez vers le nord.', distance: cum[2], duration: 180, begin: 0, end: 2 },
    { turn: 'right', text: 'Tournez à droite.', distance: cum[4] - cum[2], duration: 120, begin: 2, end: 4 },
    { turn: 'arrive', text: 'Vous êtes arrivé.', distance: 0, duration: 0, begin: 4, end: 4 },
  ],
};
const spot = (id: string, coord: LngLat): Spot => ({ id, name: id, kind: 'castle', cat: 'patrimoine', coord, base: 5, score: 5 });
const chateau: PlanSpot = { spot: spot('chateau', [5.7, 50.8515]), along: (cum[1] + cum[2]) / 2, eta: 120, n: 1, bonus: false };

describe('guidage en direct', () => {
  it('suit la progression et annonce le prochain virage', () => {
    const g = new Guide(route, [chateau], 'walk');
    const s = g.update([5.70002, 50.8505], 5);
    expect(s.progress).toBeGreaterThan(50);
    expect(s.progress).toBeLessThan(60);
    expect(s.next?.turn).toBe('right');
    expect(s.distToNext).toBeGreaterThan(160);
    expect(s.distToNext).toBeLessThan(175);
    expect(s.remainingTime).toBeGreaterThan(240);
    expect(s.remainingTime).toBeLessThan(265);
    expect(s.nextSpot?.spot.id).toBe('chateau');
    expect(s.offRoute).toBe(false);
    expect(s.arrived).toBe(false);
  });

  it('tamponne un spot quand on passe devant, une seule fois', () => {
    const g = new Guide(route, [chateau], 'walk');
    g.update([5.7, 50.8505]);
    const s = g.update([5.70001, 50.8515]);
    expect(s.justVisited?.spot.id).toBe('chateau');
    expect(s.visited).toContain('chateau');
    expect(g.update([5.70001, 50.8516]).justVisited).toBeNull();
  });

  it('détecte une sortie de route après trois positions loin du tracé', () => {
    const g = new Guide(route, [], 'walk');
    const far: LngLat = [5.6985, 50.851];
    expect(g.update(far, 5).offRoute).toBe(false);
    expect(g.update(far, 5).offRoute).toBe(false);
    expect(g.update(far, 5).offRoute).toBe(true);
    expect(g.update([5.7, 50.8511], 5).offRoute).toBe(false);
  });

  it("signale l'arrivée", () => {
    const g = new Guide(route, [], 'walk');
    g.update([5.7015, 50.852]);
    expect(g.update([5.70195, 50.852]).arrived).toBe(true);
  });

  it('ignore les micro-instructions de changement de trottoir', () => {
    const m = (turn: Maneuver['turn'], distance: number, street?: string): Maneuver => ({ turn, text: turn, distance, duration: 1, begin: 0, end: 0, street });
    const kept = dropJitter([m('depart', 30), m('right', 8), m('left', 120, 'Grote Gracht'), m('left', 6), m('arrive', 0)]);
    expect(kept.map((k) => k.turn)).toEqual(['depart', 'left', 'arrive']);
  });
});
