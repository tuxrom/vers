import { SIM_DT } from '@/config/engine';
import { GAMEPLAY } from '@/config/gameplay';
import { AiController } from '@/ai';
import { startTurn } from '@/core/game';
import { NEUTRAL_INTENT, type Intent } from '@/core/intent';
import type { Difficulty } from '@/core/options';
import { step } from '@/core/simulation';
import { createState, type GameState } from '@/core/state';
import { Terrain } from '@/terrain/terrain';
import { flatMask } from './helpers';

export const R = GAMEPLAY.worm.radius;
export const GROUND = 700; // assez haut pour que l’eau de la mort subite n’arrive pas trop tôt

/** Fait travailler l'IA sans limite de temps (tests déterministes) puis joue un pas avec son intention. */
export function aiTick(s: GameState, ai: AiController): Intent {
  let it = NEUTRAL_INTENT;
  if (AiController.isAiTurn(s)) {
    ai.pump(s, 1e9, () => 0);
    it = ai.nextIntent(s);
  }
  step(s, SIM_DT, it);
  return it;
}

/** Arène plate à 2 équipes (humaines par défaut), premier tour lancé, vent nul. */
export function aiArena(seed = 5, perTeam = 1): GameState {
  const s = createState({
    seed, withCanvas: false,
    options: {
      teams: [
        { name: 'A', color: '#f08a9b', controller: 'human', difficulty: 'medium' },
        { name: 'B', color: '#6cb4f0', controller: 'human', difficulty: 'medium' },
      ],
      wormsPerTeam: perTeam, seed: 'x', turnDuration: 45, startHealth: 100,
    },
  });
  s.terrain = new Terrain(flatMask(GAMEPLAY.world.width, GAMEPLAY.world.height, GROUND), false);
  s.worms.forEach((w, i) => { w.x = 600 + i * 400; w.y = GROUND - R - 1; w.px = w.x; w.py = w.y; w.mode = 'ground'; });
  startTurn(s);
  s.wind = 0;
  s.crates.length = 0;
  return s;
}

export function setAi(s: GameState, team: number, level: Difficulty): void {
  const t = s.teams[team]!;
  t.controller = 'ai';
  t.difficulty = level;
}
