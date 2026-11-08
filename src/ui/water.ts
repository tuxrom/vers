import { GAMEPLAY } from '@/config/gameplay';

const F = GAMEPLAY.fx.waves;

/**
 * Eau animée à deux couches de vagues sinusoïdales : la couche arrière (derrière le terrain) et la couche
 * avant (devant les vers) ont des amplitudes, longueurs d'onde et sens différents.
 */
export function drawWater(
  ctx: CanvasRenderingContext2D, view: { x: number; y: number; w: number; h: number },
  level: number, time: number, layer: 'back' | 'front', step = 12,
): void {
  const amp = layer === 'back' ? F.amp1 : F.amp2;
  const len = layer === 'back' ? F.len1 : F.len2;
  const spd = layer === 'back' ? F.speed1 : F.speed2;
  const base = level + (layer === 'back' ? -3 : 2);
  const x0 = Math.floor(view.x / step) * step - step, x1 = view.x + view.w + step;
  const bottom = Math.max(view.y + view.h, level + 600) + 20;

  ctx.beginPath();
  ctx.moveTo(x0, bottom);
  for (let x = x0; x <= x1; x += step) {
    const k = (x / len) * Math.PI * 2 + time * spd;
    ctx.lineTo(x, base + Math.sin(k) * amp + Math.sin(k * 2.3 + 1.7) * amp * 0.35);
  }
  ctx.lineTo(x1, bottom);
  ctx.closePath();
  if (layer === 'back') {
    ctx.fillStyle = backGradient(ctx, level);
  } else {
    ctx.fillStyle = 'rgba(60,130,220,0.38)';
  }
  ctx.fill();
  // Écume sur la crête.
  ctx.strokeStyle = layer === 'back' ? 'rgba(200,230,255,0.35)' : 'rgba(255,255,255,0.7)';
  ctx.lineWidth = layer === 'back' ? 1.5 : 2;
  ctx.beginPath();
  for (let x = x0; x <= x1; x += step) {
    const k = (x / len) * Math.PI * 2 + time * spd;
    const y = base + Math.sin(k) * amp + Math.sin(k * 2.3 + 1.7) * amp * 0.35;
    if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

let gradCache: { level: number; g: CanvasGradient } | null = null;

/** Dégradé de l'eau arrière, recréé seulement quand le niveau change d'au moins un pixel (montée de l'eau). */
function backGradient(ctx: CanvasRenderingContext2D, level: number): CanvasGradient {
  const lv = Math.round(level);
  if (!gradCache || gradCache.level !== lv) {
    const g = ctx.createLinearGradient(0, lv - 10, 0, lv + 260);
    g.addColorStop(0, 'rgba(70,140,220,0.75)');
    g.addColorStop(1, 'rgba(15,45,110,0.9)');
    gradCache = { level: lv, g };
  }
  return gradCache.g;
}
