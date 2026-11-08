import { GAMEPLAY } from '@/config/gameplay';
import type { Camera } from './camera';
import type { Region } from '@/ui/ui';

export interface PointerHooks {
  view(): { w: number; h: number };
  hit(sx: number, sy: number): Region | null;
  onRegion(r: Region, sx: number, sy: number, phase: 'down' | 'move' | 'up'): void;
  /** Clic/tap sans glissement (coordonnées écran CSS). */
  onTap(sx: number, sy: number, e: { shift: boolean }): void;
  onContextMenu(sx: number, sy: number): void;
  /** Ce doigt est-il attribué à une commande tactile ? (alors la caméra l'ignore) */
  owns?(pointerId: number): boolean;
}

interface Pt { sx: number; sy: number; startX: number; startY: number; dragging: boolean }

/**
 * Contrôleur de pointeur : clic/tap, glissement de caméra (souris ou doigt), molette et pincement.
 * Un appui qui bouge au-delà du seuil devient un glissement ; sinon c'est un clic (tap).
 */
export class PointerController {
  private pts = new Map<number, Pt>();
  private regionPointer: { id: number; region: Region } | null = null;
  private pinchDist = 0;

  constructor(private el: HTMLCanvasElement, private cam: Camera, private hooks: PointerHooks) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancel);
    el.addEventListener('wheel', this.wheel, { passive: false });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const p = this.local(e);
      this.hooks.onContextMenu(p.sx, p.sy);
    });
  }

  private local(e: { clientX: number; clientY: number }): { sx: number; sy: number } {
    const r = this.el.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  private down = (e: PointerEvent): void => {
    if (this.hooks.owns?.(e.pointerId)) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return; // clic droit : menu (contextmenu)
    const { sx, sy } = this.local(e);
    try { this.el.setPointerCapture(e.pointerId); } catch { /* pointeur synthétique */ }
    const region = this.hooks.hit(sx, sy);
    if (region && this.pts.size === 0) {
      // Copie : les zones d'interface sont recyclées d'une frame à l'autre.
      this.regionPointer = { id: e.pointerId, region: { ...region } };
      this.hooks.onRegion(region, sx, sy, 'down');
      return;
    }
    this.pts.set(e.pointerId, { sx, sy, startX: sx, startY: sy, dragging: false });
    if (this.pts.size === 2) this.pinchDist = this.currentPinch();
  };

  private move = (e: PointerEvent): void => {
    if (this.hooks.owns?.(e.pointerId)) return;
    const { sx, sy } = this.local(e);
    if (this.regionPointer?.id === e.pointerId) {
      this.hooks.onRegion(this.regionPointer.region, sx, sy, 'move');
      return;
    }
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    const { w, h } = this.hooks.view();
    const dx = sx - p.sx, dy = sy - p.sy;
    p.sx = sx; p.sy = sy;

    if (this.pts.size === 1) {
      if (!p.dragging && Math.hypot(sx - p.startX, sy - p.startY) > GAMEPLAY.camera.dragThreshold) p.dragging = true;
      if (p.dragging) this.cam.panBy(-dx / this.cam.zoom, -dy / this.cam.zoom, w, h);
    } else if (this.pts.size >= 2) {
      for (const q of this.pts.values()) q.dragging = true;
      const d = this.currentPinch();
      if (this.pinchDist > 0 && d > 0) {
        const c = this.pinchCenter();
        this.cam.zoomBy(d / this.pinchDist, c.sx, c.sy, w, h, true);
        this.cam.panBy(-dx / (2 * this.cam.zoom), -dy / (2 * this.cam.zoom), w, h);
      }
      this.pinchDist = d;
    }
  };

  private up = (e: PointerEvent): void => {
    const { sx, sy } = this.local(e);
    if (this.regionPointer?.id === e.pointerId) {
      this.hooks.onRegion(this.regionPointer.region, sx, sy, 'up');
      this.regionPointer = null;
      return;
    }
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    const wasSingle = this.pts.size === 1;
    this.pts.delete(e.pointerId);
    this.pinchDist = 0;
    if (wasSingle && !p.dragging) this.hooks.onTap(sx, sy, { shift: e.shiftKey });
  };

  private cancel = (e: PointerEvent): void => {
    this.pts.delete(e.pointerId);
    if (this.regionPointer?.id === e.pointerId) this.regionPointer = null;
    this.pinchDist = 0;
  };

  private wheel = (e: WheelEvent): void => {
    e.preventDefault();
    const { sx, sy } = this.local(e);
    const { w, h } = this.hooks.view();
    const notches = Math.max(-3, Math.min(3, -e.deltaY / (e.deltaMode === 1 ? 3 : 100)));
    this.cam.zoomBy(Math.pow(GAMEPLAY.camera.wheelZoomStep, notches), sx, sy, w, h);
  };

  private currentPinch(): number {
    const [a, b] = [...this.pts.values()];
    return a && b ? Math.hypot(a.sx - b.sx, a.sy - b.sy) : 0;
  }

  private pinchCenter(): { sx: number; sy: number } {
    const [a, b] = [...this.pts.values()];
    return a && b ? { sx: (a.sx + b.sx) / 2, sy: (a.sy + b.sy) / 2 } : { sx: 0, sy: 0 };
  }
}
