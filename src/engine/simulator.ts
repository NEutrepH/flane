// Fausse position GPS qui avance le long du trajet : sert à l'aperçu (et à tester sans sortir).
import { bearingAt, pointAt, type LngLat } from '../lib/geo';
import type { Route } from '../data/routing';

export interface Fix {
  coord: LngLat;
  heading: number;
  accuracy: number;
  speed: number;
}

export class Simulator {
  private timer: ReturnType<typeof setInterval> | null = null;
  private along = 0;
  private last = 0;

  constructor(
    private readonly route: Route,
    private readonly speed: number,
    private readonly onFix: (f: Fix) => void,
    public multiplier = 8,
  ) {}

  start() {
    this.stop();
    this.last = performance.now();
    this.timer = setInterval(() => this.tick(), 350);
    this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick() {
    const now = performance.now();
    const dt = Math.min(1, (now - this.last) / 1000);
    this.last = now;
    const { coords, cum } = this.route;
    const total = cum[cum.length - 1] ?? 0;
    this.along = Math.min(total, this.along + this.speed * this.multiplier * dt);
    this.onFix({
      coord: pointAt(coords, cum, this.along).point,
      heading: bearingAt(coords, cum, this.along),
      accuracy: 5,
      speed: this.speed * this.multiplier,
    });
    if (this.along >= total) this.stop();
  }
}
