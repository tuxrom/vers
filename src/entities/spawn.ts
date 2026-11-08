import { GAMEPLAY } from '@/config/gameplay';
import type { Rng } from '@/core/rng';
import { circleOverlaps } from '@/physics/collision';
import type { SolidQuery } from '@/terrain/mask';

const R = GAMEPLAY.worm.radius;

/**
 * Cherche un point d'apparition valide dans [x0, x1] : sol sous un ciel dégagé, au-dessus de l'eau.
 * Déterministe (tirages via le Rng fourni).
 */
export function findSpawn(t: SolidQuery, rng: Rng, x0: number, x1: number): { x: number; y: number } {
  const { width, startLevel } = { width: GAMEPLAY.world.width, startLevel: GAMEPLAY.water.startLevel };
  const limit = startLevel - GAMEPLAY.terrain.spawnWaterMargin;
  for (let attempt = 0; attempt < 80; attempt++) {
    const x = Math.round(rng.range(Math.max(R + 2, x0), Math.min(width - R - 2, x1)));
    let y = 0;
    while (y < limit && !t.isSolid(x, y)) y++;
    if (y >= limit) continue;
    const cy = y - R - 1;
    if (circleOverlaps(t, x, cy, R)) continue;
    if (circleOverlaps(t, x, cy - GAMEPLAY.terrain.spawnMinHeadroom, R)) continue;
    // Pointe isolée ou arête : le ver glisserait ou tomberait. On exige un appui de chaque côté.
    if (!t.isSolid(x - R * 0.8, cy + R + 3) || !t.isSolid(x + R * 0.8, cy + R + 3)) continue;
    return { x, y: cy };
  }
  return { x: Math.round((x0 + x1) / 2), y: 0 };
}
