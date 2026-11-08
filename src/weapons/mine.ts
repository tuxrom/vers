import { GAMEPLAY } from '@/config/gameplay';
import type { WeaponDef } from './types';

const C = GAMEPLAY.weapons.mine;

export const mine: WeaponDef = {
  id: 'mine',
  name: 'Mine',
  description: 'Posée au sol, s’arme après un délai puis explose à l’approche d’un ver.',
  ammo: C.ammo,
  kind: 'placed',
  input: 'press',
  aim: false,
  fuseSelectable: false,
  endsTurn: true,
  usableAfterMove: true,
  shots: 1,
  reload: 0,
  blast: C.blast,
  projectile: 'mine',
};
