import { GAMEPLAY } from '@/config/gameplay';
import type { GameEvent } from '@/core/events';
import type { GameState } from '@/core/state';

const H = GAMEPLAY.touch.haptics;
const E = GAMEPLAY.explosion;

/**
 * Durée de vibration (ms) pour un lot d'événements, ou null : explosion proche d'un ver d'équipe humaine
 * (plus l'explosion est proche et grosse, plus la vibration est longue) et perte de PV d'un ver humain
 * (proportionnelle aux dégâts ; mort = vibration longue). On garde la plus forte du lot.
 */
export function hapticPulse(events: readonly GameEvent[], s: GameState): number | number[] | null {
  let best = 0;
  let death = false;
  const human = (team: number): boolean => s.teams[team]?.controller === 'human';
  for (const e of events) {
    if (e.t === 'explosion') {
      // Ver humain le plus proche du centre de l'explosion.
      let d = Infinity;
      for (const w of s.worms) if (w.alive && !w.sunk && human(w.team)) d = Math.min(d, Math.hypot(w.x - e.x, w.y - e.y));
      const reach = e.r * E.falloffRange * H.reach;
      if (d < reach) best = Math.max(best, H.minMs + (H.maxMs - H.minMs) * (1 - d / reach));
    } else if (e.t === 'damage') {
      const w = s.worms[e.worm];
      if (w && human(w.team)) best = Math.max(best, Math.min(H.damageMaxMs, H.damageBaseMs + e.amount * H.damagePerHp));
    } else if (e.t === 'death') {
      const w = s.worms[e.worm];
      if (w && human(w.team)) death = true;
    }
  }
  if (death) return [60, 40, Math.round(Math.max(best, 120))];
  return best > 0 ? Math.round(best) : null;
}

/** Retour haptique via `navigator.vibrate` (absent sur iOS/ordinateur : sans effet), espacé pour ne pas saturer. */
export class Haptics {
  enabled = true;
  private last = -Infinity;

  constructor(
    private vibrate: (p: number | number[]) => boolean = (p) => (typeof navigator !== 'undefined' && 'vibrate' in navigator ? navigator.vibrate(p) : false),
    private now: () => number = () => performance.now(),
  ) {}

  onEvents(events: readonly GameEvent[], s: GameState): void {
    if (!this.enabled || events.length === 0) return;
    const p = hapticPulse(events, s);
    if (p === null) return;
    const t = this.now();
    if (t - this.last < H.minGapMs) return;
    this.last = t;
    try { this.vibrate(p); } catch { /* vibration refusée : sans importance */ }
  }
}
