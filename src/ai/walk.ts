import { SIM_DT } from '@/config/engine';
import { GAMEPLAY } from '@/config/gameplay';
import { NEUTRAL_INTENT, type Intent } from '@/core/intent';
import { updateWorm, type Worm } from '@/entities/worm';
import type { SolidQuery } from '@/terrain/mask';

const A = GAMEPLAY.ai.walk;
const R = GAMEPLAY.worm.radius;

/**
 * Pilote de marche : avance dans une direction ; s'il reste bloqué par un obstacle, recule un peu pour
 * prendre de l'élan puis saute (le saut ne donne aucune vitesse horizontale en l'air : il faut s'écarter du mur).
 * Utilisé à l'identique par le contrôleur (en jeu) et par les simulations de déplacement du planificateur :
 * la marche prévue est donc exactement la marche réalisée.
 */
export class WalkDriver {
  private lastX = Number.NaN;
  private still = 0;
  private mode: 'walk' | 'back' | 'jump' = 'walk';
  private backLeft = 0;
  private attempts = 0;
  private progressX = Number.NaN;
  private readonly intent: Intent = { ...NEUTRAL_INTENT, craters: [] };

  next(w: Worm, dir: -1 | 1): Intent {
    const it = this.intent;
    it.moveX = dir;
    it.jump = false;
    if (Number.isNaN(this.progressX)) this.progressX = w.x;
    if (Math.abs(w.x - this.progressX) > 40) { this.attempts = 0; this.progressX = w.x; }

    if (this.mode === 'back') {
      it.moveX = (-dir) as -1 | 1;
      if (--this.backLeft <= 0) this.mode = 'jump';
      this.lastX = w.x;
      return it;
    }
    if (this.mode === 'jump') {
      if (w.mode === 'ground') { it.jump = true; this.mode = 'walk'; this.still = 0; }
      this.lastX = w.x;
      return it;
    }
    this.still = Math.abs(w.x - this.lastX) < 0.15 && w.mode === 'ground' ? this.still + 1 : 0;
    this.lastX = w.x;
    if (this.still >= A.stuckTicks) {
      this.mode = 'back';
      this.backLeft = 10 + 8 * Math.min(this.attempts++, 4);
      this.still = 0;
      it.moveX = (-dir) as -1 | 1;
    }
    return it;
  }
}

/** Copie jetable d'un ver pour les simulations (le ver réel n'est jamais modifié). */
export function cloneWorm(w: Worm): Worm {
  return { ...w, rope: null };
}

export interface Reach {
  x: number;
  y: number;
  /** Nombre de pas de simulation pour y arriver. */
  ticks: number;
  dir: -1 | 1;
}

/** Exécute un générateur jusqu'au bout (usage synchrone : tests, calculs courts). */
export function drain<T>(g: Generator<void, T>): T {
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}

/** Pas de simulation entre deux points de reprise du calcul. */
const SLICE_TICKS = 45;

/**
 * Positions atteignables en marchant dans une direction (physique réelle du ver : pentes, marches, sauts).
 * S'arrête à la première position dangereuse : eau, chute importante ou dégâts de chute.
 * Générateur : cède la main régulièrement pour ne pas bloquer l'interface.
 */
export function* reachableGen(terrain: SolidQuery, me: Worm, waterLevel: number, dir: -1 | 1, maxSeconds: number = A.maxSeconds): Generator<void, Reach[]> {
  const out: Reach[] = [];
  const w = cloneWorm(me);
  w.rope = null;
  const driver = new WalkDriver();
  const start = w.x;
  let nextMark = A.stride;
  let idle = 0, lastX = w.x;
  const ticks = Math.round(maxSeconds / SIM_DT);
  for (let i = 1; i <= ticks; i++) {
    updateWorm(terrain, w, driver.next(w, dir), SIM_DT);
    if (w.y + R + GAMEPLAY.water.drownMargin + 2 > waterLevel) break; // noyade
    if (w.fallDamagePending > 0 || w.y - w.peakY > A.unsafeFall) break; // chute dangereuse
    idle = Math.abs(w.x - lastX) < 0.05 ? idle + 1 : 0;
    lastX = w.x;
    if (idle > 90) break; // bloqué pour de bon
    if (w.mode === 'ground' && Math.abs(w.x - start) >= nextMark) {
      out.push({ x: w.x, y: w.y, ticks: i, dir });
      nextMark += A.stride;
    }
    if (i % SLICE_TICKS === 0) yield;
  }
  return out;
}

export const reachable = (terrain: SolidQuery, me: Worm, waterLevel: number, dir: -1 | 1, maxSeconds: number = A.maxSeconds): Reach[] =>
  drain(reachableGen(terrain, me, waterLevel, dir, maxSeconds));

/** Position d'un ver après avoir marché `seconds` dans une direction (fuite après une dynamite, etc.). */
export function* walkResultGen(terrain: SolidQuery, me: Worm, waterLevel: number, dir: -1 | 1, seconds: number): Generator<void, { x: number; y: number; safe: boolean }> {
  const w = cloneWorm(me);
  const driver = new WalkDriver();
  let safe = true;
  for (let i = 1; i <= Math.round(seconds / SIM_DT); i++) {
    updateWorm(terrain, w, driver.next(w, dir), SIM_DT);
    if (w.y + R + GAMEPLAY.water.drownMargin + 2 > waterLevel) { safe = false; break; }
    if (i % SLICE_TICKS === 0) yield;
  }
  return { x: w.x, y: w.y, safe };
}
