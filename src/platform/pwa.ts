import { registerSW } from 'virtual:pwa-register';

export interface ServiceWorkerHooks {
  /** Une nouvelle version est installée et attend : proposer la mise à jour. */
  onNeedRefresh(): void;
  /** Tout est précaché : le jeu fonctionne désormais hors ligne. */
  onOfflineReady(): void;
}

export interface ServiceWorkerHandle {
  /** Active la nouvelle version (le service worker en attente prend la main) puis recharge la page. */
  applyUpdate(): Promise<void>;
  /** Vérifie maintenant s'il existe une nouvelle version (sans effet hors ligne). */
  check(): void;
}

/** Intervalle de vérification des mises à jour pour une application laissée ouverte (ms). */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * Enregistre le service worker (production uniquement). Les mises à jour sont détectées au chargement, toutes les
 * heures et à chaque retour au premier plan ; elles ne sont appliquées que sur demande de l'utilisateur.
 */
export function setupServiceWorker(hooks: ServiceWorkerHooks): ServiceWorkerHandle {
  let registration: ServiceWorkerRegistration | undefined;
  const check = (): void => {
    if (!registration || !navigator.onLine) return;
    registration.update().catch(() => { /* réseau indisponible : on réessaiera */ });
  };
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh: hooks.onNeedRefresh,
    onOfflineReady: hooks.onOfflineReady,
    onRegisteredSW(_url, reg) {
      registration = reg;
      window.setInterval(check, UPDATE_CHECK_MS);
    },
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('online', check);
  return { applyUpdate: () => updateSW(true), check };
}
