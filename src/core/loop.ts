import { ENGINE, SIM_DT } from '@/config/engine';

export interface LoopCallbacks {
  /** Une exception a été levée par update/render : la boucle continue (voir `maxConsecutiveErrors`). */
  onError?(e: unknown, fatal: boolean): void;
  /**
   * Un pas de simulation de durée SIM_DT. Renvoie `false` si le pas ne peut pas avoir lieu (lockstep en ligne : intention
   * du joueur distant pas encore reçue) : le temps accumulé est conservé et le pas retenté à la frame suivante.
   */
  update(dt: number): boolean | void;
  /** Temps de simulation supplémentaire (s) à rattraper cette frame (retard accumulé en ligne), 0 sinon. */
  boost?(): number;
  /** Rendu ; alpha ∈ [0,1) = fraction du prochain pas déjà écoulée (interpolation). */
  render(alpha: number, frameMs: number): void;
}

/** Boucle à pas fixe (accumulateur) + rendu interpolé sur requestAnimationFrame. */
export class GameLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;
  private errors = 0;

  constructor(private cb: LoopCallbacks) {
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private onVisibility = (): void => {
    // Évite un énorme delta au retour d'onglet.
    this.last = performance.now();
    this.acc = 0;
  };

  /** Au-delà de ce nombre d'erreurs consécutives, la boucle s'arrête et l'erreur est déclarée fatale. */
  static readonly maxConsecutiveErrors = 30;

  private frame = (now: number): void => {
    if (!this.running) return;
    const frameMs = now - this.last;
    this.last = now;
    try {
      this.acc += Math.min(frameMs / 1000, SIM_DT * ENGINE.maxStepsPerFrame) + (this.cb.boost?.() ?? 0);

      let steps = 0;
      while (this.acc >= SIM_DT && steps < ENGINE.maxStepsPerFrame) {
        if (this.cb.update(SIM_DT) === false) { this.acc = Math.min(this.acc, SIM_DT * ENGINE.maxStepsPerFrame); break; } // en attente
        this.acc -= SIM_DT;
        steps++;
      }
      if (steps === ENGINE.maxStepsPerFrame) this.acc = 0; // décrochage : on abandonne le retard

      this.cb.render(this.acc / SIM_DT, frameMs);
      this.errors = 0;
    } catch (e) {
      // Une exception ne doit pas figer l'écran : on réessaie à la frame suivante, jusqu'à un seuil.
      this.errors++;
      const fatal = this.errors >= GameLoop.maxConsecutiveErrors;
      this.cb.onError?.(e, fatal);
      if (fatal) { this.running = false; return; }
    }
    this.raf = requestAnimationFrame(this.frame);
  };
}
