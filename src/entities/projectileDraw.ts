import type { Projectile } from './projectile';

/** Dessin des projectiles en primitives (remplaçable par des sprites : même signature). */
export function drawProjectile(ctx: CanvasRenderingContext2D, p: Projectile, alpha: number): void {
  const x = p.px + (p.x - p.px) * alpha, y = p.py + (p.y - p.py) * alpha;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(p.angle);
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  switch (p.kind) {
    case 'rocket':
      ctx.fillStyle = '#d8d8d8';
      ctx.beginPath(); ctx.roundRect(-9, -3, 15, 6, 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d33';
      ctx.beginPath(); ctx.moveTo(6, -3); ctx.lineTo(12, 0); ctx.lineTo(6, 3); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffb347';
      ctx.beginPath(); ctx.moveTo(-9, -2); ctx.lineTo(-15, 0); ctx.lineTo(-9, 2); ctx.closePath(); ctx.fill();
      break;
    case 'missile':
      ctx.fillStyle = '#c9ced4';
      ctx.beginPath(); ctx.roundRect(-8, -2.5, 13, 5, 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d33';
      ctx.beginPath(); ctx.moveTo(5, -2.5); ctx.lineTo(10, 0); ctx.lineTo(5, 2.5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffb347';
      ctx.beginPath(); ctx.moveTo(-8, -1.5); ctx.lineTo(-13, 0); ctx.lineTo(-8, 1.5); ctx.closePath(); ctx.fill();
      break;
    case 'dynamite':
      ctx.rotate(-p.angle); // reste droite
      ctx.fillStyle = '#c0392b';
      ctx.beginPath(); ctx.roundRect(-3.5, -9, 7, 18, 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e8d9a0';
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.quadraticCurveTo(4, -14, 8, -12); ctx.stroke();
      ctx.fillStyle = Math.floor(p.age * 12) % 2 ? '#ffe08a' : '#ff7a33';
      ctx.beginPath(); ctx.arc(8, -12, 2.6, 0, Math.PI * 2); ctx.fill();
      break;
    case 'mine': {
      ctx.rotate(-p.angle);
      ctx.fillStyle = '#4b4f55';
      ctx.beginPath(); ctx.ellipse(0, 1, 8, 4.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const armed = p.arm <= 0;
      const lit = armed ? Math.floor(p.age * (p.fuse >= 0 ? 14 : 3)) % 2 === 0 : false;
      ctx.fillStyle = lit ? '#ff3b30' : armed ? '#6b1a16' : '#555';
      ctx.beginPath(); ctx.arc(0, -2, 2.2, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'grenade': {
      ctx.fillStyle = '#4f7a3a';
      ctx.beginPath(); ctx.ellipse(0, 0, 5.5, 6.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#aaa';
      ctx.fillRect(-1.8, -9, 3.6, 3); ctx.strokeRect(-1.8, -9, 3.6, 3);
      break;
    }
  }
  ctx.restore();
  // Minuterie visible au-dessus d'un objet à retardement (hors rotation).
  if (p.fuse >= 0) {
    ctx.save();
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.fillStyle = '#fff';
    const t = String(Math.ceil(p.fuse));
    ctx.strokeText(t, x, y - 14);
    ctx.fillText(t, x, y - 14);
    ctx.restore();
  }
}
