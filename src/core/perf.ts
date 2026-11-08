const N = 300; // ≈ 5 s d'historique à 60 fps

/** Quantile `q` ∈ [0,1] d'un tableau (copie triée). */
function quantile(a: ArrayLike<number>, n: number, q: number): number {
  if (n === 0) return 0;
  const s = Array.from({ length: n }, (_, i) => a[i] as number).sort((x, y) => x - y);
  return s[Math.min(n - 1, Math.floor(q * n))] as number;
}

export interface PerfStats {
  frames: number;
  fps: number;
  /** Durée de simulation (somme des pas d'une frame) et de rendu, en ms CPU. */
  updateAvg: number; updateP95: number;
  renderAvg: number; renderP95: number; renderMax: number;
  /** Intervalle entre frames (ms) : 16,7 = 60 fps. */
  frameAvg: number; frameP95: number; frameP99: number; frameMax: number;
}

/**
 * Mesure CPU de la simulation et du rendu par frame (anneau de 300 frames, sans allocation à l'enregistrement).
 * Sert à l'overlay de debug et au banc d'essai `scripts/bench.mjs`.
 */
export class Perf {
  private update = new Float32Array(N);
  private render = new Float32Array(N);
  private frame = new Float32Array(N);
  private i = 0;
  private count = 0;
  private pendingUpdate = 0;
  private renderStart = 0;

  /** Temps passé dans les pas de simulation de la frame courante (plusieurs pas possibles). */
  addUpdate(ms: number): void { this.pendingUpdate += ms; }

  beginRender(now: number): void { this.renderStart = now; }

  /** Clôt la frame : `now` = fin du rendu, `frameMs` = intervalle depuis la frame précédente. */
  endFrame(now: number, frameMs: number): void {
    if (frameMs <= 0 || frameMs > 500) { this.pendingUpdate = 0; return; } // reprise après pause / onglet masqué
    this.update[this.i] = this.pendingUpdate;
    this.render[this.i] = now - this.renderStart;
    this.frame[this.i] = frameMs;
    this.pendingUpdate = 0;
    this.i = (this.i + 1) % N;
    this.count = Math.min(N, this.count + 1);
  }

  reset(): void { this.i = 0; this.count = 0; this.pendingUpdate = 0; }

  stats(): PerfStats {
    const n = this.count;
    const avg = (a: Float32Array): number => { let s = 0; for (let k = 0; k < n; k++) s += a[k] as number; return n ? s / n : 0; };
    const frameAvg = avg(this.frame);
    return {
      frames: n, fps: frameAvg ? 1000 / frameAvg : 0,
      updateAvg: avg(this.update), updateP95: quantile(this.update, n, 0.95),
      renderAvg: avg(this.render), renderP95: quantile(this.render, n, 0.95), renderMax: quantile(this.render, n, 1),
      frameAvg, frameP95: quantile(this.frame, n, 0.95), frameP99: quantile(this.frame, n, 0.99), frameMax: quantile(this.frame, n, 1),
    };
  }
}

/**
 * Régulateur de résolution : mesure la durée moyenne des frames et propose une nouvelle échelle de résolution du
 * canvas (par paliers, avec hystérésis et délai entre deux changements). Pur : testable sans navigateur.
 */
export class AdaptiveResolution {
  scale = 1;
  private slow = 0;
  private fast = 0;
  private sum = 0;
  private n = 0;
  private lastChange = -Infinity;

  constructor(private cfg: { minScale: number; step: number; slowMs: number; fastMs: number; slowFrames: number; fastFrames: number; cooldownMs: number }) {}

  /** `frameMs` : intervalle entre frames ; renvoie la nouvelle échelle si elle change, sinon null. */
  update(frameMs: number, nowMs: number): number | null {
    if (frameMs <= 0 || frameMs > 500) { this.slow = this.fast = this.n = 0; this.sum = 0; return null; } // pause / onglet masqué
    const c = this.cfg;
    // Moyenne glissante sur 30 frames : un à-coup isolé (ramasse-miettes) ne déclenche rien.
    this.sum += frameMs; this.n++;
    if (this.n < 30) return null;
    const avg = this.sum / this.n;
    this.sum = 0; this.n = 0;
    if (avg > c.slowMs) { this.slow += 30; this.fast = 0; } else if (avg < c.fastMs) { this.fast += 30; this.slow = 0; } else { this.slow = this.fast = 0; }
    if (nowMs - this.lastChange < c.cooldownMs) return null;
    if (this.slow >= c.slowFrames && this.scale > c.minScale + 1e-9) {
      this.scale = Math.max(c.minScale, Math.round((this.scale - c.step) * 100) / 100);
      return this.commit(nowMs);
    }
    if (this.fast >= c.fastFrames && this.scale < 1 - 1e-9) {
      this.scale = Math.min(1, Math.round((this.scale + c.step) * 100) / 100);
      return this.commit(nowMs);
    }
    return null;
  }

  private commit(nowMs: number): number {
    this.lastChange = nowMs;
    this.slow = this.fast = 0;
    return this.scale;
  }

  reset(): void { this.scale = 1; this.slow = this.fast = this.n = 0; this.sum = 0; this.lastChange = -Infinity; }
}
