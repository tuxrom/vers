import { dcos, dist, dsin } from '@/core/math';
import { GAMEPLAY } from '@/config/gameplay';
import { setPhase } from '@/core/game';
import type { Intent } from '@/core/intent';
import { emit, type GameState } from '@/core/state';
import { createProjectile } from '@/entities/projectile';
import { knockWorm, releaseRope, type Worm } from '@/entities/worm';
import { circleOverlaps } from '@/physics/collision';
import { damageWorm, explode } from './explosion';
import { WEAPONS } from './index';
import { PROJECTILE_SPECS } from './specs';
import type { WeaponDef, WeaponId } from './types';

const A = GAMEPLAY.weapons;
const R = GAMEPLAY.worm.radius;

/** Armes comptées comme des tirs pour les statistiques (la corde et la téléportation n'en sont pas). */
const OFFENSIVE: ReadonlySet<string> = new Set(['launcher', 'hitscan', 'placed', 'airstrike', 'melee']);

export function isWeaponId(id: string): id is WeaponId {
  return Object.prototype.hasOwnProperty.call(WEAPONS, id);
}

/** Munitions restantes de l'équipe du ver pour l'arme (-1 = illimité). */
export function ammoOf(s: GameState, team: number, id: WeaponId): number {
  return s.teams[team]?.ammo[id] ?? 0;
}

/** L'arme est-elle sélectionnable maintenant (munitions, règle « après déplacement ») ? */
export function canSelect(s: GameState, team: number, id: WeaponId): boolean {
  const def = WEAPONS[id];
  if (!def) return false;
  if (ammoOf(s, team, id) === 0) return false;
  if (s.turn.moved && !def.usableAfterMove) return false;
  return true;
}

/** Direction de tir unitaire : angle de visée relatif au regard du ver. */
export function aimVector(w: Worm, aim: number): { x: number; y: number } {
  return { x: w.facing * dcos(aim), y: -dsin(aim) };
}

export function selectWeapon(s: GameState, id: WeaponId): void {
  const t = s.turn;
  t.weapon = id;
  t.shotsLeft = WEAPONS[id].shots;
  t.charging = false;
  t.power = 0;
  t.reload = 0;
  t.holdLock = false;
}

/** Gère sélection, visée, charge et tir de l'arme du ver actif (phase `turn`). */
export function stepWeapons(s: GameState, dt: number, intent: Intent, w: Worm): void {
  const t = s.turn;
  if (intent.moveX !== 0 || intent.jump || intent.backflip) t.moved = true;

  if (intent.selectWeapon && isWeaponId(intent.selectWeapon) && canSelect(s, w.team, intent.selectWeapon)) {
    selectWeapon(s, intent.selectWeapon);
  }
  const def = WEAPONS[t.weapon];

  if (intent.fuse !== null && def.fuseSelectable) {
    const g = A.grenade;
    t.fuse = Math.min(g.fuseMax, Math.max(g.fuseMin, Math.round(intent.fuse)));
  }
  if (def.aim && intent.aimDir !== 0) {
    t.aim = Math.min(A.aim.max, Math.max(A.aim.min, t.aim + intent.aimDir * A.aim.rate * dt));
  }
  t.reload = Math.max(0, t.reload - dt);

  const down = intent.fireDown;
  const pressed = down && !t.fireWasDown;
  t.fireWasDown = down;

  // Corde accrochée : un nouvel appui sur tir la décroche, quelles que soient les munitions.
  if (w.rope && pressed) {
    releaseRope(w);
    emit(s, { t: 'rope', x: w.x, y: w.y, kind: 'release' });
    return;
  }

  // Une utilisation déjà entamée (2e coup du fusil) reste possible même quand la munition est décomptée.
  const started = t.shotsLeft < def.shots;
  const usable = (started || ammoOf(s, w.team, def.id) !== 0) && (started || !t.moved || def.usableAfterMove);
  if (!usable) { t.charging = false; t.power = 0; return; }

  if (def.input === 'charge') {
    if (down && !t.holdLock && t.reload <= 0) {
      t.charging = true;
      t.power = Math.min(1, t.power + dt / A.chargeTime);
      if (t.power >= 1) { useWeapon(s, w, def, 1); t.holdLock = true; }
    } else if (!down) {
      if (t.charging) useWeapon(s, w, def, t.power);
      t.holdLock = false;
      t.charging = false;
      t.power = 0;
    }
  } else if (def.input === 'press') {
    if (pressed && t.reload <= 0) useWeapon(s, w, def, 1);
  } else if (intent.target) {
    useWeapon(s, w, def, 1, intent.target);
  }
}

/** Déclenche l'arme : exécute le comportement, décompte la munition (au 1er tir) et gère la fin de tour. */
function useWeapon(s: GameState, w: Worm, def: WeaponDef, power: number, target?: { x: number; y: number }): void {
  const t = s.turn;
  const team = s.teams[w.team];
  if (!team) return;

  const dir = aimVector(w, t.aim);
  let used = true;
  switch (def.kind) {
    case 'launcher': launch(s, w, def, dir, power); break;
    case 'hitscan': hitscan(s, w, def, dir); break;
    case 'placed': place(s, w, def); break;
    case 'melee': melee(s, w, dir); break;
    case 'airstrike': used = airstrike(s, w, def, target); break;
    case 'teleport': used = teleport(s, w, target); break;
    case 'rope': used = shootRope(s, w, dir); break;
  }
  t.charging = false;
  t.power = 0;
  if (!used) return; // tir sans effet (cible invalide, corde dans le vide) : ni munition ni fin de tour

  if (t.shotsLeft === def.shots && team.ammo[def.id] > 0) team.ammo[def.id]--;
  if (t.shotsLeft === def.shots && OFFENSIVE.has(def.kind)) { t.shots++; team.stats.shots++; }
  t.shotsLeft--;
  if (t.shotsLeft > 0) { t.reload = def.reload; return; }
  t.shotsLeft = def.shots;
  if (def.endsTurn) {
    t.timeLeft = GAMEPLAY.turn.retreatTime;
    setPhase(s, 'firing');
  }
}

function launch(s: GameState, w: Worm, def: WeaponDef, dir: { x: number; y: number }, power: number): void {
  if (!def.projectile) return;
  const spec = PROJECTILE_SPECS[def.projectile];
  const speed = spec.minSpeed + (spec.maxSpeed - spec.minSpeed) * power;
  const x = w.x + dir.x * A.muzzleOffset, y = w.y + dir.y * A.muzzleOffset;
  createProjectile(s, def.projectile, w.id, x, y, dir.x * speed, dir.y * speed, def.fuseSelectable ? s.turn.fuse : -1);
  emit(s, { t: 'shot', weapon: def.id, x, y, dx: dir.x, dy: dir.y, power });
}

/** Tir instantané : rayon pixel par pixel jusqu'au premier terrain ou ver ; explosion à l'impact. */
function hitscan(s: GameState, w: Worm, def: WeaponDef, dir: { x: number; y: number }): void {
  const x0 = w.x + dir.x * (R + 2), y0 = w.y + dir.y * (R + 2);
  let x = x0, y = y0, hit = false;
  for (let d = 0; d < A.shotgun.range; d++) {
    x = x0 + dir.x * d; y = y0 + dir.y * d;
    if (s.terrain.isSolid(x, y)) { hit = true; break; }
    if (s.worms.some((o) => o.alive && o.id !== w.id && dist(o.x - x, o.y - y) < R)) { hit = true; break; }
  }
  emit(s, { t: 'shot', weapon: def.id, x: x0, y: y0, dx: dir.x, dy: dir.y, power: 1 });
  emit(s, { t: 'hitscan', x0, y0, x1: x, y1: y });
  if (hit) explode(s, x, y, def.blast, w.id);
}

/** Dynamite / mine : posée devant le ver, retombe puis reste au sol. */
function place(s: GameState, w: Worm, def: WeaponDef): void {
  if (!def.projectile) return;
  let x = w.x + w.facing * (R + 4);
  const y = w.y;
  if (circleOverlaps(s.terrain, x, y, 3)) x = w.x; // collé à un mur : posée sur place
  createProjectile(s, def.projectile, w.id, x, y, 0, 0, def.projectile === 'dynamite' ? A.dynamite.fuse : -1);
  emit(s, { t: 'shot', weapon: def.id, x, y, dx: w.facing, dy: 0, power: 0 });
}

/** Batte : frappe le ver le plus proche devant (ou tout contre) ; éjection selon l'angle de visée. */
function melee(s: GameState, w: Worm, dir: { x: number; y: number }): void {
  const reach = R * 2 + A.bat.reach;
  let best: Worm | null = null, bd = Infinity;
  for (const o of s.worms) {
    if (o === w || !o.alive || o.sunk) continue;
    const dx = o.x - w.x, dy = o.y - w.y, d = dist(dx, dy);
    if (d > reach || (dx * w.facing < 0 && d > R * 1.2)) continue; // devant, ou tout contre
    if (d < bd) { bd = d; best = o; }
  }
  emit(s, { t: 'swing', x: w.x, y: w.y, dir: w.facing });
  if (!best) return;
  knockWorm(best, dir.x * A.bat.force, dir.y * A.bat.force);
  damageWorm(s, best.id, A.bat.damage, w.id);
}

/** Frappe aérienne : une ligne de missiles tombant du ciel autour du point désigné. */
function airstrike(s: GameState, w: Worm, def: WeaponDef, target?: { x: number; y: number }): boolean {
  if (!target || target.x < 0 || target.x > GAMEPLAY.world.width) { emit(s, { t: 'invalid' }); return false; }
  const a = A.airstrike;
  for (let i = 0; i < a.missiles; i++) {
    s.pending.push({
      delay: 0.5 + i * a.stagger, kind: 'missile', owner: w.id,
      x: target.x + (i - (a.missiles - 1) / 2) * a.spacing * w.facing, y: a.startY, vx: 0, vy: a.fallSpeed,
    });
  }
  emit(s, { t: 'shot', weapon: def.id, x: target.x, y: target.y, dx: 0, dy: 0, power: 0 });
  return true;
}

/** Destination valide : dans la carte, au-dessus de l'eau, assez de place pour le ver. */
export function validTeleport(s: GameState, x: number, y: number): boolean {
  const m = R + A.teleport.headroom;
  if (x < m || x > GAMEPLAY.world.width - m || y < m || y > s.waterLevel - m) return false;
  return !circleOverlaps(s.terrain, x, y, m);
}

function teleport(s: GameState, w: Worm, target?: { x: number; y: number }): boolean {
  if (!target || !validTeleport(s, target.x, target.y)) { emit(s, { t: 'invalid' }); return false; }
  emit(s, { t: 'teleport', x0: w.x, y0: w.y, x1: target.x, y1: target.y });
  w.x = w.px = target.x;
  w.y = w.py = target.y;
  w.vx = 0; w.vy = 0;
  w.mode = 'air';
  w.rope = null;
  w.knocked = false;
  w.peakY = w.y; // pas de dégâts de chute après une téléportation
  w.appear = A.teleport.appearTime;
  return true;
}

/** Corde : tir le long de la visée ; accroche au premier terrain rencontré dans la portée. */
function shootRope(s: GameState, w: Worm, dir: { x: number; y: number }): boolean {
  const r = A.rope;
  let lx = w.x, ly = w.y;
  for (let d = R + 1; d <= r.maxLength; d++) {
    const x = w.x + dir.x * d, y = w.y + dir.y * d;
    if (s.terrain.isSolid(x, y)) {
      const length = Math.min(r.maxLength, Math.max(r.minLength, dist(lx - w.x, ly - w.y)));
      w.rope = { ax: lx, ay: ly, length };
      w.mode = 'air';
      w.knocked = false;
      w.peakY = w.y;
      emit(s, { t: 'rope', x: lx, y: ly, kind: 'attach' });
      return true;
    }
    lx = x; ly = y;
  }
  emit(s, { t: 'rope', x: lx, y: ly, kind: 'miss' });
  return false;
}
