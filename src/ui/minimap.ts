import { GAMEPLAY } from '@/config/gameplay';
import type { Camera } from '@/core/camera';
import type { GameCanvas } from '@/core/canvas';
import type { GameState } from '@/core/state';
import type { UI } from './ui';

const { width: WW, height: WH } = GAMEPLAY.world;
/** Échantillonnage du terrain pour la minimap (px de monde par pixel de minimap). */
const SAMPLE = 16;
const REBUILD_MS = 400;

/** Minimap en coin : terrain échantillonné (rafraîchi si modifié), vers par équipe, cadre de la caméra. */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private builtVersion = -1;
  private builtFor: object | null = null;
  private lastBuild = 0;
  /** Rectangle écran courant (pour le clic). */
  rect = { x: 0, y: 0, w: 0, h: 0 };

  constructor() {
    const w = Math.ceil(WW / SAMPLE), h = Math.ceil(WH / SAMPLE);
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.img = this.ctx.createImageData(w, h);
  }

  /** Recalcule les pixels de la minimap couvrant [x0,x1]×[y0,y1] (coordonnées monde). */
  private rebuildRegion(s: GameState, x0: number, y0: number, x1: number, y1: number): void {
    const w = this.canvas.width, h = this.canvas.height;
    const d = this.img.data;
    const half = SAMPLE >> 1;
    const cx0 = Math.max(0, Math.floor(x0 / SAMPLE)), cx1 = Math.min(w - 1, Math.floor(x1 / SAMPLE));
    const cy0 = Math.max(0, Math.floor(y0 / SAMPLE)), cy1 = Math.min(h - 1, Math.floor(y1 / SAMPLE));
    for (let y = cy0; y <= cy1; y++) {
      for (let x = cx0; x <= cx1; x++) {
        const o = (y * w + x) * 4;
        const wx = x * SAMPLE + half, wy = y * SAMPLE + half;
        // Un pixel de minimap est plein si l'un des 4 échantillons l'est (les fins îlots restent visibles).
        const solid = s.terrain.isSolid(wx, wy) || s.terrain.isSolid(wx - half, wy - half) ||
          s.terrain.isSolid(wx + half - 1, wy) || s.terrain.isSolid(wx, wy + half - 1);
        const top = solid && !s.terrain.isSolid(wx, wy - SAMPLE);
        d[o] = top ? 110 : 140; d[o + 1] = top ? 170 : 100; d[o + 2] = top ? 70 : 62; d[o + 3] = solid ? 255 : 0;
      }
    }
  }

  /** Mise à jour : complète pour une nouvelle carte, sinon seulement les zones creusées (cratères) depuis la dernière fois. */
  private rebuild(s: GameState, nowMs: number): void {
    const t = s.terrain;
    const fresh = this.builtFor !== t || t.dirtyOverflow;
    if (!fresh && t.version === this.builtVersion) return;
    if (!fresh && this.builtVersion >= 0 && nowMs - this.lastBuild < REBUILD_MS) return;
    if (fresh) this.rebuildRegion(s, 0, 0, WW, WH);
    else for (const r of t.dirty) this.rebuildRegion(s, r.x, r.y, r.x + r.w, r.y + r.h);
    t.dirty.length = 0;
    t.dirtyOverflow = false;
    this.builtFor = t;
    this.builtVersion = t.version;
    this.lastBuild = nowMs;
    this.ctx.putImageData(this.img, 0, 0);
  }

  draw(c: GameCanvas, ui: UI, s: GameState, cam: Camera, nowMs: number): void {
    const { ctx } = c;
    this.rebuild(s, nowMs);
    const touch = c.touch;
    const w = Math.round(Math.min(touch ? 170 : 240, Math.max(touch ? 110 : 130, c.width * (touch ? 0.2 : 0.28))));
    const h = Math.round((w * WH) / WW);
    // PC : coin bas droit. Tactile : coin haut gauche (le bas est occupé par les commandes), hors encoche.
    const x = touch ? c.safe.left + 10 : c.width - w - 10 - c.safe.right;
    const y = touch ? c.safe.top + 10 : c.height - h - 10 - c.safe.bottom;
    this.rect = { x, y, w, h };
    ui.add('minimap', x, y, w, h);

    ctx.save();
    ctx.fillStyle = 'rgba(10,20,40,0.65)';
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = 'rgba(111,155,209,0.35)';
    ctx.fillRect(x, y, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.canvas, x, y, w, h);

    const k = w / WW;
    // Eau.
    ctx.fillStyle = 'rgba(40,110,200,0.55)';
    ctx.fillRect(x, y + s.waterLevel * k, w, h - s.waterLevel * k);

    // Caisses.
    ctx.fillStyle = '#ffd54a';
    for (const cr of s.crates) ctx.fillRect(x + cr.x * k - 1.5, y + Math.max(0, cr.y) * k - 1.5, 3, 3);

    // Vers.
    const blink = Math.floor(nowMs / 300) % 2 === 0;
    for (const o of s.worms) {
      if (o.sunk) continue;
      const px = x + o.x * k, py = y + o.y * k;
      if (!o.alive) {
        ctx.fillStyle = '#999';
        ctx.fillRect(px - 1, py - 1, 2, 2);
        continue;
      }
      ctx.fillStyle = o.color;
      ctx.beginPath();
      ctx.arc(px, py, o.id === s.turn.worm ? 3 : 2.2, 0, Math.PI * 2);
      ctx.fill();
      if (o.id === s.turn.worm && blink) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Cadre de la vue.
    const v = cam.visibleRect(c.width, c.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + Math.max(0, v.x) * k, y + Math.max(0, v.y) * k,
      Math.min(WW, v.w) * k, Math.min(WH, v.h) * k);
    ctx.restore();
  }

  /** Clic sur la minimap → position monde correspondante. */
  toWorld(sx: number, sy: number): { x: number; y: number } {
    const r = this.rect;
    const tx = Math.min(1, Math.max(0, (sx - r.x) / r.w)), ty = Math.min(1, Math.max(0, (sy - r.y) / r.h));
    return { x: tx * WW, y: ty * WH };
  }
}
