import { GAMEPLAY } from '@/config/gameplay';
import type { GameEvent } from './events';
import { activeWorm } from './game';
import type { GameState } from './state';

const C = GAMEPLAY.camera;

/**
 * Réalisateur de la caméra (rendu uniquement) : choisit ce qu'elle suit.
 * Priorité : projectile en vol > explosion récente > ver actif. Les événements importants
 * (nouveau tour, tir, explosion, téléportation) rendent la main au suivi automatique.
 */
export class CameraDirector {
  private explosion: { x: number; y: number; ttl: number } | null = null;
  private teleport: { x: number; y: number; ttl: number } | null = null;
  /** Dernière cible calculée (tenue entre deux événements). */
  private last = { x: GAMEPLAY.world.width / 2, y: GAMEPLAY.world.height / 2 };
  /** Indique à l'appelant qu'un événement doit reprendre le suivi automatique. */
  resumeRequested = false;

  onEvents(events: readonly GameEvent[]): void {
    for (const e of events) {
      switch (e.t) {
        case 'explosion':
          this.explosion = { x: e.x, y: e.y, ttl: C.explosionFocusTime };
          this.resumeRequested = true;
          break;
        case 'teleport':
          this.teleport = { x: e.x1, y: e.y1, ttl: C.explosionFocusTime };
          this.resumeRequested = true;
          break;
        case 'turn':
        case 'shot':
          this.resumeRequested = true;
          break;
        default:
      }
    }
  }

  /** Cible de la caméra (coordonnées monde, positions interpolées). */
  target(s: GameState, alpha: number, dtSec: number): { x: number; y: number } {
    if (this.explosion && (this.explosion.ttl -= dtSec) <= 0) this.explosion = null;
    if (this.teleport && (this.teleport.ttl -= dtSec) <= 0) this.teleport = null;

    const proj = followedProjectile(s, alpha);
    if (proj) return (this.last = proj);
    if (this.explosion) return (this.last = this.explosion);
    if (this.teleport) return (this.last = this.teleport);

    const w = activeWorm(s);
    if (w) return (this.last = { x: w.px + (w.x - w.px) * alpha, y: w.py + (w.y - w.py) * alpha });
    if (s.worms.length) {
      let x = 0, y = 0;
      for (const o of s.worms) { x += o.x; y += o.y; }
      return (this.last = { x: x / s.worms.length, y: y / s.worms.length });
    }
    return this.last;
  }
}

/** Projectile à suivre : le plus récent parmi ceux qui comptent, avec anticipation sur sa vitesse. */
function followedProjectile(s: GameState, alpha: number): { x: number; y: number } | null {
  let best: GameState['projectiles'][number] | null = null;
  for (const p of s.projectiles) {
    // Les objets posés (dynamite, mines) ne retiennent pas la caméra : on suit les tirs en vol.
    if (p.kind === 'dynamite' || p.kind === 'mine') continue;
    if (!best || p.id > best.id) best = p;
  }
  if (!best) return null;
  const la = C.lookAhead;
  return {
    x: best.px + (best.x - best.px) * alpha + best.vx * la,
    y: best.py + (best.y - best.py) * alpha + best.vy * la,
  };
}
