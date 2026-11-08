import { afterEach, describe, expect, it } from 'vitest';
import { enterFullscreen, exitFullscreen, toggleFullscreen } from '@/platform/fullscreen';
import { InstallManager, isIosSafari, isStandalone } from '@/platform/install';
import { Persistence, memoryKV } from '@/core/storage';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const IPAD_OS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

type Listener = (e: Event) => void;
function fakeWindow(opts: { ua?: string; platform?: string; touch?: number; standaloneMedia?: boolean; navStandalone?: boolean } = {}) {
  const listeners = new Map<string, Listener[]>();
  const win = {
    navigator: { userAgent: opts.ua ?? DESKTOP, platform: opts.platform ?? 'Linux x86_64', maxTouchPoints: opts.touch ?? 0, standalone: opts.navStandalone },
    matchMedia: (q: string) => ({ matches: !!opts.standaloneMedia && q.includes('standalone') }),
    addEventListener: (t: string, fn: Listener) => { listeners.set(t, [...(listeners.get(t) ?? []), fn]); },
  } as unknown as Window;
  const fire = (t: string, e: Event) => { for (const fn of listeners.get(t) ?? []) fn(e); };
  return { win, fire };
}
function promptEvent(outcome: 'accepted' | 'dismissed') {
  const calls = { prevented: 0, prompted: 0 };
  const e = Object.assign(new Event('beforeinstallprompt'), {
    preventDefault() { calls.prevented++; },
    prompt: async () => { calls.prompted++; },
    userChoice: Promise.resolve({ outcome }),
  });
  return { e, calls };
}

describe('détection de la plateforme', () => {
  it('iOS Safari reconnu (iPhone, iPadOS « Mac tactile »), pas les autres navigateurs ni le bureau', () => {
    expect(isIosSafari(IPHONE, 'iPhone', 5)).toBe(true);
    expect(isIosSafari(IPAD_OS, 'MacIntel', 5)).toBe(true);
    expect(isIosSafari(IPHONE_CHROME, 'iPhone', 5)).toBe(false);
    expect(isIosSafari(DESKTOP, 'Linux x86_64', 0)).toBe(false);
    expect(isIosSafari(IPAD_OS, 'MacIntel', 0)).toBe(false); // vrai Mac
  });

  it('mode application détecté (display-mode ou navigator.standalone iOS)', () => {
    expect(isStandalone(fakeWindow().win)).toBe(false);
    expect(isStandalone(fakeWindow({ standaloneMedia: true }).win)).toBe(true);
    expect(isStandalone(fakeWindow({ navStandalone: true }).win)).toBe(true);
  });
});

describe('invite d’installation', () => {
  it('beforeinstallprompt : capturé (pas d’invite navigateur automatique), puis déclenché sur demande', async () => {
    const { win, fire } = fakeWindow();
    const m = new InstallManager(win);
    let changes = 0;
    m.onChange(() => changes++);
    expect(m.kind).toBe('none');
    const { e, calls } = promptEvent('accepted');
    fire('beforeinstallprompt', e);
    expect(calls.prevented).toBe(1);
    expect(m.kind).toBe('prompt');
    expect(changes).toBe(1);
    expect(await m.prompt()).toBe('accepted');
    expect(calls.prompted).toBe(1);
    expect(m.kind).toBe('installed');
    expect(await m.prompt()).toBe('unavailable'); // l'événement n'est utilisable qu'une fois
  });

  it('invite refusée : on retombe sur « rien à proposer » ; appinstalled : installé', async () => {
    const { win, fire } = fakeWindow();
    const m = new InstallManager(win);
    fire('beforeinstallprompt', promptEvent('dismissed').e);
    expect(await m.prompt()).toBe('dismissed');
    expect(m.kind).toBe('none');
    fire('appinstalled', new Event('appinstalled'));
    expect(m.kind).toBe('installed');
  });

  it('iOS Safari : aide manuelle proposée, sauf si déjà lancé depuis l’écran d’accueil', () => {
    expect(new InstallManager(fakeWindow({ ua: IPHONE, platform: 'iPhone', touch: 5 }).win).kind).toBe('ios');
    expect(new InstallManager(fakeWindow({ ua: IPHONE, platform: 'iPhone', touch: 5, navStandalone: true }).win).kind).toBe('installed');
    expect(new InstallManager(fakeWindow({ ua: IPHONE_CHROME, platform: 'iPhone', touch: 5 }).win).kind).toBe('none');
  });

  it('le refus de l’invite est mémorisé', () => {
    const p = new Persistence(memoryKV());
    expect(p.installDismissedAt()).toBe(0);
    p.dismissInstall(1234);
    expect(new Persistence((p as unknown as { kv: ReturnType<typeof memoryKV> }).kv).installDismissedAt()).toBe(1234);
  });
});

describe('plein écran et verrouillage paysage', () => {
  const g = globalThis as unknown as { screen?: unknown };
  afterEach(() => { delete g.screen; });

  function fakeDoc(opts: { fsRejects?: boolean; supported?: boolean } = {}) {
    const doc = {
      fullscreenElement: null as unknown,
      fullscreenEnabled: opts.supported !== false,
      documentElement: opts.supported === false ? {} : {
        requestFullscreen: async () => { if (opts.fsRejects) throw new Error('refusé'); doc.fullscreenElement = {}; },
      },
      exitFullscreen: async () => { doc.fullscreenElement = null; },
    };
    return doc as unknown as Document;
  }

  it('plein écran puis verrouillage paysage quand l’API le permet', async () => {
    const locks: string[] = [];
    g.screen = { orientation: { lock: async (o: string) => { locks.push(o); }, unlock: () => { locks.push('unlock'); } } };
    const doc = fakeDoc();
    expect(await enterFullscreen(doc)).toEqual({ fullscreen: true, lock: true });
    expect(locks).toEqual(['landscape']);
    expect(await toggleFullscreen(doc)).toBe(false); // 2e appel : on quitte
    expect(locks).toContain('unlock');
  });

  it('repli : API absente (iOS) ou refusée → pas d’erreur, l’écran de rotation prend le relais', async () => {
    g.screen = { orientation: {} };
    expect(await enterFullscreen(fakeDoc({ supported: false }))).toEqual({ fullscreen: false, lock: false });
    g.screen = { orientation: { lock: async () => { throw new Error('NotSupportedError'); } } };
    expect(await enterFullscreen(fakeDoc({ fsRejects: true }))).toEqual({ fullscreen: false, lock: false });
    await expect(exitFullscreen(fakeDoc())).resolves.toBeUndefined();
    delete g.screen; // environnement sans `screen`
    expect(await enterFullscreen(fakeDoc())).toEqual({ fullscreen: true, lock: false });
  });
});
