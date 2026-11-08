import { GAMEPLAY } from '@/config/gameplay';
import { drawWeaponIcon } from '@/ui/icons';
import type { Crate } from './crate';

const H = GAMEPLAY.crate.halfSize;

/** Caisse (et son parachute en descente) en primitives ; remplaçable par un sprite (même signature). */
export function drawCrate(ctx: CanvasRenderingContext2D, c: Crate, alpha: number, time: number): void {
  const x = c.px + (c.x - c.px) * alpha, y = c.py + (c.y - c.py) * alpha;
  ctx.save();
  ctx.translate(x, y);
  if (!c.landed) {
    // Parachute : calotte, suspentes, léger balancement.
    const sway = Math.sin(time * 2 + c.id) * 2;
    ctx.translate(sway, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-H, -H); ctx.lineTo(-H * 2.2, -H * 4.2);
    ctx.moveTo(H, -H); ctx.lineTo(H * 2.2, -H * 4.2);
    ctx.moveTo(0, -H); ctx.lineTo(0, -H * 4.4);
    ctx.stroke();
    ctx.fillStyle = c.kind === 'health' ? '#f2f2f2' : c.kind === 'weapon' ? '#e8a23a' : '#5aa9e6';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-H * 2.4, -H * 4.2); ctx.quadraticCurveTo(0, -H * 7.6, H * 2.4, -H * 4.2); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.translate(-sway, 0);
  }
  const face = c.kind === 'health' ? '#f4f4f4' : c.kind === 'weapon' ? '#a9773c' : '#3f6fa3';
  ctx.fillStyle = face;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.roundRect(-H, -H, H * 2, H * 2, 2); ctx.fill(); ctx.stroke();
  if (c.kind === 'health') {
    ctx.fillStyle = '#d63a3a';
    ctx.fillRect(-1.8, -H + 3, 3.6, H * 2 - 6);
    ctx.fillRect(-H + 3, -1.8, H * 2 - 6, 3.6);
  } else if (c.weapon) {
    drawWeaponIcon(ctx, c.weapon, 0, 0, H * 1.5);
  }
  ctx.restore();
}
