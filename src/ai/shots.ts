import { SIM_DT } from '@/config/engine';
import { GAMEPLAY } from '@/config/gameplay';
import { advanceBody, type BallisticEnv, type Body } from '@/physics/ballistics';
import { PROJECTILE_SPECS } from '@/weapons/specs';
import type { ProjectileKind } from '@/weapons/types';

export interface ShotResult {
  /** Point d'explosion prévu. */
  x: number;
  y: number;
  /** Cause de l'explosion : contact, ver touché, minuterie ; `water`/`lost` : tir perdu (aucune explosion). */
  kind: 'impact' | 'worm' | 'fuse' | 'water' | 'lost' | 'timeout';
  t: number;
  /** Grenade : position d'explosion pour chaque minuterie 1..5 s (index = secondes). */
  fuseAt?: ({ x: number; y: number } | null)[];
}

/**
 * Prédit un tir : rejoue exactement la physique de la simulation (`advanceBody`, même pas de temps, même
 * vent) sans toucher à l'état. Pour une grenade (`fuse` = 0), renvoie en une passe la position d'explosion
 * pour chaque minuterie de 1 à 5 secondes.
 */
export function simulateShot(
  env: BallisticEnv, kind: ProjectileKind, ownerId: number,
  x: number, y: number, vx: number, vy: number, fuse = -1, maxSeconds = 9,
): ShotResult {
  const spec = PROJECTILE_SPECS[kind];
  const b: Body = { x, y, vx, vy, angle: 0, age: 0, rest: false };
  const wantFuses = fuse === 0;
  const G = GAMEPLAY.weapons.grenade;
  const fuseAt: ({ x: number; y: number } | null)[] = [];
  const left: number[] = [];
  if (wantFuses) for (let f = G.fuseMin; f <= G.fuseMax; f++) { left[f] = f; fuseAt[f] = null; }
  let remaining = fuse;
  let pending = wantFuses ? G.fuseMax - G.fuseMin + 1 : 0;
  const ticks = Math.round(maxSeconds / SIM_DT);

  for (let i = 0; i < ticks; i++) {
    b.age += SIM_DT;
    if (wantFuses) {
      // Même arithmétique que la simulation : décrément à chaque pas, explosion quand la minuterie est écoulée.
      for (let f = G.fuseMin; f <= G.fuseMax; f++) {
        if (fuseAt[f] !== null) continue;
        left[f] = (left[f] as number) - SIM_DT;
        if ((left[f] as number) <= 0) { fuseAt[f] = { x: b.x, y: b.y }; pending--; }
      }
      if (pending === 0) return { x: b.x, y: b.y, kind: 'fuse', t: b.age, fuseAt };
    } else if (remaining >= 0) {
      remaining -= SIM_DT;
      if (remaining <= 0) return { x: b.x, y: b.y, kind: 'fuse', t: b.age };
    }
    const r = advanceBody(env, b, spec, SIM_DT, ownerId);
    if (r.k === 'impact' || r.k === 'worm') return { x: r.x, y: r.y, kind: r.k, t: b.age, fuseAt: wantFuses ? fuseAt : undefined };
    if (r.k === 'water' || r.k === 'lost') {
      // Une grenade tombée à l'eau est perdue ; les minuteries déjà écoulées restent valides.
      return { x: b.x, y: b.y, kind: r.k, t: b.age, fuseAt: wantFuses ? fuseAt : undefined };
    }
  }
  return { x: b.x, y: b.y, kind: 'timeout', t: b.age, fuseAt: wantFuses ? fuseAt : undefined };
}

/** Tir instantané : premier terrain ou ver rencontré sur le rayon (même parcours que l'arme réelle). */
export function simulateRay(
  env: BallisticEnv, ownerId: number, x0: number, y0: number, dx: number, dy: number, range: number,
): { x: number; y: number; hit: boolean } {
  const R = GAMEPLAY.worm.radius;
  for (let d = 0; d < range; d++) {
    const x = x0 + dx * d, y = y0 + dy * d;
    if (env.terrain.isSolid(x, y)) return { x, y, hit: true };
    for (const o of env.worms) if (o.alive && o.id !== ownerId && Math.hypot(o.x - x, o.y - y) < R) return { x, y, hit: true };
  }
  return { x: x0 + dx * range, y: y0 + dy * range, hit: false };
}
