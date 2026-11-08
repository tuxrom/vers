import { GAMEPLAY } from '@/config/gameplay';

const C = GAMEPLAY.camera;
const { width: WW, height: WH } = GAMEPLAY.world;

/**
 * Caméra 2D : centre (x,y) monde + zoom, toujours contenue dans la carte.
 * Le suivi automatique (lissage exponentiel) est piloté par le `CameraDirector` ; l'utilisateur peut
 * reprendre la main (glisser = `panBy`, molette/pincement = `zoomBy`) : `manual` coupe alors le suivi.
 */
export class Camera {
  x = WW / 2;
  y = WH / 2;
  zoom = 1;
  /** Zoom voulu = zoom de base de la fenêtre × multiplicateur utilisateur. */
  zoomMul = 1;
  manual = false;
  private zoomAnchor: { sx: number; sy: number } | null = null;
  private snapped = false;

  /** Zoom de base : C.viewHeight px de monde visibles verticalement. */
  baseZoom(viewH: number): number {
    return viewH / C.viewHeight;
  }

  /** Zoom minimal : la vue ne doit jamais dépasser la carte. */
  minZoom(viewW: number, viewH: number): number {
    return Math.max(C.minZoom, viewW / WW, viewH / WH);
  }

  targetZoom(viewW: number, viewH: number): number {
    const z = this.baseZoom(viewH) * this.zoomMul;
    return Math.min(C.maxZoom, Math.max(this.minZoom(viewW, viewH), z));
  }

  /** Avance la caméra : suivi lissé de la cible (si pas en mode manuel) et zoom lissé. */
  update(dtSec: number, tx: number, ty: number, viewW: number, viewH: number): void {
    const dt = Math.min(dtSec, 0.1);
    const first = !this.snapped;
    this.snapped = true;

    const zt = this.targetZoom(viewW, viewH);
    const kz = first ? 1 : 1 - Math.exp(-C.zoomLerp * dt);
    const anchor = this.zoomAnchor;
    if (anchor) {
      const before = this.screenToWorld(anchor.sx, anchor.sy, viewW, viewH);
      this.zoom += (zt - this.zoom) * kz;
      const after = this.screenToWorld(anchor.sx, anchor.sy, viewW, viewH);
      this.x += before.x - after.x;
      this.y += before.y - after.y;
      if (Math.abs(zt - this.zoom) < 1e-3) this.zoomAnchor = null;
    } else {
      this.zoom += (zt - this.zoom) * kz;
    }

    if (!this.manual) {
      const k = first ? 1 : 1 - Math.exp(-C.followLerp * dt);
      this.x += (tx - this.x) * k;
      this.y += (ty - this.y) * k;
    }
    this.clamp(viewW, viewH);
  }

  /** Glissement libre (delta en unités monde). */
  panBy(dx: number, dy: number, viewW: number, viewH: number): void {
    this.manual = true;
    this.x += dx;
    this.y += dy;
    this.clamp(viewW, viewH);
  }

  /** Centre la vue sur un point (minimap). */
  centerOn(x: number, y: number, viewW: number, viewH: number): void {
    this.manual = true;
    this.x = x;
    this.y = y;
    this.clamp(viewW, viewH);
  }

  /** Zoom multiplicatif ancré sur un point de l'écran (molette, pincement). */
  zoomBy(factor: number, sx: number, sy: number, viewW: number, viewH: number, immediate = false): void {
    const lo = this.minZoom(viewW, viewH) / this.baseZoom(viewH);
    const hi = C.maxZoom / this.baseZoom(viewH);
    this.zoomMul = Math.min(hi, Math.max(lo, this.zoomMul * factor));
    this.manual = true;
    this.zoomAnchor = { sx, sy };
    if (immediate) {
      const before = this.screenToWorld(sx, sy, viewW, viewH);
      this.zoom = this.targetZoom(viewW, viewH);
      const after = this.screenToWorld(sx, sy, viewW, viewH);
      this.x += before.x - after.x;
      this.y += before.y - after.y;
      this.clamp(viewW, viewH);
    }
  }

  /** Reprend le suivi automatique. */
  resume(): void {
    this.manual = false;
    this.zoomAnchor = null;
  }

  clamp(viewW: number, viewH: number): void {
    const hw = viewW / (2 * this.zoom), hh = viewH / (2 * this.zoom);
    this.x = WW <= hw * 2 ? WW / 2 : Math.min(WW - hw, Math.max(hw, this.x));
    this.y = WH <= hh * 2 ? WH / 2 : Math.min(WH - hh, Math.max(hh, this.y));
  }

  /** Applique la transformation monde → écran (calée sur le pixel physique pour éviter le scintillement). */
  apply(ctx: CanvasRenderingContext2D, viewW: number, viewH: number, dpr = 1, shakeX = 0, shakeY = 0): void {
    const ox = Math.round((viewW / 2 - this.x * this.zoom + shakeX) * dpr) / dpr;
    const oy = Math.round((viewH / 2 - this.y * this.zoom + shakeY) * dpr) / dpr;
    ctx.translate(ox, oy);
    ctx.scale(this.zoom, this.zoom);
  }

  screenToWorld(sx: number, sy: number, viewW: number, viewH: number): { x: number; y: number } {
    return { x: (sx - viewW / 2) / this.zoom + this.x, y: (sy - viewH / 2) / this.zoom + this.y };
  }

  private readonly rect = { x: 0, y: 0, w: 0, h: 0 };

  /**
   * Rectangle monde visible (pour ne dessiner que ce qui est à l'écran). L'objet renvoyé est réutilisé à chaque
   * appel (pas d'allocation par frame) : à lire tout de suite, ne pas le conserver.
   */
  visibleRect(viewW: number, viewH: number): { x: number; y: number; w: number; h: number } {
    const w = viewW / this.zoom, h = viewH / this.zoom;
    const r = this.rect;
    r.x = this.x - w / 2; r.y = this.y - h / 2; r.w = w; r.h = h;
    return r;
  }
}
