import type { GameCanvas } from '@/core/canvas';
import { activeWorm } from '@/core/game';
import type { GameState } from '@/core/state';
import { GAMEPLAY } from '@/config/gameplay';
import { WEAPON_LIST, WEAPONS } from '@/weapons';
import { aimVector, ammoOf, canSelect, validTeleport } from '@/weapons/system';
import { drawWeaponIcon } from './icons';
import { t, type Key } from './i18n';
import type { UI } from './ui';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
/** Nom traduit d'une arme. */
export const wname = (id: string): string => t(`weapon.${id}.name` as Key);
const ammoLabel = (n: number): string => (n < 0 ? '∞' : `×${n}`);

/** Menu d'armes en grille (ouvert par clic droit, touche W/Tab ou le bouton d'arme). */
export function drawWeaponMenu(c: GameCanvas, ui: UI, s: GameState): void {
  if (!ui.menuOpen) return;
  const { ctx } = c;
  ui.add('menu-bg', 0, 0, c.width, c.height);
  const team = s.turn.team;
  const canPick = s.phase === 'turn';
  const sf = c.safe;
  const n = WEAPON_LIST.length;
  let cols: number, tw: number, th: number, gap: number, k: number, x0: number, y0: number, gw: number, gh: number;
  if (c.touch) {
    // Plein écran pour le pouce : grosses tuiles (≥ 64 px), 1 à 3 rangées selon la hauteur disponible.
    const W = c.width - sf.left - sf.right - 32, H = c.height - sf.top - sf.bottom - 130;
    gap = 10;
    const rows = Math.min(3, Math.max(1, Math.floor((H + gap) / (74 + gap)), n <= 5 ? 1 : 2));
    cols = Math.ceil(n / rows);
    tw = Math.floor((W - (cols - 1) * gap) / cols);
    th = Math.min(150, Math.floor((H - (rows - 1) * gap) / rows));
    k = Math.max(0.8, Math.min(1.5, th / 92, tw / 112));
    gw = cols * tw + (cols - 1) * gap; gh = rows * th + (rows - 1) * gap;
    x0 = Math.round(sf.left + (c.width - sf.left - sf.right - gw) / 2);
    y0 = Math.round(sf.top + 70 + (H - gh) / 2);
  } else {
    cols = Math.min(4, Math.max(1, Math.floor((c.width - 40) / 120)), n);
    const rows = Math.ceil(n / cols);
    // Tuiles réduites si la grille ne tient pas dans la hauteur (petits écrans).
    const base = { tw: 112, th: 92, gap: 10 };
    const needH = rows * base.th + (rows - 1) * base.gap + 130;
    k = Math.min(1, c.height / needH);
    tw = Math.round(base.tw * k); th = Math.round(base.th * k); gap = Math.round(base.gap * k);
    gw = cols * tw + (cols - 1) * gap; gh = rows * th + (rows - 1) * gap;
    x0 = Math.round((c.width - gw) / 2); y0 = Math.round((c.height - gh) / 2) + 10;
  }
  const pad = 16;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = 'rgba(14,24,44,0.95)';
  if (c.touch) {
    ctx.fillRect(0, 0, c.width, c.height);
    // Grand bouton de fermeture (zone de 56 px) en haut à droite.
    const cr = 28, cx = c.width - sf.right - cr - 12, cy = sf.top + cr + 10;
    ui.add('menu-close', cx - cr, cy - cr, cr * 2, cr * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - 10, cy - 10); ctx.lineTo(cx + 10, cy + 10); ctx.moveTo(cx + 10, cy - 10); ctx.lineTo(cx - 10, cy + 10); ctx.stroke();
    ctx.fillStyle = '#fff';
  } else {
    ctx.beginPath(); ctx.roundRect(x0 - pad, y0 - pad - 26, gw + pad * 2, gh + pad * 2 + 56, 14); ctx.fill();
    ui.add('menu-panel', x0 - pad, y0 - pad - 26, gw + pad * 2, gh + pad * 2 + 56);
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${c.touch ? 22 : 16}px ${FONT}`;
  ctx.fillText(t('hud.menuTitle'), c.width / 2, c.touch ? sf.top + 36 : y0 - 16);

  WEAPON_LIST.forEach((def, i) => {
    const x = x0 + (i % cols) * (tw + gap), y = y0 + Math.floor(i / cols) * (th + gap);
    const ok = canPick && canSelect(s, team, def.id);
    const sel = s.turn.weapon === def.id;
    ctx.fillStyle = sel ? 'rgba(120,180,255,0.35)' : 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.roundRect(x, y, tw, th, 10); ctx.fill();
    if (sel) { ctx.strokeStyle = '#8fd3ff'; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.globalAlpha = ok ? 1 : 0.35;
    drawWeaponIcon(ctx, def.id, x + tw / 2, y + th * 0.35, 44 * k);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(10, Math.round(12 * k))}px ${FONT}`;
    ctx.fillText(wname(def.id), x + tw / 2, y + th * 0.72, tw - 6);
    ctx.font = `${Math.max(10, Math.round(12 * k))}px ${FONT}`;
    ctx.fillStyle = ammoOf(s, team, def.id) === 0 ? '#ff8a80' : (s.turn.moved && !def.usableAfterMove) ? '#ffb347' : '#bfe3ff';
    ctx.fillText(s.turn.moved && !def.usableAfterMove ? t('hud.beforeMove') : ammoLabel(ammoOf(s, team, def.id)), x + tw / 2, y + th * 0.89, tw - 6);
    ctx.globalAlpha = 1;
    ui.add(`weapon:${def.id}`, x, y, tw, th);
  });

  const cur = WEAPONS[s.turn.weapon];
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = `12px ${FONT}`;
  ctx.font = `${c.touch ? 14 : 12}px ${FONT}`;
  ctx.fillText(t(`weapon.${cur.id}.desc` as Key), c.width / 2, c.touch ? c.height - c.safe.bottom - 22 : y0 + gh + 24, c.touch ? c.width - 40 : gw);
  ctx.restore();
}

/**
 * HUD d'arme. PC : arme courante en bas à gauche, minuterie réglable. Tactile : ces éléments sont des commandes
 * dessinées par `TouchControls` ; on garde ici la jauge de puissance et les conseils, calés dans la zone sûre.
 */
export function drawWeaponHud(c: GameCanvas, ui: UI, s: GameState, interactive = true): void {
  const act = activeWorm(s);
  if (!act || !act.alive || (s.phase !== 'turn' && s.phase !== 'firing')) return;
  const { ctx } = c;
  const def = WEAPONS[s.turn.weapon];
  const touch = c.touch;
  const x = 10 + c.safe.left, y = c.height - 62 - c.safe.bottom, w = 150, h = 52;
  ctx.save();

  if (!touch) {
    ctx.fillStyle = 'rgba(10,20,40,0.72)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill();
    if (!ui.menuOpen && interactive) ui.add('weapon-btn', x, y, w, h);
    drawWeaponIcon(ctx, def.id, x + 28, y + h / 2, 38);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = `bold 13px ${FONT}`;
    ctx.fillText(wname(def.id), x + 54, y + 20, w - 60);
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = '#bfe3ff';
    ctx.fillText(`${ammoLabel(ammoOf(s, s.turn.team, def.id))}${def.shots > 1 ? `  · ${t('hud.shotsLeft', { n: s.turn.shotsLeft })}` : ''}`, x + 54, y + 38);

    // Minuterie réglable (grenade)
    if (def.fuseSelectable) {
      const g = GAMEPLAY.weapons.grenade;
      const n = g.fuseMax - g.fuseMin + 1, cw = 26, gap = 4;
      const fx = x, fy = y - 34;
      ctx.fillStyle = 'rgba(10,20,40,0.72)';
      ctx.beginPath(); ctx.roundRect(fx, fy, n * (cw + gap) + gap, 30, 8); ctx.fill();
      ctx.textAlign = 'center';
      for (let i = 0; i < n; i++) {
        const f = g.fuseMin + i, cx = fx + gap + i * (cw + gap);
        ctx.fillStyle = f === s.turn.fuse ? '#ffb347' : 'rgba(255,255,255,0.15)';
        ctx.beginPath(); ctx.roundRect(cx, fy + 4, cw, 22, 6); ctx.fill();
        ctx.fillStyle = f === s.turn.fuse ? '#222' : '#fff';
        ctx.font = `bold 13px ${FONT}`;
        ctx.fillText(String(f), cx + cw / 2, fy + 16);
        if (!ui.menuOpen && interactive) ui.add(`fuse:${f}`, cx, fy + 4, cw, 22);
      }
    }
  }

  // Jauge de puissance (centre bas) pendant la charge : plus haute et plus large sur mobile.
  const gh = touch ? 22 : 12;
  const gy = c.height - c.safe.bottom - (touch ? 38 : 34);
  if (def.input === 'charge' && s.phase === 'turn') {
    const gw = Math.min(touch ? 320 : 260, c.width * (touch ? 0.34 : 0.4)), gx = (c.width - gw) / 2;
    ctx.fillStyle = 'rgba(10,20,40,0.78)';
    ctx.beginPath(); ctx.roundRect(gx - 6, gy - 6, gw + 12, gh + 12, 8); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(gx, gy, gw, gh);
    const grad = ctx.createLinearGradient(gx, 0, gx + gw, 0);
    grad.addColorStop(0, '#6bd36b'); grad.addColorStop(0.6, '#ffd54a'); grad.addColorStop(1, '#ff5a4d');
    ctx.fillStyle = grad;
    ctx.fillRect(gx, gy, gw * s.turn.power, gh);
    ctx.textAlign = 'center';
    if (touch && s.turn.power > 0) {
      ctx.fillStyle = '#fff';
      ctx.font = `bold 15px ${FONT}`;
      ctx.fillText(`${Math.round(s.turn.power * 100)}%`, c.width / 2, gy + gh / 2 + 1);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = `${touch ? 13 : 11}px ${FONT}`;
    if (s.turn.power === 0) ctx.fillText(t(touch ? 'hud.hint.charge.touch' : 'hud.hint.charge'), c.width / 2, gy - 12);
  } else if (s.phase === 'turn') {
    const hint = def.input === 'target' ? t(touch ? 'hud.hint.target.touch' : 'hud.hint.target')
      : def.kind === 'rope' ? t('hud.hint.rope')
      : def.kind === 'placed' ? t('hud.hint.place') : def.kind === 'melee' ? t('hud.hint.melee')
      : t(touch ? 'hud.hint.press.touch' : 'hud.hint.fire');
    ctx.font = `${touch ? 13 : 12}px ${FONT}`;
    const tw = ctx.measureText(hint).width + 24;
    ctx.fillStyle = 'rgba(10,20,40,0.72)';
    ctx.beginPath(); ctx.roundRect(c.width / 2 - tw / 2, gy - 4, tw, 26, 8); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(hint, c.width / 2, gy + 10);
  }
  ctx.restore();
}

/** Réticule et jauge de puissance autour du ver (espace monde). */
export function drawAiming(ctx: CanvasRenderingContext2D, s: GameState, alpha: number, hover: { x: number; y: number } | null = null): void {
  const act = activeWorm(s);
  if (!act || !act.alive || s.phase !== 'turn') return;
  const def = WEAPONS[s.turn.weapon];
  if (def.input === 'target' && hover) {
    ctx.save();
    const ok = def.kind !== 'teleport' || validTeleport(s, hover.x, hover.y);
    ctx.strokeStyle = ok ? 'rgba(255,255,255,0.95)' : 'rgba(255,90,77,0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(hover.x, hover.y, 14, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(hover.x - 20, hover.y); ctx.lineTo(hover.x - 8, hover.y); ctx.moveTo(hover.x + 8, hover.y); ctx.lineTo(hover.x + 20, hover.y);
    ctx.moveTo(hover.x, hover.y - 20); ctx.lineTo(hover.x, hover.y - 8); ctx.moveTo(hover.x, hover.y + 8); ctx.lineTo(hover.x, hover.y + 20);
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (!def.aim) return;
  const x = act.px + (act.x - act.px) * alpha, y = act.py + (act.y - act.py) * alpha;
  const dir = aimVector(act, s.turn.aim);
  const d = GAMEPLAY.weapons.aim.reticleDistance;
  const rx = x + dir.x * d, ry = y + dir.y * d;

  ctx.save();
  // Jauge de puissance : points qui s'allongent le long de la visée.
  if (s.turn.power > 0) {
    const n = 14, len = 80;
    for (let i = 0; i < n * s.turn.power; i++) {
      const t = i / n;
      ctx.fillStyle = `hsl(${120 - 120 * t},90%,55%)`;
      ctx.beginPath();
      ctx.arc(x + dir.x * (22 + t * len), y + dir.y * (22 + t * len), 2.2 + t * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(rx, ry, 8, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(rx - 12, ry); ctx.lineTo(rx - 4, ry); ctx.moveTo(rx + 4, ry); ctx.lineTo(rx + 12, ry);
  ctx.moveTo(rx, ry - 12); ctx.lineTo(rx, ry - 4); ctx.moveTo(rx, ry + 4); ctx.lineTo(rx, ry + 12);
  ctx.stroke();
  ctx.restore();
}
