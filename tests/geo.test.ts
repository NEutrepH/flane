import { describe, expect, it } from 'vitest';
import {
  cumulative,
  decodePolyline,
  ellipseBBox,
  haversine,
  lngLatToTile,
  nearestOnLine,
  pointAt,
  pointInRing,
  ringArea,
  ringCentroid,
  sliceLine,
  tilesInBBox,
  type LngLat,
} from '../src/lib/geo';

describe('géométrie', () => {
  it('mesure environ 111 km par degré de latitude', () => {
    const d = haversine([5, 50], [5, 51]);
    expect(d).toBeGreaterThan(110_500);
    expect(d).toBeLessThan(111_800);
  });

  it('décode une polyline (exemple de référence, précision 5)', () => {
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
    expect(pts).toHaveLength(3);
    expect(pts[0][0]).toBeCloseTo(-120.2, 5);
    expect(pts[0][1]).toBeCloseTo(38.5, 5);
    expect(pts[2][0]).toBeCloseTo(-126.453, 5);
    expect(pts[2][1]).toBeCloseTo(43.252, 5);
  });

  const line: LngLat[] = [
    [5, 50],
    [5, 50.01],
    [5.01, 50.01],
  ];
  const cum = cumulative(line);

  it('projette un point sur une ligne', () => {
    const hit = nearestOnLine(line, cum, [5.0002, 50.005]);
    expect(hit.index).toBe(0);
    expect(hit.dist).toBeGreaterThan(10);
    expect(hit.dist).toBeLessThan(20);
    expect(Math.abs(hit.along - cum[1] / 2)).toBeLessThan(2);
  });

  it('retrouve un point à une distance donnée et découpe la ligne', () => {
    expect(pointAt(line, cum, cum[1]).point[1]).toBeCloseTo(50.01, 6);
    const part = sliceLine(line, cum, 100, cum[2] - 100);
    expect(part.length).toBeGreaterThanOrEqual(3);
    expect(part[0][1]).toBeGreaterThan(50);
  });

  it("calcule l'aire et le centre d'un polygone", () => {
    const sq: LngLat[] = [
      [0, 0],
      [0.001, 0],
      [0.001, 0.001],
      [0, 0.001],
      [0, 0],
    ];
    expect(ringArea(sq)).toBeGreaterThan(12_000);
    expect(ringArea(sq)).toBeLessThan(12_500);
    const c = ringCentroid(sq);
    expect(c[0]).toBeCloseTo(0.0005, 6);
    expect(pointInRing(c, sq)).toBe(true);
    expect(pointInRing([0.002, 0.002], sq)).toBe(false);
  });

  it("couvre l'ellipse des détours possibles avec peu de tuiles", () => {
    const b = ellipseBBox([5.70531, 50.8497], [5.6889, 50.8487], 3000);
    const tiles = tilesInBBox(b, 14);
    expect(tiles).toContainEqual(lngLatToTile([5.6909, 50.8514], 14));
    expect(tiles.length).toBeLessThan(12);
  });
});
