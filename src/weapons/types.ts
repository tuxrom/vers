import type { GAMEPLAY } from '@/config/gameplay';

/** Identifiants d'armes (étendus à l'étape 4). */
export type WeaponId =
  | 'bazooka' | 'grenade' | 'shotgun'
  | 'dynamite' | 'airstrike' | 'bat' | 'rope' | 'teleport' | 'mine';

export type BlastSize = keyof typeof GAMEPLAY.explosion.presets;
export type ProjectileKind = 'rocket' | 'grenade' | 'dynamite' | 'mine' | 'missile';

/** Comportement générique d'une arme (implémenté dans weapons/system.ts). */
export type WeaponKind = 'launcher' | 'hitscan' | 'placed' | 'airstrike' | 'melee' | 'rope' | 'teleport';

/** Comment le joueur déclenche l'arme : maintenir puis relâcher (puissance), appui simple, clic sur la carte. */
export type TriggerInput = 'charge' | 'press' | 'target';

/**
 * Définition data-driven d'une arme. Les valeurs de réglage numériques viennent de `GAMEPLAY.weapons`
 * (jamais de nombre magique ici).
 */
export interface WeaponDef {
  id: WeaponId;
  name: string;
  description: string;
  /** Munitions de départ par équipe ; -1 = illimité. */
  ammo: number;
  kind: WeaponKind;
  input: TriggerInput;
  /** Affiche le réticule et accepte la visée à l'angle. */
  aim: boolean;
  /** La minuterie (1 à 5 s) est réglable avant le tir. */
  fuseSelectable: boolean;
  /** L'usage de l'arme termine le tour (retraite puis résolution). */
  endsTurn: boolean;
  /** Utilisable après s'être déplacé pendant ce tour. */
  usableAfterMove: boolean;
  /** Nombre de tirs par utilisation (une munition = une utilisation). */
  shots: number;
  /** Délai entre deux tirs d'une même utilisation (s). */
  reload: number;
  blast: BlastSize;
  projectile?: ProjectileKind;
}
