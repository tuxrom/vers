import type { Insets } from '../safeArea';

/** Commandes tactiles repositionnables. */
export type TouchControlId = 'joystick' | 'fire' | 'jump' | 'backflip' | 'weapons';
export const TOUCH_IDS: readonly TouchControlId[] = ['joystick', 'fire', 'jump', 'backflip', 'weapons'];

/** Position du centre d'une commande, en fraction de l'écran (0..1). */
export interface Pos { x: number; y: number }

export interface TouchSettings {
  /** Échelle globale des commandes. */
  scale: number;
  /** Positions personnalisées (celles absentes gardent leur valeur par défaut). */
  layout: Partial<Record<TouchControlId, Pos>>;
}

export const TOUCH_SCALE = { min: 0.7, max: 1.5, step: 0.05 } as const;

/**
 * Disposition par défaut : joystick au pouce gauche ; tir, saut, salto et armes au pouce droit.
 * Fractions de la ZONE SÛRE (hors encoches) ; les positions personnalisées, elles, sont des fractions de l'écran.
 */
export const DEFAULT_LAYOUT: Readonly<Record<TouchControlId, Pos>> = {
  joystick: { x: 0.17, y: 0.68 },
  fire: { x: 0.9, y: 0.7 },
  jump: { x: 0.74, y: 0.85 },
  backflip: { x: 0.71, y: 0.6 },
  weapons: { x: 0.92, y: 0.36 },
};

/** Rayon de chaque commande en fraction de la plus petite dimension de l'écran (avant échelle). */
export const BASE_RADIUS: Readonly<Record<TouchControlId, number>> = {
  joystick: 0.17, fire: 0.125, jump: 0.09, backflip: 0.075, weapons: 0.075,
};

/** Cible tactile minimale (rayon en px) : une commande ne devient jamais plus petite qu'un doigt. */
export const MIN_RADIUS = 26;

export interface Circle { id: TouchControlId; cx: number; cy: number; r: number }

export const DEFAULT_TOUCH: TouchSettings = { scale: 1, layout: {} };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Valide des réglages tactiles venus du stockage (positions bornées à l'écran, échelle bornée). */
export function sanitizeTouch(raw: unknown): TouchSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const scale = typeof r.scale === 'number' && Number.isFinite(r.scale) ? clamp(r.scale, TOUCH_SCALE.min, TOUCH_SCALE.max) : 1;
  const layout: Partial<Record<TouchControlId, Pos>> = {};
  const l = (typeof r.layout === 'object' && r.layout !== null ? r.layout : {}) as Record<string, unknown>;
  for (const id of TOUCH_IDS) {
    const p = l[id] as Partial<Pos> | undefined;
    if (p && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      layout[id] = { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) };
    }
  }
  return { scale, layout };
}

/**
 * Cercles des commandes pour un écran `w`×`h` : taille et position issues des réglages, ramenées dans la zone
 * sûre (hors encoches) pour que chaque commande reste entièrement visible et atteignable.
 */
export function computeControls(w: number, h: number, safe: Insets, ts: TouchSettings): Circle[] {
  const u = Math.min(w, h);
  return TOUCH_IDS.map((id) => {
    const r = Math.max(MIN_RADIUS, BASE_RADIUS[id] * u * ts.scale);
    const custom = ts.layout[id];
    const sw = w - safe.left - safe.right, sh = h - safe.top - safe.bottom;
    const px = custom ? custom.x * w : safe.left + DEFAULT_LAYOUT[id].x * sw;
    const py = custom ? custom.y * h : safe.top + DEFAULT_LAYOUT[id].y * sh;
    const lo = { x: safe.left + r + 4, y: safe.top + r + 4 };
    const hi = { x: w - safe.right - r - 4, y: h - safe.bottom - r - 4 };
    return {
      id,
      cx: clamp(px, lo.x, Math.max(lo.x, hi.x)),
      cy: clamp(py, lo.y, Math.max(lo.y, hi.y)),
      r,
    };
  });
}

export const circleOf = (cs: readonly Circle[], id: TouchControlId): Circle => cs.find((c) => c.id === id) as Circle;

export const inCircle = (c: Circle, x: number, y: number, grow = 0): boolean => Math.hypot(x - c.cx, y - c.cy) <= c.r + grow;
