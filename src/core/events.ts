/**
 * Événements émis par la simulation (sortie seulement : la simulation ne les relit jamais).
 * Consommés par le rendu : sons, particules, secousses, caméra, bulles de dégâts.
 */
export type GameEvent =
  | { t: 'phase'; phase: string }
  | { t: 'turn'; team: number; worm: number }
  | { t: 'explosion'; x: number; y: number; r: number }
  | { t: 'damage'; worm: number; amount: number; x: number; y: number }
  | { t: 'shot'; weapon: string; x: number; y: number; dx: number; dy: number; power: number }
  | { t: 'hitscan'; x0: number; y0: number; x1: number; y1: number }
  | { t: 'bounce'; x: number; y: number; speed: number }
  | { t: 'beep'; x: number; y: number }
  | { t: 'swing'; x: number; y: number; dir: number }
  | { t: 'rope'; x: number; y: number; kind: 'attach' | 'release' | 'miss' }
  | { t: 'teleport'; x0: number; y0: number; x1: number; y1: number }
  | { t: 'invalid' }
  | { t: 'death'; worm: number; x: number; y: number; drowned?: boolean }
  | { t: 'splash'; x: number; y: number; r: number }
  | { t: 'water'; level: number }
  | { t: 'pickup'; worm: number; x: number; y: number; kind: string; amount: number; weapon?: string }
  | { t: 'crate'; x: number; y: number }
  | { t: 'unstuck'; worm: number; x: number; y: number };

/** Borne mémoire quand personne ne vide la file (tests). */
export const MAX_EVENTS = 2000;
