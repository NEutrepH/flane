// Pictos dessinés à la main (traits épais, bouts ronds) : flèches de guidage, ambiances, boutons.
import type { Turn } from '../data/routing';
import type { Category } from '../data/spots';

const ANGLE: Partial<Record<Turn, number>> = {
  straight: 0,
  merge: 18,
  'slight-right': 40,
  right: 90,
  'sharp-right': 135,
  'slight-left': -40,
  left: -90,
  'sharp-left': -135,
};

function arrowPath(theta: number) {
  const r = (theta * Math.PI) / 180;
  const ex = 24 + 15 * Math.sin(r);
  const ey = 25 - 15 * Math.cos(r);
  const back = (a: number) => `${(ex - 9 * Math.sin(r + a)).toFixed(1)} ${(ey + 9 * Math.cos(r + a)).toFixed(1)}`;
  return `M24 43 L24 25 L${ex.toFixed(1)} ${ey.toFixed(1)} M${back(0.65)} L${ex.toFixed(1)} ${ey.toFixed(1)} L${back(-0.65)}`;
}

const TURN_PATH: Partial<Record<Turn, string>> = {
  uturn: 'M31 43 V21 Q31 11 22 11 Q13 11 13 21 V31 M7 25 L13 32 L19 25',
  roundabout: 'M24 43 V32 M18.5 27.5 A8 8 0 1 1 30 18 L37 11 M30 11 H37 V18',
  arrive: 'M14 43 V7 M14 9 H36 L31 16 L36 23 H14',
  depart: 'M24 40 V12 M15 21 L24 12 L33 21 M17 43 H31',
  steps: 'M7 40 H17 V31 H26 V22 H35 V13 H42',
  ferry: 'M6 30 H42 L36 40 H12 Z M14 30 V20 H34 V30 M24 20 V12',
};

export function TurnIcon({ turn, size = 48 }: { turn: Turn; size?: number }) {
  const d = TURN_PATH[turn] ?? arrowPath(ANGLE[turn] ?? 0);
  return (
    <svg className="turn" width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

const CAT_PATH: Record<Category, string> = {
  nature: 'M10 38 C10 20 22 10 38 10 C38 26 28 38 10 38 Z M10 38 L26 22',
  patrimoine: 'M8 40 H40 M11 36 H37 M14 36 V20 M21 36 V20 M27 36 V20 M34 36 V20 M9 20 H39 L24 9 Z',
  vue: 'M4 24 C11 14 37 14 44 24 C37 34 11 34 4 24 Z M24 29 A5 5 0 1 0 24 19 A5 5 0 1 0 24 29',
  urbain: 'M24 6 L28.5 19.5 L42 24 L28.5 28.5 L24 42 L19.5 28.5 L6 24 L19.5 19.5 Z',
};

export function CatIcon({ cat, size = 18 }: { cat: Category; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <path d={CAT_PATH[cat]} />
    </svg>
  );
}

function Icon({ d, size = 20, width = 4 }: { d: string; size?: number; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export const WalkIcon = () => <Icon d="M27 6 A3.5 3.5 0 1 0 27 13 A3.5 3.5 0 1 0 27 6 M23 17 L17 27 M23 17 L31 22 L35 29 M23 17 L25 30 L19 42 M25 30 L32 42" />;
export const BikeIcon = () => <Icon d="M5 33 A7 7 0 1 0 19 33 A7 7 0 1 0 5 33 M29 33 A7 7 0 1 0 43 33 A7 7 0 1 0 29 33 M12 33 L19 19 H31 L36 33 M19 19 L24 33 L31 19 M16 13 H22" />;
export const CloseIcon = () => <Icon d="M13 13 L35 35 M35 13 L13 35" width={5} />;
export const LoopIcon = () => <Icon d="M38 22 A14 14 0 1 0 34 34 M38 12 V22 H28" />;
export const PinIcon = () => <Icon d="M24 43 C24 43 10 29 10 19 A14 14 0 0 1 38 19 C38 29 24 43 24 43 Z M24 24 A5 5 0 1 0 24 14 A5 5 0 1 0 24 24" />;
export const ClockIcon = () => <Icon d="M24 42 A18 18 0 1 0 24 6 A18 18 0 1 0 24 42 M24 14 V24 L31 29" />;
export const PlayIcon = () => <Icon d="M15 9 L39 24 L15 39 Z" size={22} width={4.5} />;
export const TargetIcon =() => <Icon d="M24 38 A14 14 0 1 0 24 10 A14 14 0 1 0 24 38 M24 4 V12 M24 36 V44 M4 24 H12 M36 24 H44" />;
export function SpeakerIcon({ on }: { on: boolean }) {
  return <Icon d={on ? 'M8 19 H16 L26 10 V38 L16 29 H8 Z M32 17 Q37 24 32 31 M37 12 Q46 24 37 36' : 'M8 19 H16 L26 10 V38 L16 29 H8 Z M33 19 L43 29 M43 19 L33 29'} />;
}
