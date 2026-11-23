// Affiche de la balade (1080 × 1350, format portrait des réseaux) : le tracé imprimé façon riso,
// les étapes numérotées, les chiffres. À partager ou à garder.
import type { Plan } from '../engine/planner';
import type { Like } from '../engine/taste';
import { CAT_COLOR } from '../map/style';
import type { LngLat } from '../lib/geo';
import { fmtDist } from '../lib/format';

const PAPER = '#F3EEE3';
const INK = '#17162A';
const PINK = '#FF48B0';
const BLUE = '#0078BF';
const W = 1080;
const H = 1350;
const ON_DARK = new Set(['patrimoine', 'vue']);

export interface PosterInfo {
  minutes: number;
  from: string;
  to: string;
  date: Date;
  likes: Like[];
}

function fit(text: string, g: CanvasRenderingContext2D, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 3 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

export async function makePoster(plan: Plan, info: PosterInfo): Promise<Blob> {
  await Promise.all(['900 200px Anybody', '800 60px Anybody', '600 34px "Instrument Sans"', '500 26px "DM Mono"'].map((f) => document.fonts.load(f))).catch(() => {});
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const stretch = (v: CanvasFontStretch) => {
    if ('fontStretch' in g) g.fontStretch = v;
  };

  // Papier et grain
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(23,22,42,0.07)';
  for (let i = 0; i < 9000; i++) g.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);

  // En-tête
  const date = info.date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  g.fillStyle = INK;
  g.font = '500 26px "DM Mono", monospace';
  g.fillText(`FLÂNE · ${date.toUpperCase()}`, 70, 92);

  stretch('expanded');
  g.font = '900 210px Anybody, "Arial Black", sans-serif';
  const num = String(info.minutes);
  g.fillStyle = PINK;
  g.fillText(num, 78, 300);
  g.fillStyle = INK;
  g.fillText(num, 70, 292);
  const numW = g.measureText(num).width;
  g.font = '800 56px Anybody, "Arial Black", sans-serif';
  g.fillText('min', 70 + numW + 20, 292);
  stretch('normal');
  g.font = '600 34px "Instrument Sans", sans-serif';
  g.fillText('de flânerie', 70 + numW + 22, 226);
  g.fillText(fit(`${info.from} → ${info.to}`, g, W - 140), 70, 360);

  // Le tracé
  const box = { x: 70, y: 400, w: W - 140, h: 670 };
  g.strokeStyle = INK;
  g.lineWidth = 3;
  g.strokeRect(box.x, box.y, box.w, box.h);
  const pts = plan.route.coords;
  const lat0 = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = pts.map((p) => p[0] * k);
  const ys = pts.map((p) => -p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = 60;
  const scale = Math.min((box.w - 2 * pad) / Math.max(1e-9, maxX - minX), (box.h - 2 * pad) / Math.max(1e-9, maxY - minY));
  const ox = box.x + (box.w - (maxX - minX) * scale) / 2;
  const oy = box.y + (box.h - (maxY - minY) * scale) / 2;
  const P = (p: LngLat): [number, number] => [ox + (p[0] * k - minX) * scale, oy + (-p[1] - minY) * scale];
  const path = (dx = 0, dy = 0) => {
    g.beginPath();
    pts.forEach((p, i) => {
      const [x, y] = P(p);
      if (i === 0) g.moveTo(x + dx, y + dy);
      else g.lineTo(x + dx, y + dy);
    });
  };
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = BLUE;
  g.lineWidth = 20;
  path(7, 7);
  g.stroke();
  g.strokeStyle = PINK;
  g.lineWidth = 18;
  path();
  g.stroke();
  g.strokeStyle = PAPER;
  g.lineWidth = 5;
  g.setLineDash([0.1, 24]);
  path();
  g.stroke();
  g.setLineDash([]);

  // Départ, arrivée, coups de cœur, étapes
  const [sx, sy] = P(pts[0]);
  g.fillStyle = PAPER;
  g.strokeStyle = INK;
  g.lineWidth = 7;
  g.beginPath();
  g.arc(sx, sy, 16, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  const [ex, ey] = P(pts[pts.length - 1]);
  g.save();
  g.translate(ex, ey);
  g.rotate(Math.PI / 4);
  g.fillStyle = PINK;
  g.fillRect(-17, -17, 34, 34);
  g.lineWidth = 5;
  g.strokeRect(-17, -17, 34, 34);
  g.restore();
  for (const l of info.likes) {
    const [x, y] = P(l.coord);
    if (x < box.x || x > box.x + box.w || y < box.y || y > box.y + box.h) continue;
    g.fillStyle = PINK;
    g.strokeStyle = INK;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(x, y, 12, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  for (const ps of plan.bonus) {
    const [x, y] = P(ps.spot.coord);
    g.fillStyle = CAT_COLOR[ps.spot.cat];
    g.strokeStyle = INK;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(x, y, 9, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const ps of plan.stops) {
    const [x, y] = P(ps.spot.coord);
    g.fillStyle = INK;
    g.beginPath();
    g.arc(x + 4, y + 4, 27, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = CAT_COLOR[ps.spot.cat];
    g.strokeStyle = INK;
    g.lineWidth = 5;
    g.beginPath();
    g.arc(x, y, 27, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = ON_DARK.has(ps.spot.cat) ? PAPER : INK;
    g.font = '900 28px Anybody, "Arial Black", sans-serif';
    g.fillText(String(ps.n), x, y + 1);
  }
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';

  // Pied : chiffres, étapes, signature
  g.fillStyle = INK;
  g.font = '500 28px "DM Mono", monospace';
  const nLikes = info.likes.length;
  g.fillText(
    `${fmtDist(plan.route.distance).toUpperCase()} · ${plan.stops.length + plan.bonus.length} SPOTS${nLikes ? ` · ${nLikes} COUP${nLikes > 1 ? 'S' : ''} DE CŒUR` : ''}`,
    70,
    1122,
  );
  g.font = '600 28px "Instrument Sans", sans-serif';
  plan.stops.slice(0, 6).forEach((ps, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    g.fillText(fit(`${ps.n}. ${ps.spot.name}`, g, 440), 70 + col * 470, 1168 + row * 38);
  });
  stretch('expanded');
  g.font = '900 64px Anybody, "Arial Black", sans-serif';
  g.textAlign = 'right';
  g.fillStyle = BLUE;
  g.fillText('Flâne', W - 66, H - 36);
  g.fillStyle = PINK;
  g.fillText('Flâne', W - 70, H - 40);
  g.textAlign = 'left';
  stretch('normal');
  g.fillStyle = INK;
  g.font = '500 22px "DM Mono", monospace';
  g.fillText('neutreph.github.io/flane', 70, H - 44);

  return new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Affiche impossible'))), 'image/png'));
}

/** Partage l'affiche (feuille de partage du téléphone), sinon la télécharge. */
export async function sharePoster(blob: Blob): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], 'flane-balade.png', { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (navigator.share && nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Ma balade Flâne' });
      return 'shared';
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'flane-balade.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}
