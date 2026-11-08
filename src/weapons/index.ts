import { airstrike } from './airstrike';
import { bat } from './bat';
import { bazooka } from './bazooka';
import { dynamite } from './dynamite';
import { grenade } from './grenade';
import { mine } from './mine';
import { rope } from './rope';
import { shotgun } from './shotgun';
import { teleport } from './teleport';
import type { WeaponDef, WeaponId } from './types';

export type { WeaponDef, WeaponId, BlastSize, ProjectileKind } from './types';

/** Ordre d'affichage dans le menu d'armes. */
export const WEAPON_LIST: readonly WeaponDef[] = [bazooka, grenade, shotgun, dynamite, mine, airstrike, bat, rope, teleport];

export const WEAPONS: Readonly<Record<WeaponId, WeaponDef>> = Object.fromEntries(
  WEAPON_LIST.map((w) => [w.id, w]),
) as Record<WeaponId, WeaponDef>;

export const DEFAULT_WEAPON: WeaponId = 'bazooka';

/** Munitions de départ d'une équipe (-1 = illimité). */
export function initialAmmo(): Record<WeaponId, number> {
  return Object.fromEntries(WEAPON_LIST.map((w) => [w.id, w.ammo])) as Record<WeaponId, number>;
}
