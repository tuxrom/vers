import { GAMEPLAY } from '@/config/gameplay';
import type { GameCanvas } from '@/core/canvas';
import type { GameState } from '@/core/state';
import { t } from './i18n';
import type { UI } from './ui';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Écran de victoire : statistiques par équipe et bouton « Rejouer » (région `replay`). */
export function drawGameOver(c: GameCanvas, ui: UI, s: GameState, canReplay = false, online: 'host' | 'guest' | null = null): void {
  if (s.phase !== 'gameover' || s.phaseTime < GAMEPLAY.fx.gameoverDelay) return;
  const { ctx } = c;
  const fade = Math.min(1, (s.phaseTime - GAMEPLAY.fx.gameoverDelay) / 0.4);
  const win = s.winner !== null && s.winner >= 0 ? s.teams[s.winner] : null;
  const pw = Math.min(520, c.width - 24), ph = Math.min(360, c.height - 24);
  const px = (c.width - pw) / 2, py = (c.height - ph) / 2;

  ctx.save();
  ctx.globalAlpha = fade;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = 'rgba(14,24,44,0.96)';
  ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 16); ctx.fill();
  ctx.strokeStyle = win ? win.color : 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = win ? win.color : '#fff';
  ctx.font = `bold 28px ${FONT}`;
  ctx.fillText(win ? t('hud.victory', { team: win.name }) : t('hud.draw'), c.width / 2, py + 40);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `13px ${FONT}`;
  ctx.fillText(t('gameover.turns', { n: s.turnNumber }), c.width / 2, py + 66);

  // Tableau : une ligne par équipe.
  const cols = [t('gameover.team'), t('gameover.damage'), t('gameover.kills'), t('gameover.shots'), t('gameover.misses')];
  const x0 = px + 24, tw = pw - 48;
  const cx = [x0, x0 + tw * 0.42, x0 + tw * 0.60, x0 + tw * 0.76, x0 + tw * 0.92];
  let y = py + 104;
  ctx.font = `bold 12px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  cols.forEach((h, i) => { ctx.textAlign = i === 0 ? 'left' : 'center'; ctx.fillText(h, cx[i] as number, y); });
  y += 14;
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(x0, y, tw, 1);
  y += 22;
  for (const team of s.teams) {
    const st = team.stats;
    ctx.font = `bold 15px ${FONT}`;
    ctx.fillStyle = team.color;
    ctx.textAlign = 'left';
    ctx.fillText(`${team.id === s.winner ? '★ ' : ''}${team.name}`, cx[0] as number, y);
    ctx.font = `15px ${FONT}`;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    [Math.round(st.damage), st.kills, st.shots, st.misses].forEach((v, i) => ctx.fillText(String(v), cx[i + 1] as number, y));
    y += 34;
  }

  // Boutons : rejouer / revoir le dernier tir (replay au ralenti) / menu principal.
  const showReplay = online !== 'guest'; // en ligne, seul l'hôte propose la revanche
  const n = (canReplay ? 1 : 0) + 1 + (showReplay ? 1 : 0);
  const bh = 46, gap = 12, bw = Math.min(190, (pw - 48 - gap * (n - 1)) / n), by = py + ph - bh - 28;
  const bx0 = c.width / 2 - (bw * n + gap * (n - 1)) / 2;
  const btn = (i: number, label: string, id: string, fill: string, ink: string): void => {
    const bx = bx0 + i * (bw + gap);
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 12); ctx.fill();
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.font = `bold ${n === 3 ? 15 : 17}px ${FONT}`;
    ctx.fillText(label, bx + bw / 2, by + bh / 2 + 1, bw - 12);
    ui.add(id, bx, by, bw, bh);
  };
  let k = 0;
  if (showReplay) btn(k++, t(online ? 'online.rematch' : 'gameover.replay'), 'replay', win ? win.color : '#8fd3ff', '#10203a');
  if (canReplay) btn(k++, t('killcam.watch'), 'replay-shot', 'rgba(255,255,255,0.22)', '#fff');
  btn(n - 1, t('gameover.menu'), 'gameover-menu', 'rgba(255,255,255,0.16)', '#fff');
  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.textAlign = 'center';
  ctx.fillText(online === 'guest' ? t('online.waitRematch') : t('gameover.orKey'), c.width / 2, by + bh + 13);
  ctx.restore();
  ui.add('menu-bg-gameover', 0, 0, c.width, c.height); // bloque les clics vers la caméra/le jeu
}
