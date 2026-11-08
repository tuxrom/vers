import { GAMEPLAY } from '@/config/gameplay';
import type { WeaponDef } from './types';

const C = GAMEPLAY.weapons.teleport;

export const teleport: WeaponDef = {
  id: 'teleport',
  name: 'Téléportation',
  description: 'Cliquez sur une destination libre : le ver réapparaît là.',
  ammo: C.ammo,
  kind: 'teleport',
  input: 'target',
  aim: false,
  fuseSelectable: false,
  endsTurn: true,
  usableAfterMove: true,
  shots: 1,
  reload: 0,
  blast: C.blast,
};
