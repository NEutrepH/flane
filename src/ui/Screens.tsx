import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useApp } from '../state/store';
import { chooseLoop, effectiveOrigin, newWalk, openTaste, stopNav, toast } from '../state/controller';
import { KIND_LABEL } from '../data/spots';
import { TRAIT_SHORT } from '../data/context';
import { reasons, topTraits } from '../engine/taste';
import { fmtDist } from '../lib/format';
import { Attribution } from './Attribution';
import { HeartIcon, LoopIcon, ShareIcon } from './icons';
import { makePoster, sharePoster } from './poster';
import { useTaste } from './useTaste';

/** Accueil : la promesse en une phrase, la boucle en un geste, et ton goût. */
export function Intro() {
  const geo = useApp((s) => s.geo);
  const { taste, likes } = useTaste();
  const located = geo === 'granted';
  return (
    <section className="intro">
      <h1 className="wordmark">Flâne</h1>
      <p className="intro__tag">Le plus beau chemin, pas le plus court.</p>
      <ol className="intro__steps">
        <li>
          <b>1</b>Où tu vas
        </li>
        <li>
          <b>2</b>Combien de temps
        </li>
        <li>
          <b>3</b>Flâne
        </li>
      </ol>
      <div className="intro__actions">
        <button className="btn btn--ghost btn--wide" onClick={() => void chooseLoop()}>
          <LoopIcon /> Boucle depuis {located ? 'ici' : 'la gare'}
        </button>
        <button className={`tastechip${likes.length ? ' tastechip--on' : ''}`} onClick={openTaste}>
          <HeartIcon size={18} />
          {likes.length ? (
            <span>
              <b>{likes.length}</b> {taste ? `· ${topTraits(taste, 2).map((t) => TRAIT_SHORT[t]).join(', ')}` : ''}
            </span>
          ) : (
            <span>Ton goût</span>
          )}
        </button>
      </div>
      {!located && geo !== 'pending' && <p className="intro__note">Pas de GPS ici : départ de démo à la gare de Maastricht.</p>}
      <Attribution />
    </section>
  );
}

/** Fin de balade : le récap façon carnet tamponné, et l'affiche à partager. */
export function Arrival() {
  const { trip, plan, dest, likes } = useApp(useShallow((s) => ({ trip: s.trip, plan: s.plan, dest: s.dest, likes: s.likes })));
  const [poster, setPoster] = useState<{ blob: Blob; url: string } | null>(null);
  const tripLikes = trip ? likes.filter((l) => l.ts >= trip.startedAt) : [];

  useEffect(() => {
    if (!trip || !plan) return;
    let url = '';
    let alive = true;
    const minutes = trip.simulated ? trip.minutes : Math.max(1, Math.round(((trip.endedAt ?? Date.now()) - trip.startedAt) / 60000));
    makePoster(plan, { minutes, from: effectiveOrigin().name, to: dest?.name ?? 'Arrivée', date: new Date(trip.startedAt), likes: tripLikes })
      .then((blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setPoster({ blob, url });
      })
      .catch((e) => console.warn('[flane] affiche', e));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
    // L'affiche se fait une fois, à l'arrivée.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.startedAt]);

  if (!trip) return null;
  const elapsed = trip.simulated ? trip.minutes : Math.max(1, Math.round(((trip.endedAt ?? Date.now()) - trip.startedAt) / 60000));
  const extra = Math.max(0, elapsed - trip.baseMinutes);
  const share = async () => {
    if (!poster) return;
    const r = await sharePoster(poster.blob);
    if (r === 'downloaded') toast('Affiche enregistrée dans tes téléchargements.');
  };
  return (
    <div className="arrival">
      <div className="arrival__inner">
        <p className="kicker">{trip.simulated ? "Fin de l'aperçu" : 'Fin de balade'}</p>
        <h1 className="arrival__title">T'y es.</h1>
        <div className="arrival__stats">
          <div>
            <b>{elapsed}</b>
            <span>min de balade</span>
          </div>
          <div>
            <b>{fmtDist(trip.distance)}</b>
            <span>parcourus</span>
          </div>
          <div>
            <b>{trip.visited.length}</b>
            <span>{trip.visited.length > 1 ? 'spots tamponnés' : 'spot tamponné'}</span>
          </div>
        </div>
        {extra > 0 && trip.baseMinutes > 0 && <p className="arrival__line">Dont {extra} min de détour par les beaux coins.</p>}

        {poster && (
          <figure className="poster">
            <img src={poster.url} alt="Affiche de ta balade" />
            <button className="btn btn--go btn--wide" onClick={() => void share()}>
              <ShareIcon /> Partager l'affiche
            </button>
          </figure>
        )}

        {tripLikes.length > 0 && (
          <>
            <h2 className="arrival__h2">
              <HeartIcon size={18} /> Tes coups de cœur
            </h2>
            <ul className="arrival__list">
              {tripLikes.map((l) => (
                <li key={l.id}>
                  <span className="dot dot--like" />
                  <span>{l.name}</span>
                  <em>{reasons(l).map((t) => TRAIT_SHORT[t]).join(', ')}</em>
                </li>
              ))}
            </ul>
          </>
        )}
        {trip.visited.length > 0 && (
          <>
            <h2 className="arrival__h2">Spots tamponnés</h2>
            <ul className="arrival__list">
              {trip.visited.map((s) => (
                <li key={s.id}>
                  <span className={`dot cat-${s.cat}`} />
                  <span>{s.name}</span>
                  <em>{KIND_LABEL[s.kind]}</em>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="arrival__actions">
          <button className="btn btn--ghost" onClick={stopNav}>
            Revoir
          </button>
          <button className="btn btn--go" onClick={newWalk}>
            Nouvelle balade
          </button>
        </div>
      </div>
    </div>
  );
}

export function Toast() {
  const t = useApp((s) => s.toast);
  if (!t) return null;
  return (
    <div className="toast" key={t.id} role="status">
      {t.text}
    </div>
  );
}
