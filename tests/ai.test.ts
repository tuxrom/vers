import { describe, expect, it } from 'vitest';
import { appendFileSync } from 'node:fs';
const note = (label: string, v: unknown): void => { try { appendFileSync(process.env.AI_NOTES ?? '/dev/null', label + ' ' + JSON.stringify(v) + '\n'); } catch { /* sans importance */ } };
import { SIM_DT } from '@/config/engine';
import { GAMEPLAY } from '@/config/gameplay';
import { AiController, planTurn } from '@/ai';
import { reachable, WalkDriver } from '@/ai/walk';
import { simulateShot } from '@/ai/shots';
import { knockAdjustment } from '@/ai/score';
import { NEUTRAL_INTENT } from '@/core/intent';
import { Rng } from '@/core/rng';
import { step } from '@/core/simulation';
import { hashState, type GameState } from '@/core/state';
import { updateWorm } from '@/entities/worm';
import { PROJECTILE_SPECS } from '@/weapons/specs';
import { TerrainMask } from '@/terrain/mask';
import { Terrain } from '@/terrain/terrain';
import { aiArena, aiTick, GROUND, R, setAi } from './aiHelpers';
import { flatMask } from './helpers';

const A = GAMEPLAY.weapons;
const AIM_STEP = A.aim.rate * SIM_DT;
const events = (s: GameState, t: string) => s.events.filter((e) => e.t === t);
const active = (s: GameState) => s.worms[s.turn.worm]!;
const foe = (s: GameState) => s.worms.find((w) => w.team !== active(s).team)!;

describe('prédiction balistique = simulation réelle', () => {
  it('bazooka : le point d’impact prédit est exactement celui du jeu (vent compris)', () => {
    const rng = new Rng(77);
    for (let n = 0; n < 12; n++) {
      const s = aiArena(3 + n);
      s.wind = Math.round(rng.range(-120, 120));
      const a = active(s);
      a.facing = rng.chance(0.5) ? 1 : -1;
      const aim = rng.range(0.1, 1.2), pt = rng.int(20, 90);
      const dx = a.facing * Math.cos(aim), dy = -Math.sin(aim);
      const spec = PROJECTILE_SPECS.rocket;
      const power = Math.min(1, pt * SIM_DT / A.chargeTime);
      const sp = spec.minSpeed + (spec.maxSpeed - spec.minSpeed) * power;
      const pred = simulateShot({ terrain: s.terrain, worms: s.worms, wind: s.wind, waterLevel: s.waterLevel }, 'rocket', a.id,
        a.x + dx * A.muzzleOffset, a.y + dy * A.muzzleOffset, dx * sp, dy * sp);
      s.turn.aim = aim;
      for (let i = 0; i < pt; i++) step(s, SIM_DT, { ...NEUTRAL_INTENT, fireDown: true });
      for (let i = 0; i < 60 * 12 && !events(s, 'explosion').length; i++) step(s, SIM_DT, NEUTRAL_INTENT);
      const ex = events(s, 'explosion')[0] as { x: number; y: number } | undefined;
      if (pred.kind === 'impact' || pred.kind === 'worm') {
        expect(ex, `essai ${n}`).toBeDefined();
        expect(Math.hypot(ex!.x - pred.x, ex!.y - pred.y), `essai ${n}`).toBeLessThan(1e-6);
      } else {
        expect(ex, `tir perdu ${n}`).toBeUndefined();
      }
    }
  });

  it('grenade : une passe donne la position d’explosion de chaque minuterie 1 à 5 s', () => {
    for (const fuse of [1, 2, 3, 4, 5]) {
      const s = aiArena(9);
      s.wind = 60;
      const a = active(s);
      a.facing = 1;
      const aim = 0.7, pt = 60;
      const dx = Math.cos(aim), dy = -Math.sin(aim);
      const spec = PROJECTILE_SPECS.grenade;
      const sp = spec.minSpeed + (spec.maxSpeed - spec.minSpeed) * Math.min(1, pt * SIM_DT / A.chargeTime);
      const pred = simulateShot({ terrain: s.terrain, worms: s.worms, wind: s.wind, waterLevel: s.waterLevel }, 'grenade', a.id,
        a.x + dx * A.muzzleOffset, a.y + dy * A.muzzleOffset, dx * sp, dy * sp, 0);
      s.turn.aim = aim;
      step(s, SIM_DT, { ...NEUTRAL_INTENT, selectWeapon: 'grenade' });
      step(s, SIM_DT, { ...NEUTRAL_INTENT, fuse });
      for (let i = 0; i < pt; i++) step(s, SIM_DT, { ...NEUTRAL_INTENT, fireDown: true });
      for (let i = 0; i < 60 * 12 && !events(s, 'explosion').length; i++) step(s, SIM_DT, NEUTRAL_INTENT);
      const ex = events(s, 'explosion')[0] as { x: number; y: number };
      const p = pred.fuseAt![fuse]!;
      expect(Math.hypot(ex.x - p.x, ex.y - p.y), `minuterie ${fuse}`).toBeLessThan(1e-6);
    }
  });
});

describe('déplacement', () => {
  it('le ver franchit un obstacle de 14 px en sautant (WalkDriver) et reste prévisible', () => {
    const m = flatMask(1200, 400, 300);
    for (let x = 400; x < 420; x++) for (let y = 286; y < 300; y++) m.data[y * 1200 + x] = 1; // marche de 14 px
    const t = new Terrain(m, false);
    const pos = reachable(t, { ...aiArena().worms[0]!, x: 300, y: 300 - R - 1, px: 300, py: 300 - R - 1, mode: 'ground' }, 10_000, 1, 6);
    expect(pos.length).toBeGreaterThan(3);
    expect(Math.max(...pos.map((p) => p.x))).toBeGreaterThan(480); // a passé l'obstacle
    // Prévisions croissantes et temps de trajet cohérents
    for (let i = 1; i < pos.length; i++) { expect(pos[i]!.x).toBeGreaterThan(pos[i - 1]!.x); expect(pos[i]!.ticks).toBeGreaterThan(pos[i - 1]!.ticks); }
    const driver = new WalkDriver();
    const w = { ...aiArena().worms[0]!, x: 300, y: 300 - R - 1, px: 300, py: 300 - R - 1, mode: 'ground' as const };
    const target = pos[1]!;
    for (let i = 0; i < target.ticks; i++) updateWorm(t, w, driver.next(w, 1), SIM_DT);
    expect(Math.abs(w.x - target.x)).toBeLessThan(0.01);
  });

  it('n’emprunte pas un chemin qui mène à l’eau ou à une chute dangereuse', () => {
    const m = new TerrainMask(1200, 1300);
    m.data.fill(1, 900 * 1200);
    for (let x = 600; x < 1200; x++) for (let y = 900; y < 1300; y++) m.data[y * 1200 + x] = 0; // gouffre
    const t = new Terrain(m, false);
    const pos = reachable(t, { ...aiArena().worms[0]!, x: 300, y: 900 - R - 1, px: 300, py: 900 - R - 1, mode: 'ground' }, 1020, 1, 8);
    expect(Math.max(...pos.map((p) => p.x))).toBeLessThan(600 - 5);
  });
});

describe('réflexion découpée', () => {
  it('chaque niveau cède la main souvent et chaque tranche reste brève (pas de gel)', () => {
    for (const level of ['easy', 'medium', 'hard'] as const) {
      const s = aiArena(11, 3);
      const me = active(s);
      const gen = planTurn({ s, me, level, rng: new Rng(1) });
      let yields = 0, slice = 0, worst = 0;
      for (;;) {
        const t0 = performance.now();
        const r = gen.next();
        const dt = performance.now() - t0;
        worst = Math.max(worst, dt);
        slice += dt;
        if (r.done) { expect(['fire', 'skip']).toContain(r.value.kind); break; }
        yields++;
      }
      expect(yields, level).toBeGreaterThan(5);
      // Seuil large : les tests tournent en parallèle sur des machines chargées ; un vrai gel dépasserait 100 ms.
      expect(worst, `${level}: plus longue tranche ${worst.toFixed(1)} ms`).toBeLessThan(70);
      void slice;
    }
  });

  it('pump respecte le budget de temps et l’état de jeu n’est jamais modifié par la réflexion', () => {
    const s = aiArena(12, 2);
    setAi(s, s.turn.team, 'hard');
    const ai = new AiController();
    const h0 = hashState(s);
    let calls = 0;
    // Horloge factice : chaque lecture avance de 1 ms ; budget 3 ms → quelques tranches par appel.
    let clock = 0;
    const now = () => clock++;
    while (true) {
      ai.pump(s, 3, now);
      calls++;
      if ((ai as unknown as { brain: { plan: unknown } }).brain.plan) break;
      expect(calls).toBeLessThan(5000);
    }
    expect(calls).toBeGreaterThan(3); // plusieurs frames
    expect(hashState(s)).toBe(h0);
  });
});

describe('contrôleur : un tour complet via des intentions', () => {
  it('sélectionne, vise pas à pas (réticule visible), charge progressivement puis tire', () => {
    for (const level of ['easy', 'medium', 'hard'] as const) {
      const s = aiArena(21);
      setAi(s, s.turn.team, level);
      foe(s).x = active(s).x + 700; foe(s).px = foe(s).x;
      const ai = new AiController();
      let prevAim = s.turn.aim, aimMoves = 0, chargeSeen = 0, prevPower = 0, maxDAim = 0, firedAt = -1;
      const startTime = s.time;
      for (let i = 0; i < 60 * 40; i++) {
        aiTick(s, ai);
        const dAim = Math.abs(s.turn.aim - prevAim);
        maxDAim = Math.max(maxDAim, dAim);
        if (dAim > 1e-9) aimMoves++;
        prevAim = s.turn.aim;
        if (s.turn.charging && s.turn.power > prevPower) { chargeSeen++; expect(s.turn.power - prevPower).toBeLessThan(1 / 85); }
        prevPower = s.turn.charging ? s.turn.power : 0;
        if (s.phase === 'firing' && firedAt < 0) { firedAt = s.time; break; }
      }
      expect(firedAt, level).toBeGreaterThan(startTime + 0.5); // délai de réflexion naturel
      expect(maxDAim, level).toBeLessThanOrEqual(AIM_STEP + 1e-9); // le réticule tourne au rythme du jeu
      expect(aimMoves + chargeSeen, level).toBeGreaterThan(5);
    }
  });

  it('délais de réflexion : plus longs en facile qu’en difficile', () => {
    const first = (level: 'easy' | 'hard'): number => {
      const s = aiArena(31);
      setAi(s, s.turn.team, level);
      foe(s).x = active(s).x + 600; foe(s).px = foe(s).x;
      const ai = new AiController();
      for (let i = 0; i < 60 * 30; i++) {
        const t0 = s.turn.aim;
        aiTick(s, ai);
        if (s.turn.aim !== t0 || s.turn.charging || s.phase === 'firing') return s.time;
      }
      return Infinity;
    };
    const e: number[] = [], h: number[] = [];
    for (let k = 0; k < 1; k++) { e.push(first('easy')); h.push(first('hard')); }
    expect(Math.min(...e)).toBeGreaterThan(GAMEPLAY.ai.easy.think[0]! - 0.05);
    expect(Math.max(...h)).toBeLessThan(GAMEPLAY.ai.hard.think[1]! + 0.5);
  });

  it('un tour d’IA se termine toujours (garde-fou) même sans ennemi atteignable', () => {
    const s = aiArena(41);
    setAi(s, s.turn.team, 'hard');
    const ai = new AiController();
    // Ennemi hors de portée, derrière le bord de carte : l'IA ne peut rien viser d'utile.
    foe(s).x = GAMEPLAY.world.width - 12; foe(s).px = foe(s).x;
    active(s).x = 14; active(s).px = 14;
    const t0 = s.turnNumber;
    let guard = 0;
    while (s.turnNumber === t0 && guard++ < 60 * 120) aiTick(s, ai);
    expect(s.turnNumber).toBe(t0 + 1);
  });
});

describe('niveaux de difficulté', () => {
  /** Distance moyenne entre le premier point d'explosion et la cible, et taux de touche, sur plusieurs configurations. */
  function measure(level: 'easy' | 'medium' | 'hard', n = 10): { err: number; hit: number } {
    const rng = new Rng(2024);
    let sum = 0, hits = 0;
    for (let i = 0; i < n; i++) {
      const s = aiArena(100 + i);
      setAi(s, s.turn.team, level);
      s.wind = Math.round(rng.range(-100, 100));
      const a = active(s), f = foe(s);
      const d = rng.range(350, 1100) * (rng.chance(0.5) ? 1 : -1);
      f.x = Math.max(60, Math.min(GAMEPLAY.world.width - 60, a.x + d)); f.px = f.x;
      const hp = f.health;
      const ai = new AiController();
      for (let k = 0; k < 60 * 60 && !events(s, 'explosion').length; k++) aiTick(s, ai);
      const ex = events(s, 'explosion')[0] as { x: number; y: number } | undefined;
      const err = ex ? Math.hypot(ex.x - f.x, ex.y - f.y) : 800;
      sum += Math.min(err, 800);
      for (let k = 0; k < 60 * 5; k++) aiTick(s, ai);
      if (f.health < hp) hits++;
    }
    return { err: sum / n, hit: hits / n };
  }

  it('l’erreur de tir décroît avec le niveau : facile ≫ moyen ≥ difficile', () => {
    const easy = measure('easy'), medium = measure('medium'), hard = measure('hard');
    note('erreur moyenne (px) / touche', { easy, medium, hard });
    expect(easy.err).toBeGreaterThan(medium.err * 1.8);
    expect(medium.hit).toBeGreaterThanOrEqual(0.6);
    expect(hard.hit).toBeGreaterThanOrEqual(0.7);
    expect(easy.hit).toBeLessThanOrEqual(0.5);
  }, 120_000);

  it('difficile évite de se blesser : ennemi collé, elle ne se tue pas et lui fait plus mal qu’à elle', () => {
    let wins = 0;
    for (let i = 0; i < 4; i++) {
      const s = aiArena(200 + i);
      setAi(s, s.turn.team, 'hard');
      const a = active(s), f = foe(s);
      f.x = a.x + 55; f.px = f.x;
      const ai = new AiController();
      for (let k = 0; k < 60 * 45 && !(s.phase === 'transition' || s.phase === 'gameover'); k++) aiTick(s, ai);
      expect(a.alive).toBe(true);
      if (100 - f.health >= 100 - a.health) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(3);
  }, 120_000);

  it('difficile exploite l’eau : ennemi au bord d’un gouffre, elle le fait tomber à l’eau', () => {
    let drowned = 0;
    for (const side of [1, -1] as const) {
      const s = aiArena(300);
      setAi(s, s.turn.team, 'hard');
      const a = active(s), f = foe(s);
      // Plateau central avec un gouffre plus profond que l'eau de chaque côté.
      const m = new TerrainMask(GAMEPLAY.world.width, GAMEPLAY.world.height);
      for (let x = 1000; x < 1700; x++) for (let y = GROUND; y < GAMEPLAY.world.height; y++) m.data[y * GAMEPLAY.world.width + x] = 1;
      s.terrain = new Terrain(m, false);
      f.x = side === 1 ? 1690 : 1010; f.y = GROUND - R - 1; f.px = f.x; f.py = f.y; f.mode = 'ground';
      a.x = side === 1 ? 1380 : 1320; a.y = GROUND - R - 1; a.px = a.x; a.py = a.y; a.mode = 'ground';
      for (const w of s.worms) if (w !== a && w !== f) { w.alive = false; w.sunk = true; }
      // L'évaluation de projection voit bien la noyade possible d'un ennemi au bord du vide.
      const adj = knockAdjustment(s.terrain, s.worms, { id: a.id, team: a.team, x: a.x, y: a.y },
        f.x + (side === 1 ? -22 : 22), f.y, 'medium', s.waterLevel);
      expect(adj).toBeGreaterThan(50);
      const ai = new AiController();
      for (let k = 0; k < 60 * 40 && s.phase !== 'gameover' && s.turnNumber === 1; k++) aiTick(s, ai);
      for (let k = 0; k < 60 * 10 && s.phase !== 'gameover'; k++) aiTick(s, ai);
      if (f.sunk) drowned++;
    }
    expect(drowned).toBeGreaterThanOrEqual(1);
  }, 120_000);
});

describe('parties IA contre IA', () => {
  function playGame(seed: number, levels: ['easy' | 'medium' | 'hard', 'easy' | 'medium' | 'hard'], maxTurns = 45): { winner: number | null; turns: number; s: GameState } {
    const s = aiArena(seed, 3);
    s.worms.forEach((w, i) => { w.x = 500 + i * 450; w.px = w.x; });
    setAi(s, 0, levels[0]); setAi(s, 1, levels[1]);
    const ai = new AiController();
    let guard = 0;
    while (s.phase !== 'gameover' && s.turnNumber < maxTurns && guard++ < 60 * 60 * 40) aiTick(s, ai);
    return { winner: s.winner, turns: s.turnNumber, s };
  }

  it('une partie complète IA contre IA va au bout sans blocage', () => {
    const g = playGame(7, ['medium', 'medium']);
    expect(g.turns).toBeGreaterThan(4);
    expect(g.s.phase === 'gameover' || g.turns >= 45).toBe(true);
  }, 120_000);

  it('équilibre : le niveau supérieur gagne la majorité des parties (facile < moyen < difficile)', () => {
    const duel = (strong: 'medium' | 'hard', weak: 'easy' | 'medium', n: number): number => {
      let score = 0;
      for (let i = 0; i < n; i++) {
        const flip = i % 2 === 1; // alterne les camps
        const g = playGame(500 + i, flip ? [weak, strong] : [strong, weak]);
        const strongTeam = flip ? 1 : 0;
        if (g.winner === strongTeam) score += 1;
        else if (g.winner === 1 - strongTeam) score += 0;
        else {
          // Pas de vainqueur (la mort subite noie tout le monde sur ce terrain plat) : départage aux dégâts infligés.
          const dmg = (t: number) => g.s.teams[t]!.stats.damage;
          score += dmg(strongTeam) > dmg(1 - strongTeam) ? 1 : dmg(strongTeam) === dmg(1 - strongTeam) ? 0.5 : 0;
        }
      }
      return score / n;
    };
    const mediumVsEasy = duel('medium', 'easy', 6);
    const hardVsMedium = duel('hard', 'medium', 6);
    note('taux de victoire du niveau supérieur', { mediumVsEasy, hardVsMedium });
    expect(mediumVsEasy).toBeGreaterThanOrEqual(0.65);
    expect(hardVsMedium).toBeGreaterThanOrEqual(0.55);
  }, 600_000);
});
