import { datan2, dist } from '@/core/math';
import { GAMEPLAY } from '@/config/gameplay';
import { emit, type GameState } from '@/core/state';
import { advanceBody } from '@/physics/ballistics';
import { explode } from '@/weapons/explosion';
import { PROJECTILE_SPECS } from '@/weapons/specs';
import type { ProjectileKind } from '@/weapons/types';

const W = GAMEPLAY.weapons;

/** Projectile ou objet posé (état sérialisable ; les propriétés physiques viennent de PROJECTILE_SPECS). */
export interface Projectile {
  id: number;
  kind: ProjectileKind;
  owner: number;
  x: number; y: number;
  px: number; py: number;
  vx: number; vy: number;
  angle: number;
  age: number;
  /** Secondes avant explosion ; < 0 = pas de minuterie. */
  fuse: number;
  /** Immobilisé sur le sol. */
  rest: boolean;
  /** Mine : secondes avant armement. */
  arm: number;
  dead: boolean;
}

export function createProjectile(
  s: GameState, kind: ProjectileKind, owner: number, x: number, y: number, vx: number, vy: number, fuse = -1,
): Projectile {
  const p: Projectile = {
    id: s.nextId++, kind, owner, x, y, px: x, py: y, vx, vy,
    angle: datan2(vy, vx), age: 0, fuse, rest: false, arm: kind === 'mine' ? W.mine.armDelay : 0, dead: false,
  };
  s.projectiles.push(p);
  return p;
}

/** Empêche la résolution du tour tant que le projectile peut encore agir. */
export function blocksResolution(p: Projectile): boolean {
  // Une mine posée qui attend un ver ne bloque pas le tour ; déclenchée ou en chute, elle le bloque.
  return !p.dead && !(p.kind === 'mine' && p.rest && p.fuse < 0);
}

function detonate(s: GameState, p: Projectile, x: number, y: number): void {
  p.dead = true;
  explode(s, x, y, PROJECTILE_SPECS[p.kind].blast, p.owner);
}

/** Met à jour un projectile pour un pas de simulation fixe. */
export function updateProjectile(s: GameState, p: Projectile, dt: number): void {
  const spec = PROJECTILE_SPECS[p.kind];
  p.px = p.x; p.py = p.y;
  p.age += dt;

  if (p.age > W.projectileMaxAge && blocksResolution(p)) { detonate(s, p, p.x, p.y); return; }

  if (p.fuse >= 0) {
    const before = Math.ceil(p.fuse);
    p.fuse -= dt;
    if (p.fuse <= 0) { detonate(s, p, p.x, p.y); return; }
    if (Math.ceil(p.fuse) < before) emit(s, { t: 'beep', x: p.x, y: p.y });
  }

  if (p.kind === 'mine' && p.fuse < 0) {
    p.arm = Math.max(0, p.arm - dt);
    if (p.arm === 0) {
      for (const w of s.worms) {
        if (w.alive && !w.sunk && dist(w.x - p.x, w.y - p.y) < W.mine.triggerRadius) {
          p.fuse = W.mine.triggerFuse; // déclenchée : explose dans un instant
          emit(s, { t: 'beep', x: p.x, y: p.y });
          break;
        }
      }
    }
  }

  // Mouvement : même code que les essais de tir de l'IA (physics/ballistics.ts).
  const r = advanceBody(s, p, spec, dt, p.owner, (x, y, speed) => emit(s, { t: 'bounce', x, y, speed }));
  if (r.k === 'impact' || r.k === 'worm') detonate(s, p, r.x, r.y);
  else if (r.k === 'water') { p.dead = true; emit(s, { t: 'splash', x: r.x, y: s.waterLevel, r: 6 }); }
  else if (r.k === 'lost') p.dead = true;
}

/** Crée les projectiles programmés dont le délai est écoulé (frappe aérienne). */
export function stepPending(s: GameState, dt: number): void {
  if (s.pending.length === 0) return;
  const rest = [];
  for (const sp of s.pending) {
    sp.delay -= dt;
    if (sp.delay > 0) { rest.push(sp); continue; }
    createProjectile(s, sp.kind, sp.owner, sp.x, sp.y, sp.vx, sp.vy);
    emit(s, { t: 'shot', weapon: sp.kind, x: sp.x, y: sp.y, dx: 0, dy: 1, power: 1 });
  }
  s.pending = rest;
}

/** Met à jour tous les projectiles puis retire les morts. */
export function updateProjectiles(s: GameState, dt: number): void {
  // Un projectile peut en créer d'autres en détonant : on itère sur la longueur initiale.
  const n = s.projectiles.length;
  for (let i = 0; i < n; i++) {
    const p = s.projectiles[i] as Projectile;
    if (!p.dead) updateProjectile(s, p, dt);
  }
  let j = 0;
  for (const p of s.projectiles) if (!p.dead) s.projectiles[j++] = p;
  s.projectiles.length = j;
}
