import { SIM_DT } from '@/config/engine';
import { GAMEPLAY } from '@/config/gameplay';
import { fallDamage, knockWorm, updateWorm, type Worm } from '@/entities/worm';
import { NEUTRAL_INTENT } from '@/core/intent';
import type { SolidQuery } from '@/terrain/mask';
import { blastEffect } from '@/weapons/explosion';
import type { BlastSize } from '@/weapons/types';
import { cloneWorm, drain } from './walk';

const S = GAMEPLAY.ai.score;
const R = GAMEPLAY.worm.radius;

/** Vue minimale d'un ver pour l'évaluation (position éventuellement hypothétique). */
export interface Target { id: number; team: number; x: number; y: number; health: number; alive: boolean; sunk: boolean }

export interface BlastValue {
  score: number;
  enemyDamage: number;
  selfDamage: number;
  allyDamage: number;
}

/**
 * Valeur d'une explosion en (x,y) pour l'équipe `myTeam` : dégâts aux ennemis (+ bonus d'élimination),
 * moins les dégâts à soi (pondérés plus fort) et à ses équipiers. `me` peut être déplacé (position de tir prévue).
 */
export function scoreBlast(
  worms: readonly Target[], me: { id: number; team: number; x: number; y: number }, x: number, y: number, size: BlastSize,
): BlastValue {
  let enemy = 0, self = 0, ally = 0, score = 0;
  for (const w of worms) {
    if (!w.alive || w.sunk) continue;
    const px = w.id === me.id ? me.x : w.x, py = w.id === me.id ? me.y : w.y;
    const e = blastEffect(px, py, x, y, size);
    if (e.f <= 0) continue;
    const dmg = Math.min(w.health, e.damage);
    const kills = e.damage >= w.health;
    if (w.id === me.id) { self += dmg; score -= dmg * S.selfFactor + (kills ? S.selfKillPenalty : 0); }
    else if (w.team === me.team) { ally += dmg; score -= dmg * S.allyFactor + (kills ? S.allyKillPenalty : 0); }
    else { enemy += dmg; score += dmg + (kills ? S.killBonus : 0); }
  }
  return { score, enemyDamage: enemy, selfDamage: self, allyDamage: ally };
}

export interface KnockOutcome {
  /** Le ver finit dans l'eau. */
  drowned: boolean;
  /** Dégâts de chute subis à l'arrivée. */
  fall: number;
}

/**
 * Simule la projection d'un ver (explosion ou coup de batte) avec la vraie physique des vers : où
 * retombe-t-il, se noie-t-il, quels dégâts de chute subit-il ? Coûteux (≈ quelques ms) : réservé aux
 * meilleurs candidats du niveau difficile.
 */
export function* simulateKnockGen(terrain: SolidQuery, w: Worm, vx: number, vy: number, waterLevel: number, maxSeconds = 7): Generator<void, KnockOutcome> {
  const c = cloneWorm(w);
  knockWorm(c, vx, vy);
  for (let i = 1; i <= Math.round(maxSeconds / SIM_DT); i++) {
    if (i % 45 === 0) yield;
    updateWorm(terrain, c, NEUTRAL_INTENT, SIM_DT);
    if (c.y + R + GAMEPLAY.water.drownMargin > waterLevel) return { drowned: true, fall: 0 };
    if (c.fallDamagePending > 0) return { drowned: false, fall: c.fallDamagePending };
    if (c.mode === 'ground' && !c.knocked) return { drowned: false, fall: fallDamage(c.lastFallDistance) };
  }
  return { drowned: false, fall: 0 };
}

/**
 * Raffine la valeur d'une explosion avec la projection des vers touchés : bonus si un ennemi finit à l'eau
 * ou subit une chute, pénalité si c'est soi-même ou un équipier.
 */
export function* knockAdjustmentGen(
  terrain: SolidQuery, worms: readonly Worm[], me: { id: number; team: number; x: number; y: number },
  x: number, y: number, size: BlastSize, waterLevel: number,
): Generator<void, number> {
  let adj = 0;
  for (const w of worms) {
    if (!w.alive || w.sunk) continue;
    const isMe = w.id === me.id;
    const px = isMe ? me.x : w.x, py = isMe ? me.y : w.y;
    const e = blastEffect(px, py, x, y, size);
    if (e.f <= 0) continue;
    const probe = isMe ? { ...w, x: px, y: py } : w;
    const k = yield* simulateKnockGen(terrain, probe, e.vx, e.vy, waterLevel);
    const extra = k.drowned ? S.drownBonus : Math.min(k.fall, Math.max(0, w.health - e.damage));
    if (isMe) adj -= extra * S.selfFactor + (k.drowned ? S.selfKillPenalty : 0);
    else if (w.team === me.team) adj -= extra * S.allyFactor + (k.drowned ? S.allyKillPenalty : 0);
    else adj += extra + (k.drowned ? S.killBonus : 0);
  }
  return adj;
}

export const simulateKnock = (terrain: SolidQuery, w: Worm, vx: number, vy: number, waterLevel: number, maxSeconds = 7): KnockOutcome =>
  drain(simulateKnockGen(terrain, w, vx, vy, waterLevel, maxSeconds));

export const knockAdjustment = (
  terrain: SolidQuery, worms: readonly Worm[], me: { id: number; team: number; x: number; y: number },
  x: number, y: number, size: BlastSize, waterLevel: number,
): number => drain(knockAdjustmentGen(terrain, worms, me, x, y, size, waterLevel));
