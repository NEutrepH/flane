// Marqueurs HTML : toi (point bleu + cône d'orientation), départ, arrivée, spots numérotés.
// MapLibre positionne l'élément racine avec `transform` : les effets visuels vont sur un enfant.
import { Marker, type Map as MLMap } from 'maplibre-gl';
import type { LngLat } from '../lib/geo';
import type { Category } from '../data/spots';

export interface PinData {
  id: string;
  coord: LngLat;
  n: number;
  cat: Category;
  name: string;
  bonus: boolean;
  visited: boolean;
  focus: boolean;
  preview: boolean;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class Markers {
  private user: Marker | null = null;
  private userEl: HTMLDivElement | null = null;
  private a: Marker | null = null;
  private b: Marker | null = null;
  private pins = new Map<string, { m: Marker; el: HTMLDivElement; key: string }>();

  constructor(
    private readonly map: MLMap,
    private readonly onPin: (id: string) => void,
  ) {}

  setUser(coord: LngLat | null, heading: number | null, nav: boolean) {
    if (!coord) {
      this.user?.remove();
      this.user = null;
      return;
    }
    if (!this.user) {
      const el = document.createElement('div');
      el.className = 'me';
      el.innerHTML = '<i class="me__cone"></i><i class="me__halo"></i><i class="me__dot"></i>';
      this.userEl = el;
      this.user = new Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(coord).addTo(this.map);
    }
    this.user.setLngLat(coord);
    this.userEl!.classList.toggle('me--heading', heading != null);
    this.userEl!.classList.toggle('me--nav', nav);
    this.user.setRotation(heading ?? 0);
  }

  setEnds(a: LngLat | null, b: LngLat | null) {
    this.a = this.place(this.a, a, 'end end--a', '<i></i>');
    this.b = this.place(this.b, b, 'end end--b', '<i></i>');
  }

  private place(marker: Marker | null, coord: LngLat | null, cls: string, html: string): Marker | null {
    if (!coord) {
      marker?.remove();
      return null;
    }
    if (marker) return marker.setLngLat(coord);
    const el = document.createElement('div');
    el.className = cls;
    el.innerHTML = html;
    return new Marker({ element: el }).setLngLat(coord).addTo(this.map);
  }

  setPins(list: PinData[]) {
    const keep = new Set(list.map((p) => p.id));
    for (const [id, p] of this.pins) {
      if (!keep.has(id)) {
        p.m.remove();
        this.pins.delete(id);
      }
    }
    for (const p of list) {
      const key = `${p.n}|${p.cat}|${p.bonus}|${p.visited}|${p.focus}|${p.preview}|${p.name}`;
      let entry = this.pins.get(p.id);
      if (!entry) {
        const el = document.createElement('div');
        el.className = 'pinwrap';
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onPin(p.id);
        });
        entry = { m: new Marker({ element: el }).setLngLat(p.coord).addTo(this.map), el, key: '' };
        this.pins.set(p.id, entry);
      }
      entry.m.setLngLat(p.coord);
      if (entry.key !== key) {
        entry.key = key;
        const cls = ['pin', `pin--${p.cat}`, p.bonus && 'pin--bonus', p.visited && 'pin--visited', p.focus && 'pin--focus', p.preview && 'pin--preview'].filter(Boolean).join(' ');
        entry.el.innerHTML = `<div class="${cls}"><b>${p.bonus ? '' : p.visited ? '✓' : p.n}</b><span class="pin__name">${esc(p.name)}</span></div>`;
        entry.el.style.zIndex = p.focus ? '3' : p.bonus ? '1' : '2';
      }
    }
  }

  clear() {
    for (const p of this.pins.values()) p.m.remove();
    this.pins.clear();
    this.user?.remove();
    this.a?.remove();
    this.b?.remove();
    this.user = this.a = this.b = null;
  }
}
