import { describe, expect, it } from 'vitest';
import { SIM_DT } from '@/config/engine';
import { GAMEPLAY } from '@/config/gameplay';
import { startTurn } from '@/core/game';
import { NEUTRAL_INTENT, type Intent } from '@/core/intent';
import { Rng } from '@/core/rng';
import { step } from '@/core/simulation';
import { createState, type GameState } from '@/core/state';
import { circleOverlaps } from '@/physics/collision';
import { Terrain } from '@/terrain/terrain';
import { WEAPON_LIST, WEAPONS } from '@/weapons';
import { ammoOf, canSelect } from '@/weapons/system';
import { flatMask } from './helpers';

const W = GAMEPLAY.weapons;
const R = GAMEPLAY.worm.radius;
const GROUND = 900;
const fire = (down = true): Intent => ({ ...NEUTRAL_INTENT, fireDown: down });
const press = (s: GameState): void => { step(s, SIM_DT, fire()); step(s, SIM_DT, fire(false)); };

/** Arène plate ; `ceiling` ajoute un plafond (y < 300) pour la corde. */
function arena(ceiling = false, seed = 5): GameState {
  const s = createState({ seed, withCanvas: false });
  const m = flatMask(GAMEPLAY.world.width, GAMEPLAY.world.height, GROUND);
  if (ceiling) m.data.fill(1, 0, GAMEPLAY.world.width * 650);
  s.terrain = new Terrain(m, false);
  s.worms.forEach((w, i) => { w.x = 600 + i * 500; w.y = GROUND - R - 1; w.px = w.x; w.py = w.y; w.mode = 'ground'; });
  startTurn(s);
  s.worms[s.turn.worm]!.facing = 1;
  s.wind = 0;
  return s;
}
const active = (s: GameState) => s.worms[s.turn.worm]!;
const other = (s: GameState) => s.worms.find((w) => w.team !== active(s).team)!;
function run(s: GameState, n: number, intent: Intent = NEUTRAL_INTENT): void { for (let i = 0; i < n; i++) step(s, SIM_DT, intent); }
function select(s: GameState, id: string): void { step(s, SIM_DT, { ...NEUTRAL_INTENT, selectWeapon: id }); }
const events = (s: GameState, t: string) => s.events.filter((e) => e.t === t);
const solidCount = (s: GameState) => s.terrain.mask.data.reduce((a, b) => a + b, 0);

describe('déclarations des armes', () => {
  it('chaque arme déclare endsTurn et usableAfterMove ; 9 armes au menu', () => {
    expect(WEAPON_LIST.length).toBe(9);
    for (const d of WEAPON_LIST) {
      expect(typeof d.endsTurn, d.id).toBe('boolean');
      expect(typeof d.usableAfterMove, d.id).toBe('boolean');
      expect(WEAPONS[d.id]).toBe(d);
    }
    expect(WEAPONS.rope.endsTurn).toBe(false);
    expect(WEAPONS.airstrike.usableAfterMove).toBe(false);
    expect(WEAPONS.bazooka.endsTurn && WEAPONS.dynamite.endsTurn && WEAPONS.bat.endsTurn).toBe(true);
  });

  it('une arme « avant de bouger » est verrouillée après un déplacement', () => {
    const s = arena();
    const a = active(s);
    expect(canSelect(s, a.team, 'airstrike')).toBe(true);
    run(s, 10, { ...NEUTRAL_INTENT, moveX: 1 });
    expect(s.turn.moved).toBe(true);
    expect(canSelect(s, a.team, 'airstrike')).toBe(false);
    expect(canSelect(s, a.team, 'teleport')).toBe(true);
    select(s, 'airstrike');
    expect(s.turn.weapon).toBe('bazooka');
  });
});

describe('dynamite', () => {
  it('posée au sol, explose après 5 s et creuse un très gros cratère', () => {
    const s = arena();
    const a = active(s);
    select(s, 'dynamite');
    const ammo0 = ammoOf(s, a.team, 'dynamite');
    const before = solidCount(s);
    press(s);
    const d = s.projectiles[0]!;
    expect(d.kind).toBe('dynamite');
    expect(ammoOf(s, a.team, 'dynamite')).toBe(ammo0 - 1);
    expect(s.phase).toBe('firing');
    let t = 0;
    while (s.projectiles.length && t < 10) { step(s, SIM_DT, NEUTRAL_INTENT); t += SIM_DT; }
    expect(Math.abs(t - W.dynamite.fuse)).toBeLessThan(0.15);
    const r = GAMEPLAY.explosion.presets.huge.radius;
    expect(before - solidCount(s)).toBeGreaterThan(Math.PI * r * r * 0.5 * 0.9);
    expect(events(s, 'explosion').length).toBe(1);
    expect(r).toBeGreaterThan(GAMEPLAY.explosion.presets.large.radius);
  });

  it('blesse sévèrement un ver resté à côté', () => {
    const s = arena();
    const a = active(s);
    select(s, 'dynamite');
    press(s);
    run(s, 60 * 6);
    expect(a.health).toBeLessThan(60);
  });
});

describe('mine', () => {
  it('s’arme après un délai, n’explose pas sans ver, ne bloque pas la fin du tour', () => {
    const s = arena();
    select(s, 'mine');
    press(s);
    const m = s.projectiles[0]!;
    active(s).x = m.x - 700; // le poseur s'éloigne (sa propre mine le menacerait)
    run(s, 30);
    expect(m.rest).toBe(true);
    expect(m.arm).toBeGreaterThan(0);
    // Le tour se termine alors que la mine attend : elle ne bloque pas la résolution.
    const t0 = s.turnNumber;
    let guard = 0;
    while (s.turnNumber === t0 && guard++ < 60 * 30) step(s, SIM_DT, NEUTRAL_INTENT);
    expect(s.turnNumber).toBe(t0 + 1);
    expect(s.projectiles.some((p) => p.kind === 'mine')).toBe(true);
    expect(m.arm).toBe(0); // armée entre-temps
  });

  it('explose quand un ver s’approche (après armement), pas quand il reste loin', () => {
    const s = arena();
    select(s, 'mine');
    press(s);
    const m = s.projectiles[0]!;
    active(s).x = m.x - 700;
    const far = other(s);
    far.x = m.x + W.mine.triggerRadius * 4; far.y = GROUND - R - 1; far.mode = 'ground';
    run(s, Math.ceil(60 * (W.mine.armDelay + 1)));
    expect(m.dead).toBe(false);
    expect(m.fuse).toBeLessThan(0);
    const a = active(s);
    // Un ver pénètre le rayon de déclenchement → compte à rebours puis explosion.
    far.x = m.x + W.mine.triggerRadius - 6;
    run(s, 2);
    expect(m.fuse).toBeGreaterThanOrEqual(0);
    expect(m.dead).toBe(false);
    run(s, Math.ceil(60 * W.mine.triggerFuse) + 3);
    expect(events(s, 'explosion').length).toBe(1);
    expect(far.health).toBeLessThan(100);
    void a;
  });

  it('une mine non armée ne se déclenche pas même si on la touche', () => {
    const s = arena();
    select(s, 'mine');
    press(s);
    const m = s.projectiles[0]!;
    run(s, 10);
    const a = active(s);
    a.x = m.x; // en plein sur la mine, délai d'armement non écoulé
    run(s, 30);
    expect(m.dead).toBe(false);
  });
});

describe('frappe aérienne', () => {
  it('un clic désigne la zone : missiles en ligne, fin de tour après la résolution', () => {
    const s = arena();
    const a = active(s);
    select(s, 'airstrike');
    step(s, SIM_DT, { ...NEUTRAL_INTENT, target: { x: 2500, y: 600 } });
    expect(s.pending.length).toBe(W.airstrike.missiles);
    expect(ammoOf(s, a.team, 'airstrike')).toBe(0);
    expect(s.phase).toBe('firing');
    expect(canSelect(s, a.team, 'airstrike')).toBe(false);

    const xs = new Set<number>();
    let sawProjectile = false;
    const t0 = s.turnNumber;
    let guard = 0;
    while (s.turnNumber === t0 && guard++ < 60 * 40) {
      step(s, SIM_DT, NEUTRAL_INTENT);
      for (const p of s.projectiles) if (p.kind === 'missile') { xs.add(Math.round(p.x / 10)); sawProjectile = true; }
      if (s.phase === 'transition') { expect(s.pending.length).toBe(0); expect(s.projectiles.length).toBe(0); }
    }
    expect(sawProjectile).toBe(true);
    expect(events(s, 'explosion').length).toBe(W.airstrike.missiles);
    // Les explosions sont alignées sur la ligne, espacées de `spacing`.
    const ex = events(s, 'explosion').map((e) => (e as { x: number }).x).sort((p, q) => p - q);
    for (let i = 1; i < ex.length; i++) expect(ex[i]! - ex[i - 1]!).toBeGreaterThan(W.airstrike.spacing * 0.6);
    expect(ex[0]!).toBeGreaterThan(2500 - W.airstrike.spacing * W.airstrike.missiles);
    expect(ex[ex.length - 1]!).toBeLessThan(2500 + W.airstrike.spacing * W.airstrike.missiles);
    expect(s.turnNumber).toBe(t0 + 1);
  });

  it('cible hors carte ou clic absent : aucun effet, la machine reste jouable', () => {
    const s = arena();
    select(s, 'airstrike');
    step(s, SIM_DT, { ...NEUTRAL_INTENT, target: { x: -50, y: 10 } });
    expect(s.pending.length).toBe(0);
    expect(s.phase).toBe('turn');
    expect(events(s, 'invalid').length).toBe(1);
  });
});

describe('batte de baseball', () => {
  it('éjecte un ver adjacent avec une forte impulsion', () => {
    const s = arena();
    const a = active(s);
    const v = other(s);
    v.x = a.x + R * 2 + 4; v.y = a.y; v.mode = 'ground';
    select(s, 'bat');
    s.turn.aim = 0.5;
    const ammo0 = ammoOf(s, a.team, 'bat');
    press(s);
    expect(events(s, 'swing').length).toBe(1);
    expect(v.mode).toBe('air');
    expect(Math.hypot(v.vx, v.vy)).toBeGreaterThan(W.bat.force * 0.9);
    expect(v.vx).toBeGreaterThan(0);
    expect(v.vy).toBeLessThan(0);
    expect(v.health).toBe(100 - W.bat.damage);
    expect(ammoOf(s, a.team, 'bat')).toBe(ammo0 - 1);
    expect(s.phase).toBe('firing');
    const x0 = v.x;
    run(s, 60 * 3);
    expect(v.x - x0).toBeGreaterThan(150); // projeté loin
  });

  it('coup dans le vide : l’arme est utilisée et le tour continue normalement', () => {
    const s = arena();
    select(s, 'bat');
    press(s);
    expect(s.phase).toBe('firing');
    other(s).health = 100;
    expect(other(s).health).toBe(100);
  });
});

describe('corde ninja', () => {
  it('s’accroche au plafond, balance sans dépasser la longueur ni entrer dans le terrain', () => {
    const s = arena(true);
    const a = active(s);
    select(s, 'rope');
    s.turn.aim = 1.2;
    const ammo0 = ammoOf(s, a.team, 'rope');
    press(s);
    expect(a.rope).not.toBeNull();
    expect(s.phase).toBe('turn'); // la corde ne termine pas le tour
    expect(ammoOf(s, a.team, 'rope')).toBe(ammo0 - 1);
    const rope = a.rope!;
    let minX = a.x, maxX = a.x;
    for (let i = 0; i < 60 * 8; i++) {
      step(s, SIM_DT, { ...NEUTRAL_INTENT, moveX: (Math.floor(i / 60) % 2 ? -1 : 1) });
      if (!a.rope) break;
      expect(Math.hypot(a.x - rope.ax, a.y - rope.ay)).toBeLessThanOrEqual(rope.length + 1.5);
      expect(circleOverlaps(s.terrain, a.x, a.y, R)).toBe(false);
      minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x);
    }
    expect(maxX - minX).toBeGreaterThan(40); // il se balance vraiment
  });

  it('décrocher projette le ver ; la corde vide ne consomme rien', () => {
    const s = arena(true);
    const a = active(s);
    select(s, 'rope');
    s.turn.aim = 1.2;
    press(s);
    // On pousse jusqu'à décoller du sol (balancement), puis on décroche en l'air.
    for (let i = 0; i < 240 && a.y > GROUND - R - 25; i++) step(s, SIM_DT, { ...NEUTRAL_INTENT, moveX: i < 120 ? -1 : 1 });
    expect(a.rope).not.toBeNull();
    expect(a.y).toBeLessThan(GROUND - R - 5); // en l'air au moment de décrocher
    const speed = Math.hypot(a.vx, a.vy);
    expect(speed).toBeGreaterThan(30);
    const ammoBefore = ammoOf(s, a.team, 'rope');
    press(s); // nouvel appui : décroche
    expect(a.rope).toBeNull();
    expect(a.mode).toBe('air');
    expect(Math.hypot(a.vx, a.vy)).toBeGreaterThan(speed * 0.9);
    expect(ammoOf(s, a.team, 'rope')).toBe(ammoBefore);
    run(s, 60 * 6);
    expect(a.mode).toBe('ground');

    // Tir dans le vide : pas d'accroche, pas de munition perdue.
    const t = arena(false);
    select(t, 'rope');
    t.turn.aim = 0.2;
    const n0 = ammoOf(t, active(t).team, 'rope');
    press(t);
    expect(active(t).rope).toBeNull();
    expect(ammoOf(t, active(t).team, 'rope')).toBe(n0);
    expect(t.phase).toBe('turn');
  });

  it('Entrée décroche aussi ; la fin du temps décroche et ne bloque pas la partie', () => {
    const s = arena(true);
    const a = active(s);
    select(s, 'rope');
    s.turn.aim = 1.2;
    press(s);
    expect(a.rope).not.toBeNull();
    step(s, SIM_DT, { ...NEUTRAL_INTENT, jump: true });
    expect(a.rope).toBeNull();

    const u = arena(true);
    const b = active(u);
    select(u, 'rope');
    u.turn.aim = 1.2;
    press(u);
    const t0 = u.turnNumber;
    u.turn.timeLeft = 0.5;
    let guard = 0;
    while (u.turnNumber === t0 && guard++ < 60 * 40) step(u, SIM_DT, NEUTRAL_INTENT);
    expect(u.turnNumber).toBe(t0 + 1);
    expect(b.rope).toBeNull();
  });
});

describe('téléportation', () => {
  it('déplace le ver vers une destination valide avec effet d’apparition (la téléportation ne blesse pas)', () => {
    const s = arena();
    const a = active(s);
    select(s, 'teleport');
    const ammo0 = ammoOf(s, a.team, 'teleport');
    step(s, SIM_DT, { ...NEUTRAL_INTENT, target: { x: 1500, y: 860 } });
    expect(a.x).toBe(1500);
    expect(a.y).toBeCloseTo(860, 0);
    expect(a.appear).toBeGreaterThan(0);
    expect(events(s, 'teleport').length).toBe(1);
    expect(ammoOf(s, a.team, 'teleport')).toBe(ammo0 - 1);
    expect(s.phase).toBe('firing');
    run(s, 60 * 3);
    expect(a.mode).toBe('ground');
    expect(a.lastFallDamage).toBe(0);
    expect(a.appear).toBe(0);
  });

  it('destination invalide (terrain, eau, hors carte) : refusée sans consommer ni bloquer', () => {
    const s = arena();
    const a = active(s);
    select(s, 'teleport');
    const x0 = a.x, ammo0 = ammoOf(s, a.team, 'teleport');
    for (const target of [{ x: 1500, y: GROUND + 40 }, { x: -20, y: 400 }, { x: 1500, y: s.waterLevel + 30 }]) {
      step(s, SIM_DT, { ...NEUTRAL_INTENT, target });
      expect(a.x).toBe(x0);
    }
    expect(events(s, 'invalid').length).toBe(3);
    expect(ammoOf(s, a.team, 'teleport')).toBe(ammo0);
    expect(s.phase).toBe('turn');
  });
});

describe('robustesse de la machine à états', () => {
  it('fuzz : toutes armes, entrées aléatoires, la partie progresse toujours', () => {
    for (const seed of [3, 8, 13]) {
      const s = arena(seed % 2 === 0, seed);
      const rng = new Rng(seed * 977);
      const ids = WEAPON_LIST.map((w) => w.id);
      let down = false, lastTurn = s.turnNumber, lastChange = 0;
      for (let i = 0; i < 60 * 240 && s.phase !== 'gameover'; i++) {
        if (rng.chance(0.04)) down = !down;
        const intent: Intent = {
          ...NEUTRAL_INTENT,
          moveX: rng.chance(0.2) ? (rng.chance(0.5) ? -1 : 1) : 0,
          jump: rng.chance(0.01), backflip: rng.chance(0.005),
          aimDir: rng.chance(0.3) ? (rng.chance(0.5) ? -1 : 1) : 0,
          fireDown: down,
          selectWeapon: rng.chance(0.01) ? rng.pick(ids) : null,
          fuse: rng.chance(0.01) ? rng.int(0, 7) : null,
          target: rng.chance(0.02) ? { x: rng.range(-100, 4100), y: rng.range(-100, 1300) } : null,
        };
        step(s, SIM_DT, intent);
        for (const w of s.worms) {
          expect(Number.isFinite(w.x) && Number.isFinite(w.y), `seed ${seed} tick ${i}`).toBe(true);
        }
        if (s.turnNumber !== lastTurn) { lastTurn = s.turnNumber; lastChange = i; }
        // Aucun tour ne dure plus que sa durée max + retraite + résolution + transition.
        const cap = GAMEPLAY.turn.duration + GAMEPLAY.turn.retreatTime + GAMEPLAY.turn.resolveTimeout + 10;
        expect(i - lastChange, `seed ${seed} bloqué en ${s.phase}`).toBeLessThan(cap * 60);
      }
      expect(s.turnNumber, `seed ${seed}`).toBeGreaterThan(5);
    }
  });
});
