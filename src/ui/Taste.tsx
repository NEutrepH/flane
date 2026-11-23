// « Ton goût » : ce que Flâne a compris de tes coups de cœur, et la liste des lieux aimés.
import { TRAITS, TRAIT_SHORT } from '../data/context';
import { phrase, reasons, tasteOf, topTraits } from '../engine/taste';
import { clearLikes, closeScreen, removeLike, showLike, togglePersonalize } from '../state/controller';
import { CloseIcon, HeartIcon } from './icons';
import { TraitBars } from './TraitBars';
import { dateLabel, useTaste } from './useTaste';

export function TasteScreen() {
  const { likes, personalize } = useTaste();
  const taste = tasteOf(likes);
  const ranked = taste ? [...TRAITS].sort((a, b) => taste.weights[b] - taste.weights[a]) : [];

  return (
    <div className="sheetpage taste" role="dialog" aria-label="Ton goût">
      <button className="sheetpage__close round" onClick={closeScreen} aria-label="Fermer">
        <CloseIcon />
      </button>
      <div className="sheetpage__inner">
        <p className="kicker">Ton goût</p>
        <h1 className="taste__title">{taste ? phrase(topTraits(taste, 2)) : 'Encore un mystère.'}</h1>
        {taste ? (
          <>
            <p className="taste__lead">
              D'après {likes.length > 1 ? `tes ${likes.length} coups de cœur` : 'ton premier coup de cœur'}.
              {taste.confidence < 1 ? ` Encore ${3 - likes.length} pour que Flâne te connaisse vraiment.` : ''}
            </p>
            <TraitBars traits={taste.weights} keys={ranked} />
          </>
        ) : (
          <p className="taste__lead">
            Pendant une balade, touche le <HeartIcon size={16} /> quand un endroit te plaît. Flâne regarde ce qui l'entoure (eau, verdure, vieilles pierres, vue,
            animation, calme, art de rue) et te propose ensuite des lieux qui lui ressemblent.
          </p>
        )}

        <label className="switch">
          <input type="checkbox" checked={personalize} onChange={togglePersonalize} />
          <span className="switch__track" aria-hidden>
            <i />
          </span>
          Personnaliser mes balades
        </label>

        {likes.length > 0 && (
          <>
            <h2 className="taste__h2">Tes coups de cœur</h2>
            <ul className="likes">
              {likes.map((l) => (
                <li key={l.id}>
                  <button className="likes__main" onClick={() => showLike(l)}>
                    <span className="likes__heart">
                      <HeartIcon size={16} />
                    </span>
                    <span className="likes__text">
                      <b>{l.name}</b>
                      <em>
                        {dateLabel(l.ts)} · {reasons(l).map((t) => TRAIT_SHORT[t]).join(', ')}
                      </em>
                    </span>
                  </button>
                  <button className="likes__remove" onClick={() => removeLike(l.id)} aria-label={`Retirer ${l.name}`}>
                    <CloseIcon />
                  </button>
                </li>
              ))}
            </ul>
            <button className="btn btn--ghost btn--wide" onClick={clearLikes}>
              Tout oublier
            </button>
          </>
        )}
      </div>
    </div>
  );
}
