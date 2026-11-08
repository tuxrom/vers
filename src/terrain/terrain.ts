import type { Rng } from '@/core/rng';
import { generateMask } from './generate';
import { TerrainMask, type SolidQuery } from './mask';
import { paintRegion } from './paint';

export interface Rect { x: number; y: number; w: number; h: number }

/** Côté des tuiles de rendu (px). 512 = au plus 4 tuiles touchées par un cratère, textures GPU de taille raisonnable. */
export const TILE = 512;

/**
 * Terrain destructible : masque de collision (vérité physique) + rendu en tuiles de canvas hors écran avec canal
 * alpha (opaque = solide). Les tuiles sont peintes à la demande depuis le masque (démarrage rapide, replay possible)
 * et un cratère ne retouche que les tuiles qu'il recouvre : pas de redessin global. Sans DOM (tests Node), seul le
 * masque existe.
 */
export class Terrain implements SolidQuery {
  readonly width: number;
  readonly height: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly tiles: (HTMLCanvasElement | null)[] = [];
  private readonly withCanvas: boolean;
  /** Incrémenté à chaque modification (invalidation de caches, sauvegarde, réseau). */
  version = 0;
  /** Zones modifiées depuis la dernière consommation (minimap : mise à jour partielle). */
  readonly dirty: Rect[] = [];
  /** Trop de zones accumulées (consommateur absent) : l'information est perdue, reconstruire en entier. */
  dirtyOverflow = false;

  constructor(readonly mask: TerrainMask, withCanvas: boolean) {
    this.width = mask.width;
    this.height = mask.height;
    this.cols = Math.ceil(this.width / TILE);
    this.rows = Math.ceil(this.height / TILE);
    this.withCanvas = withCanvas && typeof document !== 'undefined';
    if (this.withCanvas) for (let i = 0; i < this.cols * this.rows; i++) this.tiles.push(null);
  }

  static generate(rng: Rng, width: number, height: number, withCanvas = true): Terrain {
    return new Terrain(generateMask(rng, width, height), withCanvas);
  }

  /** Vrai si le terrain a un rendu (navigateur). */
  get hasCanvas(): boolean { return this.withCanvas; }

  isSolid(x: number, y: number): boolean {
    return this.mask.isSolid(x, y);
  }

  /** Peint (si besoin) et renvoie la tuile (i = colonne, j = rangée). */
  private tile(i: number, j: number): HTMLCanvasElement {
    const k = j * this.cols + i;
    let c = this.tiles[k];
    if (!c) {
      const x0 = i * TILE, y0 = j * TILE;
      const w = Math.min(TILE, this.width - x0), h = Math.min(TILE, this.height - y0);
      c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D indisponible (tuile de terrain)');
      ctx.putImageData(new ImageData(paintRegion(this.mask, x0, y0, w, h) as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
      this.tiles[k] = c;
    }
    return c;
  }

  /** Nombre de tuiles déjà peintes / total (pour le préchauffage). */
  get paintedTiles(): number { return this.tiles.reduce((n, t) => n + (t ? 1 : 0), 0); }
  get totalTiles(): number { return this.cols * this.rows; }

  /** Peint des tuiles manquantes pendant `budgetMs` (appelé hors action, la carte est prête sans à-coup au scroll). */
  prewarm(budgetMs: number, now: () => number = () => performance.now()): boolean {
    if (!this.withCanvas) return true;
    const end = now() + budgetMs;
    for (let k = 0; k < this.tiles.length; k++) {
      if (this.tiles[k]) continue;
      this.tile(k % this.cols, Math.floor(k / this.cols));
      if (now() >= end) break;
    }
    return this.paintedTiles === this.totalTiles;
  }

  /** Abandonne les canvas (perte de contexte graphique) : ils seront repeints depuis le masque. */
  invalidateCanvas(): void {
    for (let k = 0; k < this.tiles.length; k++) this.tiles[k] = null;
  }

  /** Creuse un cratère : le masque ET les seules tuiles recouvertes (destination-out + bord roussi source-atop). */
  carveCircle(cx: number, cy: number, r: number): void {
    this.mask.clearCircle(cx, cy, r);
    this.version++;
    const x0 = Math.max(0, Math.floor(cx - r - 3)), y0 = Math.max(0, Math.floor(cy - r - 3));
    const x1 = Math.min(this.width, Math.ceil(cx + r + 3)), y1 = Math.min(this.height, Math.ceil(cy + r + 3));
    if (x1 <= x0 || y1 <= y0) return;
    this.dirty.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    if (this.dirty.length > 64) { this.dirty.length = 0; this.dirtyOverflow = true; } // consommateur absent : bornage
    if (!this.withCanvas) return;
    for (let j = Math.floor(y0 / TILE); j <= Math.floor((y1 - 1) / TILE); j++) {
      for (let i = Math.floor(x0 / TILE); i <= Math.floor((x1 - 1) / TILE); i++) {
        const t = this.tiles[j * this.cols + i];
        if (!t) continue; // pas encore peinte : elle le sera depuis le masque déjà creusé
        const ctx = t.getContext('2d') as CanvasRenderingContext2D;
        ctx.save();
        ctx.translate(-i * TILE, -j * TILE);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-atop';
        ctx.strokeStyle = 'rgba(20,10,0,0.45)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  /** Dessine les tuiles visibles (coordonnées monde, contexte déjà transformé), sans toucher aux autres. */
  draw(ctx: CanvasRenderingContext2D, view: Rect): void {
    if (!this.withCanvas) return;
    const sx = Math.max(0, Math.floor(view.x)), sy = Math.max(0, Math.floor(view.y));
    const ex = Math.min(this.width, Math.ceil(view.x + view.w)), ey = Math.min(this.height, Math.ceil(view.y + view.h));
    if (ex <= sx || ey <= sy) return;
    for (let j = Math.floor(sy / TILE); j <= Math.floor((ey - 1) / TILE); j++) {
      for (let i = Math.floor(sx / TILE); i <= Math.floor((ex - 1) / TILE); i++) {
        const t = this.tile(i, j);
        const tx = i * TILE, ty = j * TILE;
        const x = Math.max(sx, tx), y = Math.max(sy, ty);
        const w = Math.min(ex, tx + t.width) - x, h = Math.min(ey, ty + t.height) - y;
        if (w > 0 && h > 0) ctx.drawImage(t, x - tx, y - ty, w, h, x, y, w, h);
      }
    }
  }
}
