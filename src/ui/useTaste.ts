import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useApp } from '../state/store';
import { tasteOf, type Like, type Taste } from '../engine/taste';

/** Le goût courant (null si pas de coup de cœur ou personnalisation coupée) et les coups de cœur. */
export function useTaste(): { taste: Taste | null; likes: Like[]; personalize: boolean } {
  const { likes, personalize } = useApp(useShallow((s) => ({ likes: s.likes, personalize: s.personalize })));
  const taste = useMemo(() => (personalize ? tasteOf(likes) : null), [likes, personalize]);
  return { taste, likes, personalize };
}

export const pct = (v: number) => `${Math.round(v * 100)} %`;

export function dateLabel(ts: number): string {
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
