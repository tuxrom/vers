/** Requête de solidité (monde = pixels). Hors carte : murs latéraux et sol solides, ciel vide. */
export interface SolidQuery {
  isSolid(x: number, y: number): boolean;
}

/** Masque de collision léger : 1 octet par pixel, 1 = solide. Source de vérité de la physique. */
export class TerrainMask implements SolidQuery {
  readonly data: Uint8Array;

  constructor(readonly width: number, readonly height: number, data?: Uint8Array) {
    this.data = data ?? new Uint8Array(width * height);
  }

  isSolid(x: number, y: number): boolean {
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || ix >= this.width || iy >= this.height) return true;
    if (iy < 0) return false;
    return this.data[iy * this.width + ix] === 1;
  }

  /**
   * Vide un disque (échantillonnage au centre des pixels, cohérent avec arc() du canvas).
   * Retourne le nombre de pixels supprimés.
   */
  clearCircle(cx: number, cy: number, r: number): number {
    const { width: w, height: h, data } = this;
    const y0 = Math.max(0, Math.ceil(cy - r - 0.5));
    const y1 = Math.min(h - 1, Math.floor(cy + r - 0.5));
    let cleared = 0;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      const hw = Math.sqrt(Math.max(0, r * r - dy * dy));
      const xa = Math.max(0, Math.ceil(cx - hw - 0.5));
      const xb = Math.min(w - 1, Math.floor(cx + hw - 0.5));
      for (let x = xa, i = y * w + xa; x <= xb; x++, i++) {
        if (data[i] === 1) { data[i] = 0; cleared++; }
      }
    }
    return cleared;
  }

  /** Hauteur (y) du premier pixel solide en descendant depuis y0 ; `limit` si aucun avant y1. */
  firstSolidBelow(x: number, y0: number, y1: number, limit = y1): number {
    for (let y = Math.max(0, Math.floor(y0)); y <= y1; y++) if (this.isSolid(x, y)) return y;
    return limit;
  }

  /** Empreinte FNV-1a du masque (déterminisme / tests). */
  checksum(): number {
    let h = 0x811c9dc5;
    const d = this.data;
    for (let i = 0; i < d.length; i += 7) {
      h ^= d[i] as number;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
}
