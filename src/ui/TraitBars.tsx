import { TRAIT_SHORT, type Trait, type Traits } from '../data/context';
import { pct } from './useTaste';

/** Barres d'ambiance imprimées en trame (une encre par trait). */
export function TraitBars({ traits, keys, compact = false }: { traits: Traits; keys: Trait[]; compact?: boolean }) {
  return (
    <ul className={`traits${compact ? ' traits--compact' : ''}`}>
      {keys.map((t, i) => (
        <li key={t} className={`trait trait--${t}`} style={{ animationDelay: `${i * 80}ms` }}>
          <span className="trait__name">{TRAIT_SHORT[t]}</span>
          <span className="trait__bar">
            <i style={{ width: `${Math.max(4, Math.round(traits[t] * 100))}%` }} />
          </span>
          <span className="trait__pct">{pct(traits[t])}</span>
        </li>
      ))}
    </ul>
  );
}
