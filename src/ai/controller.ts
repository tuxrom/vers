import { SIM_DT } from '@/config/engine';
import { GAMEPLAY } from '@/config/gameplay';
import { NEUTRAL_INTENT, type Intent } from '@/core/intent';
import { Rng } from '@/core/rng';
import type { GameState, Team } from '@/core/state';
import { WEAPONS } from '@/weapons';
import { canSelect } from '@/weapons/system';
import { planTurn, type Plan } from './planner';
import { WalkDriver } from './walk';

const AI = GAMEPLAY.ai;
const A = GAMEPLAY.weapons;
const AIM_STEP = A.aim.rate * SIM_DT;

type Step = 'think' | 'select' | 'walk' | 'face' | 'aim' | 'pause' | 'fire' | 'retreat' | 'done';

/** État de l'IA pour le tour en cours. */
interface TurnBrain {
  turn: number;
  gen: Generator<void, Plan>;
  plan: Plan | null;
  step: Step;
  thinkUntil: number;
  pauseUntil: number;
  walk: WalkDriver;
  walkTicks: number;
  held: number;
  shotsFired: number;
  fireStep: number;
  rng: Rng;
  /** Réticule visible pour les armes à cible (clic simulé sur la carte). */
  targetShown: number;
}

const between = (rng: Rng, [lo, hi]: readonly number[]): number => rng.range(lo as number, hi as number);

/**
 * Pilote les équipes IA en produisant, pas après pas, exactement les mêmes `Intent` qu'un joueur humain :
 * marcher, régler la visée (le réticule tourne visiblement), charger la jauge, tirer. Aucun accès direct à
 * l'état de jeu en écriture. Le calcul du plan est un générateur repris par tranches de quelques
 * millisecondes (`pump`) : l'interface reste fluide pendant la réflexion.
 */
export class AiController {
  private brain: TurnBrain | null = null;
  /** Point visé à l'écran par l'IA (armes à cible) ; null sinon. */
  cursor: { x: number; y: number } | null = null;
  /** Vrai tant que l'IA calcule ou « réfléchit ». */
  thinking = false;

  /** L'équipe qui joue est-elle pilotée par l'IA ? */
  static isAiTurn(s: GameState): boolean {
    if (s.phase !== 'turn' && s.phase !== 'firing') return false;
    return s.teams[s.turn.team]?.controller === 'ai';
  }

  private start(s: GameState, team: Team): TurnBrain {
    const me = s.worms[s.turn.worm];
    if (!me) throw new Error('ver actif introuvable');
    // Aléa propre à l'IA, dérivé de la graine : mêmes erreurs si l'on rejoue la même partie.
    const rng = new Rng((s.seed ^ Math.imul(s.turnNumber + 1, 0x9e3779b1)) >>> 0);
    const lv = AI[team.difficulty];
    return {
      turn: s.turnNumber,
      gen: planTurn({ s, me, level: team.difficulty, rng }),
      plan: null, step: 'think',
      thinkUntil: s.time + between(rng, lv.think),
      pauseUntil: 0, walk: new WalkDriver(), walkTicks: 0, held: 0, shotsFired: 0, fireStep: 0, rng, targetShown: 0,
    };
  }

  /** À appeler à chaque frame de rendu : avance le calcul du plan pendant au plus `budgetMs` millisecondes. */
  pump(s: GameState, budgetMs: number = AI.budgetMs, now: () => number = () => performance.now()): void {
    if (!AiController.isAiTurn(s)) { this.brain = null; this.cursor = null; this.thinking = false; return; }
    const team = s.teams[s.turn.team] as Team;
    if (!this.brain || this.brain.turn !== s.turnNumber) this.brain = this.start(s, team);
    const b = this.brain;
    if (b.plan) return;
    const end = now() + budgetMs;
    do {
      const r = b.gen.next();
      if (r.done) { b.plan = r.value; break; }
    } while (now() < end);
  }

  /** Intention de l'IA pour ce pas de simulation (neutre si ce n'est pas son tour). */
  nextIntent(s: GameState): Intent {
    if (!AiController.isAiTurn(s)) { this.thinking = false; return NEUTRAL_INTENT; }
    const team = s.teams[s.turn.team] as Team;
    if (!this.brain || this.brain.turn !== s.turnNumber) this.brain = this.start(s, team);
    const b = this.brain;
    const me = s.worms[s.turn.worm];
    const intent: Intent = { ...NEUTRAL_INTENT, craters: [] };
    if (!me) return intent;
    this.thinking = b.step === 'think' && s.phase === 'turn';
    this.cursor = null;

    // Garde-fou : jamais de tour bloqué par l'IA (calcul trop long, geste impossible…).
    if (s.phase === 'turn' && s.turn.timeLeft < 3 && b.step !== 'fire' && b.step !== 'retreat' && b.step !== 'done') {
      intent.skipTurn = true;
      b.step = 'done';
      return intent;
    }

    if (s.phase === 'firing') {
      if (b.step !== 'retreat' && b.step !== 'done') b.step = 'retreat';
      return this.retreat(s, b, intent);
    }

    const plan = b.plan;
    switch (b.step) {
      case 'think':
        if (plan && s.time >= b.thinkUntil) b.step = plan.kind === 'skip' ? 'walk' : 'select';
        break;
      case 'select':
        if (plan && s.turn.weapon !== plan.weapon) {
          if (canSelect(s, s.turn.team, plan.weapon)) intent.selectWeapon = plan.weapon;
          else { b.step = 'done'; intent.skipTurn = true; }
        } else b.step = 'walk';
        break;
      case 'walk':
        if (plan) this.doWalk(s, b, plan, me.x, me, intent);
        break;
      case 'face':
        if (plan) {
          if (me.facing !== plan.facing) intent.moveX = plan.facing; // un pas pour se retourner
          else b.step = 'aim';
        }
        break;
      case 'aim':
        if (plan) this.doAim(s, b, plan, intent);
        break;
      case 'pause':
        if (plan && s.time >= b.pauseUntil) { b.step = 'fire'; b.fireStep = 0; b.held = 0; }
        else if (plan?.target) this.cursor = plan.target;
        break;
      case 'fire':
        if (plan) this.doFire(s, b, plan, intent);
        break;
      case 'done':
        break;
      case 'retreat':
        break;
    }
    return intent;
  }

  private doWalk(s: GameState, b: TurnBrain, plan: Plan, x: number, me: GameState['worms'][number], intent: Intent): void {
    if (plan.kind === 'skip') {
      // Approche sans tir : on marche, puis on termine le tour.
      if (plan.moveToX === null || Math.abs(x - plan.moveToX) < 1.5 || b.walkTicks > plan.walkTicks + 90) { intent.skipTurn = true; b.step = 'done'; return; }
      b.walkTicks++;
      Object.assign(intent, b.walk.next(me, plan.walkDir));
      return;
    }
    if (plan.moveToX === null || Math.abs(x - plan.moveToX) < 1.5 || b.walkTicks > plan.walkTicks + 90) { b.step = 'face'; return; }
    b.walkTicks++;
    const w = b.walk.next(me, plan.walkDir);
    intent.moveX = w.moveX;
    intent.jump = w.jump;
    void s;
  }

  private doAim(s: GameState, b: TurnBrain, plan: Plan, intent: Intent): void {
    const def = WEAPONS[plan.weapon];
    if (!def.aim) { b.step = 'pause'; b.pauseUntil = s.time + between(b.rng, AI[s.teams[s.turn.team]!.difficulty].aimPause); return; }
    const diff = plan.aim - s.turn.aim;
    if (Math.abs(diff) > AIM_STEP * 0.5) intent.aimDir = diff > 0 ? 1 : -1; // le réticule tourne pas à pas
    else { b.step = 'pause'; b.pauseUntil = s.time + between(b.rng, AI[s.teams[s.turn.team]!.difficulty].aimPause); }
  }

  private doFire(s: GameState, b: TurnBrain, plan: Plan, intent: Intent): void {
    const def = WEAPONS[plan.weapon];
    if (def.fuseSelectable && b.fireStep === 0) intent.fuse = plan.fuse;
    if (def.input === 'charge') {
      // Charge visible : on maintient le tir autant de pas que prévu, puis on relâche.
      if (b.held < plan.powerTicks) { intent.fireDown = true; b.held++; }
      else b.step = 'done'; // relâchement : fireDown=false ce pas
    } else if (def.input === 'press') {
      if (s.turn.reload > 0) return;
      if (b.fireStep % 2 === 0) { intent.fireDown = true; b.fireStep++; b.shotsFired++; }
      else { b.fireStep++; if (b.shotsFired >= def.shots) b.step = 'done'; }
    } else {
      // Arme à cible : le réticule s'affiche un instant sur la cible, puis « clic ».
      this.cursor = plan.target;
      if (b.targetShown++ > 20) { intent.target = plan.target; b.step = 'done'; }
    }
    b.fireStep = b.fireStep || 0;
  }

  private retreat(s: GameState, b: TurnBrain, intent: Intent): Intent {
    const plan = b.plan;
    const me = s.worms[s.turn.worm];
    if (plan && me && plan.fleeDir !== 0) {
      const w = b.walk.next(me, plan.fleeDir);
      intent.moveX = w.moveX;
      intent.jump = w.jump;
    }
    return intent;
  }
}
