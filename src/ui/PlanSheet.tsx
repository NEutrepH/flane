import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useApp, type Prep, type Preview } from '../state/store';
import { fitPlan, focusSpot, openStory, openTaste, retry, setMinutes, setMode, startNav, togglePref } from '../state/controller';
import { CATEGORIES, CATEGORY_LABEL, KIND_LABEL, type Spot } from '../data/spots';
import { traitsOf } from '../data/context';
import type { Mode } from '../data/routing';
import type { Plan, Prefs } from '../engine/planner';
import { forYou, type Like } from '../engine/taste';
import { clock, fmtDist } from '../lib/format';
import { Ruler } from './Ruler';
import { Attribution } from './Attribution';
import { BikeIcon, CatIcon, HeartIcon, PlayIcon, WalkIcon } from './icons';
import { useNow, useWide } from './hooks';
import { useTaste } from './useTaste';

const STEP_LABEL = ['Calcul du trajet le plus court', 'Lecture de la carte', 'Recherche des beaux coins', 'Photos et chemins', 'Prêt'];

interface Item {
  spot: Spot;
  n: number;
  eta: number | null;
  bonus: boolean;
}

function stripItems(plan: Plan | null, preview: Preview | null): Item[] {
  if (preview) return preview.stops.map((spot, i) => ({ spot, n: i + 1, eta: null, bonus: false }));
  if (!plan) return [];
  return [...plan.stops, ...plan.bonus].sort((a, b) => a.along - b.along).map((ps) => ({ spot: ps.spot, n: ps.n, eta: ps.eta, bonus: ps.bonus }));
}

export function PlanSheet() {
  const s = useApp(
    useShallow((st) => ({
      base: st.base,
      plan: st.plan,
      preview: st.preview,
      minutes: st.minutes,
      t0: st.t0,
      tmax: st.tmax,
      prep: st.prep,
      mode: st.mode,
      prefs: st.prefs,
      focus: st.focus,
    })),
  );
  const wide = useWide();
  const { taste, likes } = useTaste();
  const [open, setOpen] = useState(false);
  const expanded = wide || open;
  const now = useNow();

  const route = s.plan?.route ?? s.base;
  const seconds = s.preview ? s.preview.time : (route?.duration ?? 0);
  const shown = route || s.preview ? Math.max(1, Math.round(seconds / 60)) : s.minutes;
  const scenic = !!s.preview || !!s.plan?.scenic;
  const extra = Math.max(0, shown - s.t0);
  const items = useMemo(() => stripItems(s.plan, s.preview), [s.plan, s.preview]);
  const ready = s.prep.status === 'ready';
  const focused = items.find((i) => i.spot.id === s.focus)?.spot;

  useEffect(() => {
    if (!s.focus) return;
    document.querySelector(`[data-spot="${CSS.escape(s.focus)}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [s.focus]);

  return (
    <section className={`sheet${expanded ? ' sheet--open' : ''}`} aria-label="Ta balade">
      {!wide && (
        <button
          className="sheet__grip"
          onClick={() => {
            setOpen((o) => !o);
            setTimeout(fitPlan, 350);
          }}
          aria-label={open ? 'Réduire le panneau' : 'Voir les spots et les ambiances'}
          aria-expanded={open}
        >
          <i />
        </button>
      )}
      <div className="big" aria-label={`${shown} minutes, ${scenic ? 'balade' : 'trajet le plus court'}`}>
        <span className="big__num">{shown}</span>
        <span className="big__unit">min</span>
        {scenic && extra > 0 && <span className="sticker">+{extra}′ de flânerie</span>}
      </div>
      <p className="stats">
        {s.preview ? '…' : route ? fmtDist(route.distance) : '–'} · {items.length ? `${items.length} ${items.length > 1 ? 'spots' : 'spot'}` : 'aucun spot'} · arrivée{' '}
        {clock(now + seconds * 1000)}
      </p>
      <Ruler min={s.t0} max={s.tmax} value={s.minutes} onChange={setMinutes} disabled={!ready} />
      <PrepLine prep={s.prep} hint={ready && !scenic} />
      {taste && ready && (
        <button className="personal" onClick={openTaste}>
          <HeartIcon size={14} /> Balade personnalisée · {likes.length} coup{likes.length > 1 ? 's' : ''} de cœur
        </button>
      )}
      {expanded && <Chips prefs={s.prefs} disabled={!ready} />}
      <SpotStrip items={items} focus={s.focus} mini={!expanded} mates={(spot) => forYou(traitsOf(spot), taste, likes)} />
      {expanded && focused && <Detail spot={focused} />}
      <div className="sheet__actions">
        <ModeSwitch mode={s.mode} />
        <button className="btn btn--round" onClick={() => startNav(true)} disabled={!route} aria-label="Aperçu de la balade" title="Aperçu de la balade">
          <PlayIcon />
        </button>
        <button className="btn btn--go" onClick={() => startNav(false)} disabled={!route}>
          C'est parti<span aria-hidden> →</span>
        </button>
      </div>
      <Attribution />
    </section>
  );
}

function ModeSwitch({ mode }: { mode: Mode }) {
  return (
    <div className="mode" role="radiogroup" aria-label="Mode de déplacement">
      {(['walk', 'bike'] as const).map((m) => (
        <button
          key={m}
          role="radio"
          aria-checked={mode === m}
          aria-label={m === 'walk' ? 'À pied' : 'À vélo'}
          title={m === 'walk' ? 'À pied' : 'À vélo'}
          className={`mode__btn${mode === m ? ' mode__btn--on' : ''}`}
          onClick={() => setMode(m)}
        >
          {m === 'walk' ? <WalkIcon /> : <BikeIcon />}
        </button>
      ))}
    </div>
  );
}

function PrepLine({ prep, hint }: { prep: Prep; hint: boolean }) {
  if (prep.status === 'loading') {
    return (
      <div className="prep" role="status">
        <span className="prep__bar">
          <i style={{ width: `${Math.max(8, (prep.step / 4) * 100)}%` }} />
        </span>
        <span>{STEP_LABEL[prep.step] ?? ''}…</span>
      </div>
    );
  }
  if (prep.status === 'error' || prep.status === 'unavailable') {
    return (
      <div className="prep prep--note" role="status">
        <span>{prep.message}</span>
        {prep.status === 'error' && <button onClick={retry}>Réessayer</button>}
      </div>
    );
  }
  if (prep.status === 'ready' && hint) return <div className="prep prep--hint">Glisse la règle : plus tu prends ton temps, plus c'est beau.</div>;
  return null;
}

function Chips({ prefs, disabled }: { prefs: Prefs; disabled: boolean }) {
  return (
    <div className="chips" role="group" aria-label="Ambiances">
      {CATEGORIES.map((c) => (
        <button key={c} className={`chip cat-${c}${prefs[c] ? ' chip--on' : ''}`} aria-pressed={prefs[c]} onClick={() => togglePref(c)} disabled={disabled}>
          <CatIcon cat={c} size={15} />
          {CATEGORY_LABEL[c]}
        </button>
      ))}
    </div>
  );
}

function SpotStrip({ items, focus, mini, mates }: { items: Item[]; focus: string | null; mini: boolean; mates: (s: Spot) => Like | null }) {
  if (!items.length) return null;
  return (
    <div className={`strip${mini ? ' strip--mini' : ''}`}>
      {items.map((it) => (
        <SpotCard key={it.spot.id} item={it} focus={focus === it.spot.id} mini={mini} mate={mates(it.spot)} />
      ))}
    </div>
  );
}

function SpotCard({ item, focus, mini, mate }: { item: Item; focus: boolean; mini: boolean; mate: Like | null }) {
  const { spot, n, eta, bonus } = item;
  const meta = `${bonus ? 'En chemin · ' : ''}${KIND_LABEL[spot.kind]}${eta != null ? ` · ${Math.max(1, Math.round(eta / 60))} min` : ''}`;
  return (
    <button
      className={`card cat-${spot.cat}${mini ? ' card--mini' : ''}${focus ? ' card--focus' : ''}${bonus ? ' card--bonus' : ''}`}
      data-spot={spot.id}
      onClick={() => {
        focusSpot(spot.id);
        if (eta != null) openStory(spot.id);
      }}
      title={mate ? `Pour toi : comme ${mate.name}` : undefined}
    >
      {mate && (
        <span className="card__foryou" aria-label={`Pour toi, comme ${mate.name}`}>
          <HeartIcon size={12} />
        </span>
      )}
      <span className="duo">
        {spot.thumb ? (
          <img src={spot.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="duo__empty">
            <CatIcon cat={spot.cat} size={mini ? 20 : 34} />
          </span>
        )}
      </span>
      <span className="card__n">{bonus ? '•' : n}</span>
      <span className="card__body">
        <span className="card__kind">{meta}</span>
        <span className="card__name">{spot.name}</span>
      </span>
    </button>
  );
}

const FALLBACK: Partial<Record<Spot['kind'], string>> = {
  water: "Un bout de chemin au bord de l'eau.",
  bridge: 'Un pont, donc une vue : lève la tête.',
  park: 'Une respiration verte sur ton trajet.',
  garden: 'Un jardin à traverser sans se presser.',
  green: 'Un coin de verdure au calme.',
  street: 'Une rue piétonne, du monde, des vitrines.',
  square: 'Une place où lever les yeux.',
  viewpoint: 'Un point de vue : prends ton temps.',
  artwork: 'Une œuvre posée dans la rue.',
  mural: 'Du street art à ne pas rater.',
};

function Detail({ spot }: { spot: Spot }) {
  const loading = !!spot.wiki && spot.extract === undefined;
  return (
    <article className={`detail cat-${spot.cat}`}>
      <span className="kicker">
        {KIND_LABEL[spot.kind]}
        {spot.photos ? ` · ${spot.photos >= 40 ? '40+' : spot.photos} photos prises ici` : ''}
      </span>
      <h3>{spot.name}</h3>
      {spot.extract ? <p>{spot.extract}</p> : <p className="detail__muted">{loading ? 'Chargement de son histoire…' : (FALLBACK[spot.kind] ?? 'Un coin qui vaut le détour.')}</p>}
      {spot.link && (
        <a href={spot.link} target="_blank" rel="noreferrer">
          Lire sur Wikipédia ↗
        </a>
      )}
    </article>
  );
}
