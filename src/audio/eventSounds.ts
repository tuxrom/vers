import type { GameEvent } from '@/core/events';
import type { AudioEngine } from './audio';

/**
 * Traduit les événements de la simulation en sons. Le volume décroît avec la distance au centre de la vue
 * (`ref` = demi-largeur visible en px monde).
 */
export function playEvents(events: readonly GameEvent[], audio: AudioEngine, cx: number, cy: number, ref: number): void {
  const vol = (x: number, y: number): number => Math.max(0.15, 1 - Math.hypot(x - cx, y - cy) / (ref * 3));
  for (const e of events) {
    switch (e.t) {
      case 'explosion': audio.play('explosion', Math.min(1, 0.45 + e.r / 120) * vol(e.x, e.y)); break;
      case 'shot':
        if (e.weapon === 'shotgun') audio.play('shotgun', vol(e.x, e.y));
        else if (e.weapon === 'dynamite' || e.weapon === 'mine') audio.play('plant', vol(e.x, e.y));
        else if (e.weapon === 'airstrike') audio.play('beep', 0.8);
        else audio.play('bazooka', vol(e.x, e.y));
        break;
      case 'bounce': audio.play('bounce', Math.min(1, e.speed / 400) * vol(e.x, e.y)); break;
      case 'beep': audio.play('beep', 0.5 * vol(e.x, e.y)); break;
      case 'damage': audio.play('hit', 0.6 * vol(e.x, e.y)); break;
      case 'death': if (!e.drowned) audio.play('death', vol(e.x, e.y)); break;
      case 'splash': audio.play('splash', Math.min(1, 0.5 + e.r / 30) * vol(e.x, e.y)); break;
      case 'pickup': audio.play('pickup', vol(e.x, e.y)); break;
      case 'water': audio.play('splash', 0.6); break;
      case 'swing': audio.play('swing', vol(e.x, e.y)); break;
      case 'rope': audio.play(e.kind === 'miss' ? 'invalid' : 'rope', vol(e.x, e.y)); break;
      case 'teleport': audio.play('teleport', 0.8); break;
      case 'invalid': audio.play('invalid', 0.6); break;
      default:
    }
  }
}
