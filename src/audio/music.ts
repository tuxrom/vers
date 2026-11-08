import { Rng } from '@/core/rng';

/** Notes (demi-tons MIDI) de la gamme pentatonique mineure de La, sur plusieurs octaves. */
const SCALE = [45, 48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 72];
/** Accords de fond (fondamentale en MIDI), changeant toutes les 4 mesures. */
const ROOTS = [33, 29, 36, 31];
const midi = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/**
 * Musique d'ambiance générative (aucun fichier) : nappe grave + notes pentatoniques éparses.
 * Planification en avance via setInterval ; aléa cosmétique propre (hors simulation).
 */
export class Music {
  private rng = new Rng(0x6d75736);
  private timer = 0;
  private next = 0;
  private beat = 0;
  private gain: GainNode | null = null;

  constructor(private ctx: () => AudioContext | null, private out: () => AudioNode | null) {}

  /** Volume ∈ [0,1] ; 0 arrête la musique. */
  setVolume(v: number): void {
    const ctx = this.ctx(), out = this.out();
    if (v <= 0.001) { this.stop(); return; }
    if (!ctx || !out) return;
    if (!this.gain) {
      this.gain = ctx.createGain();
      this.gain.connect(out);
    }
    this.gain.gain.setTargetAtTime(v * 0.5, ctx.currentTime, 0.2);
    if (!this.timer) {
      this.next = ctx.currentTime + 0.1;
      this.timer = window.setInterval(() => this.schedule(), 200);
    }
  }

  stop(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
  }

  private note(freq: number, t: number, dur: number, type: OscillatorType, peak: number): void {
    const ctx = this.ctx();
    if (!ctx || !this.gain) return;
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = type;
    o.frequency.value = freq;
    f.type = 'lowpass';
    f.frequency.value = 1400;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.gain);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private schedule(): void {
    const ctx = this.ctx();
    if (!ctx || ctx.state !== 'running') return;
    const step = 0.5; // une croche toutes les 0,5 s
    while (this.next < ctx.currentTime + 0.8) {
      const root = ROOTS[Math.floor(this.beat / 16) % ROOTS.length] as number;
      if (this.beat % 16 === 0) {
        this.note(midi(root), this.next, 8, 'sine', 0.35);
        this.note(midi(root + 7), this.next, 8, 'sine', 0.18);
      }
      if (this.rng.chance(0.55)) {
        this.note(midi(this.rng.pick(SCALE)), this.next, this.rng.range(1.2, 2.4), 'triangle', 0.16);
      }
      this.next += step;
      this.beat++;
    }
  }
}
