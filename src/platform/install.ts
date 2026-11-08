/** Événement non standard de Chromium proposant l'installation. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallKind =
  /** Déjà installée / lancée en mode application. */
  | 'installed'
  /** Le navigateur a proposé l'installation : on peut déclencher son invite. */
  | 'prompt'
  /** iOS / iPadOS Safari : pas d'invite, il faut guider (Partager → Sur l'écran d'accueil). */
  | 'ios'
  /** Rien à proposer (ordinateur sans invite, navigateur non compatible). */
  | 'none';

/** Mode d'affichage « application » (standalone, plein écran…) ou raccourci iOS lancé depuis l'écran d'accueil. */
export function isStandalone(win: Window = window): boolean {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']
    .some((m) => win.matchMedia?.(`(display-mode: ${m})`).matches);
}

/** iPhone / iPad / iPod (y compris iPadOS qui se présente comme un Mac tactile) sous Safari. */
export function isIosSafari(ua: string, platform: string, maxTouchPoints: number): boolean {
  const ios = /iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
  // Les autres navigateurs iOS (Chrome, Firefox, Edge) ne savent pas ajouter à l'écran d'accueil comme Safari.
  const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return ios && !otherBrowser;
}

/**
 * Suit les possibilités d'installation : capture `beforeinstallprompt` (pour un bouton personnalisé), détecte
 * `appinstalled` et le mode application, et signale le cas iOS où il faut afficher une aide.
 */
export class InstallManager {
  private deferred: BeforeInstallPromptEvent | null = null;
  private installed: boolean;
  private listeners = new Set<() => void>();

  constructor(private win: Window = window) {
    this.installed = isStandalone(win);
    win.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); // on affiche notre propre invite, au bon moment
      this.deferred = e as BeforeInstallPromptEvent;
      this.emit();
    });
    win.addEventListener('appinstalled', () => {
      this.installed = true;
      this.deferred = null;
      this.emit();
    });
  }

  get kind(): InstallKind {
    if (this.installed) return 'installed';
    if (this.deferred) return 'prompt';
    const n = this.win.navigator;
    return isIosSafari(n.userAgent, n.platform, n.maxTouchPoints) ? 'ios' : 'none';
  }

  onChange(fn: () => void): void { this.listeners.add(fn); }
  private emit(): void { for (const l of this.listeners) l(); }

  /** Déclenche l'invite d'installation du navigateur. */
  async prompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    const e = this.deferred;
    if (!e) return 'unavailable';
    this.deferred = null; // l'événement n'est utilisable qu'une fois
    try {
      await e.prompt();
      const { outcome } = await e.userChoice;
      if (outcome === 'accepted') this.installed = true;
      return outcome;
    } finally {
      this.emit();
    }
  }
}
