import { GAMEPLAY } from '@/config/gameplay';
import type { Action } from '@/core/input';
import { circleOf, inCircle, type Circle, type TouchControlId } from './layout';

const T = GAMEPLAY.touch;
const AIM = GAMEPLAY.weapons.aim;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export interface Rect { x: number; y: number; w: number; h: number }

/** Ce dont la logique tactile a besoin de l'application (aucun accès DOM : testable sous Node). */
export interface TouchHost {
  circles(): readonly Circle[];
  /** Commandes de jeu actives (tour d'un joueur humain, aucun menu ouvert). */
  enabled(): boolean;
  /** `hold` : maintenir pour charger ; `confirm` : valider la cible désignée (armes à cible). */
  fireMode(): 'hold' | 'confirm';
  /** Zone de visée au doigt (null si l'arme courante ne se vise pas). */
  aimZone(): Rect | null;
  /** Une zone d'interface (menu, minimap…) occupe-t-elle ce point ? Elle est prioritaire sur la visée. */
  uiHit(x: number, y: number): boolean;
  currentAim(): number;
  press(action: Action, source: string, down: boolean): void;
  onWeapons(): void;
  onConfirm(): void;
}

/**
 * Logique des commandes tactiles : chaque doigt est « attribué » à UNE commande (joystick, bouton, visée) à son
 * premier contact et la garde jusqu'à son relâchement ou son annulation. Plusieurs doigts agissent donc en
 * même temps (marcher + viser + charger) sans interférer. Les doigts non attribués restent libres pour la
 * caméra (déplacement à un doigt, pincement à deux).
 */
export class TouchCore {
  /** Joystick : doigt et position normalisée dans [-1,1]². */
  joy: { id: number; nx: number; ny: number } | null = null;
  /** Visée au doigt : doigt, point de départ et angle visé. */
  private aim: { id: number; startY: number; startAim: number } | null = null;
  aimTarget: number | null = null;
  /** Doigt → bouton maintenu. */
  private buttons = new Map<number, TouchControlId>();
  private dirs: Record<'left' | 'right' | 'aimUp' | 'aimDown', boolean> = { left: false, right: false, aimUp: false, aimDown: false };

  constructor(private host: TouchHost) {}

  owns(id: number): boolean {
    return this.joy?.id === id || this.aim?.id === id || this.buttons.has(id);
  }

  /** Une commande est-elle actuellement pressée (pour l'affichage) ? */
  isPressed(c: TouchControlId): boolean {
    if (c === 'joystick') return this.joy !== null;
    for (const b of this.buttons.values()) if (b === c) return true;
    return false;
  }

  get aiming(): boolean { return this.aim !== null; }

  /** Premier contact : renvoie true si le doigt est attribué à une commande (il ne doit pas déplacer la caméra). */
  down(id: number, x: number, y: number): boolean {
    if (!this.host.enabled()) return false;
    if (this.owns(id)) return true;
    for (const c of this.host.circles()) {
      const grow = c.id === 'joystick' ? c.r * T.joyGrab : 6;
      if (!inCircle(c, x, y, grow)) continue;
      switch (c.id) {
        case 'joystick':
          if (!this.joy) { this.joy = { id, nx: 0, ny: 0 }; this.moveJoy(x, y); } else return true; // 2e doigt : ignoré, mais pas de caméra
          break;
        case 'fire':
          this.buttons.set(id, 'fire');
          if (this.host.fireMode() === 'confirm') this.host.onConfirm();
          else this.host.press('fire', 'touch:fire', true);
          break;
        case 'jump': this.buttons.set(id, 'jump'); this.host.press('jump', 'touch:jump', true); break;
        case 'backflip': this.buttons.set(id, 'backflip'); this.host.press('backflip', 'touch:backflip', true); break;
        case 'weapons': this.buttons.set(id, 'weapons'); this.host.onWeapons(); break;
      }
      return true;
    }
    const zone = this.host.aimZone();
    if (zone && !this.aim && x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h && !this.host.uiHit(x, y)) {
      const a = this.host.currentAim();
      this.aim = { id, startY: y, startAim: a };
      this.aimTarget = a;
      return true;
    }
    return false;
  }

  move(id: number, x: number, y: number): void {
    if (this.joy?.id === id) this.moveJoy(x, y);
    else if (this.aim?.id === id) {
      // Glisser vers le haut relève le réticule ; la visée suit le doigt, à la vitesse permise par le jeu.
      this.aimTarget = clamp(this.aim.startAim - (y - this.aim.startY) * T.aimRadPerPx, AIM.min, AIM.max);
    }
  }

  /** Relâchement ou annulation (touchcancel, perte de capture) : toutes les actions du doigt sont relâchées. */
  up(id: number): void {
    if (this.joy?.id === id) {
      this.joy = null;
      this.setDirs(false, false, false, false);
    } else if (this.aim?.id === id) {
      this.aim = null;
      this.aimTarget = null;
    } else {
      const b = this.buttons.get(id);
      if (b !== undefined) {
        this.buttons.delete(id);
        if (b === 'fire' && this.host.fireMode() === 'hold') this.host.press('fire', 'touch:fire', false);
        if (b === 'jump') this.host.press('jump', 'touch:jump', false);
        if (b === 'backflip') this.host.press('backflip', 'touch:backflip', false);
      }
    }
  }

  /** Relâche tout (changement de tour, menu ouvert, perte de focus) : jamais de bouton « coincé ». */
  cancelAll(): void {
    const ids = [this.joy?.id, this.aim?.id, ...this.buttons.keys()];
    for (const id of ids) if (id !== undefined) this.up(id);
    // Garde-fou : relâche aussi les sources même si l'état interne était déjà vide.
    this.host.press('fire', 'touch:fire', false);
    this.setDirs(false, false, false, false);
  }

  private moveJoy(x: number, y: number): void {
    const j = this.joy;
    if (!j) return;
    const c = circleOf(this.host.circles(), 'joystick');
    let nx = (x - c.cx) / c.r, ny = (y - c.cy) / c.r;
    const len = Math.hypot(nx, ny);
    if (len > 1) { nx /= len; ny /= len; }
    j.nx = nx; j.ny = ny;
    const vertical = Math.abs(ny) > T.joyVertical && Math.abs(ny) > Math.abs(nx) * 1.2;
    this.setDirs(
      !vertical && nx < -T.joyDeadzone, !vertical && nx > T.joyDeadzone,
      vertical && ny < 0, vertical && ny > 0,
    );
  }

  private setDirs(left: boolean, right: boolean, up: boolean, down: boolean): void {
    const next = { left, right, aimUp: up, aimDown: down };
    for (const k of ['left', 'right', 'aimUp', 'aimDown'] as const) {
      if (this.dirs[k] !== next[k]) { this.dirs[k] = next[k]; this.host.press(k, 'touch:joy', next[k]); }
    }
  }
}
