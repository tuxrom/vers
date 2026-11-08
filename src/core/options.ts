import { GAMEPLAY } from '@/config/gameplay';
import { TEAM_PALETTE, defaultTeamColor } from '@/config/palette';

/** Qui joue une équipe : un humain (hot-seat) ou l'IA (étape 7). */
export type Controller = 'human' | 'ai';

/** Niveau de l'IA. */
export type Difficulty = 'easy' | 'medium' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];

export interface TeamOptions {
  name: string;
  /** Couleur (élément de TEAM_PALETTE). */
  color: string;
  controller: Controller;
  /** Niveau de l'IA (utilisé si controller = 'ai'). */
  difficulty: Difficulty;
}

/** Réglages d'une partie, choisis dans le menu et sauvegardés localement. */
export interface GameOptions {
  teams: TeamOptions[];
  wormsPerTeam: number;
  /** Graine de la carte : texte libre (hexadécimal tel quel, sinon haché). */
  seed: string;
  /** Durée d'un tour (s). */
  turnDuration: number;
  /** PV de départ de chaque ver. */
  startHealth: number;
}

const O = GAMEPLAY.options;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const snap = (v: number, lo: number, hi: number, step: number): number => clamp(lo + Math.round((v - lo) / step) * step, lo, hi);

/** Options par défaut ; `names` fournit les noms d'équipe de la langue courante. */
export function defaultOptions(names: readonly string[] = GAMEPLAY.match.teamNames): GameOptions {
  const n = GAMEPLAY.match.teams;
  return {
    teams: Array.from({ length: n }, (_, i) => ({
      name: names[i] ?? `Team ${i + 1}`, color: defaultTeamColor(i), controller: 'human' as Controller, difficulty: 'medium' as Difficulty,
    })),
    wormsPerTeam: GAMEPLAY.match.wormsPerTeam,
    seed: '5eed1234',
    turnDuration: GAMEPLAY.turn.duration,
    startHealth: GAMEPLAY.worm.startHealth,
  };
}

/** Valide et borne des options venues d'une source non fiable (stockage corrompu, ancienne version). */
export function sanitizeOptions(raw: unknown, names: readonly string[] = GAMEPLAY.match.teamNames): GameOptions {
  const def = defaultOptions(names);
  if (typeof raw !== 'object' || raw === null) return def;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

  const rawTeams = Array.isArray(r.teams) ? r.teams : [];
  const count = clamp(Math.round(rawTeams.length || def.teams.length), O.teams.min, O.teams.max);
  const used = new Set<string>();
  const teams: TeamOptions[] = [];
  for (let i = 0; i < count; i++) {
    const t = (typeof rawTeams[i] === 'object' && rawTeams[i] !== null ? rawTeams[i] : {}) as Record<string, unknown>;
    const name = typeof t.name === 'string' ? t.name.trim().slice(0, O.nameMaxLength) : '';
    let color = typeof t.color === 'string' && (TEAM_PALETTE as readonly string[]).includes(t.color) ? t.color : defaultTeamColor(i);
    // Couleurs uniques : en cas de doublon, première couleur libre de la palette.
    if (used.has(color)) color = TEAM_PALETTE.find((c) => !used.has(c)) ?? color;
    used.add(color);
    teams.push({
      name: name || names[i] || `Team ${i + 1}`,
      color,
      controller: t.controller === 'ai' ? 'ai' : 'human',
      difficulty: DIFFICULTIES.includes(t.difficulty as Difficulty) ? (t.difficulty as Difficulty) : 'medium',
    });
  }
  return {
    teams,
    wormsPerTeam: clamp(Math.round(num(r.wormsPerTeam, def.wormsPerTeam)), O.worms.min, O.worms.max),
    seed: typeof r.seed === 'string' && r.seed.trim() ? r.seed.trim().slice(0, 24) : def.seed,
    turnDuration: snap(num(r.turnDuration, def.turnDuration), O.turnDuration.min, O.turnDuration.max, O.turnDuration.step),
    startHealth: snap(num(r.startHealth, def.startHealth), O.health.min, O.health.max, O.health.step),
  };
}

/** Graine numérique d'une graine texte : hexadécimal (≤ 8 chiffres) tel quel, sinon hachage FNV-1a. */
export function seedToNumber(seed: string): number {
  const s = seed.trim();
  if (/^[0-9a-f]{1,8}$/i.test(s)) return Number.parseInt(s, 16) >>> 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Graine aléatoire lisible (8 chiffres hexadécimaux) ; `rand` injectable (UI uniquement, jamais la simulation). */
export function randomSeed(rand: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < 8; i++) out += Math.floor(rand() * 16).toString(16);
  return out;
}

/** Hot-seat : au moins deux équipes humaines se partagent l'écran. */
export const isHotSeat = (o: GameOptions): boolean => o.teams.filter((t) => t.controller === 'human').length >= 2;
