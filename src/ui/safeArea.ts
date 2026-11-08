/** Marges de sécurité de l'écran (encoches, coins arrondis, barres système), en px CSS. */
export interface Insets { top: number; right: number; bottom: number; left: number }

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Lit `env(safe-area-inset-*)` via un élément sonde (la page est en `viewport-fit=cover`).
 * Sans support (ordinateur, vieux navigateur) toutes les marges valent 0.
 */
export function readSafeArea(): Insets {
  if (typeof document === 'undefined') return NO_INSETS;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  document.body.append(probe);
  const cs = getComputedStyle(probe);
  const n = (v: string): number => Math.max(0, Number.parseFloat(v) || 0);
  const out = { top: n(cs.paddingTop), right: n(cs.paddingRight), bottom: n(cs.paddingBottom), left: n(cs.paddingLeft) };
  probe.remove();
  return out;
}
