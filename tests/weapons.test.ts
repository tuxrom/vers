import { describe, expect, it } from 'vitest';
import { SIM_DT } from '@/config/engine';
import { GAMEPLAY } from '@/config/gameplay';
import { startTurn } from '@/core/game';
import { NEUTRAL_INTENT, type Intent } from '@/core/intent';
import { step } from '@/core/simulation';
import { createState, hashState, type GameState } from '@/core/state';
import { Terrain } from '@/terrain/terrain';
import { blastFalloff, explode } from '@/weapons/explosion';
import { ammoOf, canSelect } from '@/weapons/system';
import { flatMask } from './helpers';

const W = GAMEPLAY.weapons;
const R = GAMEPLAY.worm.radius;
const GROUND = 900;
const fire = (down = true): Intent => ({ ...NEUTRAL_INTENT, fireDown: down });

/** Arène plate : 6 vers alignés au sol, premier tour lancé, ver actif tourné vers la droite. */
function arena(seed = 5): GameState {
  const s = createState({ seed, withCanvas: false });
  s.terrain = new Terrain(flatMask(GAMEPLAY.world.width, GAMEPLAY.world.height, GROUND), false);
  s.worms.forEach((w, i) => { w.x = 600 + i * 400; w.y = GROUND - R - 1; w.px = w.x; w.py = w.y; w.mode = 'ground'; });
  startTurn(s);
  s.worms[s.turn.worm]!.facing = 1;
  s.wind = 0;
  return s;
}
const active = (s: GameState) => s.worms[s.turn.worm]!;
function run(s: GameState, steps: number, intent: Intent = NEUTRAL_INTENT): void {
  for (let i = 0; i < steps; i++) step(s, SIM_DT, intent);
}
function select(s: GameState, id: string): void { step(s, SIM_DT, { ...NEUTRAL_INTENT, selectWeapon: id }); }
const events = (s: GameState, t: string) => s.events.filter((e) => e.t === t);

describe('explosions', () => {
  it('dégâts et recul décroissent avec la distance, nuls au-delà de la portée', () => {
    const r = GAMEPLAY.explosion.presets.medium.radius;
    let prev = 2;
    for (let d = 0; d <= r * GAMEPLAY.explosion.falloffRange + 5; d += 5) {
      const f = blastFalloff(d, r);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
    expect(blastFalloff(0, r)).toBe(1);
    expect(blastFalloff(r * GAMEPLAY.explosion.falloffRange, r)).toBe(0);

    const s = arena();
    const cx = 2000, cy = GROUND - R - 1; // au niveau des vers
    const near = s.worms[1]!, mid = s.worms[2]!, far = s.worms[3]!;
    near.x = cx + 12; mid.x = cx + 40; far.x = cx + 400;
    for (const w of [near, mid, far]) { w.y = GROUND - R - 1; w.mode = 'ground'; }
    explode(s, cx, cy, 'medium');
    expect(100 - near.health).toBeGreaterThan(100 - mid.health);
    expect(100 - mid.health).toBeGreaterThan(0);
    expect(far.health).toBe(100);
    expect(far.mode).toBe('ground');
    expect(near.vx).toBeGreaterThan(mid.vx); // recul plus fort près du centre
    expect(mid.vx).toBeGreaterThan(0); // direction : à l'opposé du centre
    expect(near.mode).toBe('air');
    expect(near.vy).toBeLessThan(0); // projeté vers le haut
  });

  it('creuse un cratère de la taille du preset et émet un événement', () => {
    const s = arena();
    const before = s.terrain.mask.data.reduce((a, b) => a + b, 0);
    explode(s, 2000, GROUND, 'large');
    const cleared = before - s.terrain.mask.data.reduce((a, b) => a + b, 0);
    const r = GAMEPLAY.explosion.presets.large.radius;
    expect(cleared).toBeGreaterThan(Math.PI * r * r * 0.5 * 0.95); // demi-disque (sol à moitié)
    expect(s.terrain.isSolid(2000, GROUND + 10)).toBe(false);
    expect(events(s, 'explosion').length).toBe(1);
  });

  it('un ver sans PV meurt et sort de la rotation', () => {
    const s = arena();
    const v = s.worms[1]!;
    v.x = 2000; v.health = 5;
    explode(s, 2000 + 5, GROUND - 20, 'medium');
    expect(v.alive).toBe(false);
    expect(v.health).toBe(0);
    expect(events(s, 'death').length).toBe(1);
  });
});

describe('bazooka', () => {
  it('la puissance se charge en maintenant et le tir part au relâchement', () => {
    const s = arena();
    const a = active(s);
    run(s, 45, fire()); // 0,75 s à 1,5 s de charge complète
    expect(s.turn.charging).toBe(true);
    expect(s.turn.power).toBeCloseTo(0.5, 1);
    expect(s.projectiles.length).toBe(0);
    step(s, SIM_DT, fire(false));
    expect(s.projectiles.length).toBe(1);
    const p = s.projectiles[0]!;
    const sp = GAMEPLAY.weapons.bazooka;
    expect(Math.hypot(p.vx, p.vy)).toBeCloseTo(sp.minSpeed + (sp.maxSpeed - sp.minSpeed) * 0.5, -2);
    expect(p.owner).toBe(a.id);
    expect(s.phase).toBe('firing');
    expect(s.turn.timeLeft).toBe(GAMEPLAY.turn.retreatTime);
    expect(ammoOf(s, a.team, 'bazooka')).toBe(-1); // illimité
  });

  it('tir automatique à 100 % puis pas de recharge tant que la touche reste enfoncée', () => {
    const s = arena();
    run(s, 120, fire());
    expect(s.projectiles.length).toBe(1);
    expect(s.phase).toBe('firing');
  });

  it('la visée à l’angle règle la direction (bornes respectées)', () => {
    const s = arena();
    run(s, 300, { ...NEUTRAL_INTENT, aimDir: 1 });
    expect(s.turn.aim).toBe(W.aim.max);
    run(s, 600, { ...NEUTRAL_INTENT, aimDir: -1 });
    expect(s.turn.aim).toBe(W.aim.min);
  });

  it('le vent dévie la trajectoire (sens et amplitude)', () => {
    const land = (wind: number): number => {
      const s = arena();
      s.wind = wind;
      s.turn.aim = 0.9;
      run(s, 100, fire()); // puissance max
      for (let i = 0; i < 60 * 8 && s.projectiles.length; i++) step(s, SIM_DT, NEUTRAL_INTENT);
      return (events(s, 'explosion')[0] as { x: number }).x;
    };
    const calm = land(0), push = land(GAMEPLAY.wind.max), pull = land(-GAMEPLAY.wind.max);
    expect(push).toBeGreaterThan(calm + 60);
    expect(pull).toBeLessThan(calm - 60);
  });

  it('explosion à l’impact : cratère, ver voisin projeté et blessé', () => {
    const s = arena();
    const a = active(s);
    const victim = s.worms.find((w) => w.team !== a.team)!;
    victim.x = a.x + 90; victim.y = GROUND - R - 1;
    s.turn.aim = 0;
    const solidBefore = s.terrain.isSolid(a.x + 90, GROUND + 5);
    const hp = victim.health;
    run(s, 100, fire());
    let flew = false;
    for (let i = 0; i < 60 * 3; i++) { step(s, SIM_DT, NEUTRAL_INTENT); if (victim.mode === 'air') flew = true; }
    expect(events(s, 'explosion').length).toBe(1);
    expect(victim.health).toBeLessThan(hp);
    expect(flew).toBe(true);
    expect(victim.vx !== 0 || victim.x > a.x + 90).toBe(true);
    expect(solidBefore).toBe(true);
    expect(s.terrain.isSolid(a.x + 90 + 30, GROUND + 5)).toBe(false); // trou dans le sol
  });
});

describe('grenade', () => {
  it('explose à l’échéance de la minuterie choisie, après avoir rebondi', () => {
    for (const fuse of [1, 3, 5]) {
      const s = arena();
      select(s, 'grenade');
      step(s, SIM_DT, { ...NEUTRAL_INTENT, fuse });
      expect(s.turn.fuse).toBe(fuse);
      s.turn.aim = 0.6;
      run(s, 40, fire());
      step(s, SIM_DT, fire(false));
      const p = s.projectiles[0]!;
      expect(p.kind).toBe('grenade');
      let t = 0;
      while (s.projectiles.length && t < 10) { step(s, SIM_DT, NEUTRAL_INTENT); t += SIM_DT; }
      expect(Math.abs(t - fuse)).toBeLessThan(0.1);
      expect(events(s, 'bounce').length).toBeGreaterThanOrEqual(fuse === 1 ? 0 : 1);
      expect(events(s, 'explosion').length).toBe(1);
    }
  });

  it('minuterie bornée à 1..5 et munitions décomptées par équipe', () => {
    const s = arena();
    const a = active(s);
    select(s, 'grenade');
    step(s, SIM_DT, { ...NEUTRAL_INTENT, fuse: 9 });
    expect(s.turn.fuse).toBe(5);
    step(s, SIM_DT, { ...NEUTRAL_INTENT, fuse: 0 });
    expect(s.turn.fuse).toBe(1);
    const other = s.teams.find((t) => t.id !== a.team)!;
    const mine = ammoOf(s, a.team, 'grenade');
    run(s, 30, fire());
    step(s, SIM_DT, fire(false));
    expect(ammoOf(s, a.team, 'grenade')).toBe(mine - 1);
    expect(other.ammo.grenade).toBe(mine); // l'autre équipe n'est pas touchée
  });

  it('rebondit sur le terrain sans le traverser et finit par s’immobiliser', () => {
    const s = arena();
    select(s, 'grenade');
    step(s, SIM_DT, { ...NEUTRAL_INTENT, fuse: 5 });
    s.turn.aim = 0.3;
    run(s, 50, fire());
    step(s, SIM_DT, fire(false));
    const p = s.projectiles[0]!;
    let rested = false;
    for (let i = 0; i < 60 * 4 && !p.dead; i++) {
      step(s, SIM_DT, NEUTRAL_INTENT);
      expect(p.y).toBeLessThan(GROUND + 1);
      if (p.rest) rested = true;
    }
    expect(rested).toBe(true);
  });
});

describe('fusil à pompe', () => {
  it('deux tirs par tour, une seule munition, délai entre les tirs, petits cratères', () => {
    const s = arena();
    const a = active(s);
    select(s, 'shotgun');
    s.turn.aim = -0.5; // vers le sol devant le ver
    const ammo0 = ammoOf(s, a.team, 'shotgun');
    const solid0 = s.terrain.mask.data.reduce((x, y) => x + y, 0);

    step(s, SIM_DT, fire());
    step(s, SIM_DT, fire(false));
    expect(events(s, 'hitscan').length).toBe(1);
    expect(s.phase).toBe('turn'); // pas encore fini : un second tir reste
    expect(ammoOf(s, a.team, 'shotgun')).toBe(ammo0 - 1);
    const cleared1 = solid0 - s.terrain.mask.data.reduce((x, y) => x + y, 0);
    const r = GAMEPLAY.explosion.presets.tiny.radius;
    expect(cleared1).toBeGreaterThan(Math.PI * r * r * 0.3);
    expect(cleared1).toBeLessThan(Math.PI * r * r);

    // Pendant le délai de rechargement, un appui est ignoré.
    step(s, SIM_DT, fire()); step(s, SIM_DT, fire(false));
    expect(events(s, 'hitscan').length).toBe(1);
    run(s, Math.ceil(60 * GAMEPLAY.weapons.shotgun.reload) + 2);
    step(s, SIM_DT, fire()); step(s, SIM_DT, fire(false));
    expect(events(s, 'hitscan').length).toBe(2);
    expect(ammoOf(s, a.team, 'shotgun')).toBe(ammo0 - 1); // toujours une seule munition
    expect(s.phase).toBe('firing');
  });

  it('tir en ligne droite : touche le ver visé et le blesse', () => {
    const s = arena();
    const a = active(s);
    const victim = s.worms.find((w) => w.team !== a.team)!;
    victim.x = a.x + 150; victim.y = GROUND - R - 1;
    select(s, 'shotgun');
    s.turn.aim = 0;
    step(s, SIM_DT, fire()); step(s, SIM_DT, fire(false));
    expect(victim.health).toBeLessThan(100);
  });
});

describe('intégration machine à états', () => {
  it('le changement de tour attend qu’un projectile actif ait explosé', () => {
    const s = arena();
    const a = active(s);
    select(s, 'grenade');
    step(s, SIM_DT, { ...NEUTRAL_INTENT, fuse: 5 });
    s.turn.aim = 1.0;
    run(s, 30, fire());
    step(s, SIM_DT, fire(false));
    expect(s.phase).toBe('firing');
    let sawResolvingWithProjectile = false;
    let guard = 0;
    while (s.phase !== 'turn' && guard++ < 60 * 30) {
      if (s.phase === 'transition') expect(s.projectiles.length).toBe(0);
      if (s.phase === 'resolving' && s.projectiles.length) sawResolvingWithProjectile = true;
      step(s, SIM_DT, NEUTRAL_INTENT);
    }
    expect(sawResolvingWithProjectile).toBe(true);
    expect(s.phase).toBe('turn');
    expect(s.turn.worm).not.toBe(a.id);
    expect(s.turn.weapon).toBe('bazooka'); // l'arme est réinitialisée à chaque tour
  });

  it('le ver actif tué par son tir ne bloque pas la partie', () => {
    const s = arena();
    const a = active(s);
    s.turn.aim = 1.5; // quasi vertical : retombe sur le tireur
    run(s, 120, fire());
    let guard = 0;
    while (s.phase !== 'turn' || s.turnNumber < 2) { step(s, SIM_DT, NEUTRAL_INTENT); if (guard++ > 60 * 60) break; }
    expect(s.turnNumber).toBeGreaterThanOrEqual(2);
    expect(s.turn.worm).not.toBe(a.id);
  });

  it('armes interdites sans munition ; identifiant inconnu ignoré', () => {
    const s = arena();
    const a = active(s);
    s.teams[a.team]!.ammo.grenade = 0;
    expect(canSelect(s, a.team, 'grenade')).toBe(false);
    select(s, 'grenade');
    expect(s.turn.weapon).toBe('bazooka');
    select(s, 'lance-flammes');
    expect(s.turn.weapon).toBe('bazooka');
  });

  it('déterminisme complet avec tirs', () => {
    const play = (): string => {
      const s = arena(21);
      s.turn.aim = 0.8;
      run(s, 70, fire());
      run(s, 60 * 12);
      return hashState(s);
    };
    expect(play()).toBe(play());
  });
});
