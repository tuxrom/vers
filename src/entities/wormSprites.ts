import { GAMEPLAY } from '@/config/gameplay';

const R = GAMEPLAY.worm.radius;
/** Le sprite couvre un carré de ±1,5 R autour du centre du ver (corps + contour). */
export const SPRITE_HALF = R * 1.5;

/**
 * Cache de sprites de vers : le corps (ventre, yeux, sourcil, bouche) ne change qu'avec la couleur d'équipe, le regard
 * (gauche/droite) et le clignement. Au lieu de ~15 tracés par ver et par frame, un `drawImage` d'un sprite prérendu
 * à la résolution d'affichage (échelle écran, arrondie par paliers). Les déformations (écrasement, étirement,
 * rotation du salto) s'appliquent par la transformation du contexte.
 */
export class WormSpriteCache {
  private bucket = 0;
  private map = new Map<string, HTMLCanvasElement>();

  /** Palier de résolution pour une échelle écran (px par unité de monde) : 1, 1,5, 2, … 6. */
  static bucketFor(scale: number): number {
    return Math.min(6, Math.max(1, Math.ceil(scale * 2) / 2));
  }

  get(color: string, facing: -1 | 1, blink: boolean, scale: number): HTMLCanvasElement {
    const b = WormSpriteCache.bucketFor(scale);
    if (b !== this.bucket) { this.map.clear(); this.bucket = b; } // zoom/résolution changés : sprites refaits à la demande
    const key = `${color}|${facing}|${blink ? 1 : 0}`;
    let c = this.map.get(key);
    if (!c) {
      c = document.createElement('canvas');
      const px = Math.ceil(SPRITE_HALF * 2 * b);
      c.width = c.height = px;
      const ctx = c.getContext('2d') as CanvasRenderingContext2D;
      ctx.scale(px / (SPRITE_HALF * 2), px / (SPRITE_HALF * 2));
      ctx.translate(SPRITE_HALF, SPRITE_HALF);
      paintBody(ctx, color, facing, blink);
      this.map.set(key, c);
    }
    return c;
  }

  /** Efface tout (perte de contexte graphique). */
  clear(): void { this.map.clear(); }
}

/** Corps du ver centré en (0,0), tourné vers `f`. */
function paintBody(ctx: CanvasRenderingContext2D, color: string, f: -1 | 1, blink: boolean): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Ventre.
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath();
  ctx.ellipse(f * 1.5, R * 0.45, R * 0.62, R * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  // Yeux : blanc + pupille décalée dans le sens du regard.
  for (const ox of [2.0, 6.2]) {
    const ex = f * ox, ey = -R * 0.28;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(ex, ey, 2.7, blink ? 0.5 : 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!blink) {
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(ex + f * 1.0, ey + 0.4, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Sourcil + bouche.
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(f * 0.5, -R * 0.62);
  ctx.lineTo(f * 7.5, -R * 0.78);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(f * 5, R * 0.18, 2.4, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
}

export const wormSprites = new WormSpriteCache();
