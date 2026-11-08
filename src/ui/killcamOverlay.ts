import { GAMEPLAY } from '@/config/gameplay';
import type { GameCanvas } from '@/core/canvas';
import type { Killcam } from '@/core/killcam';
import { t } from './i18n';
import type { UI } from './ui';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Habillage du replay : bandes de cinéma, titre, vitesse, progression et bouton Passer (région `killcam-skip`). */
export function drawKillcam(c: GameCanvas, ui: UI, k: Killcam): void {
  const { ctx } = c;
  const bar = Math.max(34, Math.round(c.height * 0.1));
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(0, 0, c.width, bar + c.safe.top);
  ctx.fillRect(0, c.height - bar - c.safe.bottom, c.width, bar + c.safe.bottom);
  ctx.textBaseline = 'middle';
  const y = c.safe.top + bar / 2;
  // Pastille REC clignotante + titre.
  ctx.fillStyle = Math.floor(performance.now() / 500) % 2 ? '#ff4d4d' : '#7a1f1f';
  ctx.beginPath(); ctx.arc(c.safe.left + 22, y, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.font = `bold ${c.touch ? 15 : 17}px ${FONT}`;
  ctx.fillText(t('killcam.title'), c.safe.left + 38, y);
  ctx.font = `13px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(t('killcam.speed', { n: GAMEPLAY.killcam.slowMotion }), c.safe.left + 38 + 170, y);
  // Bouton Passer (zone tactile ≥ 44 px).
  const bw = 110, bh = 40, bx = c.width - c.safe.right - bw - 16, by = c.safe.top + (bar - bh) / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 10); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = `bold 15px ${FONT}`;
  ctx.fillText(`${t('killcam.skip')} ⏭`, bx + bw / 2, by + bh / 2);
  ui.add('killcam-skip', bx - 6, by - 6, bw + 12, bh + 12);
  // Progression.
  const py = c.height - c.safe.bottom - bar / 2, pw = Math.min(c.width - 160, 560), px = (c.width - pw) / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.fillRect(px, py - 3, pw, 6);
  ctx.fillStyle = '#8fd3ff';
  ctx.fillRect(px, py - 3, pw * k.progress, 6);
  ctx.restore();
}
