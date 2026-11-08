/**
 * Banc de réglage du gameplay (désactivé par défaut) : joue des parties IA contre IA sur de vraies cartes générées
 * et mesure des indicateurs de ressenti, pour comparer des jeux de valeurs de `src/config/gameplay.ts`.
 *
 *   TUNING=1 TUNING_OUT=/tmp/tuning.jsonl TUNING_GAMES=12 TUNING_LABEL=base npx vitest run tests/tuning.test.ts
 *
 * Variables d'ajustement : TUNING_DAMAGE (×), TUNING_WIND (vent max), TUNING_GRAVITY, TUNING_TURN (durée du tour),
 * TUNING_SUDDEN (tour de mort subite), TUNING_KNOCK (×). Les valeurs sont restaurées à la fin.
 */
import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SIM_DT } from '@/config/engine';
import { GAMEPLAY } from '@/config/gameplay';
import { AiController } from '@/ai';
import { NEUTRAL_INTENT } from '@/core/intent';
import { sanitizeOptions } from '@/core/options';
import { step } from '@/core/simulation';
import { createState, type GameState } from '@/core/state';

const ON = !!process.env.TUNING;
const num = (k: string, d: number): number => (process.env[k] ? Number(process.env[k]) : d);

interface Metrics {
  turns: number; winner: boolean; suddenDeath: boolean;
  shots: number; hits: number; enemyDamage: number; selfDamage: number; hitCount: number;
  kills: number; drownings: number; fallDamage: number;
}

function playGame(seed: number, levels: ['easy' | 'medium' | 'hard', 'easy' | 'medium' | 'hard']): Metrics {
  const options = sanitizeOptions({
    teams: [{ name: 'A', controller: 'ai', difficulty: levels[0] }, { name: 'B', controller: 'ai', difficulty: levels[1] }],
    wormsPerTeam: 3, seed: String(seed),
  });
  const s: GameState = createState({ options, withCanvas: false });
  const ai = new AiController();
  const m: Metrics = { turns: 0, winner: false, suddenDeath: false, shots: 0, hits: 0, enemyDamage: 0, selfDamage: 0, hitCount: 0, kills: 0, drownings: 0, fallDamage: 0 };
  let guard = 0;
  while (s.phase !== 'gameover' && s.turnNumber < 70 && guard++ < 60 * 60 * 60) {
    let it = NEUTRAL_INTENT;
    if (AiController.isAiTurn(s)) { ai.pump(s, 1e9, () => 0); it = ai.nextIntent(s); }
    step(s, SIM_DT, it);
    for (const e of s.events) {
      if (e.t === 'damage') {
        const w = s.worms[e.worm];
        if (!w) continue;
        if (s.phase === 'resolving' || s.phase === 'firing' || s.phase === 'turn') {
          if (s.phase === 'turn' && e.amount > 0 && s.worms[s.turn.worm] === w && w.mode === 'ground' && w.lastFallDamage === e.amount) m.fallDamage += e.amount;
          else if (w.team === s.turn.team) m.selfDamage += e.amount; else { m.enemyDamage += e.amount; m.hitCount++; }
        }
      } else if (e.t === 'death' && e.drowned) m.drownings++;
    }
    s.events.length = 0;
  }
  m.turns = s.turnNumber;
  m.winner = s.winner !== null && s.winner >= 0;
  m.suddenDeath = s.turnNumber >= GAMEPLAY.water.suddenDeathTurn;
  for (const t of s.teams) { m.shots += t.stats.shots; m.hits += t.stats.shots - t.stats.misses; m.kills += t.stats.kills; }
  return m;
}

describe.skipIf(!ON)('réglage du gameplay (parties IA contre IA)', () => {
  it('mesure les indicateurs de ressenti', () => {
    const G = GAMEPLAY as unknown as {
      physics: { gravity: number }; wind: { max: number }; turn: { duration: number };
      water: { suddenDeathTurn: number }; worm: { knockbackMultiplier: number };
      explosion: { presets: Record<string, { damage: number }> };
    };
    const saved = {
      gravity: G.physics.gravity, wind: G.wind.max, water: G.water.suddenDeathTurn, knock: G.worm.knockbackMultiplier,
      dmg: Object.fromEntries(Object.entries(G.explosion.presets).map(([k, v]) => [k, v.damage])),
    };
    G.physics.gravity = num('TUNING_GRAVITY', saved.gravity);
    G.wind.max = num('TUNING_WIND', saved.wind);
    G.water.suddenDeathTurn = num('TUNING_SUDDEN', saved.water);
    G.worm.knockbackMultiplier = num('TUNING_KNOCK', 1) * saved.knock;
    for (const [k, v] of Object.entries(G.explosion.presets)) v.damage = Math.round((saved.dmg[k] as number) * num('TUNING_DAMAGE', 1));
    try {
      const games = num('TUNING_GAMES', 12);
      const all: Metrics[] = [];
      for (let i = 0; i < games; i++) all.push(playGame(9000 + i, ['medium', 'medium']));
      const avg = (f: (m: Metrics) => number): number => all.reduce((a, m) => a + f(m), 0) / all.length;
      const median = (f: (m: Metrics) => number): number => { const v = all.map(f).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] as number; };
      const shots = avg((m) => m.shots), hits = avg((m) => m.hits);
      const out = {
        label: process.env.TUNING_LABEL ?? '', games,
        turnsMedian: median((m) => m.turns), turnsAvg: +avg((m) => m.turns).toFixed(1),
        victoryRate: +avg((m) => (m.winner ? 1 : 0)).toFixed(2),
        victoryBeforeSuddenDeath: +avg((m) => (m.winner && m.turns < GAMEPLAY.water.suddenDeathTurn + 4 ? 1 : 0)).toFixed(2),
        hitRate: +(hits / shots).toFixed(2),
        damagePerHit: +(avg((m) => m.enemyDamage) / Math.max(1, avg((m) => m.hitCount))).toFixed(1),
        shotsPerGame: +shots.toFixed(1),
        selfDamageShare: +(avg((m) => m.selfDamage) / Math.max(1, avg((m) => m.selfDamage + m.enemyDamage))).toFixed(2),
        drowningsPerGame: +avg((m) => m.drownings).toFixed(2),
        killsPerGame: +avg((m) => m.kills).toFixed(2),
        fallDamagePerGame: +avg((m) => m.fallDamage).toFixed(1),
        params: { gravity: G.physics.gravity, wind: G.wind.max, sudden: G.water.suddenDeathTurn, dmgScale: num('TUNING_DAMAGE', 1), knock: num('TUNING_KNOCK', 1) },
      };
      if (process.env.TUNING_OUT) appendFileSync(process.env.TUNING_OUT, JSON.stringify(out) + '\n');
      expect(all.length).toBe(games);
    } finally {
      G.physics.gravity = saved.gravity; G.wind.max = saved.wind; G.water.suddenDeathTurn = saved.water; G.worm.knockbackMultiplier = saved.knock;
      for (const [k, v] of Object.entries(G.explosion.presets)) v.damage = saved.dmg[k] as number;
    }
  }, 900_000);
});
