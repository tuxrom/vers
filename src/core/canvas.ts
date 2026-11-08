import { ENGINE, QUALITY, type QualitySpec } from '@/config/engine';
import { NO_INSETS, readSafeArea, type Insets } from '@/ui/safeArea';

/** Le navigateur ne fournit pas de contexte Canvas 2D. */
export class CanvasUnavailableError extends Error {
  constructor() { super('Canvas 2D indisponible'); this.name = 'CanvasUnavailableError'; }
}

/** Canvas plein écran, pixel ratio plafonné, redimensionné via ResizeObserver. */
export class GameCanvas {
  readonly ctx: CanvasRenderingContext2D;
  /** Taille CSS (px logiques). */
  width = 0;
  height = 0;
  /** Pixel ratio effectif (≤ ENGINE.maxPixelRatio). */
  dpr = 1;
  /** Marges de sécurité (encoches) en px CSS, tenues à jour à chaque redimensionnement. */
  safe: Insets = NO_INSETS;
  /** Interface tactile active : les éléments d'interface s'adaptent (HUD mobile). */
  touch = false;
  onContextLost?: () => void;
  onContextRestored?: () => void;
  /** Plafond du pixel ratio (réglage de qualité). */
  maxDpr: number = ENGINE.maxPixelRatio;
  /** Échelle de résolution dynamique (1 = pleine résolution), ajustée selon la charge. */
  resolutionScale = 1;
  /** Détails graphiques courants (ombres, vagues, particules). */
  quality: QualitySpec = QUALITY.high;

  constructor(readonly el: HTMLCanvasElement) {
    const ctx = el.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new CanvasUnavailableError();
    // Perte du contexte graphique (veille, manque de mémoire) : on la signale pour que l'application se restaure.
    el.addEventListener('contextlost', (e) => { e.preventDefault(); this.onContextLost?.(); });
    el.addEventListener('contextrestored', () => { this.onContextRestored?.(); });
    this.ctx = ctx;
    new ResizeObserver(() => this.resize()).observe(el);
    window.addEventListener('orientationchange', () => this.resize());
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr) * this.resolutionScale;
    this.safe = readSafeArea();
    this.width = this.el.clientWidth;
    this.height = this.el.clientHeight;
    this.el.width = Math.max(1, Math.round(this.width * this.dpr));
    this.el.height = Math.max(1, Math.round(this.height * this.dpr));
  }

  /** Réinitialise la transformation en coordonnées CSS (à appeler en début de frame). */
  begin(): void {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
}
