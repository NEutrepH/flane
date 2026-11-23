import { useShallow } from 'zustand/react/shallow';
import { useApp, type LikeCard as LikeCardState } from '../state/store';
import { dismissLike, likeHere, openStory, openTaste, recenter, stopNav, toggleVoice } from '../state/controller';
import type { Maneuver, Turn } from '../data/routing';
import { KIND_LABEL, type Spot } from '../data/spots';
import { TRAITS } from '../data/context';
import type { Plan, PlanSpot } from '../engine/planner';
import type { NavState } from '../engine/navigation';
import { phrase, reasons } from '../engine/taste';
import { clock, fmtDist } from '../lib/format';
import { CatIcon, CloseIcon, HeartIcon, SpeakerIcon, TargetIcon, TurnIcon } from './icons';
import { TraitBars } from './TraitBars';
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
  const s = useApp(
    useShallow((st) => ({ nav: st.nav, plan: st.plan, follow: st.follow, voice: st.voice, simulating: st.simulating, stamp: st.stamp, mode: st.mode, likeCard: st.likeCard })),
  );
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
      {s.likeCard ? <LikeCard card={s.likeCard} /> : nav?.nextSpot && <NextSpot ps={nav.nextSpot} dist={nav.distToSpot} />}
      {!s.follow && (
        <button className="recenter" onClick={recenter}>
          <TargetIcon /> Recentrer
        </button>
      )}
      <div className="navbar">
        {s.plan && <Frise plan={s.plan} nav={nav} />}
        <div className="navbar__row">
          <button className="round round--stop" onClick={stopNav} aria-label="Arrêter la navigation">
            <CloseIcon />
          </button>
          <div className="navbar__mid">
            <div>
              <span className="navbar__min">{Math.max(1, Math.ceil(remaining / 60))}</span> <span className="navbar__unit">min</span>
            </div>
            <div className="navbar__sub">
              {nav ? fmtDist(nav.remainingDist) : '–'} · {clock(now + remaining * 1000)}
            </div>
          </div>
          <button
            className={`likefab${s.likeCard?.status === 'analysing' ? ' likefab--busy' : ''}`}
            onClick={() => void likeHere()}
            aria-label="J'adore cet endroit"
            title="J'adore cet endroit"
          >
            <HeartIcon size={30} />
          </button>
          <button className={`round${s.voice ? ' round--on' : ''}`} onClick={toggleVoice} aria-label={s.voice ? 'Couper la voix' : 'Activer la voix'} aria-pressed={s.voice}>
            <SpeakerIcon on={s.voice} />
          </button>
        </div>
      </div>
      {s.simulating && <div className="simtag">Aperçu ×{s.mode === 'walk' ? 8 : 5}</div>}
      {s.stamp && <Stamp key={s.stamp.id} spot={s.stamp.spot} />}
    </>
  );
}

/** Frise de la balade : progression et spots (tamponnés une fois passés). */
function Frise({ plan, nav }: { plan: Plan; nav: NavState | null }) {
  const total = plan.route.cum[plan.route.cum.length - 1] || 1;
  const done = Math.min(1, (nav?.progress ?? 0) / total);
  const visited = new Set(nav?.visited ?? []);
  const spots = [...plan.stops, ...plan.bonus];
  return (
    <div className="frise" aria-hidden>
      <i className="frise__done" style={{ width: `${done * 100}%` }} />
      {spots.map((ps) => (
        <span
          key={ps.spot.id}
          className={`frise__dot cat-${ps.spot.cat}${ps.bonus ? ' frise__dot--bonus' : ''}${visited.has(ps.spot.id) ? ' frise__dot--done' : ''}${nav?.nextSpot?.spot.id === ps.spot.id ? ' frise__dot--next' : ''}`}
          style={{ left: `${(ps.along / total) * 100}%` }}
        />
      ))}
      <span className="frise__me" style={{ left: `${done * 100}%` }} />
    </div>
  );
}

function NextSpot({ ps, dist }: { ps: PlanSpot; dist: number }) {
  const { spot } = ps;
  return (
    <button className={`navspot cat-${spot.cat}`} onClick={() => openStory(spot.id)}>
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
        <span className="navspot__kicker">
          {ps.bonus ? 'En chemin' : `Spot ${ps.n}`} · {KIND_LABEL[spot.kind]}
        </span>
        <span className="navspot__name">{spot.name}</span>
      </span>
      <span className="navspot__dist">{dist < 20 ? 'Là !' : fmtDist(dist)}</span>
    </button>
  );
}

/** Analyse d'un coup de cœur : la zone scannée sur la carte, puis ce qui rend le lieu spécial. */
function LikeCard({ card }: { card: LikeCardState }) {
  if (card.status === 'analysing' || !card.like) {
    return (
      <div className="likecard likecard--scan" role="status">
        <span className="likecard__heart">
          <HeartIcon size={28} />
        </span>
        <div>
          <span className="kicker">Coup de cœur</span>
          <b className="likecard__title">J'analyse ce qui t'entoure…</b>
          <div className="likecard__scan">
            {TRAITS.map((t, i) => (
              <i key={t} className={`trait--${t}`} style={{ animationDelay: `${i * 90}ms` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }
  const like = card.like;
  const why = reasons(like);
  return (
    <div className="likecard" role="status">
      <button className="likecard__close" onClick={dismissLike} aria-label="Fermer">
        <CloseIcon />
      </button>
      <span className="kicker">Coup de cœur · {like.name}</span>
      <b className="likecard__title">Tu aimes ici : {phrase(why).toLowerCase()}</b>
      <TraitBars traits={like.ctx} keys={why} compact />
      <p className="likecard__note">
        Noté. Tes prochaines balades passeront par plus d'endroits comme celui-ci.{' '}
        <button className="linklike" onClick={openTaste}>
          Voir ton goût
        </button>
      </p>
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
