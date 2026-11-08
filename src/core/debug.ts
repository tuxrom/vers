import { ENGINE } from '@/config/engine';

/** Compteur FPS lissé + drapeau debug (?debug, touche F3, ou mode dev). */
export class Debug {
  enabled: boolean;
  fps = 0;
  frameMs = 0;
  stepsPerSec = 0;
  private steps = 0;
  private stepWindow = 0;

  constructor() {
    this.enabled = import.meta.env.DEV || new URLSearchParams(location.search).has('debug');
  }

  toggle(): void {
    this.enabled = !this.enabled;
  }

  onStep(): void {
    this.steps++;
  }

  onFrame(frameMs: number): void {
    if (frameMs <= 0 || frameMs > 1000) return;
    const k = ENGINE.fpsSmoothing;
    this.frameMs = this.frameMs ? this.frameMs + (frameMs - this.frameMs) * k : frameMs;
    this.fps = 1000 / this.frameMs;
    this.stepWindow += frameMs;
    if (this.stepWindow >= 1000) {
      this.stepsPerSec = Math.round((this.steps * 1000) / this.stepWindow);
      this.steps = 0;
      this.stepWindow = 0;
    }
  }
}
