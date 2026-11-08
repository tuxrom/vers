import { GAMEPLAY } from '@/config/gameplay';
import { emit, type GameState } from '@/core/state';
import { WEAPONS, type WeaponId } from '@/weapons';

const C = GAMEPLAY.crate;
const R = GAMEPLAY.worm.radius;

export type CrateKind = 'health' | 'weapon' | 'tool';

/** Caisse larguée en parachute : soins, arme ou outil. */
export interface Crate {
  id: number;
  kind: CrateKind;
  /** Arme ou outil offert (caisses `weapon` / `tool`). */
  weapon: WeaponId | null;
  amount: number;
  x: number; y: number;
  px: number; py: number;
  /** Posée au sol : le parachute disparaît. */
  landed: boolean;
  dead: boolean;
}

function pickKind(s: GameState): CrateKind {
  const w = C.weights;
  const total = w.health + w.weapon + w.tool;
  const r = s.rng.range(0, total);
  return r < w.health ? 'health' : r < w.health + w.weapon ? 'weapon' : 'tool';
}

/** Largue éventuellement une caisse (tirage déterministe) au début d'un tour. */
export function maybeSpawnCrate(s: GameState): void {
  if (s.crates.length >= C.maxAlive || !s.rng.chance(C.spawnChancePerTurn)) return;
  const kind = pickKind(s);
  let weapon: WeaponId | null = null;
  if (kind !== 'health') {
    const pool = ((kind === 'weapon' ? C.weaponPool : C.toolPool) as readonly string[])
      .filter((id): id is WeaponId => Object.prototype.hasOwnProperty.call(WEAPONS, id));
    weapon = s.rng.pick(pool);
  }
  // Colonne de largage : un sol réel au-dessus de l'eau (sinon la caisse serait perdue).
  const limit = s.waterLevel - C.dropWaterMargin;
  for (let tries = 0; tries < 12; tries++) {
    const x = Math.round(s.rng.range(100, GAMEPLAY.world.width - 100));
    let y = 0;
    while (y < limit && !s.terrain.isSolid(x, y)) y += 4;
    if (y >= limit) continue;
    const startY = -30;
    s.crates.push({
      id: s.nextId++, kind, weapon, amount: kind === 'health' ? C.healthRestore : C.ammoBonus,
      x, y: startY, px: x, py: startY, landed: false, dead: false,
    });
    emit(s, { t: 'crate', x, y: startY });
    return;
  }
}

const supported = (s: GameState, c: Crate): boolean => {
  const by = c.y + C.halfSize + 1, q = C.halfSize * 0.6;
  return s.terrain.isSolid(c.x, by) || s.terrain.isSolid(c.x - q, by) || s.terrain.isSolid(c.x + q, by);
};

/** Chute des caisses, pose, perte dans l'eau, ramassage par un ver vivant qui les touche. */
export function updateCrates(s: GameState, dt: number): void {
  if (s.crates.length === 0) return;
  for (const c of s.crates) {
    c.px = c.x; c.py = c.y;
    if (c.landed && !supported(s, c)) c.landed = false; // le sol a été creusé
    if (!c.landed) {
      c.y += C.fallSpeed * dt;
      if (supported(s, c)) c.landed = true;
    }
    if (c.y + C.halfSize > s.waterLevel) {
      c.dead = true;
      emit(s, { t: 'splash', x: c.x, y: s.waterLevel, r: C.halfSize * 1.5 });
      continue;
    }
    for (const w of s.worms) {
      if (!w.alive || w.sunk) continue;
      // Distance du centre du ver au carré de la caisse < rayon du ver.
      const dx = Math.max(Math.abs(w.x - c.x) - C.halfSize, 0), dy = Math.max(Math.abs(w.y - c.y) - C.halfSize, 0);
      if (dx * dx + dy * dy > R * R) continue;
      const team = s.teams[w.team];
      if (c.kind === 'health') w.health = Math.min(s.options.startHealth, w.health + c.amount);
      else if (team && c.weapon && team.ammo[c.weapon] >= 0) team.ammo[c.weapon] += c.amount;
      emit(s, { t: 'pickup', worm: w.id, x: c.x, y: c.y, kind: c.kind, amount: c.amount, weapon: c.weapon ?? undefined });
      c.dead = true;
      break;
    }
  }
  s.crates = s.crates.filter((c) => !c.dead);
}
