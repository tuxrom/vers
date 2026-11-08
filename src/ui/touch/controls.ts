import { GAMEPLAY } from '@/config/gameplay';
import type { GameCanvas } from '@/core/canvas';
import type { GameState } from '@/core/state';
import { WEAPONS } from '@/weapons';
import { ammoOf } from '@/weapons/system';
import { drawWeaponIcon } from '../icons';
import { t } from '../i18n';
import type { UI } from '../ui';
import { TouchCore, type TouchHost } from './core';
import { circleOf, type Circle } from './layout';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const T = GAMEPLAY.touch;

/**
 * Commandes tactiles : écoute des doigts (pointer events de type touch/pen, un identifiant par doigt),
 * attribution aux commandes via `TouchCore` et dessin des commandes. Écoute AVANT le contrôleur de pointeur de
 * la caméra et lui retire les doigts qu'elle a pris (`stopImmediatePropagation`).
 */
export class TouchControls {
  readonly core: TouchCore;

  constructor(private el: HTMLCanvasElement, host: TouchHost) {
    this.core = new TouchCore(host);
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up); // touchcancel : geste interrompu par le système
    el.addEventListener('lostpointercapture', this.up);
    window.addEventListener('blur', () => this.core.cancelAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.core.cancelAll(); });
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private isTouch(e: PointerEvent): boolean { return e.pointerType === 'touch' || e.pointerType === 'pen'; }

  private down = (e: PointerEvent): void => {
    if (!this.isTouch(e)) return;
    const p = this.local(e);
    if (this.core.down(e.pointerId, p.x, p.y)) {
      try { this.el.setPointerCapture(e.pointerId); } catch { /* pointeur synthétique */ }
      e.preventDefault();
      e.stopImmediatePropagation(); // ce doigt n'appartient pas à la caméra
    }
  };

  private move = (e: PointerEvent): void => {
    if (!this.core.owns(e.pointerId)) return;
    const p = this.local(e);
    this.core.move(e.pointerId, p.x, p.y);
    e.stopImmediatePropagation();
  };

  private up = (e: PointerEvent): void => {
    if (!this.core.owns(e.pointerId)) return;
    this.core.up(e.pointerId);
    e.stopImmediatePropagation();
  };

  /** Dessine les commandes (grisées hors du tour du joueur) et déclare les puces de minuterie. */
  draw(c: GameCanvas, ui: UI, s: GameState, circles: readonly Circle[], enabled: boolean, mode: 'hold' | 'confirm', hasTarget: boolean, aimActive: boolean): void {
    const { ctx } = c;
    const dim = enabled ? 1 : 0.35;
    const def = WEAPONS[s.turn.weapon];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // --- joystick
    const j = circleOf(circles, 'joystick');
    ctx.globalAlpha = 0.55 * dim;
    ctx.fillStyle = 'rgba(10,20,40,0.55)';
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(j.cx, j.cy, j.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `bold ${Math.round(j.r * 0.32)}px ${FONT}`;
    ctx.fillText('◀', j.cx - j.r * 0.72, j.cy);
    ctx.fillText('▶', j.cx + j.r * 0.72, j.cy);
    ctx.font = `bold ${Math.round(j.r * 0.24)}px ${FONT}`;
    ctx.fillText('▲', j.cx, j.cy - j.r * 0.74);
    ctx.fillText('▼', j.cx, j.cy + j.r * 0.74);
    const jj = this.core.joy;
    const kx = j.cx + (jj ? jj.nx * j.r * 0.62 : 0), ky = j.cy + (jj ? jj.ny * j.r * 0.62 : 0);
    ctx.globalAlpha = (jj ? 0.95 : 0.6) * dim;
    ctx.fillStyle = jj ? '#8fd3ff' : 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.arc(kx, ky, j.r * 0.38, 0, Math.PI * 2); ctx.fill();

    // --- boutons ronds
    const round = (cc: Circle, fill: string, pressed: boolean, draw: () => void): void => {
      ctx.globalAlpha = (pressed ? 0.95 : 0.62) * dim;
      ctx.fillStyle = fill;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cc.cx, cc.cy, cc.r * (pressed ? 0.94 : 1), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = (pressed ? 1 : 0.9) * dim;
      draw();
    };

    const jump = circleOf(circles, 'jump');
    round(jump, 'rgba(60,130,200,0.8)', this.core.isPressed('jump'), () => {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(jump.r * 0.9)}px ${FONT}`;
      ctx.fillText('⤒', jump.cx, jump.cy + 1);
    });
    const flip = circleOf(circles, 'backflip');
    round(flip, 'rgba(120,90,200,0.8)', this.core.isPressed('backflip'), () => {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(flip.r * 1.05)}px ${FONT}`;
      ctx.fillText('↺', flip.cx, flip.cy + 1);
    });

    // --- arme courante (ouvre le menu) + minuteries de la grenade
    const wp = circleOf(circles, 'weapons');
    round(wp, 'rgba(20,40,80,0.85)', this.core.isPressed('weapons'), () => {
      drawWeaponIcon(ctx, def.id, wp.cx, wp.cy - wp.r * 0.12, wp.r * 1.15);
      const a = ammoOf(s, s.turn.team, def.id);
      ctx.fillStyle = '#bfe3ff';
      ctx.font = `bold ${Math.max(11, Math.round(wp.r * 0.38))}px ${FONT}`;
      ctx.fillText(a < 0 ? '∞' : `×${a}`, wp.cx, wp.cy + wp.r * 0.62);
    });
    if (def.fuseSelectable) {
      const g = GAMEPLAY.weapons.grenade;
      const size = Math.max(40, wp.r * 0.95), gap = 6;
      const n = g.fuseMax - g.fuseMin + 1;
      let x = wp.cx - wp.r - 10 - n * (size + gap);
      const y = wp.cy - size / 2;
      for (let f = g.fuseMin; f <= g.fuseMax; f++) {
        ctx.globalAlpha = 0.85 * dim;
        ctx.fillStyle = f === s.turn.fuse ? '#ffb347' : 'rgba(10,20,40,0.75)';
        ctx.beginPath(); ctx.roundRect(x, y, size, size, 10); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = f === s.turn.fuse ? '#222' : '#fff';
        ctx.font = `bold ${Math.round(size * 0.5)}px ${FONT}`;
        ctx.fillText(String(f), x + size / 2, y + size / 2 + 1);
        if (enabled && !ui.menuOpen) ui.add(`fuse:${f}`, x, y, size, size);
        x += size + gap;
      }
    }

    // --- tir : anneau de puissance très visible, valeur en pourcentage
    const fire = circleOf(circles, 'fire');
    const ready = mode === 'hold' || hasTarget;
    const pressed = this.core.isPressed('fire');
    const charging = s.turn.charging && s.turn.power > 0;
    round(fire, mode === 'confirm' ? 'rgba(40,160,90,0.85)' : 'rgba(200,60,50,0.85)', pressed, () => {
      ctx.fillStyle = '#fff';
      if (mode === 'confirm') {
        ctx.font = `bold ${Math.round(fire.r * 1.1)}px ${FONT}`;
        ctx.fillText('✓', fire.cx, fire.cy + 2);
      } else if (charging) {
        ctx.font = `bold ${Math.round(fire.r * 0.55)}px ${FONT}`;
        ctx.fillText(`${Math.round(s.turn.power * 100)}%`, fire.cx, fire.cy + 1);
      } else {
        // Réticule (maintenir pour charger).
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3.5;
        const r = fire.r * 0.42;
        ctx.beginPath(); ctx.arc(fire.cx, fire.cy, r, 0, Math.PI * 2);
        ctx.moveTo(fire.cx - r * 1.5, fire.cy); ctx.lineTo(fire.cx - r * 0.5, fire.cy);
        ctx.moveTo(fire.cx + r * 0.5, fire.cy); ctx.lineTo(fire.cx + r * 1.5, fire.cy);
        ctx.moveTo(fire.cx, fire.cy - r * 1.5); ctx.lineTo(fire.cx, fire.cy - r * 0.5);
        ctx.moveTo(fire.cx, fire.cy + r * 0.5); ctx.lineTo(fire.cx, fire.cy + r * 1.5);
        ctx.stroke();
      }
    });
    if (!ready) { ctx.globalAlpha = 0.45 * dim; ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(fire.cx, fire.cy, fire.r, 0, Math.PI * 2); ctx.fill(); }
    if (def.input === 'charge' && s.phase === 'turn') {
      // Jauge circulaire épaisse autour du bouton : vert → rouge.
      const lw = Math.max(9, fire.r * 0.24);
      ctx.globalAlpha = 0.5 * dim;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.arc(fire.cx, fire.cy, fire.r + lw * 0.8, 0, Math.PI * 2); ctx.stroke();
      if (s.turn.power > 0) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = `hsl(${120 - 120 * s.turn.power},95%,55%)`;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(fire.cx, fire.cy, fire.r + lw * 0.8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * s.turn.power); ctx.stroke();
      }
    }

    // --- visée au doigt : angle affiché pendant le glissement, rappel discret sinon
    if (aimActive && enabled) {
      const deg = Math.round((s.turn.aim * 180) / Math.PI);
      const zx = c.width - c.safe.right - 10;
      ctx.globalAlpha = this.core.aiming ? 0.95 : 0.4;
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'right';
      ctx.font = `bold ${this.core.aiming ? 22 : 14}px ${FONT}`;
      ctx.fillText(this.core.aiming ? `${deg}°` : `↕ ${t('touch.aimHint')}`, zx, c.height * 0.27);
    }
    void T;
    ctx.restore();
  }
}
