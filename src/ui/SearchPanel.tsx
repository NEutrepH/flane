import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useApp } from '../state/store';
import { chooseDestination, chooseLoop, chooseOrigin, DEMO_ORIGIN, effectiveOrigin, newWalk, recentPlaces } from '../state/controller';
import { searchPlaces, type Place } from '../data/geocode';
import { isAbort } from '../lib/http';
import { ClockIcon, CloseIcon, LoopIcon, PinIcon, TargetIcon } from './icons';

type Field = 'origin' | 'dest';

export function SearchPanel() {
  const s = useApp(useShallow((st) => ({ phase: st.phase, dest: st.dest, origin: st.origin, hasUser: !!st.user })));
  const [editing, setEditing] = useState<Field | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const text = q.trim();
    if (!editing || text.length < 2) {
      setResults([]);
      setBusy(false);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        setResults(await searchPlaces(text, effectiveOrigin().coord, ctrl.signal));
      } catch (e) {
        if (!isAbort(e)) setResults([]);
      } finally {
        if (!ctrl.signal.aborted) setBusy(false);
      }
    }, 220);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, editing]);

  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  const originLabel = s.origin?.name ?? (s.hasUser ? 'Ma position' : DEMO_ORIGIN.name);
  const close = () => {
    setEditing(null);
    setQ('');
    setResults([]);
  };
  const pick = (choice: Place | 'me' | 'loop') => {
    const target = editing;
    close();
    input.current?.blur();
    if (target === 'origin') void chooseOrigin(choice === 'me' || choice === 'loop' ? null : choice);
    else if (choice === 'loop') void chooseLoop();
    else if (choice !== 'me') void chooseDestination(choice);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && results[0]) pick(results[0]);
  };

  if (s.phase === 'plan' && !editing) {
    return (
      <div className="search search--compact">
        <button className="search__route" onClick={() => setEditing('dest')} aria-label="Modifier le trajet">
          <span className="search__from">{originLabel}</span>
          <span className="search__arrow" aria-hidden>
            →
          </span>
          <span className="search__to">{s.dest?.name}</span>
        </button>
        <button className="icon-btn" onClick={newWalk} aria-label="Effacer le trajet">
          <CloseIcon />
        </button>
      </div>
    );
  }

  const empty = q.trim().length < 2;
  const recents = empty ? recentPlaces() : [];
  const list = empty ? recents : results;

  return (
    <>
      {editing && <div className="backdrop" onClick={close} />}
      <div className={`search${editing ? ' search--open' : ''}`}>
        <div className="search__row">
          <span className="search__dot" aria-hidden />
          {editing === 'origin' ? (
            <input ref={input} className="search__input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="D'où tu pars ?" aria-label="Point de départ" />
          ) : (
            <button
              className="search__field search__field--muted"
              onClick={() => {
                setQ('');
                setEditing('origin');
              }}
            >
              {originLabel}
            </button>
          )}
        </div>
        <div className="search__sep" />
        <div className="search__row">
          <span className="search__dot search__dot--b" aria-hidden />
          {editing === 'origin' ? (
            <button className="search__field" onClick={() => setEditing('dest')}>
              {s.dest?.name ?? 'Où tu vas ?'}
            </button>
          ) : (
            <input
              ref={input}
              className="search__input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => setEditing('dest')}
              onKeyDown={onKey}
              placeholder={s.dest?.name ?? 'Où tu vas ?'}
              aria-label="Destination"
            />
          )}
          {busy && <span className="search__busy" aria-hidden />}
        </div>
        {editing && (
          <ul className="results">
            {empty && editing === 'dest' && (
              <li>
                <button onClick={() => pick('loop')}>
                  <span className="results__icon">
                    <LoopIcon />
                  </span>
                  <span>
                    <span className="results__name">Balade en boucle</span>
                    <span className="results__sub">Tu reviens à ton point de départ</span>
                  </span>
                </button>
              </li>
            )}
            {empty && editing === 'origin' && s.hasUser && (
              <li>
                <button onClick={() => pick('me')}>
                  <span className="results__icon">
                    <TargetIcon />
                  </span>
                  <span>
                    <span className="results__name">Ma position</span>
                    <span className="results__sub">GPS du téléphone</span>
                  </span>
                </button>
              </li>
            )}
            {empty && recents.length > 0 && <li className="results__label">Récents</li>}
            {list.map((p) => (
              <li key={p.id}>
                <button onClick={() => pick(p)}>
                  <span className="results__icon">{empty ? <ClockIcon /> : <PinIcon />}</span>
                  <span className="results__text">
                    <span className="results__name">{p.name}</span>
                    {p.sub && <span className="results__sub">{p.sub}</span>}
                  </span>
                </button>
              </li>
            ))}
            {!empty && !busy && !results.length && <li className="results__empty">Rien trouvé. Essaie une adresse, un lieu, un quartier.</li>}
          </ul>
        )}
      </div>
    </>
  );
}
