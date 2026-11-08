const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export interface Label { canvas: HTMLCanvasElement; /** Taille en unités de monde. */ w: number; h: number }

const cache = new Map<string, Label>();
let bucket = 0;

/**
 * Étiquette de texte contourné prérendue (nom d'un ver). Le texte est l'opération la plus coûteuse du canvas :
 * rendu une fois par (nom, couleur, résolution) puis simplement copié à chaque frame.
 */
export function getLabel(text: string, color: string, scale: number): Label {
  const b = Math.min(6, Math.max(1, Math.ceil(scale * 2) / 2));
  if (b !== bucket) { cache.clear(); bucket = b; }
  const key = `${text}|${color}`;
  let l = cache.get(key);
  if (!l) {
    if (cache.size > 96) cache.clear();
    const probe = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
    probe.font = `bold 10px ${FONT}`;
    const w = Math.ceil(probe.measureText(text).width) + 6, h = 16;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w * b); canvas.height = Math.ceil(h * b);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.scale(b, b);
    ctx.font = `bold 10px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(text, w / 2, h / 2);
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2);
    l = { canvas, w, h };
    cache.set(key, l);
  }
  return l;
}

export function clearLabels(): void { cache.clear(); }
