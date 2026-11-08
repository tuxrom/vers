import { GAMEPLAY } from '@/config/gameplay';
import type { WeaponDef } from './types';

const C = GAMEPLAY.weapons.airstrike;

export const airstrike: WeaponDef = {
  id: 'airstrike',
  name: 'Frappe aérienne',
  description: 'Cliquez sur la carte : une série de missiles tombe en ligne. À désigner avant de bouger.',
  ammo: C.ammo,
  kind: 'airstrike',
  input: 'target',
  aim: false,
  fuseSelectable: false,
  endsTurn: true,
  usableAfterMove: false,
  shots: 1,
  reload: 0,
  blast: C.blast,
};
