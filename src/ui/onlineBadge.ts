import type { GameCanvas } from '@/core/canvas';
import { t } from './i18n';

export interface OnlineBadgeInfo {
  /** Latence aller-retour lissée (ms), -1 si inconnue. */
  rtt: number;
  code: string;
  /** Dernier tour confirmé synchronisé par le serveur. */
  syncedTurn: number;
  /** Nom du joueur dont on attend les actions (le lockstep attend), ou null. */
  waitingFor: string | null;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Pastille « en ligne » : latence colorée, code du salon, état de synchronisation, attente d'un joueur. */
export function drawOnlineBadge(c: GameCanvas, info: OnlineBadgeInfo): void {
  const { ctx } = c;
  const x = c.touch ? c.width / 2 + 60 : c.safe.left + 10;
  const y = c.touch ? c.safe.top + 14 : c.safe.top + 10;
  const ms = info.rtt;
  const color = ms < 0 ? '#9aa6b8' : ms < 80 ? '#6bd36b' : ms < 200 ? '#ffd54a' : '#ff5a4d';
  const lines: string[] = [`${info.code} · ${ms >= 0 ? `${Math.round(ms)} ms` : '… ms'}`];
  if (info.syncedTurn > 0 && !c.touch) lines.push(t('online.synced', { n: info.syncedTurn }));
  if (info.waitingFor) lines.push(t('online.waiting', { name: info.waitingFor }));
  ctx.save();
  ctx.font = `bold 12px ${FONT}`;
  ctx.textBaseline = 'middle';
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 34;
  const h = 10 + lines.length * 16;
  ctx.fillStyle = 'rgba(10,20,40,0.72)';
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x + 14, y + 5 + 8, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  lines.forEach((l, i) => {
    ctx.font = `${i === 0 ? 'bold ' : ''}12px ${FONT}`;
    ctx.fillStyle = i === 2 || (i === 1 && info.waitingFor && lines.length === 2) ? '#ffd54a' : i === 0 ? '#fff' : 'rgba(255,255,255,0.7)';
    ctx.fillText(l, x + 26, y + 13 + i * 16);
  });
  ctx.restore();
}
