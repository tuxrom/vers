import { GAMEPLAY } from '@/config/gameplay';
import { SPRITE_HALF, wormSprites } from './wormSprites';
import type { Worm } from './worm';

const R = GAMEPLAY.worm.radius;



/**
 * Dessin d'un ver : sprite de corps prérendu (cache), queue, léger écrasement à la marche, étirement en l'air,
 * rotation pendant le salto. `scale` = pixels écran par unité de monde (zoom × pixel ratio) : choisit la
 * résolution du sprite. Point de remplacement par de vrais sprites : réimplémenter cette fonction (même signature).
 */
export function drawWorm(ctx: CanvasRenderingContext2D, w: Worm, alpha: number, time: number, scale = 2, shadows = true): void {
  if (w.sunk) return;
  if (!w.alive) { drawGrave(ctx, w, alpha); return; }
  const x = w.px + (w.x - w.px) * alpha;
  const y = w.py + (w.y - w.py) * alpha;
  const f = w.facing;

  // Écrasement / étirement, ancré sur le bas du corps (le contact au sol reste fixe).
  let sx = 1, sy = 1;
  if (w.mode === 'ground' && w.walking) {
    const b = Math.sin(w.walkPhase * Math.PI * 2);
    sx = 1 + 0.1 * b; sy = 1 - 0.1 * b;
  } else if (w.mode === 'air') {
    const v = Math.min(1, Math.abs(w.vy) / 500);
    sx = 1 - 0.12 * v; sy = 1 + 0.18 * v;
  }

  ctx.save();
  if (w.appear > 0) {
    // Téléportation : le ver grandit en apparaissant, avec un léger clignotement.
    const k = 1 - w.appear / GAMEPLAY.weapons.teleport.appearTime;
    sx *= 0.2 + 0.8 * k; sy *= 0.2 + 1.0 * k;
    ctx.globalAlpha = 0.35 + 0.65 * k;
  }
  ctx.translate(x, y + R);
  ctx.rotate(w.angle);
  ctx.scale(sx, sy);
  ctx.translate(0, -R);

  // Ombre portée (qualité moyenne et plus).
  if (shadows && w.mode === 'ground' && w.angle === 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(0, R, R * 0.9, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Queue (suit la marche en ondulant) : seule partie animée, tracée directement.
  const wag = w.walking ? Math.sin(w.walkPhase * Math.PI * 2 + 1) * 2.5 : 0;
  ctx.fillStyle = w.color;
  ctx.beginPath();
  ctx.arc(-f * (R * 0.95), R * 0.55 + wag * 0.4, R * 0.42, 0, Math.PI * 2);
  ctx.fill();

  // Corps + visage : un seul drawImage du sprite prérendu (couleur, regard, clignement).
  const blink = (time + w.id * 0.7) % 3.4 < 0.1;
  ctx.drawImage(wormSprites.get(w.color, f, blink, scale), -SPRITE_HALF, -SPRITE_HALF, SPRITE_HALF * 2, SPRITE_HALF * 2);

  ctx.restore();
}

/** Pierre tombale : retombe au-dessus du ver mort avec un petit rebond, puis reste au sol. */
function drawGrave(ctx: CanvasRenderingContext2D, w: Worm, alpha: number): void {
  const x = w.px + (w.x - w.px) * alpha, y = w.py + (w.y - w.py) * alpha;
  let t = Math.min(1, w.deathAge / GAMEPLAY.fx.graveDrop);
  // Chute accélérée puis rebond amorti (easeOutBounce).
  const bounce = t < 1 / 2.75 ? 7.5625 * t * t
    : t < 2 / 2.75 ? 7.5625 * (t -= 1.5 / 2.75) * t + 0.75
    : t < 2.5 / 2.75 ? 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375
    : 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
  const dy = -(1 - Math.min(1, bounce)) * 90;
  ctx.save();
  ctx.translate(x, y + R + dy);
  ctx.globalAlpha = Math.min(1, w.deathAge / 0.15);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); ctx.ellipse(0, 0, 9, 2.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#b8bcc4';
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-7, 0); ctx.lineTo(-7, -14); ctx.arc(0, -14, 7, Math.PI, 0); ctx.lineTo(7, 0); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.strokeStyle = w.color;
  ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(0, -7); ctx.moveTo(-3.5, -13.5); ctx.lineTo(3.5, -13.5); ctx.stroke();
  ctx.restore();
}
