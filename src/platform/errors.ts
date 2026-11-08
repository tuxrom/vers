import { t } from '@/ui/i18n';

const FATAL_ID = 'fatal-error';

/**
 * Écran d'erreur bloquant en HTML pur (fonctionne même si le canvas ou le jeu n'ont pas démarré) : message clair,
 * bouton Recharger et, si possible, retour au menu.
 */
export function showFatal(message: string, onMenu?: () => void): void {
  document.getElementById(FATAL_ID)?.remove();
  const box = document.createElement('div');
  box.id = FATAL_ID;
  box.setAttribute('role', 'alertdialog');
  box.style.cssText = 'position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:24px;' +
    'background:rgba(8,14,28,0.96);color:#eef3fb;font-family:system-ui,sans-serif;text-align:center';
  const card = document.createElement('div');
  card.style.cssText = 'max-width:460px;display:grid;gap:14px';
  const title = document.createElement('h2');
  title.textContent = t('error.title');
  title.style.margin = '0';
  const p = document.createElement('p');
  p.textContent = message;
  p.style.margin = '0';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap';
  const mk = (label: string, fn: () => void, primary: boolean): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `font:inherit;min-height:44px;padding:8px 18px;border-radius:12px;border:1px solid rgba(255,255,255,.3);cursor:pointer;` +
      (primary ? 'background:#8fd3ff;color:#10203a;font-weight:700' : 'background:rgba(255,255,255,.1);color:inherit');
    b.addEventListener('click', fn);
    return b;
  };
  row.append(mk(t('error.reload'), () => location.reload(), true));
  if (onMenu) row.append(mk(t('error.menu'), () => { box.remove(); onMenu(); }, false));
  card.append(title, p, row);
  box.append(card);
  document.body.append(box);
}

export const hideFatal = (): void => { document.getElementById(FATAL_ID)?.remove(); };

/** Message lisible d'une erreur inconnue. */
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 160);

/**
 * Capte les erreurs non gérées (exceptions, promesses rejetées) : jamais d'écran figé en silence. `report` reçoit le
 * message ; l'application décide de l'afficher (notification) sans interrompre la partie.
 */
export function installGlobalErrorHandlers(report: (message: string) => void): void {
  window.addEventListener('error', (e) => { console.error(e.error ?? e.message); report(errorMessage(e.error ?? e.message)); });
  window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); report(errorMessage(e.reason)); });
}
