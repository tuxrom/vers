import { GAMEPLAY } from '@/config/gameplay';
import type { WeaponDef } from './types';

const C = GAMEPLAY.weapons.grenade;

export const grenade: WeaponDef = {
  id: 'grenade',
  name: 'Grenade',
  description: 'Rebondit sur le terrain et explose à échéance (minuterie 1 à 5 s : touches 1-5).',
  ammo: C.ammo,
  kind: 'launcher',
  input: 'charge',
  aim: true,
  fuseSelectable: true,
  endsTurn: true,
  usableAfterMove: true,
  shots: 1,
  reload: 0,
  blast: C.blast,
  projectile: 'grenade',
};
