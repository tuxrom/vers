import { GAMEPLAY } from '@/config/gameplay';
import type { WeaponDef } from './types';

const C = GAMEPLAY.weapons.bazooka;

export const bazooka: WeaponDef = {
  id: 'bazooka',
  name: 'Bazooka',
  description: 'Roquette balistique, déviée par le vent. Explose à l’impact.',
  ammo: C.ammo,
  kind: 'launcher',
  input: 'charge',
  aim: true,
  fuseSelectable: false,
  endsTurn: true,
  usableAfterMove: true,
  shots: 1,
  reload: 0,
  blast: C.blast,
  projectile: 'rocket',
};
