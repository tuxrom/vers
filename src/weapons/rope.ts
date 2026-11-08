import { GAMEPLAY } from '@/config/gameplay';
import type { WeaponDef } from './types';

const C = GAMEPLAY.weapons.rope;

export const rope: WeaponDef = {
  id: 'rope',
  name: 'Corde ninja',
  description: 'Espace : accrocher / décrocher. ←→ balancer, ↑↓ longueur. Ne termine pas le tour.',
  ammo: C.ammo,
  kind: 'rope',
  input: 'press',
  aim: true,
  fuseSelectable: false,
  endsTurn: false,
  usableAfterMove: true,
  shots: 1,
  reload: 0,
  blast: C.blast,
};
