import { create } from 'zustand';
import type { LngLat } from '../lib/geo';
import { prefGet } from '../lib/cache';
import type { Place } from '../data/geocode';
import type { Mode, Route } from '../data/routing';
import type { Spot } from '../data/spots';
import type { Plan, Prefs } from '../engine/planner';
import type { NavState } from '../engine/navigation';
import type { Like } from '../engine/taste';

export type Phase = 'explore' | 'plan' | 'nav' | 'arrived';

export interface UserPos {
  coord: LngLat;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  ts: number;
}

export type PrepStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';

export interface Prep {
  status: PrepStatus;
  /** 0 = trajet le plus court, 1 = carte, 2 = lieux, 3 = photos et chemins, 4 = prêt */
  step: number;
  message?: string;
}

/** Aperçu instantané pendant qu'on glisse le curseur (avant d'avoir l'itinéraire réel). */
export interface Preview {
  minutes: number;
  stops: Spot[];
  time: number;
}

export interface Trip {
  startedAt: number;
  endedAt?: number;
  minutes: number;
  baseMinutes: number;
  distance: number;
  visited: Spot[];
  simulated: boolean;
}

/** Coup de cœur en cours d'analyse, puis son résultat. */
export interface LikeCard {
  id: string;
  status: 'analysing' | 'done';
  coord: LngLat;
  like?: Like;
}

/** Écrans plein écran par-dessus la carte. */
export type Screen = { kind: 'taste' } | { kind: 'story'; spotId: string };

export interface AppState {
  likes: Like[];
  personalize: boolean;
  likeCard: LikeCard | null;
  screen: Screen | null;
  phase: Phase;
  mode: Mode;
  prefs: Prefs;
  geo: 'pending' | 'granted' | 'denied' | 'unavailable';
  user: UserPos | null;
  compass: number | null;
  origin: Place | null;
  dest: Place | null;
  base: Route | null;
  /** minutes */
  t0: number;
  tmax: number;
  minutes: number;
  prep: Prep;
  candidates: Spot[];
  plan: Plan | null;
  planLoading: boolean;
  preview: Preview | null;
  nav: NavState | null;
  follow: boolean;
  simulating: boolean;
  voice: boolean;
  stamp: { id: number; spot: Spot } | null;
  trip: Trip | null;
  focus: string | null;
  toast: { id: number; text: string } | null;
}

export const useApp = create<AppState>(() => ({
  likes: prefGet<Like[]>('likes', []),
  personalize: prefGet('personalize', true),
  likeCard: null,
  screen: null,
  phase: 'explore',
  mode: prefGet<Mode>('mode', 'walk'),
  prefs: prefGet<Prefs>('prefs', { nature: true, patrimoine: true, vue: true, urbain: true }),
  geo: 'pending',
  user: null,
  compass: null,
  origin: null,
  dest: null,
  base: null,
  t0: 0,
  tmax: 0,
  minutes: 0,
  prep: { status: 'idle', step: 0 },
  candidates: [],
  plan: null,
  planLoading: false,
  preview: null,
  nav: null,
  follow: true,
  simulating: false,
  voice: prefGet('voice', false),
  stamp: null,
  trip: null,
  focus: null,
  toast: null,
}));

export const getState = useApp.getState;
export const setState = useApp.setState;
