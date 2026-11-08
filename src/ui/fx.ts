import { GAMEPLAY } from '@/config/gameplay';
import { Rng } from '@/core/rng';
import type { GameEvent } from '@/core/events';
import type { GameState } from '@/core/state';
import { t } from './i18n';
import { wname } from './weaponMenu';

const MAXP = GAMEPLAY.fx.maxParticles;
const enum Kind { Smoke, Spark, Debris, Dust }

/** Libellé du ramassage d'une caisse (traduit à l'affichage). */
/** Retire en place les éléments dont `ttl` est écoulé. */
function compact<T extends { ttl: number }>(a: T[]): void {
  let j = 0;
  for (let i = 0; i < a.length; i++) { const e = a[i] as T; if (e.ttl > 0) a[j++] = e; }
  a.length = j;
}

/** Nombre de paliers d'opacité des particules. */
const STEPS = 12;
/** Tables de styles : tables[type][indice de teinte] = un style par palier d'opacité (recherche par indices, sans chaîne). */
const styleTables: (string[] | undefined)[][] = [[], [], [], []];

/** Table de styles de remplissage d'un type de particule ; teinte arrondie à 5° (72 teintes). */
function styles(kind: number, hue: number): string[] {
  const hi = Math.round(hue / 5) % 72;
  const row = styleTables[kind] as (string[] | undefined)[];
  let t = row[hi];
  if (!t) {
    const h = hi * 5;
    t = [];
    for (let i = 0; i <= STEPS; i++) {
      const k = i / STEPS;
      t.push(kind === 0 ? `rgba(70,70,75,${(0.55 * k).toFixed(3)})`
        : kind === 3 ? `rgba(150,120,80,${(0.5 * k).toFixed(3)})`
        : kind === 1 ? `hsla(${h},100%,${(55 + 30 * k).toFixed(0)}%,${Math.min(1, k * 1.6).toFixed(3)})`
        : `hsla(${h},45%,32%,${Math.min(1, k * 2).toFixed(3)})`);
    }
    row[hi] = t;
  }
  return t;
}

function pickupText(e: { kind: string; amount: number; weapon?: string }): string {
  return e.kind === 'health' ? t('hud.pickup.health', { n: e.amount }) : t('hud.pickup.weapon', { n: e.amount, name: e.weapon ? wname(e.weapon) : '' });
}

interface Popup { x: number; y: number; text: string; ttl: number; color: string }
interface Ring { x: number; y: number; ttl: number; max: number; color: string; grow: boolean }
interface Tracer { x0: number; y0: number; x1: number; y1: number; ttl: number }

/**
 * Effets visuels cosmétiques : particules (fumée, étincelles, débris), secousse d'écran, bulles de dégâts.
 * Pool de particules en tableaux typés (pas d'allocation par frame). Aléa cosmétique séparé de la simulation.
 */
export class Fx {
  private rng = new Rng(0xc0ffee);
  private n = 0;
  private x = new Float32Array(MAXP); private y = new Float32Array(MAXP);
  private vx = new Float32Array(MAXP); private vy = new Float32Array(MAXP);
  private life = new Float32Array(MAXP); private maxLife = new Float32Array(MAXP);
  private size = new Float32Array(MAXP); private kind = new Uint8Array(MAXP);
  private hue = new Float32Array(MAXP);
  /** Densité de particules (qualité graphique) : fraction de la capacité du pool utilisée. */
  density = 1;
  readonly popups: Popup[] = [];
  readonly tracers: Tracer[] = [];
  readonly rings: Ring[] = [];
  readonly swings: { x: number; y: number; dir: number; ttl: number }[] = [];
  /** Intensité courante de la secousse (px). */
  shake = 0;
  private trailAcc = 0;
  /** Niveau d'eau affiché : rattrape en douceur le niveau de la simulation (animation de la montée). */
  private waterShown = -1;
  /** Bandeau temporaire (mort subite…). */
  banner: { text: string; ttl: number } | null = null;

  private spawn(kind: Kind, x: number, y: number, vx: number, vy: number, life: number, size: number, hue = 0): void {
    if (this.n >= MAXP * this.density) return;
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.kind[i] = kind; this.hue[i] = hue;
  }

  explosion(x: number, y: number, r: number): void {
    const g = this.rng;
    const nSmoke = Math.round(10 + r * 0.3), nSpark = Math.round(14 + r * 0.4), nDebris = Math.round(8 + r * 0.25);
    for (let i = 0; i < nSmoke; i++) {
      const a = g.range(0, Math.PI * 2), sp = g.range(10, r * 1.6);
      this.spawn(Kind.Smoke, x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3, Math.cos(a) * sp, Math.sin(a) * sp - 20, g.range(0.6, 1.4), g.range(r * 0.25, r * 0.55));
    }
    for (let i = 0; i < nSpark; i++) {
      const a = g.range(0, Math.PI * 2), sp = g.range(120, 420 + r * 3);
      this.spawn(Kind.Spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp - 80, g.range(0.25, 0.7), g.range(1.2, 2.4), g.range(20, 55));
    }
    for (let i = 0; i < nDebris; i++) {
      const a = g.range(-Math.PI, 0), sp = g.range(100, 260 + r * 2);
      this.spawn(Kind.Debris, x, y, Math.cos(a) * sp, Math.sin(a) * sp, g.range(0.6, 1.3), g.range(1.5, 3.2), g.range(25, 35));
    }
    this.shake = Math.min(GAMEPLAY.fx.shake.max, Math.max(this.shake, r * GAMEPLAY.fx.shake.perRadius));
  }

  puff(x: number, y: number, n: number, kind: Kind.Smoke | Kind.Dust = Kind.Dust): void {
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(0, Math.PI * 2), sp = this.rng.range(8, 40);
      this.spawn(kind, x, y, Math.cos(a) * sp, Math.sin(a) * sp - 10, this.rng.range(0.3, 0.7), this.rng.range(3, 6));
    }
  }

  /** Traînée de fumée d'un projectile en vol (appelée à chaque frame de rendu). */
  trail(x: number, y: number, dtSec: number): void {
    this.trailAcc += dtSec;
    while (this.trailAcc > 0.018) {
      this.trailAcc -= 0.018;
      this.spawn(Kind.Smoke, x + this.rng.range(-1, 1), y + this.rng.range(-1, 1), this.rng.range(-8, 8), this.rng.range(-8, 8), this.rng.range(0.4, 0.8), this.rng.range(2.5, 4.5));
    }
  }

  waterLevel(s: GameState): number {
    if (this.waterShown < 0) this.waterShown = s.waterLevel;
    return this.waterShown;
  }

  /** Éclaboussure : gerbe de gouttes vers le haut et anneaux sur l'eau. */
  splash(x: number, y: number, r: number): void {
    const n = Math.round(GAMEPLAY.fx.splashDrops * Math.max(0.5, r / 10));
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(-Math.PI * 0.9, -Math.PI * 0.1), sp = this.rng.range(80, 220 + r * 6);
      this.spawn(Kind.Spark, x + this.rng.range(-r, r), y, Math.cos(a) * sp * 0.6, Math.sin(a) * sp, this.rng.range(0.5, 1.0), this.rng.range(1.6, 3), 205);
    }
    this.rings.push({ x, y, ttl: 0.7, max: 0.7, color: '210,235,255', grow: true });
    this.shake = Math.min(GAMEPLAY.fx.shake.max, Math.max(this.shake, r * 0.15));
  }

  onEvents(events: readonly GameEvent[], s: GameState): void {
    for (const e of events) {
      switch (e.t) {
        case 'splash': this.splash(e.x, e.y, e.r); break;
        case 'death': if (!e.drowned) this.explosion(e.x, e.y, 24); break;
        case 'pickup': {
          const w = s.worms[e.worm];
          this.popups.push({ x: e.x, y: e.y - 24, text: pickupText(e), ttl: 1.8, color: w ? w.color : '#fff' });
          for (let i = 0; i < 14; i++) {
            const a = this.rng.range(0, Math.PI * 2), sp = this.rng.range(40, 140);
            this.spawn(Kind.Spark, e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp - 40, this.rng.range(0.3, 0.7), this.rng.range(1.4, 2.4), 50);
          }
          break;
        }
        case 'water': this.banner = { text: t('hud.sudden.now'), ttl: 2.6 }; break;
        case 'explosion': this.explosion(e.x, e.y, e.r); break;
        case 'damage': {
          const w = s.worms[e.worm];
          this.popups.push({ x: e.x + this.rng.range(-6, 6), y: e.y - 30, text: `-${e.amount}`, ttl: 1.3, color: w ? w.color : '#fff' });
          break;
        }
        case 'shot': this.puff(e.x, e.y, 6, Kind.Smoke); break;
        case 'bounce': this.puff(e.x, e.y, 4); break;
        case 'teleport':
          // Disparition (anneau qui se resserre) et apparition (anneau qui s'élargit + étincelles).
          this.rings.push({ x: e.x0, y: e.y0, ttl: 0.5, max: 0.5, color: '127,224,255', grow: false });
          this.rings.push({ x: e.x1, y: e.y1, ttl: 0.6, max: 0.6, color: '127,224,255', grow: true });
          for (let i = 0; i < 26; i++) {
            const a = this.rng.range(0, Math.PI * 2), sp = this.rng.range(40, 220);
            this.spawn(Kind.Spark, e.x1, e.y1, Math.cos(a) * sp, Math.sin(a) * sp - 40, this.rng.range(0.3, 0.8), this.rng.range(1.4, 2.6), 190);
          }
          break;
        case 'swing': this.swings.push({ x: e.x, y: e.y, dir: e.dir, ttl: 0.18 }); break;
        case 'rope': if (e.kind === 'attach') this.puff(e.x, e.y, 4); break;
        case 'hitscan': this.tracers.push({ x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, ttl: 0.12 }); break;
        default:
      }
    }
  }

  update(dt: number, s?: GameState): void {
    if (s) {
      const target = s.waterLevel;
      if (this.waterShown < 0) this.waterShown = target;
      const step = GAMEPLAY.water.riseAnimSpeed * dt;
      this.waterShown += Math.max(-step, Math.min(step, target - this.waterShown));
    }
    const G = GAMEPLAY.physics.gravity;
    for (let i = 0; i < this.n; i++) {
      this.life[i] = (this.life[i] as number) - dt;
      if ((this.life[i] as number) <= 0) {
        // Échange avec la dernière particule vivante.
        const l = --this.n;
        this.x[i] = this.x[l] as number; this.y[i] = this.y[l] as number;
        this.vx[i] = this.vx[l] as number; this.vy[i] = this.vy[l] as number;
        this.life[i] = this.life[l] as number; this.maxLife[i] = this.maxLife[l] as number;
        this.size[i] = this.size[l] as number; this.kind[i] = this.kind[l] as number; this.hue[i] = this.hue[l] as number;
        i--;
        continue;
      }
      const k = this.kind[i];
      if (k === Kind.Spark || k === Kind.Debris) this.vy[i] = (this.vy[i] as number) + G * 0.8 * dt;
      else this.vy[i] = (this.vy[i] as number) - 30 * dt; // la fumée monte
      const drag = k === Kind.Smoke || k === Kind.Dust ? Math.exp(-2.2 * dt) : 1;
      this.vx[i] = (this.vx[i] as number) * drag; this.vy[i] = (this.vy[i] as number) * drag;
      this.x[i] = (this.x[i] as number) + (this.vx[i] as number) * dt;
      this.y[i] = (this.y[i] as number) + (this.vy[i] as number) * dt;
    }
    for (const p of this.popups) { p.ttl -= dt; p.y -= 28 * dt; }
    for (const r of this.rings) r.ttl -= dt;
    for (const sw of this.swings) sw.ttl -= dt;
    for (const t of this.tracers) t.ttl -= dt;
    // Compaction en place (pas de nouveau tableau à chaque frame).
    compact(this.popups); compact(this.rings); compact(this.swings); compact(this.tracers);
    if (this.banner && (this.banner.ttl -= dt) <= 0) this.banner = null;
    this.shake *= Math.exp(-GAMEPLAY.fx.shake.decay * dt);
    if (this.shake < 0.05) this.shake = 0;
  }

  /** Décalage de secousse pour cette frame (aléa cosmétique). */
  shakeOffset(): { x: number; y: number } {
    const v = this.shakeVec; // objet réutilisé (pas d'allocation par frame)
    if (this.shake > 0) { v.x = this.rng.range(-1, 1) * this.shake; v.y = this.rng.range(-1, 1) * this.shake; } else { v.x = 0; v.y = 0; }
    return v;
  }
  private readonly shakeVec = { x: 0, y: 0 };

  /**
   * Dessine les effets. Les couleurs viennent de tables précalculées (opacité quantifiée) : aucune chaîne n'est
   * construite par particule. Les particules hors champ ne sont pas dessinées ; `soft=false` (qualité basse) remplace
   * les disques de fumée par de petits carrés.
   */
  draw(ctx: CanvasRenderingContext2D, view: { x: number; y: number; w: number; h: number }, soft = true): void {
    const vx0 = view.x - 40, vx1 = view.x + view.w + 40, vy0 = view.y - 40, vy1 = view.y + view.h + 40;
    let last: string | null = null;
    for (let i = 0; i < this.n; i++) {
      const x = this.x[i] as number, y = this.y[i] as number;
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
      const t = (this.life[i] as number) / (this.maxLife[i] as number);
      const sz = this.size[i] as number;
      const bucket = Math.min(STEPS, Math.ceil(t * STEPS));
      const kind = this.kind[i] as Kind;
      const style = (styles(kind, kind === Kind.Spark || kind === Kind.Debris ? this.hue[i] as number : 0)[bucket]) as string;
      if (style !== last) { ctx.fillStyle = style; last = style; }
      if ((kind === Kind.Smoke || kind === Kind.Dust) && soft) {
        const r = kind === Kind.Smoke ? sz * (1.6 - t * 0.6) : sz * (1.4 - t * 0.4);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      } else {
        const h = kind === Kind.Smoke || kind === Kind.Dust ? sz * 1.2 : sz / 2;
        ctx.fillRect(x - h, y - h, h * 2, h * 2);
      }
    }
    for (const t of this.tracers) {
      ctx.strokeStyle = `rgba(255,240,170,${t.ttl / 0.12})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(t.x0, t.y0); ctx.lineTo(t.x1, t.y1); ctx.stroke();
    }
    for (const r of this.rings) {
      const k = r.ttl / r.max, radius = (r.grow ? 1 - k : k) * 34 + 4;
      ctx.strokeStyle = `rgba(${r.color},${k})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(r.x, r.y, radius, 0, Math.PI * 2); ctx.stroke();
    }
    for (const sw of this.swings) {
      const k = sw.ttl / 0.18;
      ctx.strokeStyle = `rgba(255,255,255,${k})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, 24, sw.dir > 0 ? -1.2 + (1 - k) * 1.6 : Math.PI - 0.4 - (1 - k) * 1.6, sw.dir > 0 ? 0.2 + (1 - k) * 1.6 : Math.PI + 1.2 - (1 - k) * 1.6, sw.dir < 0);
      ctx.stroke();
    }
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    for (const p of this.popups) {
      ctx.globalAlpha = Math.min(1, p.ttl * 2);
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }

  /** Bandeau central temporaire (espace écran). */
  drawBanner(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const b = this.banner;
    if (!b) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, b.ttl * 2);
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(b.text).width + 50;
    ctx.fillStyle = 'rgba(120,20,20,0.85)';
    ctx.beginPath(); ctx.roundRect(w / 2 - tw / 2, h * 0.18 - 24, tw, 48, 12); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(b.text, w / 2, h * 0.18);
    ctx.restore();
  }
}
