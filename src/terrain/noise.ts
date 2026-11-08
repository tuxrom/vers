import type { Rng } from '@/core/rng';

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Bruit de valeur 1D/2D déterministe (table de permutation tirée du Rng de la partie). */
export class ValueNoise {
  private perm = new Uint8Array(512);

  constructor(rng: Rng) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      const t = p[i] as number;
      p[i] = p[j] as number;
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255] as number;
  }

  private lattice(xi: number, yi: number): number {
    const pm = this.perm;
    // Double indirection : évite les corrélations (stries verticales) de pm[xi] + yi.
    return (pm[(pm[xi & 255] as number) + (pm[(yi + 91) & 255] as number)] as number) / 255;
  }

  /** Valeur dans [0,1]. */
  noise2(x: number, y: number): number {
    const xi = Math.floor(x), yi = Math.floor(y);
    const u = smooth(x - xi), v = smooth(y - yi);
    const a = this.lattice(xi, yi), b = this.lattice(xi + 1, yi);
    const c = this.lattice(xi, yi + 1), d = this.lattice(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  noise1(x: number): number {
    return this.noise2(x, 0.5);
  }

  /** Bruit fractal normalisé dans [0,1]. */
  fbm2(x: number, y: number, octaves: number, persistence: number): number {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise2(x * freq + o * 17.3, y * freq + o * 31.7);
      norm += amp;
      amp *= persistence;
      freq *= 2;
    }
    return sum / norm;
  }
}
