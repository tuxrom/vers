/** Couleurs de rendu partagées (cosmétique uniquement, sans effet sur la simulation). */

/** Palette proposée pour les équipes dans le menu de configuration. */
export const TEAM_PALETTE = [
  '#f08a9b', '#6cb4f0', '#f0c75e', '#8bd67a', '#c79bf2', '#f2a35e', '#5fd6c9', '#e6e6e6',
] as const;

/** Couleur par défaut de l'équipe `i` (les 4 premières de la palette). */
export const defaultTeamColor = (i: number): string => TEAM_PALETTE[i % TEAM_PALETTE.length] as string;
