import { useApp } from '../state/store';
import { chooseLoop, newWalk, stopNav } from '../state/controller';
import { KIND_LABEL } from '../data/spots';
import { fmtDist } from '../lib/format';
import { Attribution } from './Attribution';
import { LoopIcon } from './icons';

/** Accueil : la promesse en une phrase et la boucle en un geste. */
export function Intro() {
  const geo = useApp((s) => s.geo);
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
      <button className="btn btn--ghost btn--wide" onClick={() => void chooseLoop()}>
        <LoopIcon /> Boucle depuis {located ? 'ici' : 'la gare'}
      </button>
      {!located && geo !== 'pending' && <p className="intro__note">Pas de GPS ici : départ de démo à la gare de Maastricht.</p>}
      <Attribution />
    </section>
  );
}

/** Fin de balade : le récap façon carnet tamponné. */
export function Arrival() {
  const trip = useApp((s) => s.trip);
  if (!trip) return null;
  const elapsed = trip.simulated ? trip.minutes : Math.max(1, Math.round(((trip.endedAt ?? Date.now()) - trip.startedAt) / 60000));
  const extra = Math.max(0, elapsed - trip.baseMinutes);
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
        {trip.visited.length > 0 && (
          <ul className="arrival__list">
            {trip.visited.map((s) => (
              <li key={s.id}>
                <span className={`dot cat-${s.cat}`} />
                <span>{s.name}</span>
                <em>{KIND_LABEL[s.kind]}</em>
              </li>
            ))}
          </ul>
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
