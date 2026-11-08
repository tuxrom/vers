import { GAMEPLAY } from '@/config/gameplay';
import type { TerrainMask } from './mask';

/** Hash entier 2D → [0,1) : bruit de texture cosmétique, stable et sans Math.random. */
function hash2(x: number, y: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Peint herbe + terre + roche pour la région (x0,y0,w,h) du masque : RGBA, alpha 255 = solide, 0 = vide.
 * La texture suit la profondeur sous la surface « vue d'en haut » (chaque bord supérieur reçoit de l'herbe),
 * avec un liseré sombre contre le vide pour la lisibilité. Le résultat ne dépend que du masque : une région
 * peut être (re)peinte à tout moment, indépendamment des autres (tuiles paresseuses, replay).
 */
export function paintRegion(mask: TerrainMask, x0: number, y0: number, w: number, h: number): Uint8ClampedArray {
  const { width: W, height: H, data } = mask;
  const out = new Uint8ClampedArray(w * h * 4);
  const px = new Uint32Array(out.buffer); // écriture d'un pixel en une seule opération (little-endian : ABGR)
  const grass = GAMEPLAY.terrain.grassDepth;

  for (let cx = 0; cx < w; cx++) {
    const x = x0 + cx;
    // Profondeur au-dessus de la région : on remonte la colonne depuis le haut de la carte.
    let depth = 0;
    for (let y = 0; y < y0; y++) depth = data[y * W + x] === 0 ? 0 : depth + 1;
    const gd = grass + (hash2(x, 7919) - 0.5) * 5; // lisière d'herbe irrégulière
    const strata0 = hash2(x >> 4, 3) * 20;
    for (let cy = 0; cy < h; cy++) {
      const y = y0 + cy;
      const i = y * W + x;
      if (data[i] === 0) { depth = 0; continue; }
      depth++;

      const n = hash2(x, y);
      const n2 = hash2(x >> 2, y >> 2); // grain plus grossier
      let r: number, g: number, b: number;
      if (depth <= gd) {
        const k = 1 - (depth / gd) * 0.35;
        r = 74 * k + n * 22; g = 150 * k + n * 28 + n2 * 10; b = 44 * k + n * 12;
      } else if (depth <= gd + 6) {
        r = 110 + n * 20; g = 100 + n * 18; b = 52 + n * 10; // transition herbe sèche → terre
      } else {
        const deep = Math.min(1, Math.max(0, (y - 350) / 750)); // assombrissement selon l'altitude absolue
        const strata = Math.sin((y + strata0) * 0.11) * 6;
        r = 128 - deep * 52 + n * 20 + strata;
        g = 90 - deep * 38 + n * 14 + strata * 0.7;
        b = 56 - deep * 22 + n * 10;
        if (n2 > 0.93) { r += 28; g += 28; b += 28; } // cailloux
        if (n > 0.985) { r *= 0.6; g *= 0.6; b *= 0.6; } // points sombres
      }

      // Liseré contre le vide.
      const edge =
        (x === 0 || data[i - 1] === 0) || (x === W - 1 || data[i + 1] === 0) ||
        (y > 0 && data[i - W] === 0) || (y < H - 1 && data[i + W] === 0);
      if (edge && y !== H - 1) { r *= 0.62; g *= 0.62; b *= 0.62; }

      px[cy * w + cx] = (255 << 24) | ((b > 255 ? 255 : b < 0 ? 0 : b) << 16) | ((g > 255 ? 255 : g < 0 ? 0 : g) << 8) | (r > 255 ? 255 : r < 0 ? 0 : r);
    }
  }
  return out;
}

/** Peint toute la carte (outils / tests). */
export const paintTerrain = (mask: TerrainMask): Uint8ClampedArray => paintRegion(mask, 0, 0, mask.width, mask.height);
