import { SIM_DT } from '@/config/engine';
import { GAMEPLAY } from '@/config/gameplay';
import type { Difficulty } from '@/core/options';
import type { Rng } from '@/core/rng';
import type { GameState } from '@/core/state';
import type { Worm } from '@/entities/worm';
import type { BallisticEnv } from '@/physics/ballistics';
import { WEAPONS } from '@/weapons';
import { PROJECTILE_SPECS } from '@/weapons/specs';
import type { BlastSize, WeaponId } from '@/weapons/types';
import { knockAdjustmentGen, scoreBlast, simulateKnockGen } from './score';
import { simulateRay, simulateShot } from './shots';
import { reachableGen, walkResultGen, type Reach } from './walk';

const AI = GAMEPLAY.ai;
const A = GAMEPLAY.weapons;
const R = GAMEPLAY.worm.radius;
const E = GAMEPLAY.explosion;
const AIM_STEP = A.aim.rate * SIM_DT;

/** Décision de l'IA pour son tour : où aller, quelle arme, comment viser. Tout est déjà quantifié sur les pas du jeu. */
export interface Plan {
  kind: 'fire' | 'skip';
  weapon: WeaponId;
  /** Abscisse à rejoindre en marchant (null = tirer d'ici). */
  moveToX: number | null;
  walkDir: -1 | 1;
  /** Durée de marche prévue (pas de simulation). */
  walkTicks: number;
  facing: -1 | 1;
  /** Angle de visée absolu (rad), multiple du pas d'angle du jeu. */
  aim: number;
  /** Pas de simulation pendant lesquels maintenir la charge (0 si l'arme ne se charge pas). */
  powerTicks: number;
  fuse: number;
  /** Point désigné (armes à cible). */
  target: { x: number; y: number } | null;
  /** Point d'explosion attendu (sert à fuir après le tir). */
  blast: { x: number; y: number } | null;
  /** Direction de fuite pendant la retraite (0 = rester). */
  fleeDir: -1 | 0 | 1;
  score: number;
  note: string;
}

interface Candidate {
  weapon: WeaponId;
  pos: Reach | null;
  facing: -1 | 1;
  aim: number;
  powerTicks: number;
  fuse: number;
  target: { x: number; y: number } | null;
  blast: { x: number; y: number };
  size: BlastSize;
  score: number;
  /** Position finale du tireur (après fuite) pour l'évaluation des risques. */
  selfAt?: { x: number; y: number };
  fleeDir: -1 | 0 | 1;
}

export interface PlanInput {
  s: GameState;
  me: Worm;
  level: Difficulty;
  rng: Rng;
}

const gauss = (rng: Rng): number => {
  const u = Math.max(1e-9, rng.next()), v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const sgn = (v: number): -1 | 1 => (v >= 0 ? 1 : -1);

/** Tous les angles de visée atteignables : l'angle courant ± n pas, bornes comprises. */
function aimGrid(start: number): number[] {
  const nMin = Math.ceil((A.aim.min - start) / AIM_STEP), nMax = Math.floor((A.aim.max - start) / AIM_STEP);
  const out: number[] = [];
  for (let n = nMin; n <= nMax; n++) out.push(start + n * AIM_STEP);
  return out;
}

const powerOf = (ticks: number): number => Math.min(1, ticks * SIM_DT / A.chargeTime);
const maxTicks = Math.round(A.chargeTime / SIM_DT);

/** Garde les `k` meilleurs candidats (insertion triée). */
class TopK {
  readonly items: Candidate[] = [];
  constructor(private k: number) {}
  add(c: Candidate): void {
    const a = this.items;
    if (a.length === this.k && c.score <= (a[a.length - 1] as Candidate).score) return;
    let i = a.length;
    while (i > 0 && (a[i - 1] as Candidate).score < c.score) i--;
    a.splice(i, 0, c);
    if (a.length > this.k) a.pop();
  }
}

/**
 * Planifie le tour d'une IA. Générateur : chaque `yield` rend la main à l'appelant, qui reprend le calcul à la
 * frame suivante (aucun gel de l'interface) ; le plan est la valeur de retour.
 */
export function* planTurn(input: PlanInput): Generator<void, Plan> {
  const { s, me, level, rng } = input;
  const team = s.teams[me.team];
  const enemies = s.worms.filter((w) => w.alive && !w.sunk && w.team !== me.team);
  const ammo = (id: WeaponId): number => team?.ammo[id] ?? 0;
  const lv = AI[level];
  const baseEnv: BallisticEnv = { terrain: s.terrain, worms: s.worms, wind: level === 'easy' ? 0 : s.wind, waterLevel: s.waterLevel };
  const aims = aimGrid(s.turn.aim);
  let trials = 0;

  const skip = (note: string, pos: Reach | null = null): Plan => ({
    kind: 'skip', weapon: 'bazooka', moveToX: pos ? pos.x : null, walkDir: pos?.dir ?? 1, walkTicks: pos?.ticks ?? 0,
    facing: me.facing, aim: s.turn.aim, powerTicks: 0, fuse: 3, target: null, blast: null, fleeDir: 0, score: 0, note,
  });
  if (enemies.length === 0) return skip('aucun ennemi');

  // --- environnement balistique selon la position de tir (le ver y est déplacé)
  const envCache = new Map<Reach | null, BallisticEnv>();
  const envAt = (pos: Reach | null): BallisticEnv => {
    let e = envCache.get(pos);
    if (!e) {
      e = pos ? { ...baseEnv, worms: s.worms.map((w) => (w.id === me.id ? { id: w.id, x: pos.x, y: pos.y, alive: w.alive, sunk: w.sunk } : w)) } : baseEnv;
      envCache.set(pos, e);
    }
    return e;
  };
  const at = (pos: Reach | null): { x: number; y: number } => (pos ? { x: pos.x, y: pos.y } : { x: me.x, y: me.y });
  const meAt = (pos: Reach | null, self?: { x: number; y: number }): { id: number; team: number; x: number; y: number } => ({ id: me.id, team: me.team, ...(self ?? at(pos)) });
  const value = (pos: Reach | null, x: number, y: number, size: BlastSize, self?: { x: number; y: number }): number =>
    scoreBlast(s.worms, meAt(pos, self), x, y, size).score;
  const tick = (): boolean => ++trials % AI.sliceTrials === 0;

  // --- positions de tir
  const positions: (Reach | null)[] = [null];
  const nearest = enemies.slice().sort((p, q) => Math.abs(p.x - me.x) - Math.abs(q.x - me.x))[0] as Worm;
  function* approachPos(): Generator<void, Reach | null> {
    const dir = sgn(nearest.x - me.x);
    const cands = yield* reachableGen(s.terrain, me, s.waterLevel, dir);
    let best: Reach | null = null, bd = Infinity;
    for (const c of cands) {
      const d = Math.abs(Math.abs(nearest.x - c.x) - AI.walk.idealRange);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  if (level === 'easy') {
    if (Math.abs(nearest.x - me.x) > AI.easy.approachRange) { const p = yield* approachPos(); if (p) positions[0] = p; }
  } else if (level === 'hard') {
    const all = [...(yield* reachableGen(s.terrain, me, s.waterLevel, -1)), ...(yield* reachableGen(s.terrain, me, s.waterLevel, 1))];
    const n = AI.hard.positions;
    for (let i = 0; i < Math.min(n, all.length); i++) positions.push(all[Math.floor((i * all.length) / Math.min(n, all.length))] as Reach);
  }
  yield;

  // --- armes envisagées selon le niveau
  const usable = (id: WeaponId): boolean => ammo(id) !== 0;
  const weapons: WeaponId[] = ['bazooka'];
  if (level !== 'easy') {
    if (usable('grenade')) weapons.push('grenade');
    if (usable('shotgun')) weapons.push('shotgun');
  }
  if (level === 'hard') {
    for (const id of ['dynamite', 'bat', 'airstrike'] as const) if (usable(id)) weapons.push(id);
  }

  const facingsFor = (pos: Reach | null): (-1 | 1)[] => {
    const px = at(pos).x;
    const f: (-1 | 1)[] = [];
    if (level === 'easy') return [sgn(nearest.x - px)];
    if (enemies.some((e) => e.x >= px)) f.push(1);
    if (enemies.some((e) => e.x < px)) f.push(-1);
    return f;
  };

  const pool: Candidate[] = [];

  // --- tir balistique (bazooka, grenade) : grille grossière puis affinage
  function* searchLauncher(weapon: 'bazooka' | 'grenade', pos: Reach | null, facing: -1 | 1, coarse: boolean, around?: Candidate): Generator<void, Candidate[]> {
    const def = WEAPONS[weapon];
    const kind = def.projectile!;
    const spec = PROJECTILE_SPECS[kind];
    const env = envAt(pos);
    const p0 = at(pos);
    const top = new TopK(coarse ? 4 : 3);
    const aimIdx0 = around ? Math.round((around.aim - aims[0]!) / AIM_STEP) : 0;
    const aStep = coarse ? AI.search.aimStride : 1, pStep = coarse ? AI.search.powerStride : 1;
    const aLo = coarse ? 0 : Math.max(0, aimIdx0 - AI.search.refineAim), aHi = coarse ? aims.length - 1 : Math.min(aims.length - 1, aimIdx0 + AI.search.refineAim);
    const pLo = coarse ? pStep : Math.max(1, (around?.powerTicks ?? 1) - AI.search.refinePower);
    const pHi = coarse ? maxTicks : Math.min(maxTicks, (around?.powerTicks ?? 1) + AI.search.refinePower);
    for (let ai = aLo; ai <= aHi; ai += aStep) {
      const aim = aims[ai] as number;
      const dx = facing * Math.cos(aim), dy = -Math.sin(aim);
      for (let pt = pLo; pt <= pHi; pt += pStep) {
        const sp = spec.minSpeed + (spec.maxSpeed - spec.minSpeed) * powerOf(pt);
        const ox = p0.x + dx * A.muzzleOffset, oy = p0.y + dy * A.muzzleOffset;
        const r = simulateShot(env, kind, me.id, ox, oy, dx * sp, dy * sp, weapon === 'grenade' ? 0 : -1);
        if (weapon === 'bazooka') {
          if (r.kind === 'impact' || r.kind === 'worm') {
            top.add({ weapon, pos, facing, aim, powerTicks: pt, fuse: 3, target: null, blast: { x: r.x, y: r.y }, size: spec.blast, score: value(pos, r.x, r.y, spec.blast), fleeDir: 0 });
          }
        } else if (r.fuseAt) {
          for (let f = A.grenade.fuseMin; f <= A.grenade.fuseMax; f++) {
            const b = r.fuseAt[f];
            if (!b) continue;
            top.add({ weapon, pos, facing, aim, powerTicks: pt, fuse: f, target: null, blast: b, size: spec.blast, score: value(pos, b.x, b.y, spec.blast), fleeDir: 0 });
          }
        }
        if (tick()) yield;
      }
    }
    return top.items;
  }

  // --- fusil à pompe : un rayon par angle
  function* searchShotgun(pos: Reach | null, facing: -1 | 1): Generator<void> {
    const env = envAt(pos);
    const p0 = at(pos);
    const top = new TopK(2);
    for (const aim of aims) {
      const dx = facing * Math.cos(aim), dy = -Math.sin(aim);
      const r = simulateRay(env, me.id, p0.x + dx * (R + 2), p0.y + dy * (R + 2), dx, dy, A.shotgun.range);
      if (r.hit) top.add({ weapon: 'shotgun', pos, facing, aim, powerTicks: 0, fuse: 3, target: null, blast: { x: r.x, y: r.y }, size: A.shotgun.blast, score: value(pos, r.x, r.y, A.shotgun.blast) * 1.7, fleeDir: 0 });
      if (tick()) yield;
    }
    pool.push(...top.items);
  }

  // --- dynamite : ennemi collé, avec fuite simulée pendant la retraite
  function* searchDynamite(pos: Reach | null): Generator<void> {
    const p0 = at(pos);
    for (const e of enemies) {
      if (Math.abs(e.x - p0.x) > AI.hard.closeRange || Math.abs(e.y - p0.y) > 40) continue;
      const facing = sgn(e.x - p0.x);
      const blast = { x: p0.x + facing * 13, y: p0.y + 4 };
      const fleeDir: -1 | 1 = p0.x >= blast.x ? 1 : -1;
      const probe: Worm = { ...me, x: p0.x, y: p0.y, mode: 'ground', rope: null, knocked: false };
      const away = yield* walkResultGen(s.terrain, probe, s.waterLevel, fleeDir, GAMEPLAY.turn.retreatTime);
      if (!away.safe) continue;
      const self = { x: away.x, y: away.y };
      pool.push({ weapon: 'dynamite', pos, facing, aim: s.turn.aim, powerTicks: 0, fuse: 3, target: null, blast, size: 'huge', score: value(pos, blast.x, blast.y, 'huge', self), selfAt: self, fleeDir });
      yield;
    }
  }

  // --- batte : angle d'éjection choisi avec la simulation de projection (eau, falaises)
  function* searchBat(pos: Reach | null): Generator<void> {
    const p0 = at(pos);
    const reach = R * 2 + A.bat.reach;
    for (const e of enemies) {
      if (Math.hypot(e.x - p0.x, e.y - p0.y) > Math.min(reach, AI.hard.closeRange)) continue;
      const facing = sgn(e.x - p0.x);
      let best: Candidate | null = null;
      for (let i = 0; i < aims.length; i += 3) {
        const aim = aims[i] as number;
        const k = yield* simulateKnockGen(s.terrain, e, facing * Math.cos(aim) * A.bat.force, -Math.sin(aim) * A.bat.force, s.waterLevel);
        const dmg = Math.min(e.health, A.bat.damage);
        const sc = dmg + (e.health <= A.bat.damage ? AI.score.killBonus : 0) + (k.drowned ? AI.score.drownBonus + AI.score.killBonus : Math.min(k.fall, Math.max(0, e.health - A.bat.damage)));
        if (!best || sc > best.score) best = { weapon: 'bat', pos, facing, aim, powerTicks: 0, fuse: 3, target: null, blast: { x: e.x, y: e.y }, size: A.bat.blast, score: sc, fleeDir: 0 };
        if (tick()) yield;
      }
      if (best) pool.push(best);
    }
  }

  // --- frappe aérienne : ligne de missiles simulés un par un (vent compris) ; uniquement avant de bouger
  function* searchAirstrike(): Generator<void> {
    const a = A.airstrike;
    for (const e of enemies) {
      // Le ver ne doit pas se retourner : se déplacer interdit la frappe (`usableAfterMove: false`).
      for (const facing of [me.facing]) {
        let total = 0, cx = 0, cy = 0, n = 0;
        for (let i = 0; i < a.missiles; i++) {
          const x = e.x + (i - (a.missiles - 1) / 2) * a.spacing * facing;
          const r = simulateShot(baseEnv, 'missile', me.id, x, a.startY, 0, a.fallSpeed);
          if (r.kind === 'impact' || r.kind === 'worm') { total += value(null, r.x, r.y, a.blast); cx += r.x; cy += r.y; n++; }
        }
        if (n > 0) pool.push({ weapon: 'airstrike', pos: null, facing, aim: s.turn.aim, powerTicks: 0, fuse: 3, target: { x: e.x, y: e.y }, blast: { x: cx / n, y: cy / n }, size: a.blast, score: total, fleeDir: 0 });
        yield;
      }
    }
  }

  // ===================================================================== recherche
  const search = function* (poss: (Reach | null)[]): Generator<void> {
    const coarse: Candidate[] = [];
    for (const pos of poss) {
      for (const facing of facingsFor(pos)) {
        for (const w of weapons) {
          if (w === 'bazooka' || w === 'grenade') coarse.push(...(yield* searchLauncher(w, pos, facing, true)));
          else if (w === 'shotgun') yield* searchShotgun(pos, facing);
        }
      }
      if (level === 'hard') {
        if (weapons.includes('dynamite')) yield* searchDynamite(pos);
        if (weapons.includes('bat')) yield* searchBat(pos);
      }
    }
    if (level === 'hard' && weapons.includes('airstrike')) yield* searchAirstrike();

    // Affinage fin autour des meilleurs tirs grossiers (niveaux moyen et difficile).
    coarse.sort((p, q) => q.score - p.score);
    if (level === 'easy') pool.push(...coarse);
    else {
      const seen = new Set<string>();
      let used = 0;
      for (const c of coarse) {
        const key = `${c.weapon}|${c.pos?.x}|${c.facing}|${c.fuse}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (used++ >= AI.search.refineTop) break;
        pool.push(c, ...(yield* searchLauncher(c.weapon as 'bazooka' | 'grenade', c.pos, c.facing, false, c)).filter((r) => r.weapon === c.weapon && (c.weapon !== 'grenade' || r.fuse === c.fuse)));
      }
      pool.push(...coarse.slice(AI.search.refineTop));
    }
  };

  yield* search(positions);

  // Moyen : rien d'intéressant d'ici → on s'approche puis on réessaie.
  if (level === 'medium' && Math.max(-1e9, ...pool.map((c) => c.score)) < AI.score.minScore) {
    const p = yield* approachPos();
    if (p) { positions.push(p); yield* search([p]); }
  }

  // Difficile : les meilleurs tirs sont re-évalués avec la projection des vers (eau, falaises, chutes).
  if (level === 'hard') {
    pool.sort((p, q) => q.score - p.score);
    for (const c of pool.slice(0, AI.hard.knockTopK)) {
      if (c.weapon === 'bat' || c.weapon === 'airstrike') continue;
      c.score += yield* knockAdjustmentGen(s.terrain, s.worms, meAt(c.pos, c.selfAt), c.blast.x, c.blast.y, c.size, s.waterLevel);
    }
  }

  pool.sort((p, q) => q.score - p.score);
  const best = pool[0];
  if (!best || best.score <= 0) {
    // Aucun tir rentable : on avance vers l'ennemi pour le prochain tour plutôt que de se blesser.
    const p = yield* approachPos();
    return skip('aucun tir rentable', p);
  }

  // --- erreur de visée propre au niveau (en crans réels du jeu)
  const aimErrSteps = Math.round((gauss(rng) * lv.aimError) / AIM_STEP);
  const aimIdx = clamp(Math.round((best.aim - aims[0]!) / AIM_STEP) + aimErrSteps, 0, aims.length - 1);
  const aim = aims[aimIdx] as number;
  const def = WEAPONS[best.weapon];
  const powerTicks = def.input === 'charge'
    ? clamp(Math.round(best.powerTicks * (1 + gauss(rng) * lv.powerError)), 1, maxTicks)
    : 0;

  // Fuite pendant la retraite si l'explosion attendue est proche de soi.
  const p0 = best.selfAt ?? at(best.pos);
  const blastR = E.presets[best.size].radius * E.falloffRange;
  let fleeDir = best.fleeDir;
  if (fleeDir === 0 && Math.hypot(best.blast.x - p0.x, best.blast.y - p0.y) < blastR + 40 && best.weapon !== 'bat') {
    fleeDir = p0.x >= best.blast.x ? 1 : -1;
  }

  return {
    kind: 'fire', weapon: best.weapon, moveToX: best.pos ? best.pos.x : null, walkDir: best.pos?.dir ?? 1,
    walkTicks: best.pos?.ticks ?? 0, facing: best.facing, aim, powerTicks, fuse: best.fuse,
    target: best.target, blast: best.blast, fleeDir, score: best.score,
    note: `${best.weapon} score ${best.score.toFixed(0)}`,
  };
}
