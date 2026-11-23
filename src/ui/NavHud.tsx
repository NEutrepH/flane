import { useShallow } from 'zustand/react/shallow';
import { useApp } from '../state/store';
import { recenter, stopNav, toggleVoice } from '../state/controller';
import type { Maneuver, Turn } from '../data/routing';
import { KIND_LABEL, type Spot } from '../data/spots';
import type { PlanSpot } from '../engine/planner';
import { clock, fmtDist } from '../lib/format';
import { CatIcon, CloseIcon, SpeakerIcon, TargetIcon, TurnIcon } from './icons';
import { useNow } from './hooks';

const THEN: Record<Turn, string> = {
  left: 'à gauche',
  right: 'à droite',
  'slight-left': 'légèrement à gauche',
  'slight-right': 'légèrement à droite',
  'sharp-left': 'franchement à gauche',
  'sharp-right': 'franchement à droite',
  straight: 'tout droit',
  merge: 'tout droit',
  uturn: 'demi-tour',
  roundabout: 'au rond-point',
  arrive: "c'est l'arrivée",
  depart: 'départ',
  steps: 'les escaliers',
  ferry: 'le bac',
};

const then = (m: Maneuver) => THEN[m.turn];

export function NavHud() {
  const s = useApp(useShallow((st) => ({ nav: st.nav, plan: st.plan, follow: st.follow, voice: st.voice, simulating: st.simulating, stamp: st.stamp, mode: st.mode })));
  const now = useNow(15000);
  const nav = s.nav;
  const next = nav?.next;
  const remaining = nav ? nav.remainingTime : (s.plan?.route.duration ?? 0);
  const atEnd = next?.turn === 'arrive' && (nav?.distToNext ?? 99) < 15;

  return (
    <>
      <div className="navtop" role="status" aria-live="polite">
        <TurnIcon turn={next?.turn ?? 'depart'} size={52} />
        <div className="navtop__main">
          <div className="navtop__dist">{nav ? (atEnd ? 'Ici' : fmtDist(nav.distToNext)) : '…'}</div>
          <div className="navtop__text">{nav ? (next?.text ?? 'Continuez.') : 'On cherche ta position…'}</div>
          {nav?.after && nav.distToNext < 120 && <div className="navtop__then">Puis {then(nav.after)}</div>}
        </div>
      </div>
      {nav?.nextSpot && <NextSpot ps={nav.nextSpot} dist={nav.distToSpot} />}
      {!s.follow && (
        <button className="recenter" onClick={recenter}>
          <TargetIcon /> Recentrer
        </button>
      )}
      <div className="navbar">
        <button className="round round--stop" onClick={stopNav} aria-label="Arrêter la navigation">
          <CloseIcon />
        </button>
        <div className="navbar__mid">
          <div>
            <span className="navbar__min">{Math.max(1, Math.ceil(remaining / 60))}</span> <span className="navbar__unit">min</span>
          </div>
          <div className="navbar__sub">
            {nav ? fmtDist(nav.remainingDist) : '–'} · arrivée {clock(now + remaining * 1000)}
          </div>
        </div>
        <button className={`round${s.voice ? ' round--on' : ''}`} onClick={toggleVoice} aria-label={s.voice ? 'Couper la voix' : 'Activer la voix'} aria-pressed={s.voice}>
          <SpeakerIcon on={s.voice} />
        </button>
      </div>
      {s.simulating && <div className="simtag">Aperçu ×{s.mode === 'walk' ? 8 : 5}</div>}
      {s.stamp && <Stamp key={s.stamp.id} spot={s.stamp.spot} />}
    </>
  );
}

function NextSpot({ ps, dist }: { ps: PlanSpot; dist: number }) {
  const { spot } = ps;
  return (
    <div className={`navspot cat-${spot.cat}`}>
      <span className="duo">
        {spot.thumb ? (
          <img src={spot.thumb} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="duo__empty">
            <CatIcon cat={spot.cat} size={22} />
          </span>
        )}
      </span>
      <span className="navspot__text">
        <span className="navspot__kicker">{ps.bonus ? 'En chemin' : `Spot ${ps.n}`} · {KIND_LABEL[spot.kind]}</span>
        <span className="navspot__name">{spot.name}</span>
      </span>
      <span className="navspot__dist">{dist < 20 ? 'Là !' : fmtDist(dist)}</span>
    </div>
  );
}

function Stamp({ spot }: { spot: Spot }) {
  return (
    <div className={`stamp cat-${spot.cat}`} aria-live="assertive">
      <b>Tamponné</b>
      <span>{spot.name}</span>
    </div>
  );
}
