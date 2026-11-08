import { GAMEPLAY } from '@/config/gameplay';
import type { WeaponDef } from './types';

const C = GAMEPLAY.weapons.shotgun;

export const shotgun: WeaponDef = {
  id: 'shotgun',
  name: 'Fusil à pompe',
  description: 'Tir instantané en ligne droite, deux tirs par tour, petits cratères.',
  ammo: C.ammo,
  kind: 'hitscan',
  input: 'press',
  aim: true,
  fuseSelectable: false,
  endsTurn: true,
  usableAfterMove: true,
  shots: C.shots,
  reload: C.reload,
  blast: C.blast,
};
