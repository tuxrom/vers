import { GAMEPLAY } from '@/config/gameplay';
import type { Rng } from '@/core/rng';
import { TerrainMask } from './mask';
import { ValueNoise } from './noise';

const T = GAMEPLAY.terrain;

/** x^1,25 par racines carrées (exactes) : `Math.pow` n'est pas identique d'un moteur à l'autre. */
function quarticRoot(x: number): number {
  return x * Math.sqrt(Math.sqrt(x));
}

/**
 * Génère le masque solide d'une carte : collines (bruit fractal 1D), grottes (lignes de niveau d'un
 * bruit 2D) et îlots flottants. Pur et déterministe pour une graine donnée (aucun DOM).
 */
export function generateMask(rng: Rng, width: number, height: number): TerrainMask {
  const mask = new TerrainMask(width, height);
  const noise = new ValueNoise(rng);
  const data = mask.data;
  const maxSurface = GAMEPLAY.water.startLevel - 60;

  // 1. Collines : hauteur de surface par colonne puis remplissage vers le bas.
  const surface = new Int16Array(width);
  for (let x = 0; x < width; x++) {
    const n = noise.fbm2(x / T.wavelength, 0.5, T.octaves, T.persistence);
    const y = T.baseHeight + (n - 0.5) * T.amplitudeScale * T.amplitude;
    surface[x] = Math.round(Math.min(maxSurface, Math.max(T.minSurface, y)));
  }
  for (let x = 0; x < width; x++) {
    for (let y = surface[x] as number; y < height; y++) data[y * width + x] = 1;
  }

  // 2. Grottes : champ de bruit à basse résolution, interpolé bilinéairement par pixel.
  const cell = T.caveCellSize;
  const cw = Math.ceil(width / cell) + 2;
  const ch = Math.ceil(height / cell) + 2;
  const field = new Float32Array(cw * ch);
  const f = cell / T.caveWavelength;
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      // Un décalage vertical évite que les grottes se calent sur la même ligne que la surface.
      field[j * cw + i] = noise.fbm2(i * f + 100, j * f + 100, T.caveOctaves, 0.5);
    }
  }
  const caveFloor = Math.min(height, GAMEPLAY.water.startLevel + T.caveWaterMargin);
  for (let x = 0; x < width; x++) {
    const gx = x / cell;
    const i0 = Math.floor(gx), fx = gx - i0;
    for (let y = (surface[x] as number) + T.caveMinDepth; y < caveFloor; y++) {
      const gy = y / cell;
      const j0 = Math.floor(gy), fy = gy - j0;
      const k = j0 * cw + i0;
      const a = field[k] as number, b = field[k + 1] as number;
      const c = field[k + cw] as number, d = field[k + cw + 1] as number;
      const v = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
      // Les tunnels s'amincissent en approchant du fond de zone (pas de coupe franche).
      const taper = Math.min(1, (caveFloor - y) / T.caveTaper);
      if (Math.abs(v - 0.5) < T.caveWidth * taper) data[y * width + x] = 0;
    }
  }

  // 3. Îlots flottants (posés après les grottes : ils restent pleins).
  const placed: { cx: number; half: number }[] = [];
  for (let n = 0, tries = 0; n < T.islandCount && tries < T.islandCount * 12; tries++) {
    const half = rng.range(T.islandMinWidth, T.islandMaxWidth) / 2;
    const cx = Math.round(rng.range(T.islandEdgeMargin + half, width - T.islandEdgeMargin - half));
    const thick = rng.range(T.islandMinThickness, T.islandMaxThickness);
    if (placed.some((p) => Math.abs(p.cx - cx) < p.half + half + 60)) continue;

    let minSurface = height;
    for (let x = cx - half; x <= cx + half; x++) minSurface = Math.min(minSurface, surface[Math.round(x)] as number);
    const yMax = minSurface - T.islandClearance - thick * 0.7;
    if (yMax < T.islandMinY + thick * 0.3) continue;
    const cy = Math.round(rng.range(T.islandMinY + thick * 0.3, yMax));

    for (let dx = -Math.floor(half); dx <= half; dx++) {
      const t = dx / half;
      const wob = (noise.noise1((cx + dx) / 40 + 7) - 0.5) * 14;
      const top = cy - thick * 0.3 * Math.sqrt(Math.max(0, 1 - t * t)) + wob * 0.3;
      const bottom = cy + thick * 0.7 * quarticRoot(Math.max(0, 1 - Math.abs(t))) + wob;
      const x = cx + dx;
      for (let y = Math.max(0, Math.round(top)); y <= Math.round(bottom) && y < height; y++) data[y * width + x] = 1;
    }
    placed.push({ cx, half });
    n++;
  }

  return mask;
}
