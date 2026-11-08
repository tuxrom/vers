/** Plein écran et verrouillage de l'orientation, quand le navigateur le permet. */

interface LockableOrientation { lock?(o: string): Promise<void>; unlock?(): void }

const orientation = (): LockableOrientation | undefined =>
  typeof screen === 'undefined' ? undefined : (screen as Screen & { orientation?: LockableOrientation }).orientation;

export const canFullscreen = (doc: Document = document): boolean => !!doc.documentElement.requestFullscreen && doc.fullscreenEnabled !== false;
export const isFullscreen = (doc: Document = document): boolean => doc.fullscreenElement !== null;

/**
 * Passe en plein écran puis verrouille le paysage. À appeler depuis un geste de l'utilisateur. Renvoie le
 * résultat de chaque étape : `lock: false` (ex. iOS Safari, ou verrouillage refusé) → l'écran de rotation sert de repli.
 */
export async function enterFullscreen(doc: Document = document): Promise<{ fullscreen: boolean; lock: boolean }> {
  let fullscreen = isFullscreen(doc);
  if (!fullscreen && canFullscreen(doc)) {
    try {
      await doc.documentElement.requestFullscreen({ navigationUI: 'hide' });
      fullscreen = true;
    } catch { /* refusé (pas de geste récent, politique) : on continue sans */ }
  }
  let lock = false;
  const o = orientation();
  if (o?.lock) {
    try { await o.lock('landscape'); lock = true; } catch { /* non supporté hors plein écran / sur ce navigateur */ }
  }
  return { fullscreen, lock };
}

export async function exitFullscreen(doc: Document = document): Promise<void> {
  try { orientation()?.unlock?.(); } catch { /* sans importance */ }
  if (isFullscreen(doc)) { try { await doc.exitFullscreen(); } catch { /* sans importance */ } }
}

export async function toggleFullscreen(doc: Document = document): Promise<boolean> {
  if (isFullscreen(doc)) { await exitFullscreen(doc); return false; }
  return (await enterFullscreen(doc)).fullscreen;
}
