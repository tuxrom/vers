import { GAMEPLAY } from '@/config/gameplay';
import { drawWorm } from '@/entities/wormDraw';
import { drawCrate } from '@/entities/crateDraw';
import { drawWater } from '@/ui/water';
import { drawProjectile } from '@/entities/projectileDraw';
import type { Fx } from '@/ui/fx';
import { drawWorldHud } from '@/ui/hud';
import { drawAiming } from '@/ui/weaponMenu';
import type { Worm } from '@/entities/worm';
import type { GameCanvas } from './canvas';
import type { Camera } from './camera';
import type { GameState } from './state';

/**
 * Rendu du monde (lit l'état, n'y écrit jamais). `alpha` interpole entre le pas précédent et le courant.
 * Point d'extension : terrain, vers et effets sont des fonctions de dessin remplaçables (sprites plus tard).
 */
export function renderWorld(c: GameCanvas, cam: Camera, s: GameState, alpha: number, fx: Fx, shakeX = 0, shakeY = 0, hover: { x: number; y: number } | null = null): void {
  const { ctx } = c;
  c.begin();

  // Ciel (espace écran) : dégradé mémorisé tant que la hauteur ne change pas (pas de nouvel objet à chaque frame).
  if (!sky || sky.h !== c.height) {
    const g = ctx.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, '#1b2a41');
    g.addColorStop(1, '#6f9bd1');
    sky = { h: c.height, g };
  }
  ctx.fillStyle = sky.g;
  ctx.fillRect(0, 0, c.width, c.height);

  ctx.save();
  cam.apply(ctx, c.width, c.height, c.dpr, shakeX, shakeY);
  const view = cam.visibleRect(c.width, c.height);
  const { width, height } = GAMEPLAY.world;
  const q = c.quality;
  const scale = cam.zoom * c.dpr; // pixels écran par unité de monde : résolution des sprites mis en cache

  // Eau : couche arrière derrière le terrain, couche avant devant les vers.
  const wl = fx.waterLevel(s);
  const waveTime = performance.now() / 1000; // vagues cosmétiques : horloge murale (animées même en pause/menu)
  drawWater(ctx, view, wl, waveTime, 'back', q.waveStep);
  s.terrain.draw(ctx, view); // seules les tuiles visibles
  // Tout ce qui est hors champ n'est pas dessiné (24 vers, caisses, projectiles, cordes).
  for (let i = 0; i < s.crates.length; i++) { const cr = s.crates[i] as GameState['crates'][number]; if (visible(view, cr.x, cr.y)) drawCrate(ctx, cr, alpha, s.time); }
  for (let i = 0; i < s.worms.length; i++) { const w = s.worms[i] as Worm; if (w.rope && visible(view, w.x, w.y)) drawRope(ctx, w, alpha); }
  for (let i = 0; i < s.worms.length; i++) { const w = s.worms[i] as Worm; if (visible(view, w.x, w.y)) drawWorm(ctx, w, alpha, s.time, scale, q.shadows); }
  for (let i = 0; i < s.projectiles.length; i++) { const p = s.projectiles[i] as GameState['projectiles'][number]; if (visible(view, p.x, p.y)) drawProjectile(ctx, p, alpha); }
  fx.draw(ctx, view, q.soft);
  drawAiming(ctx, s, alpha, hover);
  drawWater(ctx, view, wl, waveTime, 'front', q.waveStep);

  drawWorldHud(ctx, s, alpha, s.time, view, scale);

  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, width, height);
  ctx.restore();
}

let sky: { h: number; g: CanvasGradient } | null = null;

/** Un objet du monde est-il (à peu près) à l'écran ? Marge pour le contour, les étiquettes et les ombres. */
function visible(view: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean {
  return x > view.x - 90 && x < view.x + view.w + 90 && y > view.y - 160 && y < view.y + view.h + 90;
}

/** Corde ninja : trait du ver à son point d'ancrage, avec le crochet. */
function drawRope(ctx: CanvasRenderingContext2D, w: Worm, alpha: number): void {
  if (!w.rope) return;
  const x = w.px + (w.x - w.px) * alpha, y = w.py + (w.y - w.py) * alpha;
  ctx.save();
  ctx.strokeStyle = '#6e4a24';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 2);
  ctx.lineTo(w.rope.ax, w.rope.ay);
  ctx.stroke();
  ctx.fillStyle = '#bbb';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.beginPath();
  ctx.arc(w.rope.ax, w.rope.ay, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
