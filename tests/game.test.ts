import { describe, expect, it } from 'vitest';
import { SIM_DT } from '@/config/engine';
import { GAMEPLAY } from '@/config/gameplay';
import { Camera } from '@/core/camera';
import { NEUTRAL_INTENT, type Intent } from '@/core/intent';
import { step } from '@/core/simulation';
import { createState, hashState, type GameState } from '@/core/state';

const T = GAMEPLAY.turn;
const skip: Intent = { ...NEUTRAL_INTENT, skipTurn: true };

function run(s: GameState, steps: number, intent: Intent = NEUTRAL_INTENT): void {
  for (let i = 0; i < steps; i++) step(s, SIM_DT, intent);
}
function runUntil(s: GameState, pred: () => boolean, maxSec = 120): number {
  let n = 0;
  while (!pred() && n < maxSec * 60) { step(s, SIM_DT, NEUTRAL_INTENT); n++; }
  return n;
}
function toFirstTurn(seed = 7): GameState {
  const s = createState({ seed, withCanvas: false });
  runUntil(s, () => s.phase === 'turn');
  return s;
}
/** Termine le tour courant et attend le suivant. */
function nextTurn(s: GameState): void {
  const n = s.turnNumber;
  step(s, SIM_DT, skip);
  runUntil(s, () => s.turnNumber > n || s.phase === 'gameover');
}

describe('machine à états', () => {
  it('deux équipes de 3 vers ; placement puis premier tour', () => {
    const s = createState({ seed: 7, withCanvas: false });
    expect(s.teams.length).toBe(2);
    expect(s.teams.every((t) => t.wormIds.length === 3)).toBe(true);
    expect(s.phase).toBe('placing');
    runUntil(s, () => s.phase === 'turn');
    expect(s.phase).toBe('turn');
    expect(s.worms.every((w) => w.mode === 'ground')).toBe(true);
    expect(s.turn.timeLeft).toBe(T.duration);
    expect(s.turnNumber).toBe(1);
  });

  it('le chronomètre décroît et le tour se termine à zéro', () => {
    const s = toFirstTurn();
    run(s, 60 * 10);
    expect(s.turn.timeLeft).toBeCloseTo(T.duration - 10, 1);
    run(s, Math.ceil(60 * (T.duration - 10)) + 1);
    expect(s.phase).not.toBe('turn');
    expect(['resolving', 'transition']).toContain(s.phase);
  });

  it('rotation : équipes en alternance, chaque ver de l’équipe joue à son tour', () => {
    const s = toFirstTurn();
    const seq: { team: number; worm: number }[] = [{ team: s.turn.team, worm: s.turn.worm }];
    for (let i = 0; i < 5; i++) { nextTurn(s); seq.push({ team: s.turn.team, worm: s.turn.worm }); }
    for (let i = 1; i < seq.length; i++) expect(seq[i]!.team).not.toBe(seq[i - 1]!.team);
    for (const team of [0, 1]) {
      const mine = seq.filter((x) => x.team === team).map((x) => x.worm);
      expect(new Set(mine).size).toBe(3); // 3 tours, 3 vers différents
    }
    // Le cycle recommence dans le même ordre au 4e tour de l'équipe.
    nextTurn(s);
    expect(s.turn.team).toBe(seq[0]!.team);
    expect(s.turn.worm).toBe(seq[0]!.worm);
  });

  it('le vent change à chaque tour, borné par la config', () => {
    const s = toFirstTurn();
    const winds = [s.wind];
    for (let i = 0; i < 7; i++) { nextTurn(s); winds.push(s.wind); }
    for (const w of winds) expect(Math.abs(w)).toBeLessThanOrEqual(GAMEPLAY.wind.max);
    expect(new Set(winds).size).toBeGreaterThan(4);
    expect(winds.some((w) => w > 0) && winds.some((w) => w < 0)).toBe(true);
  });

  it('la résolution attend que tout soit immobile (ver projeté en l’air)', () => {
    const s = toFirstTurn();
    step(s, SIM_DT, skip);
    expect(s.phase).toBe('resolving');
    const victim = s.worms[(s.turn.worm + 1) % s.worms.length]!;
    victim.mode = 'air'; victim.vy = -700; victim.vx = 150; victim.knocked = true;
    let sawAir = false;
    while (s.phase === 'resolving') {
      if (victim.mode === 'air') sawAir = true;
      step(s, SIM_DT, NEUTRAL_INTENT);
    }
    expect(sawAir).toBe(true);
    expect(victim.mode).toBe('ground');
    expect(s.phase).toBe('transition');
    expect(s.phaseTime).toBe(0);
  });

  it('garde-fou : une résolution qui ne s’arrête jamais est forcée après le délai max', () => {
    const s = toFirstTurn();
    step(s, SIM_DT, skip);
    const w = s.worms[0]!;
    let ticks = 0;
    while (s.phase === 'resolving' && ticks < 60 * 40) {
      w.mode = 'air'; w.vy = -50; w.knocked = true; // instabilité perpétuelle
      step(s, SIM_DT, NEUTRAL_INTENT);
      ticks++;
    }
    expect(s.phase).toBe('transition');
    expect(ticks / 60).toBeGreaterThanOrEqual(T.resolveTimeout - 0.1);
    expect(ticks / 60).toBeLessThan(T.resolveTimeout + 1);
  });

  it('transition puis nouveau tour de l’autre équipe, minuteur remis', () => {
    const s = toFirstTurn();
    const team0 = s.turn.team;
    step(s, SIM_DT, skip);
    runUntil(s, () => s.phase === 'transition');
    runUntil(s, () => s.phase === 'turn');
    expect(s.turn.team).not.toBe(team0);
    expect(s.turn.timeLeft).toBe(T.duration);
  });

  it('un ver actif mort termine le tour ; les morts sont sautés dans la rotation', () => {
    const s = toFirstTurn();
    const t0 = s.turn.team;
    const deadId = s.teams[t0]!.wormIds[1]!; // son prochain ver
    s.worms[deadId]!.alive = false;
    s.worms[s.turn.worm]!.alive = false; // le ver actif meurt
    run(s, 2);
    expect(s.phase).toBe('resolving');
    runUntil(s, () => s.phase === 'turn' && s.turn.team === t0 && s.turnNumber > 1);
    const remaining = s.teams[t0]!.wormIds.filter((id) => s.worms[id]!.alive);
    expect(remaining.length).toBe(1);
    expect(s.turn.worm).toBe(remaining[0]);
  });

  it('fin de partie : victoire quand une seule équipe survit, égalité si plus personne', () => {
    const s = toFirstTurn();
    for (const id of s.teams[1]!.wormIds) s.worms[id]!.alive = false;
    step(s, SIM_DT, skip);
    runUntil(s, () => s.phase === 'gameover');
    expect(s.phase).toBe('gameover');
    expect(s.winner).toBe(0);

    const d = toFirstTurn(11);
    for (const w of d.worms) w.alive = false;
    run(d, 2);
    runUntil(d, () => d.phase === 'gameover');
    expect(d.winner).toBe(-1);
  });

  it('seul le ver actif répond au joueur', () => {
    const s = toFirstTurn();
    const act = s.worms[s.turn.worm]!;
    const others = s.worms.filter((w) => w !== act).map((w) => w.x);
    const x0 = act.x;
    run(s, 60, { ...NEUTRAL_INTENT, moveX: 1 });
    expect(act.x).toBeGreaterThan(x0 + 30);
    expect(s.worms.filter((w) => w !== act).map((w) => w.x)).toEqual(others);
    // Pendant la résolution/transition, plus de contrôle.
    step(s, SIM_DT, skip);
    const x1 = act.x;
    run(s, 30, { ...NEUTRAL_INTENT, moveX: 1 });
    expect(act.x).toBe(x1);
  });

  it('déterminisme : même graine + mêmes intents = même état', () => {
    const play = (): string => {
      const s = toFirstTurn(42);
      for (let i = 0; i < 4; i++) { run(s, 50, { ...NEUTRAL_INTENT, moveX: i % 2 ? 1 : -1 }); nextTurn(s); }
      return hashState(s);
    };
    expect(play()).toBe(play());
  });
});

describe('caméra', () => {
  const VW = 1280, VH = 720;
  const { width: WW, height: WH } = GAMEPLAY.world;

  it('reste dans les limites de la carte, quelle que soit la cible', () => {
    const c = new Camera();
    for (const [tx, ty] of [[-5000, -5000], [1e5, 1e5], [0, WH], [WW, 0]] as const) {
      for (let i = 0; i < 120; i++) c.update(1 / 60, tx, ty, VW, VH);
      const v = c.visibleRect(VW, VH);
      expect(v.x).toBeGreaterThanOrEqual(-0.01);
      expect(v.y).toBeGreaterThanOrEqual(-0.01);
      expect(v.x + v.w).toBeLessThanOrEqual(WW + 0.01);
      expect(v.y + v.h).toBeLessThanOrEqual(WH + 0.01);
    }
  });

  it('suivi lisse : jamais de saut supérieur au déplacement de la cible', () => {
    const c = new Camera();
    c.update(1 / 60, 500, 500, VW, VH);
    let prev = c.x, prevStep = Infinity;
    for (let i = 0; i < 240; i++) {
      c.update(1 / 60, 2500, 500, VW, VH);
      const stepPx = Math.abs(c.x - prev);
      expect(stepPx).toBeLessThanOrEqual(prevStep + 1e-9); // décélération monotone : pas d'à-coup
      expect(stepPx).toBeLessThan(2000 * 0.1); // jamais plus de 10 % de la distance par frame
      prevStep = stepPx;
      prev = c.x;
    }
    expect(Math.abs(c.x - 2500)).toBeLessThan(5);
  });

  it('zoom borné (min = carte entière dans la vue, max = config) et ancré sur le curseur', () => {
    const c = new Camera();
    c.update(1 / 60, 2000, 600, VW, VH);
    for (let i = 0; i < 50; i++) c.zoomBy(1.5, 400, 300, VW, VH, true);
    expect(c.zoom).toBeLessThanOrEqual(GAMEPLAY.camera.maxZoom + 1e-9);
    for (let i = 0; i < 80; i++) c.zoomBy(1 / 1.5, 400, 300, VW, VH, true);
    expect(c.zoom).toBeGreaterThanOrEqual(c.minZoom(VW, VH) - 1e-9);
    const v = c.visibleRect(VW, VH);
    expect(v.w).toBeLessThanOrEqual(WW + 0.01);
    expect(v.h).toBeLessThanOrEqual(WH + 0.01);

    const d = new Camera();
    d.update(1 / 60, 2000, 600, VW, VH);
    const before = d.screenToWorld(900, 200, VW, VH);
    d.zoomBy(1.3, 900, 200, VW, VH, true);
    const after = d.screenToWorld(900, 200, VW, VH);
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
  });

  it('glisser coupe le suivi automatique jusqu’à resume()', () => {
    const c = new Camera();
    c.update(1 / 60, 1000, 600, VW, VH);
    c.panBy(300, 0, VW, VH);
    const x = c.x;
    for (let i = 0; i < 30; i++) c.update(1 / 60, 3000, 600, VW, VH);
    expect(c.x).toBeCloseTo(x, 3);
    c.resume();
    for (let i = 0; i < 30; i++) c.update(1 / 60, 3000, 600, VW, VH);
    expect(c.x).toBeGreaterThan(x + 100);
  });
});
