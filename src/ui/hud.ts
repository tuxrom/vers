import { GAMEPLAY } from '@/config/gameplay';
import type { GameCanvas } from '@/core/canvas';
import { activeWorm, livingOf } from '@/core/game';
import type { GameState } from '@/core/state';
import { t, type Key } from './i18n';
import { getLabel } from './labels';
import type { UI } from './ui';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(h / 2, 12));
  ctx.fill();
}

/** Éléments d'interface en espace monde : repère du ver actif, PV au-dessus des vers. */
export function drawWorldHud(
  ctx: CanvasRenderingContext2D, s: GameState, alpha: number, timeSec: number,
  view: { x: number; y: number; w: number; h: number }, scale: number,
): void {
  const act = activeWorm(s);
  ctx.save();
  for (const w of s.worms) {
    if (!w.alive || w.sunk) continue;
    const x = w.px + (w.x - w.px) * alpha, y = w.py + (w.y - w.py) * alpha;
    if (x < view.x - 60 || x > view.x + view.w + 60 || y < view.y - 80 || y > view.y + view.h + 40) continue; // hors champ
    // Nom : étiquette prérendue (le texte contouré est l'opération la plus chère du canvas), puis barre de PV.
    const label = getLabel(w.name, w.color, scale);
    ctx.drawImage(label.canvas, x - label.w / 2, y - 36 - label.h / 2, label.w, label.h);
    const bw = 34, frac = Math.max(0, Math.min(1, w.health / s.options.startHealth));
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x - bw / 2 - 1, y - 30, bw + 2, 7);
    ctx.fillStyle = frac > 0.5 ? '#6bd36b' : frac > 0.25 ? '#ffd54a' : '#ff5a4d';
    ctx.fillRect(x - bw / 2, y - 29, bw * frac, 5);
  }
  if (act && act.alive && (s.phase === 'turn' || s.phase === 'firing')) {
    const x = act.px + (act.x - act.px) * alpha, y = act.py + (act.y - act.py) * alpha;
    const bob = Math.sin(timeSec * 6) * 3;
    ctx.fillStyle = act.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - 46 + bob);
    ctx.lineTo(x - 7, y - 58 + bob);
    ctx.lineTo(x + 7, y - 58 + bob);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** Interface en espace écran : chronomètre, jauge de vent, équipes, bandeaux. */
export function drawHud(c: GameCanvas, s: GameState, aiThinking = false, ui?: UI): void {
  const { ctx } = c;
  const sf = c.safe;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(0, sf.top); // le haut de l'écran commence sous l'encoche

  // --- Chronomètre (haut, centré)
  const cx = c.width / 2;
  const counting = s.phase === 'turn' || s.phase === 'firing';
  const secs = Math.ceil(s.turn.timeLeft);
  const urgent = counting && secs <= 10;
  const tcolor = s.teams[s.turn.team]?.color ?? '#ccc';
  ctx.fillStyle = 'rgba(10,20,40,0.7)';
  ctx.beginPath();
  ctx.arc(cx, 34, 26, 0, Math.PI * 2);
  ctx.fill();
  if (counting) {
    const frac = s.turn.timeLeft / (s.phase === 'firing' ? GAMEPLAY.turn.retreatTime : s.options.turnDuration);
    ctx.strokeStyle = urgent ? '#ff5a4d' : tcolor;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, 34, 23, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, frac));
    ctx.stroke();
  }
  ctx.fillStyle = urgent ? '#ff8a80' : '#fff';
  ctx.font = `bold 24px ${FONT}`;
  ctx.fillText(counting ? String(secs) : '–', cx, 35);
  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  const hint = s.phase === 'placing' ? t('hud.placing') : s.phase === 'firing' ? t('hud.retreat') :
    s.phase === 'resolving' ? t('hud.resolving') : '';
  if (hint) ctx.fillText(hint, cx, 74);
  else if (aiThinking) { ctx.fillStyle = '#ffd54a'; ctx.fillText(t('hud.aiThinking'), cx, 74); ctx.fillStyle = 'rgba(255,255,255,0.85)'; }

  // --- Jauge de vent (sous le chrono)
  const gw = 150, gx = cx - gw / 2, gy = hint || aiThinking ? 86 : 72;
  pill(ctx, gx - 4, gy - 4, gw + 8, 16, 'rgba(10,20,40,0.7)');
  const frac = Math.max(-1, Math.min(1, s.wind / GAMEPLAY.wind.max));
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(gx, gy, gw, 8);
  ctx.fillStyle = Math.abs(frac) > 0.66 ? '#ffb347' : '#8fd3ff';
  if (frac >= 0) ctx.fillRect(cx, gy, (gw / 2) * frac, 8);
  else ctx.fillRect(cx + (gw / 2) * frac, gy, (gw / 2) * -frac, 8);
  ctx.fillStyle = '#fff';
  ctx.fillRect(cx - 1, gy - 2, 2, 12);
  // Chevrons de direction.
  if (Math.abs(frac) > 0.03) {
    const dir = Math.sign(frac), n = 1 + Math.floor(Math.abs(frac) * 3);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    for (let i = 0; i < n; i++) {
      const px = cx + dir * (gw / 2 + 14 + i * 7);
      ctx.beginPath();
      ctx.moveTo(px - dir * 3, gy - 1);
      ctx.lineTo(px + dir * 3, gy + 4);
      ctx.lineTo(px - dir * 3, gy + 9);
      ctx.stroke();
    }
  }
  ctx.font = `10px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(t('hud.wind', { n: Math.abs(Math.round(frac * 100)) }), cx, gy + 22);
  // Mort subite : décompte avant la première montée de l'eau, puis rappel.
  const sd = GAMEPLAY.water.suddenDeathTurn - s.turnNumber;
  if (s.turnNumber > 0) {
    ctx.fillStyle = sd <= 0 ? '#ff8a80' : sd <= 3 ? '#ffd54a' : 'rgba(255,255,255,0.55)';
    ctx.fillText(sd > 0 ? t(sd > 1 ? 'hud.sudden.many' : 'hud.sudden.one', { n: sd }) : t('hud.sudden.now'), cx, gy + 35);
  }

  // --- Équipes (haut droite) : PV cumulés, équipe qui joue en surbrillance
  const per = s.options.startHealth * s.options.wormsPerTeam;
  ctx.translate(0, -sf.top);
  const pw = c.touch ? 132 : 150, ph = c.touch ? 18 : 20;
  let py = 10 + sf.top;
  ctx.textAlign = 'left';
  for (const tm of s.teams) {
    let hp = 0, alive = 0;
    for (const w of s.worms) if (w.team === tm.id && w.alive) { hp += w.health; alive++; }
    const px = c.width - pw - 10 - sf.right;
    pill(ctx, px - 4, py - 2, pw + 8, ph + 4, tm.id === s.turn.team ? 'rgba(255,255,255,0.28)' : 'rgba(10,20,40,0.6)');
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(px, py + 12, pw, 5);
    ctx.fillStyle = tm.color;
    ctx.fillRect(px, py + 12, pw * Math.min(1, hp / per), 5);
    ctx.font = `bold 11px ${FONT}`;
    ctx.fillStyle = '#fff';
    ctx.fillText(`${tm.name}${tm.controller === 'ai' ? ` · ${t('hud.aiTag', { level: t(`difficulty.${tm.difficulty}` as Key) })}` : ''} · ${alive}`, px + 2, py + 5, pw - 4);
    py += ph + 8;
  }
  ctx.textAlign = 'center';
  ctx.translate(0, sf.top);

  // --- Bouton pause (tactile : pas de touche Échap)
  if (c.touch) {
    const bx = cx - 62, by = 34, r = 22;
    ctx.fillStyle = 'rgba(10,20,40,0.7)';
    ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(bx - 7, by - 8, 5, 16); ctx.fillRect(bx + 2, by - 8, 5, 16);
    ui?.add('pause-btn', bx - r - 6, by + sf.top - r - 6, r * 2 + 12, r * 2 + 12);
  }

  // --- Bandeaux
  if (s.phase === 'transition' || s.phase === 'gameover') {
    const winner = s.winner !== null && s.winner >= 0 ? s.teams[s.winner] : undefined;
    const text = s.phase === 'gameover'
      ? (winner ? t('hud.victory', { team: winner.name }) : t('hud.draw'))
      : t('hud.nextTurn', { team: nextName(s) });
    const color = s.phase === 'gameover' && winner ? winner.color : '#fff';
    ctx.font = `bold 34px ${FONT}`;
    const w = ctx.measureText(text).width + 60;
    pill(ctx, cx - w / 2, c.height * 0.3 - 30, w, 60, 'rgba(10,20,40,0.78)');
    ctx.fillStyle = color;
    ctx.fillText(text, cx, c.height * 0.3);
  }
  ctx.restore();
}

/** Nom de l'équipe qui va jouer (prochaine équipe vivante après l'équipe courante). */
function nextName(s: GameState): string {
  const n = s.teams.length;
  for (let i = 1; i <= n; i++) {
    const tm = s.teams[(s.turn.team + i) % n];
    if (tm && livingOf(s, tm.id).length > 0) return tm.name;
  }
  return '';
}
