import { GAMEPLAY } from '@/config/gameplay';
import type { BlastSize, ProjectileKind } from './types';

/** Propriétés physiques d'un type de projectile. */
export interface ProjectileSpec {
  radius: number;
  gravityScale: number;
  windInfluence: number;
  /** Restitution au rebond (0 = aucun). Ignoré si `explodeOnImpact`. */
  bounce: number;
  /** Fraction de vitesse tangentielle perdue à chaque rebond. */
  friction: number;
  hitsWorms: boolean;
  explodeOnImpact: boolean;
  /** Rotation visuelle (rad/s) ; 0 = orienté selon la vitesse. */
  spin: number;
  blast: BlastSize;
  /** Vitesse de lancement à 0 % et 100 % de puissance (px/s) ; 0 si non lancé par le joueur. */
  minSpeed: number;
  maxSpeed: number;
}

const B = GAMEPLAY.weapons.bazooka;
const G = GAMEPLAY.weapons.grenade;
const D = GAMEPLAY.weapons.dynamite;
const M = GAMEPLAY.weapons.mine;
const A = GAMEPLAY.weapons.airstrike;

export const PROJECTILE_SPECS: Readonly<Record<ProjectileKind, ProjectileSpec>> = {
  rocket: {
    radius: B.radius, gravityScale: B.gravityScale, windInfluence: B.windInfluence,
    bounce: 0, friction: 0, hitsWorms: true, explodeOnImpact: true, spin: 0, blast: B.blast, minSpeed: B.minSpeed, maxSpeed: B.maxSpeed,
  },
  grenade: {
    radius: G.radius, gravityScale: G.gravityScale, windInfluence: G.windInfluence,
    bounce: G.bounce, friction: G.friction, hitsWorms: false, explodeOnImpact: false, spin: G.spin, blast: G.blast, minSpeed: G.minSpeed, maxSpeed: G.maxSpeed,
  },
  dynamite: {
    radius: D.radius, gravityScale: 1, windInfluence: 0, bounce: 0.1, friction: 0.6,
    hitsWorms: false, explodeOnImpact: false, spin: 0, blast: D.blast, minSpeed: 0, maxSpeed: 0,
  },
  mine: {
    radius: M.radius, gravityScale: 1, windInfluence: 0, bounce: M.bounce, friction: M.friction,
    hitsWorms: false, explodeOnImpact: false, spin: 0, blast: M.blast, minSpeed: 0, maxSpeed: 0,
  },
  missile: {
    radius: A.radius, gravityScale: A.gravityScale, windInfluence: A.windInfluence, bounce: 0, friction: 0,
    hitsWorms: true, explodeOnImpact: true, spin: 0, blast: A.blast, minSpeed: 0, maxSpeed: 0,
  },
};
