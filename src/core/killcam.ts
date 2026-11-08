import { SIM_DT } from '@/config/engine';
import { GAMEPLAY } from '@/config/gameplay';
import { Fx } from '@/ui/fx';
import { CameraDirector } from './director';
import { restoreState, type Recording } from './replay';
import { step } from './simulation';
import type { GameState } from './state';

const K = GAMEPLAY.killcam;

/**
 * Replay au ralenti du dernier tir : restaure l'état du début du tour, rejoue les intentions enregistrées (avance
 * rapide, sans affichage, jusqu'à quelques instants avant le tir) puis montre l'action au ralenti jusqu'après
 * la dernière explosion. Le résultat est identique à la partie réelle, grâce au déterminisme de la simulation.
 */
export class Killcam {
  readonly state: GameState;
  readonly fx = new Fx();
  readonly director = new CameraDirector();
  private i = 0;
  private acc = 0;
  private readonly from: number;
  private readonly to: number;
  /** `ffwd` : avance rapide invisible ; `slow` : lecture au ralenti ; `done`. */
  phase: 'ffwd' | 'slow' | 'done' = 'ffwd';
  /** Fraction d'un pas déjà écoulée (interpolation du rendu). */
  alpha = 0;

  constructor(private rec: Recording, withCanvas = true) {
    this.state = restoreState(rec.snap, withCanvas);
    const shot = (rec.shotTick ?? rec.lastExplosionTick ?? rec.endTick) - rec.startTick;
    const boom = (rec.lastExplosionTick ?? rec.endTick) - rec.startTick;
    this.from = Math.max(0, shot - Math.round(K.leadSeconds / SIM_DT));
    this.to = Math.min(rec.intents.length, boom + Math.round(K.tailSeconds / SIM_DT));
    if (this.to <= this.from) this.phase = 'done';
  }

  /** Durée affichée (secondes de jeu) et progression 0..1 de la lecture au ralenti. */
  get progress(): number {
    return this.to > this.from ? Math.min(1, Math.max(0, (this.i - this.from) / (this.to - this.from))) : 1;
  }

  private stepOnce(): void {
    step(this.state, SIM_DT, this.rec.intents[this.i] as Recording['intents'][number]);
    this.i++;
  }

  /** Avance de `dtSec` secondes réelles (frame de rendu). */
  advance(dtSec: number): void {
    if (this.phase === 'ffwd') {
      // Avance rapide par tranches : quelques centaines de pas par frame, sans bloquer l'interface.
      for (let n = 0; n < K.fastForwardStepsPerFrame && this.i < this.from; n++) this.stepOnce();
      this.state.events.length = 0;
      if (this.i >= this.from) { this.phase = 'slow'; this.acc = 0; }
      return;
    }
    if (this.phase !== 'slow') return;
    this.acc += Math.min(dtSec, 0.1) * K.slowMotion;
    while (this.acc >= SIM_DT && this.i < this.to) {
      this.stepOnce();
      this.acc -= SIM_DT;
    }
    this.alpha = Math.min(1, this.acc / SIM_DT);
    if (this.i >= this.to) this.phase = 'done';
  }
}
