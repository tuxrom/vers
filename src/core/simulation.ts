import { GAMEPLAY } from '@/config/gameplay';
import { updateCrates } from '@/entities/crate';
import { findSpawn } from '@/entities/spawn';
import { circleOverlaps } from '@/physics/collision';
import { stepPending, updateProjectiles } from '@/entities/projectile';
import { updateWorm, type Worm } from '@/entities/worm';
import { damageWorm } from '@/weapons/explosion';
import { stepWeapons } from '@/weapons/system';
import { activeWorm, isSettled, stepPhase } from './game';
import { NEUTRAL_INTENT, type Intent } from './intent';
import { emit, type GameState } from './state';

/** Un ver dont le bas du corps touche l'eau est éliminé (éclaboussure) et retiré du jeu. */
function drown(s: GameState, w: Worm): void {
  if (w.alive) {
    w.alive = false;
    w.health = 0;
    emit(s, { t: 'death', worm: w.id, x: w.x, y: w.y, drowned: true });
  }
  w.sunk = true;
  w.rope = null;
  emit(s, { t: 'splash', x: w.x, y: s.waterLevel, r: GAMEPLAY.worm.radius * 2 });
}

/**
 * Anti-coincement : un ver encore enfoncé dans le terrain après la sortie locale (`unstick`, ±40 px) est replacé au
 * sol le plus proche (recherche déterministe autour de lui, aléa de la partie). Ne se produit pas en jeu normal
 * (les cratères ne font qu'enlever de la matière) mais protège de toute situation imprévue (sauvegarde, carte
 * modifiée, bug de physique) : un ver ne reste jamais prisonnier de la roche.
 */
function relocateIfStuck(s: GameState, w: Worm): void {
  const R = GAMEPLAY.worm.radius;
  if (w.sunk || !circleOverlaps(s.terrain, w.x, w.y, R)) return;
  const p = findSpawn(s.terrain, s.rng, w.x - 400, w.x + 400);
  if (circleOverlaps(s.terrain, p.x, p.y, R)) return; // aucun point valide trouvé : on réessaiera au pas suivant
  w.x = w.px = p.x; w.y = w.py = p.y;
  w.vx = 0; w.vy = 0; w.mode = 'air'; w.knocked = false; w.rope = null;
  w.peakY = w.y; // pas de dégâts de chute pour une remise en place
  emit(s, { t: 'unstuck', worm: w.id, x: p.x, y: p.y });
}

/**
 * Un pas de simulation à dt fixe. Pur par rapport à (state, intent) : aucune horloge, aucun Math.random,
 * aucun accès au DOM. Même graine + même suite d'intents = même résultat (replay, réseau).
 */
export function step(s: GameState, dt: number, intent: Intent): void {
  // Commandes de debug : cratères (mise à jour immédiate de la collision).
  for (const c of intent.craters) s.terrain.carveCircle(c.x, c.y, c.r);

  stepPhase(s, dt, intent.skipTurn);

  // Le joueur ne contrôle le ver actif que pendant son tour et la retraite qui suit un tir.
  const controlled = s.phase === 'turn' || s.phase === 'firing' ? activeWorm(s) : undefined;
  if (s.phase === 'turn' && controlled && controlled.alive) stepWeapons(s, dt, intent, controlled);
  stepPending(s, dt);
  updateProjectiles(s, dt);

  for (const w of s.worms) {
    if (w.sunk) continue;
    updateWorm(s.terrain, w, w === controlled && w.alive ? intent : NEUTRAL_INTENT, dt);
    if (w.fallDamagePending > 0) {
      // Chute : dégâts proportionnels à la hauteur (sauf la mise en place initiale des vers).
      if (w.alive && s.phase !== 'placing') damageWorm(s, w.id, w.fallDamagePending);
      w.fallDamagePending = 0;
    }
    if (!w.alive) w.deathAge += dt;
    relocateIfStuck(s, w);
    if (w.y + GAMEPLAY.worm.radius + GAMEPLAY.water.drownMargin > s.waterLevel) drown(s, w);
  }
  updateCrates(s, dt);

  s.stableTime = isSettled(s) ? s.stableTime + dt : 0;
  s.tick++;
  s.time += dt;
}
