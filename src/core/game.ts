import { GAMEPLAY } from '@/config/gameplay';
import { maybeSpawnCrate } from '@/entities/crate';
import { releaseRope, type Worm } from '@/entities/worm';
import { WEAPONS } from '@/weapons';
import { blocksResolution } from '@/entities/projectile';
import { emit, emptyTurn, type GameState, type Phase } from './state';

const T = GAMEPLAY.turn;

export function setPhase(s: GameState, phase: Phase): void {
  s.phase = phase;
  s.phaseTime = 0;
  s.stableTime = 0;
  emit(s, { t: 'phase', phase });
}

export function activeWorm(s: GameState): Worm | undefined {
  return s.turn.worm >= 0 ? s.worms[s.turn.worm] : undefined;
}

export function livingOf(s: GameState, team: number): Worm[] {
  return s.worms.filter((w) => w.team === team && w.alive);
}

/** Équipes encore en vie. */
export function aliveTeams(s: GameState): number[] {
  return s.teams.filter((t) => livingOf(s, t.id).length > 0).map((t) => t.id);
}

/** Prochaine équipe ayant au moins un ver vivant (rotation circulaire à partir de `from`). */
function nextTeam(s: GameState, from: number): number {
  const n = s.teams.length;
  for (let i = 1; i <= n; i++) {
    const t = (from + i) % n;
    if (livingOf(s, t).length > 0) return t;
  }
  return -1;
}

/** Ver suivant de l'équipe (rotation : chacun son tour, comme dans Worms). */
function pickWorm(s: GameState, team: number): number {
  const t = s.teams[team];
  if (!t) return -1;
  for (let i = 0; i < t.wormIds.length; i++) {
    const idx = (t.cursor + i) % t.wormIds.length;
    const id = t.wormIds[idx] as number;
    if ((s.worms[id] as Worm).alive) { t.cursor = idx + 1; return id; }
  }
  return -1;
}

/** Nouveau vent : direction et force tirées de l'aléa de la partie. */
export function rollWind(s: GameState): void {
  s.wind = GAMEPLAY.wind.changePerTurn || s.turnNumber === 0
    ? Math.round(s.rng.range(-GAMEPLAY.wind.max, GAMEPLAY.wind.max))
    : s.wind;
}

export function startTurn(s: GameState): void {
  const first = s.turnNumber === 0 ? s.rng.int(0, s.teams.length - 1) : nextTeam(s, s.turn.team);
  const worm = pickWorm(s, first);
  if (worm < 0) { finishGame(s); return; }
  s.turnNumber++;
  s.turn = { ...emptyTurn(), team: first, worm, timeLeft: s.options.turnDuration };
  s.turn.shotsLeft = WEAPONS[s.turn.weapon].shots;
  rollWind(s);
  riseWater(s);
  maybeSpawnCrate(s);
  emit(s, { t: 'turn', team: first, worm });
  setPhase(s, 'turn');
}

/** Mort subite : l'eau monte d'un cran à intervalle régulier une fois le tour configuré atteint. */
function riseWater(s: GameState): void {
  const W = GAMEPLAY.water;
  if (s.turnNumber < W.suddenDeathTurn || (s.turnNumber - W.suddenDeathTurn) % W.riseEveryTurns !== 0) return;
  s.waterLevel -= W.riseAmount;
  emit(s, { t: 'water', level: s.waterLevel });
}

/** Statistiques : un tour où l'on a tiré sans blesser aucun ennemi compte autant de tirs ratés. */
function closeTurnStats(s: GameState): void {
  const t = s.teams[s.turn.team];
  if (t && s.turn.shots > 0 && s.turn.damageDealt === 0) t.stats.misses += s.turn.shots;
}

function finishGame(s: GameState): void {
  const alive = aliveTeams(s);
  s.winner = alive.length === 1 ? (alive[0] as number) : -1;
  setPhase(s, 'gameover');
}

/** Fin de l'action du ver actif : on attend que tout s'immobilise. */
export function beginResolving(s: GameState): void {
  const a = activeWorm(s);
  if (a) releaseRope(a); // une corde ne doit jamais retenir la fin du tour
  setPhase(s, 'resolving');
}

/** Tout est-il immobile ? (vers posés, plus de projectile actif). */
export function isSettled(s: GameState): boolean {
  const rest = T.restSpeed;
  for (const w of s.worms) {
    if (w.sunk) continue;
    if (w.mode !== 'ground' || w.sliding || w.knocked) return false;
    if (Math.abs(w.vx) > rest) return false;
  }
  return s.pending.length === 0 && !s.projectiles.some(blocksResolution);
}

/** Avance la machine à états d'un pas (avant la mise à jour des vers). */
export function stepPhase(s: GameState, dt: number, skip: boolean): void {
  s.phaseTime += dt;
  switch (s.phase) {
    case 'placing':
      if (s.stableTime >= T.placeStableTime || s.phaseTime >= T.placeTimeout) startTurn(s);
      break;

    case 'turn': {
      const w = activeWorm(s);
      s.turn.timeLeft = Math.max(0, s.turn.timeLeft - dt);
      if (skip || s.turn.timeLeft <= 0 || !w || !w.alive) beginResolving(s);
      break;
    }

    case 'firing':
      s.turn.timeLeft = Math.max(0, s.turn.timeLeft - dt);
      if (s.turn.timeLeft <= 0) beginResolving(s);
      break;

    case 'resolving':
      // Garde-fou : une situation qui ne se stabilise jamais ne doit pas bloquer la partie.
      if (s.stableTime >= T.resolveStableTime || s.phaseTime >= T.resolveTimeout) {
        closeTurnStats(s);
        if (aliveTeams(s).length <= 1) finishGame(s);
        else setPhase(s, 'transition');
      }
      break;

    case 'transition':
      if (s.phaseTime >= T.transitionTime) startTurn(s);
      break;

    case 'gameover':
      break;
  }
}
