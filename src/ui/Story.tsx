// Les spots de la balade en « stories » : grande photo bichromie, récit, ambiance. On tape à droite
// pour avancer, à gauche pour revenir, on glisse, ou on utilise les flèches du clavier.
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useApp } from '../state/store';
import { closeScreen, focusSpot } from '../state/controller';
import { KIND_LABEL, type Spot } from '../data/spots';
import { TRAITS, traitsOf } from '../data/context';
import { forYou } from '../engine/taste';
import { CatIcon, CloseIcon, HeartIcon } from './icons';
import { TraitBars } from './TraitBars';
import { useTaste } from './useTaste';

const FALLBACK: Partial<Record<Spot['kind'], string>> = {
  water: "Un bout de chemin au bord de l'eau : ralentis, regarde les reflets.",
  bridge: 'Un pont, donc une vue : arrête-toi au milieu.',
  park: 'Une respiration verte sur ton trajet.',
  garden: 'Un jardin à traverser sans se presser.',
  green: 'Un coin de verdure au calme.',
  street: 'Une rue piétonne, du monde, des vitrines.',
  square: 'Une place où lever les yeux.',
  viewpoint: 'Un point de vue : prends ton temps.',
  artwork: 'Une œuvre posée dans la rue.',
  mural: 'Du street art à ne pas rater.',
};

export function StoryViewer({ spotId }: { spotId: string }) {
  const plan = useApp((s) => s.plan);
  const { taste, likes } = useTaste();
  const items = useMemo(() => (plan ? [...plan.stops, ...plan.bonus].sort((a, b) => a.along - b.along) : []), [plan]);
  const [i, setI] = useState(() => Math.max(0, items.findIndex((x) => x.spot.id === spotId)));
  const start = useRef<number | null>(null);

  const go = (d: number) => {
    const k = i + d;
    if (k < 0) return;
    if (k >= items.length) closeScreen();
    else setI(k);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeScreen();
      if (e.key === 'ArrowRight') setI((k) => Math.min(items.length - 1, k + 1));
      if (e.key === 'ArrowLeft') setI((k) => Math.max(0, k - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length]);

  useEffect(() => {
    const it = items[i];
    if (it) focusSpot(it.spot.id, false);
  }, [i, items]);

  const it = items[i];
  if (!it) return null;
  const { spot } = it;
  const traits = traitsOf(spot);
  const top = [...TRAITS].sort((a, b) => traits[b] - traits[a]).filter((t) => traits[t] >= 0.25).slice(0, 3);
  const mate = forYou(traits, taste, likes);
  const loading = !!spot.wiki && spot.extract === undefined;

  const onDown = (e: PointerEvent) => (start.current = e.clientX);
  const onUp = (e: PointerEvent) => {
    if (start.current === null) return;
    const dx = e.clientX - start.current;
    start.current = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
    else go(e.clientX < window.innerWidth * 0.3 ? -1 : 1);
  };

  return (
    <div className={`story cat-${spot.cat}`} role="dialog" aria-label={`Spot : ${spot.name}`}>
      <div className="story__bars" aria-hidden>
        {items.map((x, k) => (
          <i key={x.spot.id} className={k < i ? 'is-done' : k === i ? 'is-on' : ''} />
        ))}
      </div>
      <button className="story__close" onClick={closeScreen} aria-label="Fermer">
        <CloseIcon />
      </button>
      <div className="story__tap" onPointerDown={onDown} onPointerUp={onUp} />
      <div className="story__photo duo" key={spot.id}>
        {spot.thumb ? (
          <img src={spot.thumb} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="duo__empty">
            <CatIcon cat={spot.cat} size={90} />
          </span>
        )}
        <span className="story__num">{it.bonus ? '•' : it.n}</span>
      </div>
      <div className="story__body" key={`b-${spot.id}`}>
        <span className="kicker">
          {it.bonus ? 'En chemin' : `Étape ${it.n} / ${plan?.stops.length ?? 0}`} · {KIND_LABEL[spot.kind]} · à {Math.max(1, Math.round(it.eta / 60))} min
        </span>
        <h2 className="story__name">{spot.name}</h2>
        {mate && (
          <span className="foryou">
            <HeartIcon size={14} /> Pour toi · comme {mate.name}
          </span>
        )}
        {top.length > 0 && <TraitBars traits={traits} keys={top} compact />}
        <p className="story__text">{spot.extract || (loading ? 'Chargement de son histoire…' : (FALLBACK[spot.kind] ?? 'Un coin qui vaut le détour.'))}</p>
        {spot.link && (
          <a className="story__link" href={spot.link} target="_blank" rel="noreferrer">
            Lire sur Wikipédia ↗
          </a>
        )}
        <span className="story__hint">{i < items.length - 1 ? 'Touche à droite pour le spot suivant' : 'Dernier spot — touche pour fermer'}</span>
      </div>
    </div>
  );
}
