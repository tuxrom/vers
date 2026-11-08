/** Noms des vers (cosmétique) : attribués dans l'ordre de création. */
export const WORM_NAMES = [
  'Ver de Terre', 'Lombric', 'Annélide', 'Anguille', 'Spaghetti', 'Tortillon', 'Sillon', 'Gluant',
  'Vermicelle', 'Rampant', 'Zigzag', 'Boudin', 'Filou', 'Torpille', 'Racine', 'Limon',
  'Mollusque', 'Fouisseur', 'Gigoteur', 'Bidule', 'Ficelle', 'Nouille', 'Serpentin', 'Croquette',
] as const;

export const wormName = (id: number): string => WORM_NAMES[id % WORM_NAMES.length] as string;
