import { dist } from '@/core/math';
import { GAMEPLAY } from '@/config/gameplay';
import type { ProjectileSpec } from '@/weapons/specs';
import type { SolidQuery } from '@/terrain/mask';
import { surfaceNormal } from './collision';

const P = GAMEPLAY.physics;
const W = GAMEPLAY.weapons;

/** Ce qu'il faut savoir du monde pour faire avancer un projectile (lecture seule). */
export interface BallisticEnv {
  terrain: SolidQuery;
  worms: readonly { id: number; x: number; y: number; alive: boolean; sunk: boolean }[];
  wind: number;
  waterLevel: number;
}

/** État cinématique d'un corps balistique (sous-ensemble de `Projectile`). */
export interface Body {
  x: number; y: number;
  vx: number; vy: number;
  angle: number;
  age: number;
  rest: boolean;
}

export type MotionResult =
  | { k: 'fly' } // toujours en vol, ou immobilisé au sol
  | { k: 'impact'; x: number; y: number } // terrain touché (projectile qui explose à l'impact)
  | { k: 'worm'; x: number; y: number } // ver touché
  | { k: 'water'; x: number; y: number } // tombé à l'eau
  | { k: 'lost' }; // sorti de la carte

/**
 * Un pas de mouvement balistique : gravité, vent, collision pixel par sous-pas ≤ 1,5 px, rebonds.
 * Source UNIQUE de la physique des projectiles : la simulation l'appelle, et l'IA l'appelle pour prédire
 * ses tirs, ce qui garantit des prédictions identiques à ce qui se produira.
 * `ownerId` est ignoré des collisions pendant 0,3 s après le tir ; `onBounce` reçoit chaque rebond marqué.
 */
export function advanceBody(
  env: BallisticEnv, p: Body, spec: ProjectileSpec, dt: number, ownerId: number,
  onBounce?: (x: number, y: number, speed: number) => void,
): MotionResult {
  const t = env.terrain;

  if (p.rest) {
    // Le sol a été creusé sous l'objet : il retombe.
    if (!t.isSolid(p.x, p.y + spec.radius + 1)) p.rest = false;
    else return { k: 'fly' };
  }

  p.vy = Math.min(p.vy + P.gravity * spec.gravityScale * dt, P.terminalVelocity);
  p.vx += env.wind * spec.windInfluence * dt;

  const speed = dist(p.vx, p.vy);
  const n = Math.max(1, Math.ceil((speed * dt) / 1.5));
  const sx = (p.vx * dt) / n, sy = (p.vy * dt) / n;

  for (let i = 0; i < n; i++) {
    const lx = p.x, ly = p.y;
    p.x += sx; p.y += sy;

    if (p.y > env.waterLevel + spec.radius) return { k: 'water', x: p.x, y: env.waterLevel };
    if (p.x < -GAMEPLAY.world.killMargin || p.x > GAMEPLAY.world.width + GAMEPLAY.world.killMargin) return { k: 'lost' };

    if (spec.hitsWorms) {
      for (const w of env.worms) {
        if (!w.alive || w.sunk) continue;
        if (w.id === ownerId && p.age < 0.3) continue;
        if (dist(w.x - p.x, w.y - p.y) < GAMEPLAY.worm.radius + spec.radius) return { k: 'worm', x: p.x, y: p.y };
      }
    }

    if (t.isSolid(p.x, p.y)) {
      if (spec.explodeOnImpact) return { k: 'impact', x: p.x, y: p.y };
      // Rebond : retour au dernier point libre, réflexion selon la normale.
      p.x = lx; p.y = ly;
      const nrm = surfaceNormal(t, p.x + Math.sign(sx || 0), p.y + Math.sign(sy || 0));
      const vn = p.vx * nrm.x + p.vy * nrm.y;
      if (vn < 0) {
        const tx = p.vx - vn * nrm.x, ty = p.vy - vn * nrm.y;
        const keep = 1 - spec.friction;
        p.vx = tx * keep - spec.bounce * vn * nrm.x;
        p.vy = ty * keep - spec.bounce * vn * nrm.y;
        const sp = dist(p.vx, p.vy);
        if (-vn > W.bounceEventSpeed) onBounce?.(p.x, p.y, -vn);
        if (sp < W.projectileRestSpeed && nrm.y < -0.5) { p.vx = 0; p.vy = 0; p.rest = true; }
      }
      break;
    }
  }

  if (spec.spin > 0) p.angle += spec.spin * dt * Math.sign(p.vx || 1);
  else if (!p.rest) p.angle = Math.atan2(p.vy, p.vx);
  return { k: 'fly' };
}
