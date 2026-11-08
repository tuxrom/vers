import { dist } from '@/core/math';
import type { SolidQuery } from '@/terrain/mask';

/** Décalages entiers du pourtour d'un cercle de rayon r (+ centre) : points testés contre le masque. */
const ringCache = new Map<number, Int8Array>();
/** Dernier rayon demandé : chemin rapide (tous les vers ont le même rayon) sans recherche dans la Map. */
let lastR = -1;
let lastOffs: Int8Array = new Int8Array(0);

function ringOffsets(r: number): Int8Array {
  if (r === lastR) return lastOffs;
  let offs = ringCache.get(r);
  if (offs) { lastR = r; lastOffs = offs; return offs; }
  const pts: number[] = [0, 0];
  const inner = (r - 1.5) * (r - 1.5);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 <= r * r && d2 >= inner) pts.push(dx, dy);
    }
  }
  offs = Int8Array.from(pts);
  ringCache.set(r, offs);
  lastR = r; lastOffs = offs;
  return offs;
}

/**
 * Le cercle (centre arrondi au pixel, rayon r) touche-t-il un pixel solide ?
 * Les déplacements sont balayés par pas ≤ 1 px : le pourtour suffit (pas de tunnelage).
 */
export function circleOverlaps(t: SolidQuery, x: number, y: number, r: number): boolean {
  const cx = Math.round(x), cy = Math.round(y);
  const o = ringOffsets(r);
  for (let i = 0; i < o.length; i += 2) {
    if (t.isSolid(cx + (o[i] as number), cy + (o[i + 1] as number))) return true;
  }
  return false;
}

/** Fait sortir un cercle enfoncé dans le terrain (apparition, terrain modifié) : monte puis déborde. */
export function unstick(t: SolidQuery, p: { x: number; y: number }, r: number, maxPush = 40): boolean {
  if (!circleOverlaps(t, p.x, p.y, r)) return false;
  for (let d = 1; d <= maxPush; d++) {
    for (const [dx, dy] of [[0, -d], [-d, -d], [d, -d], [-d, 0], [d, 0]] as const) {
      if (!circleOverlaps(t, p.x + dx, p.y + dy, r)) { p.x += dx; p.y += dy; return true; }
    }
  }
  return true;
}

/**
 * Normale approchée de la surface au point (x,y) : direction moyenne du vide autour du point
 * (vecteur unitaire pointant hors de la matière). Vers le haut si rien d'exploitable.
 */
export function surfaceNormal(t: SolidQuery, x: number, y: number, radius = 3): { x: number; y: number } {
  const cx = Math.floor(x), cy = Math.floor(y);
  let sx = 0, sy = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius + 1) continue;
      if (t.isSolid(cx + dx, cy + dy)) { sx -= dx; sy -= dy; }
    }
  }
  const len = dist(sx, sy);
  return len < 1e-6 ? { x: 0, y: -1 } : { x: sx / len, y: sy / len };
}
