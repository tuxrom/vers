import { describe, expect, it } from 'vitest';
import { SIM_DT } from '@/config/engine';
import { GAMEPLAY } from '@/config/gameplay';
import { startTurn } from '@/core/game';
import { NEUTRAL_INTENT, type Intent } from '@/core/intent';
import { step } from '@/core/simulation';
import { createState, hashState, type GameState } from '@/core/state';
import { maybeSpawnCrate, updateCrates, type Crate } from '@/entities/crate';
import { fallDamage } from '@/entities/worm';
import { Terrain } from '@/terrain/terrain';
import { damageWorm, explode } from '@/weapons/explosion';
import { ammoOf } from '@/weapons/system';
import { flatMask } from './helpers';

const R = GAMEPLAY.worm.radius;
const GROUND = 900;
const WATER = GAMEPLAY.water;
const fire = (down = true): Intent => ({ ...NEUTRAL_INTENT, fireDown: down });

function arena(seed = 5): GameState {
  const s = createState({ seed, withCanvas: false });
  s.terrain = new Terrain(flatMask(GAMEPLAY.world.width, GAMEPLAY.world.height, GROUND), false);
  s.worms.forEach((w, i) => { w.x = 600 + i * 500; w.y = GROUND - R - 1; w.px = w.x; w.py = w.y; w.mode = 'ground'; });
  startTurn(s);
  s.worms[s.turn.worm]!.facing = 1;
  s.wind = 0;
  s.crates.length = 0;
  return s;
}
const active = (s: GameState) => s.worms[s.turn.worm]!;
const enemy = (s: GameState) => s.worms.find((w) => w.team !== active(s).team && w.alive)!;
function run(s: GameState, n: number, intent: Intent = NEUTRAL_INTENT): void { for (let i = 0; i < n; i++) step(s, SIM_DT, intent); }
function untilTurn(s: GameState, n: number): void {
  let g = 0;
  while ((s.turnNumber < n || s.phase !== 'turn') && s.phase !== 'gameover' && g++ < 60 * 120) step(s, SIM_DT, NEUTRAL_INTENT);
}
const events = (s: GameState, t: string) => s.events.filter((e) => e.t === t);

describe('dégâts de chute', () => {
  it('proportionnels à la hauteur au-delà du seuil, plafonnés', () => {
    for (const h of [60, 100, 160, 220, 330, 900]) {
      const s = arena();
      const w = enemy(s);
      w.y = GROUND - R - 1 - h; w.py = w.y; w.mode = 'air'; w.vy = 0; w.peakY = w.y;
      run(s, 60 * 6);
      expect(w.mode).toBe('ground');
      const expected = fallDamage(h);
      expect(100 - w.health, `chute ${h}`).toBeGreaterThanOrEqual(Math.max(0, expected - 2));
      expect(100 - w.health, `chute ${h}`).toBeLessThanOrEqual(expected + 2);
    }
    expect(fallDamage(GAMEPLAY.worm.fallDamageThreshold)).toBe(0);
    expect(fallDamage(400)).toBeGreaterThan(fallDamage(200));
    expect(fallDamage(1e5)).toBe(GAMEPLAY.worm.fallDamageMax);
  });

  it('une chute mortelle tue (sans crédit de kill) et affiche les dégâts', () => {
    const s = arena();
    const w = enemy(s);
    w.health = 5;
    w.y -= 300; w.py = w.y; w.mode = 'air'; w.peakY = w.y;
    run(s, 60 * 5);
    expect(w.alive).toBe(false);
    expect(events(s, 'death').length).toBe(1);
    expect(events(s, 'damage').length).toBeGreaterThan(0);
    expect(s.teams.every((t) => t.stats.kills === 0)).toBe(true);
  });
});

describe('mort et statistiques', () => {
  it('la tombe reste (animation par deathAge), le ver n’est plus ciblé', () => {
    const s = arena();
    const v = enemy(s);
    damageWorm(s, v.id, 999, active(s).id);
    expect(v.alive).toBe(false);
    run(s, 60);
    expect(v.deathAge).toBeGreaterThan(0.9);
    const x = v.x;
    explode(s, v.x, v.y, 'large');
    expect(v.health).toBe(0);
    expect(v.sunk).toBe(false);
    expect(Math.abs(v.x - x)).toBeLessThan(1); // une tombe n'est pas projetée
  });

  it('dégâts et kills crédités à l’équipe adverse seulement', () => {
    const s = arena();
    const a = active(s), v = enemy(s);
    damageWorm(s, v.id, 30, a.id);
    expect(s.teams[a.team]!.stats.damage).toBe(30);
    damageWorm(s, v.id, 999, a.id);
    expect(s.teams[a.team]!.stats.damage).toBe(100); // plafonné aux PV restants
    expect(s.teams[a.team]!.stats.kills).toBe(1);
    const mate = s.worms.find((w) => w.team === a.team && w !== a)!;
    damageWorm(s, mate.id, 40, a.id); // tir ami : non compté
    damageWorm(s, a.id, 10, a.id); // auto-dégâts : non comptés
    expect(s.teams[a.team]!.stats.damage).toBe(100);
    expect(s.teams[a.team]!.stats.kills).toBe(1);
  });

  it('tirs et tirs ratés : un tour sans dégât ennemi compte comme raté', () => {
    const s = arena();
    const a = active(s), v = enemy(s);
    // Tour 1 : roquette en plein sur un ennemi.
    v.x = a.x + 90; v.y = GROUND - R - 1;
    s.turn.aim = 0;
    run(s, 100, fire());
    const t1 = a.team;
    untilTurn(s, 2);
    expect(s.teams[t1]!.stats.shots).toBe(1);
    expect(s.teams[t1]!.stats.misses).toBe(0);
    expect(s.teams[t1]!.stats.damage).toBeGreaterThan(0);

    // Tour 2 (autre équipe) : tir vers le ciel, aucun ennemi touché.
    const b = active(s);
    expect(b.team).not.toBe(t1);
    for (const w of s.worms) if (w.team !== b.team) { w.x = b.x + 1500; w.y = GROUND - R - 1; }
    b.facing = -1;
    s.turn.aim = 1.45;
    run(s, 100, fire());
    untilTurn(s, 3);
    expect(s.teams[b.team]!.stats.shots).toBe(1);
    expect(s.teams[b.team]!.stats.misses).toBe(1);
  });
});

describe('eau', () => {
  it('monte d’un cran au tour de mort subite puis à intervalle régulier', () => {
    const s = arena();
    const levels: number[] = [];
    levels[s.turnNumber] = s.waterLevel;
    while (s.turnNumber < WATER.suddenDeathTurn + WATER.riseEveryTurns * 2 + 1 && s.phase !== 'gameover') {
      const n = s.turnNumber;
      step(s, SIM_DT, { ...NEUTRAL_INTENT, skipTurn: true });
      untilTurn(s, n + 1);
      levels[s.turnNumber] = s.waterLevel;
    }
    const start = WATER.startLevel;
    for (let t = 1; t < WATER.suddenDeathTurn; t++) expect(levels[t], `tour ${t}`).toBe(start);
    expect(levels[WATER.suddenDeathTurn]).toBe(start - WATER.riseAmount);
    expect(levels[WATER.suddenDeathTurn + 1]).toBe(start - WATER.riseAmount);
    expect(levels[WATER.suddenDeathTurn + WATER.riseEveryTurns]).toBe(start - 2 * WATER.riseAmount);
    expect(s.events.some((e) => e.t === 'water')).toBe(true);
  });

  it('un ver qui touche l’eau est éliminé avec éclaboussure, sans crédit de kill', () => {
    const s = arena();
    const v = enemy(s);
    // Fosse plus profonde que le niveau de l'eau sous le ver.
    s.terrain.carveCircle(v.x, GROUND + 100, 160);
    const x = v.x;
    run(s, 60 * 4);
    expect(v.sunk).toBe(true);
    expect(v.alive).toBe(false);
    expect(v.health).toBe(0);
    expect(events(s, 'splash').length).toBeGreaterThan(0);
    const d = events(s, 'death')[0] as { drowned?: boolean };
    expect(d.drowned).toBe(true);
    expect(s.teams.every((t) => t.stats.kills === 0)).toBe(true);
    const y = v.y;
    run(s, 60);
    expect(v.y).toBe(y); // retiré de la physique
    expect(Math.abs(v.x - x)).toBeLessThan(200);
  });

  it('la montée de l’eau noie les vers qu’elle atteint et ne bloque pas la partie', () => {
    const s = arena();
    s.waterLevel = GROUND - R - 1 - 5; // juste au-dessus des vers
    run(s, 2);
    expect(s.worms.every((w) => w.sunk && !w.alive)).toBe(true);
    untilTurn(s, 99);
    expect(s.phase).toBe('gameover');
    expect(s.winner).toBe(-1);
  });
});

describe('caisses', () => {
  function crate(s: GameState, kind: Crate['kind'], x: number, y: number, weapon: Crate['weapon'] = null): Crate {
    const c: Crate = { id: s.nextId++, kind, weapon, amount: kind === 'health' ? GAMEPLAY.crate.healthRestore : GAMEPLAY.crate.ammoBonus, x, y, px: x, py: y, landed: false, dead: false };
    s.crates.push(c);
    return c;
  }

  it('tombent en parachute à vitesse constante et se posent', () => {
    const s = arena();
    const c = crate(s, 'health', 3000, 100);
    updateCrates(s, 1);
    expect(c.y).toBeCloseTo(100 + GAMEPLAY.crate.fallSpeed, 5);
    let t = 0;
    while (!c.landed && t++ < 60 * 30) updateCrates(s, SIM_DT);
    expect(c.landed).toBe(true);
    expect(c.y + GAMEPLAY.crate.halfSize).toBeLessThanOrEqual(GROUND + 1);
    expect(c.y + GAMEPLAY.crate.halfSize).toBeGreaterThan(GROUND - 3);
  });

  it('un ver qui la touche la ramasse : soins plafonnés, munitions de son équipe', () => {
    const s = arena();
    const w = active(s);
    w.health = 60;
    crate(s, 'health', w.x, w.y);
    updateCrates(s, SIM_DT);
    expect(w.health).toBe(85);
    expect(s.crates.length).toBe(0);
    expect(events(s, 'pickup').length).toBe(1);

    crate(s, 'health', w.x, w.y);
    updateCrates(s, SIM_DT);
    expect(w.health).toBe(100); // plafond de PV

    const before = ammoOf(s, w.team, 'dynamite');
    const otherTeam = s.teams.find((t) => t.id !== w.team)!;
    const otherBefore = otherTeam.ammo.dynamite;
    crate(s, 'weapon', w.x, w.y, 'dynamite');
    updateCrates(s, SIM_DT);
    expect(ammoOf(s, w.team, 'dynamite')).toBe(before + GAMEPLAY.crate.ammoBonus);
    expect(otherTeam.ammo.dynamite).toBe(otherBefore);

    crate(s, 'tool', w.x, w.y, 'rope');
    const r0 = ammoOf(s, w.team, 'rope');
    updateCrates(s, SIM_DT);
    expect(ammoOf(s, w.team, 'rope')).toBe(r0 + GAMEPLAY.crate.ammoBonus);
  });

  it('une caisse tombée dans l’eau est perdue (éclaboussure) ; le sol creusé la refait tomber', () => {
    const s = arena();
    const c = crate(s, 'health', 3000, s.waterLevel - 6);
    c.landed = false;
    run(s, 30);
    expect(s.crates.includes(c)).toBe(false);
    expect(events(s, 'splash').length).toBeGreaterThan(0);

    const d = crate(s, 'weapon', 3200, GROUND - GAMEPLAY.crate.halfSize - 1, 'grenade');
    d.landed = true;
    s.terrain.carveCircle(3200, GROUND, 60);
    run(s, 10);
    expect(d.landed).toBe(false);
    expect(d.y).toBeGreaterThan(GROUND - GAMEPLAY.crate.halfSize);
  });

  it('largage aléatoire déterministe au début des tours, contenu valide', () => {
    const drops = (): string => {
      const s = arena(9);
      const seen: string[] = [];
      for (let i = 0; i < 40; i++) {
        maybeSpawnCrate(s);
      }
      for (const c of s.crates) seen.push(`${c.kind}:${c.weapon}:${Math.round(c.x)}`);
      return seen.join(',') + '|' + s.crates.length;
    };
    expect(drops()).toBe(drops());
    const s = arena(9);
    for (let i = 0; i < 60; i++) { maybeSpawnCrate(s); if (s.crates.length >= GAMEPLAY.crate.maxAlive) break; }
    expect(s.crates.length).toBeGreaterThan(0);
    expect(s.crates.length).toBeLessThanOrEqual(GAMEPLAY.crate.maxAlive);
    for (const c of s.crates) {
      expect(c.y).toBeLessThan(0);
      expect(['health', 'weapon', 'tool']).toContain(c.kind);
      if (c.kind === 'health') expect(c.weapon).toBeNull(); else expect(c.weapon).not.toBeNull();
    }
  });
});

describe('partie complète', () => {
  /** Joueur automatique de test : s'oriente vers l'ennemi le plus proche et tire au bazooka à pleine puissance. */
  function playGame(seed: number): GameState {
    const s = arena(seed);
    let lastTurn = -1, shooting = 0;
    for (let i = 0; i < 60 * 60 * 25 && s.phase !== 'gameover'; i++) {
      let intent = NEUTRAL_INTENT;
      if (s.phase === 'turn') {
        const a = active(s);
        if (s.turnNumber !== lastTurn) {
          lastTurn = s.turnNumber;
          const foes = s.worms.filter((w) => w.team !== a.team && w.alive && !w.sunk);
          const t = foes.sort((p, q) => Math.abs(p.x - a.x) - Math.abs(q.x - a.x))[0];
          if (t) a.facing = t.x >= a.x ? 1 : -1;
          // Angle balistique pour atteindre la cible à même hauteur (vitesse max, gravité de la config).
          const v = GAMEPLAY.weapons.bazooka.maxSpeed;
          const d = t ? Math.abs(t.x - a.x) : 0;
          s.turn.aim = 0.5 * Math.asin(Math.min(1, (GAMEPLAY.physics.gravity * d) / (v * v)));
          shooting = 100;
        }
        if (shooting > 0) { intent = fire(); shooting--; } else if (shooting === 0) { shooting = -1; intent = fire(false); }
      }
      step(s, SIM_DT, intent);
    }
    return s;
  }

  it('deux équipes de 3 vers jouent jusqu’à la victoire ; statistiques cohérentes', () => {
    const s = playGame(4);
    expect(s.phase).toBe('gameover');
    expect(s.turnNumber).toBeGreaterThan(5);
    const alive = s.teams.map((t) => t.wormIds.filter((id) => s.worms[id]!.alive).length);
    if (s.winner !== null && s.winner >= 0) {
      expect(alive[s.winner]).toBeGreaterThan(0);
      expect(alive.filter((n) => n > 0).length).toBe(1);
    } else {
      expect(alive.every((n) => n === 0)).toBe(true);
    }
    const dmg = s.teams.reduce((a, t) => a + t.stats.damage, 0);
    const kills = s.teams.reduce((a, t) => a + t.stats.kills, 0);
    const shots = s.teams.reduce((a, t) => a + t.stats.shots, 0);
    expect(dmg).toBeGreaterThan(0);
    expect(shots).toBeGreaterThan(0);
    expect(kills).toBeLessThanOrEqual(6);
    for (const t of s.teams) expect(t.stats.misses).toBeLessThanOrEqual(t.stats.shots);
  });

  it('la partie est entièrement déterministe', () => {
    const a = playGame(6), b = playGame(6);
    expect(hashState(a)).toBe(hashState(b));
    expect(a.turnNumber).toBe(b.turnNumber);
    expect(a.winner).toBe(b.winner);
  });

  it('l’eau monte pendant une longue partie (mort subite) et la partie finit quand même', () => {
    const s = arena(12);
    // Ennemis hors de portée : seule la mort subite peut décider de la partie.
    s.worms.forEach((w, i) => { w.x = 300 + i * 40; });
    let g = 0;
    while (s.phase !== 'gameover' && g++ < 60 * 60 * 40) {
      if (s.phase === 'turn') step(s, SIM_DT, { ...NEUTRAL_INTENT, skipTurn: true });
      else step(s, SIM_DT, NEUTRAL_INTENT);
    }
    expect(s.phase).toBe('gameover');
    expect(s.waterLevel).toBeLessThan(WATER.startLevel);
    expect(s.worms.every((w) => !w.alive)).toBe(true);
  });
});
