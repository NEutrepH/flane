export function fmtDist(m: number): string {
  if (!isFinite(m)) return '–';
  if (m < 950) return `${Math.max(0, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(m < 9950 ? 1 : 0).replace('.', ',')} km`;
}

export function clock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function mins(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}
