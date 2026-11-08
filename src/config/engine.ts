/** Réglages techniques du moteur (hors ressenti de jeu — voir gameplay.ts). */
export const ENGINE = {
  /** Pas de simulation fixe : 60 Hz. */
  simHz: 60,
  /** Plafond du nombre de pas rattrapés par frame (évite la spirale de la mort). */
  maxStepsPerFrame: 5,
  /** Pixel ratio plafonné pour tenir 60 fps sur mobile milieu de gamme. */
  maxPixelRatio: 2,
  /** Graine par défaut de la partie (déterminisme). */
  defaultSeed: 0x5eed1234,
  /** Lissage du compteur FPS (0..1, plus grand = plus réactif). */
  fpsSmoothing: 0.1,
} as const;

export const SIM_DT = 1 / ENGINE.simHz;

/**
 * Niveaux de qualité graphique (réglage utilisateur) :
 * - `maxPixelRatio` : résolution maximale du canvas (le plus gros levier sur mobile : coût ∝ pixels),
 * - `particles` : densité de particules, - `shadows` : ombres des vers,
 * - `waveStep` : pas (px) des polygones de vagues (moins de sommets = moins de travail),
 * - `soft` : particules rondes dégradées (sinon petits carrés).
 */
export const QUALITY = {
  low: { maxPixelRatio: 1, particles: 0.35, shadows: false, waveStep: 28, soft: false },
  medium: { maxPixelRatio: 1.5, particles: 0.7, shadows: true, waveStep: 18, soft: true },
  high: { maxPixelRatio: ENGINE.maxPixelRatio, particles: 1, shadows: true, waveStep: 12, soft: true },
} as const;

export type Quality = keyof typeof QUALITY;
export type QualitySpec = (typeof QUALITY)[Quality];

/**
 * Résolution dynamique : si la durée moyenne des frames reste trop longue, le canvas passe à une résolution plus
 * basse (par paliers), et remonte quand la machine a de la marge. Évite de tomber sous ~30 fps sur mobile.
 */
export const ADAPTIVE = {
  /** Échelle de résolution minimale / pas de variation. */
  minScale: 0.6,
  step: 0.2,
  /** Durée moyenne de frame (ms) au-delà de laquelle on baisse / en deçà de laquelle on remonte. */
  slowMs: 24,
  fastMs: 15.5,
  /** Nombre de frames consécutives avant décision, et délai minimal entre deux changements (ms). */
  slowFrames: 90,
  fastFrames: 480,
  cooldownMs: 6000,
} as const;
