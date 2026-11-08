import { GAMEPLAY } from '@/config/gameplay';
import type { WeaponDef } from './types';

const C = GAMEPLAY.weapons.bat;

export const bat: WeaponDef = {
  id: 'bat',
  name: 'Batte de baseball',
  description: 'Corps à corps : éjecte un ver adjacent avec une forte impulsion (visée = direction).',
  ammo: C.ammo,
  kind: 'melee',
  input: 'press',
  aim: true,
  fuseSelectable: false,
  endsTurn: true,
  usableAfterMove: true,
  shots: 1,
  reload: 0,
  blast: C.blast,
};
