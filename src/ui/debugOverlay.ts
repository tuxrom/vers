import type { Debug } from '@/core/debug';
import type { GameCanvas } from '@/core/canvas';
import type { Perf } from '@/core/perf';
import { hashState, type GameState } from '@/core/state';

let hashAt = -1e9;
let hashStr = '';
let statsAt = -1e9;
let statsStr = '';

export function drawDebugOverlay(c: GameCanvas, d: Debug, s: GameState, perf?: Perf): void {
  const { ctx } = c;
  const now = performance.now();
  // Empreinte et statistiques : recalculées deux fois par seconde (le hash parcourt le masque du terrain).
  if (now - hashAt > 500) { hashAt = now; hashStr = hashState(s); }
  if (perf && now - statsAt > 500) {
    statsAt = now;
    const p = perf.stats();
    statsStr = `rendu ${p.renderAvg.toFixed(1)} ms (p95 ${p.renderP95.toFixed(1)})  sim ${p.updateAvg.toFixed(2)} ms  frame p95 ${p.frameP95.toFixed(0)} ms`;
  }
  const w = s.worms[s.turn.worm];
  const lines = [
    `${d.fps.toFixed(0)} FPS  (${d.frameMs.toFixed(1)} ms)`,
    `sim ${d.stepsPerSec} pas/s  tick ${s.tick}`,
    `canvas ${c.el.width}×${c.el.height}  dpr ${c.dpr.toFixed(2)}  échelle ${c.resolutionScale}`,
    ...(perf ? [statsStr] : []),
    `seed ${s.seed.toString(16)}  hash ${hashStr}`,
    `phase ${s.phase}  tour ${s.turnNumber}  équipe ${s.turn.team}  ver ${s.turn.worm}  vent ${s.wind}`,
    ...(w ? [`ver ${w.mode}${w.sliding ? ' glisse' : ''}  x ${w.x.toFixed(0)} y ${w.y.toFixed(0)}  chute ${w.lastFallDistance.toFixed(0)}px`] : []),
    '←→ marche · Entrée saut · ⌫ salto · N passe le tour · glisser = caméra · molette = zoom · Maj+clic = cratère · Échap pause',
  ];
  ctx.save();
  ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
  ctx.textBaseline = 'top';
  const pad = 6;
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const h = lines.length * 15 + pad * 2 - 3;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(8, 8, width, h);
  ctx.fillStyle = d.fps >= 55 ? '#8f8' : d.fps >= 30 ? '#fd6' : '#f77';
  ctx.fillText(lines[0] as string, 8 + pad, 8 + pad);
  ctx.fillStyle = '#ddd';
  for (let i = 1; i < lines.length; i++) ctx.fillText(lines[i] as string, 8 + pad, 8 + pad + i * 15);
  ctx.restore();
}
