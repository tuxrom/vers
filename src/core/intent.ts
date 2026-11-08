/** Commande de cratère de debug (coordonnées monde) : exécutée par la simulation, donc rejouable. */
export interface CraterCommand { x: number; y: number; r: number }

/**
 * Intention du joueur pour UN pas de simulation : seule entrée de la simulation.
 * (Un replay ou le réseau = une suite d'Intent par tick.)
 */
export interface Intent {
  moveX: -1 | 0 | 1;
  jump: boolean;
  backflip: boolean;
  /** Réglage de la visée : +1 vers le haut, -1 vers le bas. */
  aimDir: -1 | 0 | 1;
  /** Touche de tir maintenue (niveau) ; au moins un pas à vrai même pour un appui très bref. */
  fireDown: boolean;
  /** Arme choisie dans le menu pendant ce pas. */
  selectWeapon: string | null;
  /** Minuterie choisie (1 à 5 s). */
  fuse: number | null;
  /** Point désigné sur la carte (coordonnées monde) pour les armes à cible. */
  target: { x: number; y: number } | null;
  /** Passe le tour (debug / abandon). */
  skipTurn: boolean;
  craters: CraterCommand[];
}

export const NEUTRAL_INTENT: Intent = { moveX: 0, jump: false, backflip: false, aimDir: 0, fireDown: false, selectWeapon: null, fuse: null, target: null, skipTurn: false, craters: [] };
