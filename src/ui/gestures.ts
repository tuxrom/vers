/**
 * Neutralise les gestes du navigateur qui gêneraient le jeu au toucher : zoom de page (pincement, double
 * appui), défilement / rebond / tirer-pour-rafraîchir, sélection de texte, menu contextuel (appui long),
 * glisser-déposer. Les menus gardent leur défilement vertical et les champs de saisie leur sélection.
 */
export function installGestureGuards(): void {
  const inField = (t: EventTarget | null): boolean => {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  };
  const inScrollable = (t: EventTarget | null): boolean => !!(t as HTMLElement | null)?.closest?.('.panel');
  const stop = (e: Event): void => { if (e.cancelable) e.preventDefault(); };

  // Safari iOS : gestes de pincement de la page.
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, stop as EventListener);
  // Défilement et rebond du document (non passif pour pouvoir annuler) ; sauf dans un panneau de menu.
  document.addEventListener('touchmove', (e) => { if (!inScrollable(e.target)) stop(e); }, { passive: false });
  // Pincement à deux doigts partout ailleurs que dans un menu.
  document.addEventListener('touchstart', (e) => { if (e.touches.length > 1 && !inScrollable(e.target)) stop(e); }, { passive: false });
  document.addEventListener('contextmenu', (e) => { if (!inField(e.target)) stop(e); });
  document.addEventListener('selectstart', (e) => { if (!inField(e.target)) stop(e); });
  document.addEventListener('dragstart', stop);
  // Double appui = zoom sur certains navigateurs.
  let lastEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastEnd < 350 && !inField(e.target) && !inScrollable(e.target)) stop(e);
    lastEnd = now;
  }, { passive: false });
}
