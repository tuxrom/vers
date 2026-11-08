/** Identifiants des sons du jeu (tous synthétisés). */
export type SoundId =
  | 'explosion' | 'bazooka' | 'shotgun' | 'bounce' | 'beep' | 'hit' | 'death' | 'splash'
  | 'swing' | 'rope' | 'teleport' | 'invalid' | 'plant' | 'pickup' | 'win';

export interface SoundCtx {
  ctx: AudioContext;
  out: AudioNode;
  noise: AudioBuffer;
  volume: number;
  t0: number;
}

function env(c: SoundCtx, peak: number, attack: number, decay: number): GainNode {
  const g = c.ctx.createGain();
  g.gain.setValueAtTime(0.0001, c.t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * c.volume), c.t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, c.t0 + attack + decay);
  g.connect(c.out);
  return g;
}

function noiseSrc(c: SoundCtx, dur: number): AudioBufferSourceNode {
  const s = c.ctx.createBufferSource();
  s.buffer = c.noise;
  s.loop = true;
  s.start(c.t0);
  s.stop(c.t0 + dur);
  return s;
}

function tone(c: SoundCtx, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, attack = 0.005): void {
  const o = c.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, c.t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), c.t0 + dur);
  o.connect(env(c, peak, attack, dur));
  o.start(c.t0);
  o.stop(c.t0 + dur + attack + 0.02);
}

function filtered(c: SoundCtx, type: BiquadFilterType, f0: number, f1: number, dur: number, peak: number, attack = 0.005, q = 1): void {
  const src = noiseSrc(c, dur + attack + 0.05);
  const f = c.ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, c.t0);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), c.t0 + dur);
  src.connect(f);
  f.connect(env(c, peak, attack, dur));
}

/** Chaque son renvoie sa durée (s) pour la gestion de la polyphonie. */
export const SOUNDS: Record<SoundId, (c: SoundCtx) => number> = {
  explosion: (c) => { filtered(c, 'lowpass', 2400, 70, 0.9, 1.1, 0.004); tone(c, 'sine', 120, 28, 0.55, 1.0); return 1; },
  bazooka: (c) => { filtered(c, 'bandpass', 900, 220, 0.4, 0.7, 0.01, 1.5); tone(c, 'sawtooth', 180, 60, 0.25, 0.15); return 0.5; },
  shotgun: (c) => { filtered(c, 'highpass', 1800, 600, 0.14, 0.9, 0.002); tone(c, 'sine', 170, 55, 0.18, 0.8); return 0.25; },
  bounce: (c) => { tone(c, 'triangle', 340, 170, 0.08, 0.4); return 0.15; },
  beep: (c) => { tone(c, 'square', 920, 920, 0.05, 0.12); return 0.1; },
  hit: (c) => { filtered(c, 'lowpass', 900, 200, 0.12, 0.5, 0.002); return 0.2; },
  death: (c) => { tone(c, 'sine', 420, 90, 0.5, 0.5); filtered(c, 'lowpass', 1500, 100, 0.4, 0.5); return 0.6; },
  splash: (c) => { filtered(c, 'bandpass', 1400, 400, 0.45, 0.8, 0.01, 0.8); return 0.55; },
  swing: (c) => { filtered(c, 'bandpass', 300, 1800, 0.18, 0.5, 0.02, 2); return 0.25; },
  rope: (c) => { tone(c, 'square', 1500, 600, 0.06, 0.25); filtered(c, 'highpass', 3000, 1500, 0.05, 0.3); return 0.12; },
  teleport: (c) => { tone(c, 'sine', 300, 1800, 0.35, 0.45, 0.02); tone(c, 'triangle', 1800, 400, 0.3, 0.25, 0.1); return 0.5; },
  invalid: (c) => { tone(c, 'sawtooth', 120, 90, 0.16, 0.35); return 0.25; },
  plant: (c) => { filtered(c, 'lowpass', 700, 150, 0.1, 0.6, 0.002); tone(c, 'sine', 140, 80, 0.09, 0.5); return 0.2; },
  pickup: (c) => { tone(c, 'triangle', 660, 660, 0.09, 0.4); tone(c, 'triangle', 990, 990, 0.14, 0.4, 0.07); return 0.3; },
  win: (c) => { for (const [i, f] of [523, 659, 784, 1046].entries()) { const cc = { ...c, t0: c.t0 + i * 0.13 }; tone(cc, 'triangle', f, f, 0.22, 0.4); } return 0.9; },
};
