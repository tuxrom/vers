import type { Intent } from '@/core/intent';
import type { GameOptions } from '@/core/options';
import { syncHash, type GameState } from '@/core/state';
import { t } from '@/ui/i18n';
import type { OnlineMenuHost, RoomView } from '@/ui/menu/menu';
import { NetClient, defaultServerUrl } from './client';
import type { ServerMsg } from './protocol';
import { OnlineSession } from './session';

/** Écrans de menu concernés par le mode en ligne (sous-ensemble de `MenuManager`). */
export interface OnlineMenu {
  readonly current: string | null;
  readonly visible: boolean;
  render(): void;
  show(screen: 'home' | 'online' | 'lobby', reset?: boolean): void;
}

/** Ce que le mode en ligne attend de l'application (injecté : le contrôleur ne touche ni au DOM ni au rendu). */
export interface OnlineApp {
  state(): GameState;
  /** Une partie est-elle affichée (par opposition au décor des menus) ? */
  inGame(): boolean;
  /** Options de partie en cours d'édition, nettoyées. */
  options(): GameOptions;
  name(): string;
  setName(n: string): void;
  menu(): OnlineMenu;
  /** Crée la partie imposée par le serveur (graine + options). */
  begin(options: GameOptions): void;
  /** Quitte la partie affichée (retour au décor des menus). */
  backToDemo(): void;
  toast(id: string, text: string, timeoutMs: number): void;
  /** Écran bloquant ; `then` au retour au menu. */
  fatal(message: string, then: () => void): void;
  /** Identifiant de salon dans l'URL d'invitation. */
  shareLink(code: string): string;
  now(): number;
  /** Fabrique de connexion (remplaçable dans les tests). */
  connect?: () => NetClient;
  url?: () => string;
}

const KNOWN_ERRORS = ['not-found', 'full', 'in-progress', 'version', 'busy', 'not-host', 'slots', 'gap', 'expired', 'resume'] as const;
type KnownError = (typeof KNOWN_ERRORS)[number];

/** Durée maximale des tentatives de reconnexion (le serveur garde la place 20 s). */
const RECONNECT_MS = 16_000;
const RETRY_MS = 1200;
const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

/**
 * Mode en ligne côté application : connexion au serveur de salons, salon (création, jonction, configuration), lancement
 * d'une partie, pas de simulation en lockstep, reprise automatique après une coupure de connexion.
 */
export class OnlineController {
  net: NetClient | null = null;
  session: OnlineSession | null = null;
  room: RoomView | null = null;
  error: string | null = null;
  busy = false;
  /** Tentatives de reconnexion en cours (la simulation locale attend ou continue, le serveur garde la place). */
  reconnecting = false;
  /** Instant (ms) où la simulation a commencé à attendre un joueur distant ; 0 = elle n'attend pas. */
  stalledSince = 0;
  /** Empreinte de l'état au début de chaque tour (consultable en debug : comparer les appareils). */
  readonly turnHashes = new Map<number, string>();
  /** Enregistrer `turnHashes` (debug / tests). */
  keepHashes = false;
  private endSent = false;
  private configTimer: ReturnType<typeof setTimeout> | undefined;
  private waiters: ((ok: boolean) => void)[] = [];

  constructor(private app: OnlineApp) {}

  get active(): boolean { return this.session !== null; }
  get isHost(): boolean { return this.session?.isHost ?? false; }

  /** Interface offerte aux écrans de menu « Jouer en ligne » et « Salon ». */
  readonly menuHost: OnlineMenuHost = {
    name: () => this.app.name(),
    setName: (n) => this.app.setName(n),
    room: () => this.room,
    busy: () => this.busy,
    error: () => this.error,
    clearError: () => { this.error = null; },
    create: () => this.enter(() => this.net?.send({ t: 'create', options: this.app.options() })),
    join: (code) => this.enter(() => this.net?.send({ t: 'join', code: code.trim().toUpperCase() })),
    pushConfig: () => {
      clearTimeout(this.configTimer);
      this.configTimer = setTimeout(() => {
        if (this.room && this.room.hostId === this.room.you) this.net?.send({ t: 'config', options: this.app.options() });
      }, 250);
    },
    start: () => this.net?.send({ t: 'start' }),
    leave: () => this.leave(),
    shareLink: (code) => this.app.shareLink(code),
  };

  private settle(ok: boolean): void { const w = this.waiters; this.waiters = []; for (const f of w) f(ok); }

  private newClient(): NetClient { return this.app.connect ? this.app.connect() : new NetClient(); }
  private url(): string { return this.app.url ? this.app.url() : defaultServerUrl(); }

  private async ensureNet(): Promise<boolean> {
    if (this.net?.status === 'open') return true;
    this.busy = true; this.error = null; this.app.menu().render();
    const c = this.newClient();
    c.onMessage = (m) => this.onMessage(m);
    c.onClose = () => this.onClose(c);
    try {
      await c.connect(this.url(), this.app.name());
      this.net = c;
      return true;
    } catch {
      this.error = t('online.failed');
      return false;
    } finally {
      this.busy = false;
    }
  }

  /** Se connecte, envoie la demande (création / jonction) et attend le salon ou l'erreur. */
  private async enter(send: () => void): Promise<boolean> {
    if (!(await this.ensureNet())) return false;
    this.room = null; this.error = null;
    send();
    const ok = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.settle(false), 6000);
      this.waiters.push((v) => { clearTimeout(timer); resolve(v); });
    });
    if (!ok && !this.error) this.error = t('online.failed');
    return ok;
  }

  private reset(): void {
    this.net = null; this.session = null; this.room = null; this.stalledSince = 0; this.endSent = false; this.reconnecting = false;
  }

  /** Quitte le salon / la partie en ligne et revient à l'accueil. */
  leave(): void {
    try { this.net?.send({ t: 'leave' }); } catch { /* connexion déjà fermée */ }
    this.net?.close();
    this.reset();
    this.error = null;
    if (this.app.inGame()) this.app.backToDemo();
    this.app.menu().show('home', true);
  }

  /** Rejouer (réservé à l'hôte) : le serveur tire une nouvelle graine. */
  rematch(): void { if (this.isHost) this.net?.send({ t: 'rematch' }); }

  private lost(): void {
    const inGame = this.app.inGame() && this.session !== null;
    this.net?.close();
    this.reset();
    this.settle(false);
    if (inGame) {
      this.app.fatal(t('online.lost'), () => { this.app.backToDemo(); this.app.menu().show('home', true); });
    } else {
      this.error = t('online.lost');
      const menu = this.app.menu();
      if (menu.visible && (menu.current === 'lobby' || menu.current === 'online')) menu.show('online', true);
    }
  }

  private onClose(c: NetClient): void {
    if (this.net !== c) return; // ancienne connexion
    const ses = this.session;
    // Coupure en pleine partie : le serveur garde la place quelques secondes, on tente de la reprendre.
    if (ses && this.app.inGame() && this.app.state().phase !== 'gameover' && !ses.desync) {
      this.net = null;
      void this.reconnect(ses, c.key);
      return;
    }
    this.lost();
  }

  /** Reprise après une coupure : nouvelle connexion + `resume` (ancien identifiant et clé), jusqu'à expiration du délai. */
  private async reconnect(ses: OnlineSession, key: string): Promise<void> {
    this.reconnecting = true;
    const deadline = this.app.now() + RECONNECT_MS;
    while (this.session === ses && this.app.now() < deadline) {
      const c = this.newClient();
      // true = place reprise ; false = refus du serveur (définitif) ; null = connexion retombée (nouvel essai).
      let answer: (ok: boolean | null) => void = () => {};
      const answered = new Promise<boolean | null>((r) => { answer = r; });
      c.onMessage = (m) => {
        if (m.t === 'resumed') {
          if (this.session !== ses) { answer(false); return; }
          this.net = c;
          c.id = ses.myId;
          for (const team of ses.resumed(m)) this.teamToAi(team);
          answer(true);
        } else if (this.net === c) this.onMessage(m);
        else if (m.t === 'error') answer(false);
      };
      c.onClose = () => { answer(null); this.onClose(c); };
      let ok: boolean | null = null;
      try {
        await c.connect(this.url(), this.app.name(), 4000);
        c.send({ t: 'resume', code: ses.code, id: ses.myId, key, have: this.app.state().tick });
        ok = await Promise.race([answered, sleep(4000).then(() => null)]);
      } catch { ok = null; }
      if (ok === true) {
        this.reconnecting = false;
        this.app.toast('reconnected', t('online.reconnected'), 3500);
        return;
      }
      if (this.net !== c) c.close();
      if (ok === false) break; // place perdue (délai dépassé, partie terminée)
      await sleep(RETRY_MS);
    }
    if (this.session === ses) this.lost();
  }

  private teamToAi(team: number): string {
    const tm = this.app.state().teams[team];
    if (tm) { tm.controller = 'ai'; tm.difficulty = 'medium'; }
    return tm?.name ?? '';
  }

  private onMessage(m: ServerMsg): void {
    const menu = this.app.menu();
    switch (m.t) {
      case 'room':
        this.room = { code: m.code, hostId: m.hostId, you: this.net?.id ?? this.session?.myId ?? '', phase: m.phase, players: m.players, options: m.options };
        this.settle(true);
        if (menu.current === 'lobby') menu.render();
        return;
      case 'rtt': {
        const p = this.room?.players.find((q) => q.id === m.id);
        if (p) { p.rtt = m.rtt; if (menu.current === 'lobby') menu.render(); }
        return;
      }
      case 'error': {
        this.error = (KNOWN_ERRORS as readonly string[]).includes(m.code)
          ? t(`online.err.${m.code as KnownError}`) : t('online.err.other', { msg: m.message });
        if (this.app.inGame()) this.app.toast('neterr', this.error, 5000);
        this.settle(false);
        if (m.code === 'expired') { this.net?.close(); this.reset(); if (menu.current === 'lobby') menu.show('online', true); return; }
        if (menu.current === 'online') menu.render();
        return;
      }
      case 'start': this.start(m); return;
      default: {
        const r = this.session?.receive(m);
        if (!r) return;
        if (r.kind === 'replace') {
          const name = this.teamToAi(r.team);
          this.app.toast('replaced', t('online.replaced', { name: r.name || name }), 6000);
        } else if (r.kind === 'host') {
          this.app.toast('hostchg', t('online.hostChanged'), 5000);
        } else if (r.kind === 'desync') {
          this.app.fatal(t('online.desync', { turn: r.turn }), () => this.leave());
        }
      }
    }
  }

  /** Début (ou revanche) d'une partie : graine et options imposées par le serveur → carte et état identiques partout. */
  private start(m: Extract<ServerMsg, { t: 'start' }>): void {
    if (!this.net) return;
    // La session reçoit immédiatement les actions des autres, même pendant la génération de la carte.
    this.session = new OnlineSession(this.net.id, m.owners, m.hostId, this.room?.code ?? '');
    this.endSent = false; this.stalledSince = 0; this.turnHashes.clear();
    this.app.begin(m.options);
  }

  /**
   * Un pas de simulation en lockstep. L'intention vient du propriétaire de l'équipe active : `local()` si c'est cet
   * appareil (joueur ou IA de l'hôte), sinon reçue du réseau — le pas attend alors (`false`). `run` exécute le pas.
   */
  step(s: GameState, local: () => Intent, run: (intent: Intent) => void): boolean {
    const ses = this.session;
    if (!ses) return false;
    const before = s.turnNumber;
    const intent = ses.intentFor(s, local);
    if (intent === null) { if (!this.stalledSince) this.stalledSince = this.app.now(); return false; }
    this.stalledSince = 0;
    run(intent);
    // Empreinte de l'état au début du tour → relève de tour confirmée par le serveur.
    if (s.turnNumber !== before) { ses.turnStarted(s); if (this.keepHashes) this.turnHashes.set(s.turnNumber, syncHash(s)); }
    if (s.phase === 'gameover' && !this.endSent) { this.endSent = true; ses.gameEnded(s); }
    return true;
  }

  /** Envoie les intentions locales et annonces de tour accumulées pendant la frame (rien pendant une coupure). */
  flush(): void {
    if (this.session && this.net) for (const m of this.session.drain()) this.net.send(m);
  }

  /** Intentions déjà reçues et pas encore jouées (rattrapage plus rapide que le temps réel). */
  backlog(tick: number): number { return this.session ? this.session.backlog(tick) : 0; }

  /** Ligne d'état pour la pastille en jeu : attente d'un joueur ou reconnexion, sinon null. */
  status(s: GameState): string | null {
    if (this.reconnecting) return t('online.reconnecting');
    if (this.stalledSince && this.app.now() - this.stalledSince > 350) {
      return t('online.waiting', { name: s.teams[s.turn.team]?.name ?? '' });
    }
    return null;
  }
}
