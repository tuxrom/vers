import { dist } from '@/core/math';
import { GAMEPLAY } from '@/config/gameplay';
import { emit, type GameState, type Team } from '@/core/state';
import { knockWorm } from '@/entities/worm';
import type { BlastSize } from './types';

const E = GAMEPLAY.explosion;

/** Dégâts et recul (0..1) d'un point à `d` px du centre d'une explosion de rayon `r`. */
export function blastFalloff(d: number, r: number): number {
  const range = r * E.falloffRange;
  return d >= range ? 0 : 1 - d / range;
}

/**
 * Dégâts et impulsion qu'une explosion de centre (x,y) inflige à un ver centré en (wx,wy) — source unique,
 * partagée avec l'IA pour prédire les effets d'un tir. `f` = 0 hors de portée.
 */
export function blastEffect(wx: number, wy: number, x: number, y: number, size: BlastSize):
  { f: number; damage: number; vx: number; vy: number } {
  const p = E.presets[size];
  const dx = wx - x, dy = wy - y;
  const d = dist(dx, dy);
  const f = blastFalloff(d, p.radius);
  if (f <= 0) return { f: 0, damage: 0, vx: 0, vy: 0 };
  // Direction depuis le centre ; pile au centre : droit vers le haut.
  const nx = d > 1e-6 ? dx / d : 0, ny = d > 1e-6 ? dy / d : -1;
  const force = E.knockbackForce * f * p.knockback * GAMEPLAY.worm.knockbackMultiplier;
  return { f, damage: Math.round(p.damage * f), vx: nx * force, vy: ny * force - E.knockbackLift * f * p.knockback };
}

/**
 * Applique des dégâts (PV, mort éventuelle), émet l'événement de bulle et tient les statistiques :
 * `source` = ver responsable (-1 : chute, eau…). Seuls les dégâts infligés à une autre équipe sont comptés.
 */
export function damageWorm(s: GameState, id: number, amount: number, source = -1): number {
  const w = s.worms[id];
  if (!w || !w.alive || amount <= 0) return 0;
  const dealt = Math.min(w.health, amount);
  w.health -= dealt;
  emit(s, { t: 'damage', worm: id, amount, x: w.x, y: w.y });

  const src = source >= 0 ? s.worms[source] : undefined;
  const enemyHit = src !== undefined && src.team !== w.team;
  if (enemyHit) {
    (s.teams[src.team] as Team).stats.damage += dealt;
    if (src.team === s.turn.team) s.turn.damageDealt += dealt;
  }
  if (w.health <= 0) {
    w.alive = false;
    w.deathAge = 0;
    if (enemyHit) (s.teams[src.team] as Team).stats.kills++;
    emit(s, { t: 'death', worm: id, x: w.x, y: w.y });
  }
  return dealt;
}

/**
 * Explosion : creuse le terrain, inflige des dégâts décroissants avec la distance et projette les vers
 * proches (direction depuis le centre, force décroissante). Les vers morts ne sont plus touchés.
 */
export function explode(s: GameState, x: number, y: number, size: BlastSize, owner = -1): void {
  const p = E.presets[size];
  s.terrain.carveCircle(x, y, p.radius);
  emit(s, { t: 'explosion', x, y, r: p.radius });

  for (const w of s.worms) {
    if (!w.alive || w.sunk) continue;
    const e = blastEffect(w.x, w.y, x, y, size);
    if (e.f <= 0) continue;
    knockWorm(w, e.vx, e.vy);
    damageWorm(s, w.id, e.damage, owner);
  }
}
