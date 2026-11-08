import { GAMEPLAY } from '@/config/gameplay';
import type { WeaponDef } from './types';

const C = GAMEPLAY.weapons.dynamite;

export const dynamite: WeaponDef = {
  id: 'dynamite',
  name: 'Dynamite',
  description: 'Posée au sol, mèche de 5 secondes, très gros cratère. Éloignez-vous !',
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
  projectile: 'dynamite',
};
