import { SIM_DT } from '@/config/engine';
import { NEUTRAL_INTENT, type Intent } from '@/core/intent';
import { createWorm, updateWorm, type Worm } from '@/entities/worm';
import { TerrainMask } from '@/terrain/mask';

export const idle: Intent = NEUTRAL_INTENT;
export const move = (d: -1 | 1): Intent => ({ ...idle, moveX: d });

/** Masque plat : solide à partir de y = ground. */
export function flatMask(w = 800, h = 400, ground = 300): TerrainMask {
  const m = new TerrainMask(w, h);
  m.data.fill(1, ground * w);
  return m;
}

/** Remplit un polygone-rampe : le sol monte de (x0,y0) à (x1,y1), plein dessous. */
export function rampMask(w: number, h: number, x0: number, y0: number, x1: number, y1: number, base: number): TerrainMask {
  const m = new TerrainMask(w, h);
  for (let x = 0; x < w; x++) {
    const t = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
    const top = Math.round(y0 + (y1 - y0) * t);
    for (let y = Math.min(top, base); y < h; y++) m.data[y * w + x] = 1;
  }
  return m;
}

export function run(m: TerrainMask, w: Worm, intent: Intent | ((tick: number) => Intent), steps: number): void {
  for (let i = 0; i < steps; i++) updateWorm(m, w, typeof intent === 'function' ? intent(i) : intent, SIM_DT);
}

export const spawnWorm = (x: number, y: number): Worm => createWorm(0, 0, x, y);
