import { describe, expect, it } from 'vitest';
import { affinity, forYou, phrase, reasons, signalOf, tasteBoost, tasteOf, type Like } from '../src/engine/taste';
import { ZERO_TRAITS, type Traits } from '../src/data/context';

const T = (t: Partial<Traits>): Traits => ({ ...ZERO_TRAITS, ...t });
const like = (id: string, ctx: Traits, signal = ctx, ts = Date.now()): Like => ({ id, coord: [0, 0], ts, name: id, ctx, signal });

describe('ton goût', () => {
  it("retient ce qui distingue le lieu du reste de la balade", () => {
    // Tout le trajet est animé ; ici c'est le bord de l'eau qui ressort.
    const s = signalOf(T({ eau: 0.9, animation: 0.6 }), T({ animation: 0.8, eau: 0.1 }));
    expect(s.eau).toBeGreaterThan(0.8);
    expect(s.animation).toBeLessThan(0.25);
    expect(reasons({ ctx: T({ eau: 0.9, animation: 0.6 }), signal: s })[0]).toBe('eau');
  });

  it('formule les raisons en français', () => {
    expect(phrase(['eau', 'calme'])).toBe("Le bord de l'eau et le calme.");
    expect(phrase(['verdure'])).toBe('La verdure.');
  });

  it('favorise les lieux qui ressemblent aux coups de cœur', () => {
    const taste = tasteOf([like('quai', T({ eau: 0.9, calme: 0.7 })), like('berge', T({ eau: 0.8, verdure: 0.4 }))]);
    expect(taste).not.toBeNull();
    const riverside = T({ eau: 0.85, calme: 0.6 });
    const busyStreet = T({ animation: 0.9, patrimoine: 0.5 });
    expect(affinity(riverside, taste!)).toBeGreaterThan(affinity(busyStreet, taste!));
    expect(tasteBoost(riverside, taste)).toBeGreaterThan(tasteBoost(busyStreet, taste));
    expect(tasteBoost(busyStreet, null)).toBe(1);
  });

  it('oublie peu à peu les vieux coups de cœur', () => {
    const old = Date.now() - 365 * 864e5;
    const taste = tasteOf([like('vieux', T({ patrimoine: 1 }), T({ patrimoine: 1 }), old), like('récent', T({ verdure: 1 }))]);
    expect(taste!.weights.verdure).toBe(1);
    expect(taste!.weights.patrimoine).toBeLessThan(0.1);
  });

  it('dit « pour toi » seulement quand ça ressemble vraiment', () => {
    const likes = [like('quai', T({ eau: 0.9, calme: 0.7 }))];
    const taste = tasteOf(likes);
    expect(forYou(T({ eau: 0.9, calme: 0.6 }), taste, likes)?.name).toBe('quai');
    expect(forYou(T({ animation: 1 }), taste, likes)).toBeNull();
  });
});
