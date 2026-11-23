// Trames de points (demi-tons) dessinées à la volée pour les parcs, bois et plans d'eau.

const PATTERNS: Record<string, { color: string; spacing: number; r: number }> = {
  'dots-green': { color: '#00A95C', spacing: 6, r: 1.15 },
  'dots-green-dense': { color: '#00A95C', spacing: 4.5, r: 1.2 },
  'dots-blue': { color: '#0078BF', spacing: 5, r: 0.85 },
};

/** Tuile de motif répétable, rangées décalées comme une trame d'imprimerie. */
export function patternImage(id: string, pixelRatio = 2): ImageData | null {
  const p = PATTERNS[id];
  if (!p || typeof document === 'undefined') return null;
  const S = p.spacing * pixelRatio;
  const size = Math.round(S * 2);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.fillStyle = p.color;
  const r = p.r * pixelRatio;
  const dots: Array<[number, number]> = [
    [S / 2, S / 2],
    [S * 1.5, S / 2],
    [0, S * 1.5],
    [S, S * 1.5],
    [S * 2, S * 1.5],
  ];
  for (const [x, y] of dots) {
    for (const [ox, oy] of [
      [0, 0],
      [size, 0],
      [-size, 0],
      [0, size],
      [0, -size],
    ]) {
      g.beginPath();
      g.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  return g.getImageData(0, 0, size, size);
}
