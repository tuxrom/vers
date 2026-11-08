import { h } from './dom';

export interface ToastAction { label: string; primary?: boolean; onClick(): void }
export interface ToastSpec {
  title?: string;
  text: string;
  actions?: ToastAction[];
  /** Disparition automatique (ms) ; sans valeur, reste jusqu'à action. */
  timeoutMs?: number;
}

/**
 * Notifications non bloquantes en bas d'écran (nouvelle version, prêt hors ligne, invite d'installation).
 * Un toast par identifiant ; l'affichage reste au-dessus du jeu et des menus, hors de la zone sûre des encoches.
 */
export class Toasts {
  private items = new Map<string, { el: HTMLElement; timer: number }>();

  constructor(private root: HTMLElement) {}

  show(id: string, spec: ToastSpec): void {
    this.dismiss(id);
    const actions = (spec.actions ?? []).map((a) => h('button', {
      class: a.primary ? 'primary' : '', text: a.label, attrs: { type: 'button' },
      on: { click: () => { this.dismiss(id); a.onClick(); } },
    }));
    const el = h('div', { class: 'toast-card', attrs: { role: 'status', 'aria-live': 'polite', 'data-toast': id } },
      spec.title ? h('strong', { text: spec.title }) : null,
      h('span', { text: spec.text }),
      actions.length ? h('div', { class: 'row' }, ...actions) : null);
    this.root.append(el);
    const timer = spec.timeoutMs ? window.setTimeout(() => this.dismiss(id), spec.timeoutMs) : 0;
    this.items.set(id, { el, timer });
    this.layout();
  }

  /** Réserve la hauteur des notifications en bas des menus (variable CSS) : elles ne masquent jamais un bouton. */
  private layout(): void {
    const h = this.items.size ? this.root.getBoundingClientRect().height + 12 : 0;
    document.documentElement.style.setProperty('--toast-h', `${Math.round(h)}px`);
  }

  dismiss(id: string): void {
    const it = this.items.get(id);
    if (!it) return;
    window.clearTimeout(it.timer);
    it.el.remove();
    this.items.delete(id);
    this.layout();
  }

  has(id: string): boolean { return this.items.has(id); }
}
