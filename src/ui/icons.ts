import type { WeaponId } from '@/weapons';

/**
 * Pictogrammes d'armes dessinés en primitives, centrés sur (cx, cy) dans un carré de `s` px.
 * Point de remplacement par des sprites : même signature.
 */
export function drawWeaponIcon(ctx: CanvasRenderingContext2D, id: WeaponId, cx: number, cy: number, s: number): void {
  const u = s / 40; // unité = 1/40 de la taille
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(u, u);
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  switch (id) {
    case 'bazooka':
      ctx.fillStyle = '#6b7a4a';
      ctx.beginPath(); ctx.roundRect(-18, -5, 32, 10, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c0392b';
      ctx.beginPath(); ctx.moveTo(14, -5); ctx.lineTo(22, 0); ctx.lineTo(14, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#444';
      ctx.fillRect(-8, 5, 5, 9); ctx.strokeRect(-8, 5, 5, 9);
      break;
    case 'grenade':
      ctx.fillStyle = '#4f7a3a';
      ctx.beginPath(); ctx.ellipse(0, 3, 11, 13, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#999';
      ctx.fillRect(-4, -14, 8, 6); ctx.strokeRect(-4, -14, 8, 6);
      ctx.beginPath(); ctx.arc(9, -12, 4, 0, Math.PI * 2); ctx.stroke();
      break;
    case 'shotgun':
      ctx.fillStyle = '#8a8a8a';
      ctx.fillRect(-20, -6, 30, 5); ctx.strokeRect(-20, -6, 30, 5);
      ctx.fillStyle = '#8b5a2b';
      ctx.beginPath(); ctx.moveTo(10, -7); ctx.lineTo(21, -3); ctx.lineTo(18, 7); ctx.lineTo(8, 2); ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    case 'dynamite':
      ctx.fillStyle = '#c0392b';
      for (const ox of [-9, 0, 9]) { ctx.beginPath(); ctx.roundRect(ox - 4, -10, 8, 24, 2); ctx.fill(); ctx.stroke(); }
      ctx.strokeStyle = '#e8d9a0';
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.quadraticCurveTo(6, -18, 12, -15); ctx.stroke();
      ctx.fillStyle = '#ffb347';
      ctx.beginPath(); ctx.arc(12, -15, 3, 0, Math.PI * 2); ctx.fill();
      break;
    case 'mine':
      ctx.fillStyle = '#555';
      ctx.beginPath(); ctx.ellipse(0, 4, 15, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c0392b';
      ctx.beginPath(); ctx.arc(0, -2, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      for (const a of [-0.9, 0, 0.9]) { ctx.beginPath(); ctx.moveTo(Math.sin(a) * 9, -3); ctx.lineTo(Math.sin(a) * 14, -10); ctx.stroke(); }
      break;
    case 'airstrike':
      ctx.fillStyle = '#9aa7b5';
      ctx.beginPath(); ctx.moveTo(-16, -6); ctx.lineTo(14, -2); ctx.lineTo(20, 0); ctx.lineTo(14, 2); ctx.lineTo(-16, 6); ctx.lineTo(-10, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c0392b';
      for (const ox of [-8, 0, 8]) { ctx.beginPath(); ctx.roundRect(ox - 2, 8, 4, 9, 1.5); ctx.fill(); ctx.stroke(); }
      break;
    case 'bat':
      ctx.save(); ctx.rotate(-0.6);
      ctx.fillStyle = '#c8a064';
      ctx.beginPath(); ctx.moveTo(-18, 2); ctx.lineTo(8, -4); ctx.quadraticCurveTo(20, -5, 20, 0); ctx.quadraticCurveTo(20, 5, 8, 4); ctx.lineTo(-18, -2); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      break;
    case 'rope':
      ctx.strokeStyle = '#8b5a2b'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-14, 14); ctx.bezierCurveTo(-14, -2, 6, 4, 8, -10); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 2;
      ctx.fillStyle = '#aaa';
      ctx.beginPath(); ctx.arc(9, -12, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    case 'teleport':
      ctx.strokeStyle = '#7fe0ff'; ctx.lineWidth = 3;
      for (const r of [14, 9, 4]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 1.6); ctx.stroke(); }
      break;
  }
  ctx.restore();
}
