import { GAMEPLAY } from '@/config/gameplay';
import type { Crate } from '@/entities/crate';
import type { Projectile } from '@/entities/projectile';
import { createWorm, type Worm } from '@/entities/worm';
import { DEFAULT_WEAPON, initialAmmo, type ProjectileKind, type WeaponId } from '@/weapons';
import { findSpawn } from '@/entities/spawn';
import { Terrain } from '@/terrain/terrain';
import { defaultOptions, seedToNumber, type Controller, type Difficulty, type GameOptions } from './options';
import { MAX_EVENTS, type GameEvent } from './events';
import { Rng } from './rng';

/** Machine à états de la partie. */
export type Phase =
  | 'placing' // les vers tombent et se posent sur le terrain
  | 'turn' // une équipe joue : déplacement, visée (chronomètre actif)
  | 'firing' // arme utilisée : retraite pendant que l'action se déroule
  | 'resolving' // on attend que tout soit immobile
  | 'transition' // bandeau de changement d'équipe
  | 'gameover';

export interface Team {
  id: number;
  name: string;
  color: string;
  controller: Controller;
  difficulty: Difficulty;
  wormIds: number[];
  /** Index (dans wormIds) du prochain ver à jouer : rotation comme dans Worms. */
  cursor: number;
  /** Munitions restantes par arme (-1 = illimité) : décomptées par équipe. */
  ammo: Record<WeaponId, number>;
  stats: TeamStats;
}

/** Statistiques de fin de partie. Tir raté = tour où un tir offensif n'a infligé aucun dégât à un ennemi. */
export interface TeamStats {
  damage: number;
  kills: number;
  shots: number;
  misses: number;
}

/** État du tour en cours. */
export interface TurnState {
  team: number;
  worm: number;
  timeLeft: number;
  weapon: WeaponId;
  /** Angle de visée (rad, > 0 = vers le haut), relatif à la direction du regard. */
  aim: number;
  /** Jauge de puissance 0..1 pendant la charge. */
  power: number;
  charging: boolean;
  /** Le tir est parti automatiquement à 100 % : on attend le relâchement avant de recharger. */
  holdLock: boolean;
  /** Minuterie choisie (s) pour les armes à retardement. */
  fuse: number;
  shotsLeft: number;
  /** Le ver s'est déplacé pendant ce tour (certaines armes l'interdisent ensuite). */
  moved: boolean;
  fireWasDown: boolean;
  /** Délai avant le prochain tir d'une même utilisation (s). */
  reload: number;
  /** Tirs offensifs effectués ce tour et dégâts infligés aux ennemis ce tour (statistiques). */
  shots: number;
  damageDealt: number;
}

export function emptyTurn(): TurnState {
  return {
    team: -1, worm: -1, timeLeft: 0, weapon: DEFAULT_WEAPON, aim: GAMEPLAY.weapons.aim.start, power: 0,
    charging: false, holdLock: false, fuse: GAMEPLAY.weapons.grenade.fuseDefault, shotsLeft: 0,
    moved: false, fireWasDown: false, reload: 0, shots: 0, damageDealt: 0,
  };
}

/** État global de la simulation. Tout ce qui influence le gameplay vit ici (sérialisable). */
export interface GameState {
  seed: number;
  /** Réglages de la partie (menu). */
  options: GameOptions;
  tick: number;
  time: number;
  /** Aléa du gameplay : seule source autorisée dans la simulation. */
  rng: Rng;
  terrain: Terrain;
  worms: Worm[];
  teams: Team[];
  phase: Phase;
  phaseTime: number;
  turn: TurnState;
  projectiles: Projectile[];
  /** Largages différés (frappe aérienne) : apparaissent quand leur délai est écoulé. */
  pending: ScheduledSpawn[];
  crates: Crate[];
  nextId: number;
  turnNumber: number;
  /** Vent (px/s²), signé : > 0 pousse vers la droite. */
  wind: number;
  /** Durée pendant laquelle tout est immobile (résolution / placement). */
  stableTime: number;
  /** Équipe gagnante à la fin ; -1 = égalité ; null = partie en cours. */
  winner: number | null;
  waterLevel: number;
  events: GameEvent[];
}

/** Projectile programmé : créé après `delay` secondes. */
export interface ScheduledSpawn {
  delay: number;
  kind: ProjectileKind;
  owner: number;
  x: number; y: number;
  vx: number; vy: number;
}

export interface CreateStateOptions {
  /** Réglages de partie ; par défaut ceux de GAMEPLAY. */
  options?: GameOptions;
  /** Graine numérique (prioritaire sur options.seed). */
  seed?: number;
  /** false : pas de canvas (tests Node) — seul le masque de collision existe. */
  withCanvas?: boolean;
}

export function emit(s: GameState, e: GameEvent): void {
  s.events.push(e);
  if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
}

export function createState(opts: CreateStateOptions = {}): GameState {
  const options = opts.options ?? defaultOptions();
  const seed = opts.seed ?? seedToNumber(options.seed);
  const rng = new Rng(seed);
  const terrainRng = rng.fork();
  const spawnRng = rng.fork();
  const { width, height } = GAMEPLAY.world;
  const terrain = Terrain.generate(terrainRng, width, height, opts.withCanvas ?? true);

  const nTeams = options.teams.length, wormsPerTeam = options.wormsPerTeam;
  const count = nTeams * wormsPerTeam;
  const worms: Worm[] = [];
  const teams: Team[] = [];
  for (let t = 0; t < nTeams; t++) {
    const o = options.teams[t] as GameOptions['teams'][number];
    teams.push({
      id: t, name: o.name, color: o.color, controller: o.controller, difficulty: o.difficulty, wormIds: [], cursor: 0,
      ammo: initialAmmo(), stats: { damage: 0, kills: 0, shots: 0, misses: 0 },
    });
  }
  // Tronçons de carte attribués en alternant les équipes : les camps sont mélangés sur la carte.
  for (let i = 0; i < count; i++) {
    const x0 = (width * i) / count, x1 = (width * (i + 1)) / count;
    const p = findSpawn(terrain, spawnRng, x0 + 40, x1 - 40);
    const team = i % nTeams;
    const w = createWorm(i, team, p.x, p.y, undefined, options.startHealth, (teams[team] as Team).color);
    w.facing = p.x < width / 2 ? 1 : -1; // regarde vers le centre de la carte
    worms.push(w);
    (teams[team] as Team).wormIds.push(i);
  }

  return {
    seed, options, tick: 0, time: 0, rng, terrain, worms, teams,
    phase: 'placing', phaseTime: 0,
    turn: emptyTurn(), projectiles: [], pending: [], crates: [], nextId: 1,
    turnNumber: 0, wind: 0, stableTime: 0, winner: null,
    waterLevel: GAMEPLAY.water.startLevel,
    events: [],
  };
}

/** Empreinte rapide de l'état (positions + masque + machine à états) : déterminisme/replay. */
export function hashState(s: GameState): string {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h ^= Math.round(n * 1000) | 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  mix(s.tick);
  mix(s.terrain.mask.checksum());
  mix(s.turnNumber);
  mix(s.wind);
  for (const w of s.worms) { mix(w.x); mix(w.y); mix(w.health); }
  for (const p of s.projectiles) { mix(p.x); mix(p.y); }
  mix(s.pending.length);
  mix(s.waterLevel);
  for (const c of s.crates) { mix(c.x); mix(c.y); }
  return h.toString(16).padStart(8, '0');
}

/**
 * Empreinte COMPLÈTE de l'état de simulation pour la détection de désynchronisation en ligne : au contenu de
 * `hashState` s'ajoutent l'état du générateur aléatoire, les vitesses, les munitions, la phase et le chronomètre.
 * Deux clients qui ont rejoué les mêmes intentions obtiennent exactement la même chaîne.
 */
export function syncHash(s: GameState): string {
  let h = 0x811c9dc5;
  const mix = (n: number): void => {
    h ^= Math.round(n * 1000) | 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  mix(s.rng.getState());
  mix(s.turn.timeLeft); mix(s.turn.team); mix(s.turn.worm); mix(s.phaseTime); mix(s.stableTime);
  for (let i = 0; i < s.phase.length; i++) mix(s.phase.charCodeAt(i));
  for (const w of s.worms) {
    mix(w.vx); mix(w.vy); mix(w.facing); mix(w.alive ? 1 : 0); mix(w.sunk ? 1 : 0); mix(w.mode === 'air' ? 1 : 0); mix(w.angle);
  }
  for (const t of s.teams) {
    for (const k of Object.keys(t.ammo).sort()) mix((t.ammo as Record<string, number>)[k] as number);
    mix(t.stats.damage); mix(t.stats.kills);
  }
  for (const p of s.projectiles) { mix(p.vx); mix(p.vy); mix(p.fuse); mix(p.id); }
  return `${hashState(s)}.${(h >>> 0).toString(16).padStart(8, '0')}`;
}
