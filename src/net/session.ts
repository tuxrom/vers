import { NEUTRAL_INTENT, type Intent } from '@/core/intent';
import { syncHash, type GameState } from '@/core/state';
import { LIMITS, decodeIntent, encodeIntent, type ClientMsg, type Owner, type ServerMsg, type WireIntent } from './protocol';

/** Qui produit les intentions de l'équipe active, du point de vue de CET appareil. */
export type Source = 'local' | 'remote' | 'ai-local' | 'ai-remote';

/**
 * Moteur de synchronisation « lockstep » d'un client. Principe : la simulation est déterministe, donc seules les
 * intentions du joueur actif circulent ; chaque client les rejoue au même numéro de pas.
 *
 * Règles (identiques sur tous les appareils, c'est ce qui garantit des états identiques) :
 *  - un pas dont la phase AVANT exécution n'est ni `turn` ni `firing` utilise TOUJOURS l'intention neutre (aucune
 *    entrée n'est lue, même pour le joueur qui va jouer : sinon l'état divergerait au changement de tour) ;
 *  - sinon l'intention vient du propriétaire de l'équipe active : lue localement (et envoyée) si c'est cet appareil,
 *    produite par l'IA de l'hôte (et envoyée) si l'équipe est une IA, sinon attendue du réseau (le pas attend : lockstep) ;
 *  - au début de chaque tour, chaque client annonce l'empreinte complète de son état : le serveur confirme la relève
 *    de tour si tout le monde est identique, sinon signale une désynchronisation.
 */
export class OnlineSession {
  private owners: Owner[];
  /** Intentions reçues, par numéro de pas (état de simulation AVANT le pas). */
  private buffer = new Map<number, Intent>();
  /** Lot en cours d'envoi. */
  private out: { turn: number; from: number; items: WireIntent[] } | null = null;
  private ready: ClientMsg[] = [];
  /** Dernier tour confirmé par le serveur (tous les clients identiques). */
  confirmedTurn = 0;
  /**
   * Plancher des pas que l'IA de CET appareil (s'il est l'hôte) produit : en dessous, les intentions viennent encore du
   * flux de l'ancien joueur / de l'ancien hôte, déjà relayé par le serveur. Monte à chaque remplacement ou changement d'hôte.
   */
  private aiFloor = 0;
  /** Pas courant de la simulation : les intentions reçues pour un pas déjà joué sont écartées. */
  private cursor = 0;
  /** Journal de ce que cet appareil a annoncé / produit récemment : renvoyé au serveur après une reprise de connexion. */
  private sums: Extract<ClientMsg, { t: 'sum' }>[] = [];
  private mine = new Map<number, { from: number; items: WireIntent[] }>();
  private endMsg: ClientMsg | null = null;
  desync: { turn: number } | null = null;

  constructor(readonly myId: string, owners: Owner[], public hostId: string, readonly code: string) {
    this.owners = owners.slice();
  }

  get isHost(): boolean { return this.hostId === this.myId; }
  owner(team: number): Owner { return this.owners[team] ?? 'ai'; }
  isLocalTeam(team: number): boolean { return this.owner(team) === this.myId; }

  /** Source des intentions de l'équipe `team` sur cet appareil. */
  source(team: number, tick: number): Source {
    const o = this.owner(team);
    if (o === this.myId) return 'local';
    if (o === 'ai') {
      if (!this.isHost) return 'ai-remote';
      // Équipe remplacée / hôte changé en cours de tour : le flux précédent court jusqu'à `aiFloor`.
      return tick < this.aiFloor ? 'ai-remote' : 'ai-local';
    }
    return 'remote';
  }

  /** Ce pas doit-il attendre une intention du réseau ? (les phases sans contrôle n'attendent jamais) */
  mustWait(s: GameState): boolean {
    if (s.phase !== 'turn' && s.phase !== 'firing') return false;
    const src = this.source(s.turn.team, s.tick);
    return (src === 'remote' || src === 'ai-remote') && !this.buffer.has(s.tick);
  }

  /** Nombre d'intentions déjà reçues et pas encore jouées (pour rattraper le retard plus vite que le temps réel). */
  backlog(tick: number): number {
    let n = 0;
    while (this.buffer.has(tick + n) && n < 120) n++;
    return n;
  }

  /**
   * Intention à appliquer au pas `s.tick`. `local` produit l'intention de cet appareil (clavier, tactile ou IA) ;
   * renvoie null si le pas doit attendre. Les intentions locales sont mises en file d'envoi.
   */
  intentFor(s: GameState, local: () => Intent): Intent | null {
    this.cursor = s.tick;
    if (s.phase !== 'turn' && s.phase !== 'firing') return NEUTRAL_INTENT;
    const src = this.source(s.turn.team, s.tick);
    if (src === 'local' || src === 'ai-local') {
      const it = local();
      this.record(s.turnNumber, s.tick, it);
      return it;
    }
    const got = this.buffer.get(s.tick);
    if (!got) return null;
    this.buffer.delete(s.tick);
    return got;
  }

  private record(turn: number, tick: number, intent: Intent): void {
    const w = encodeIntent(intent);
    const log = this.mine.get(turn);
    if (log && log.from + log.items.length === tick) log.items.push(w);
    else if (!log) {
      this.mine.set(turn, { from: tick, items: [w] });
      for (const k of [...this.mine.keys()]) if (k < turn - 3) this.mine.delete(k);
    }
    const o = this.out;
    if (o && o.turn === turn && o.from + o.items.length === tick && o.items.length < LIMITS.batch) o.items.push(w);
    else { this.flushOut(); this.out = { turn, from: tick, items: [w] }; }
  }

  private flushOut(): void {
    if (this.out) this.ready.push({ t: 'in', turn: this.out.turn, from: this.out.from, items: this.out.items });
    this.out = null;
  }

  /** Messages à envoyer maintenant (lots d'intentions + annonces de relève de tour). */
  drain(): ClientMsg[] {
    this.flushOut();
    const r = this.ready;
    this.ready = [];
    return r;
  }

  /** À appeler après un pas qui a fait changer le numéro de tour : annonce l'état au début du tour. */
  turnStarted(s: GameState): void {
    this.flushOut();
    const sum = { t: 'sum' as const, turn: s.turnNumber, team: s.turn.team, tick: s.tick, hash: syncHash(s) };
    this.sums.push(sum);
    if (this.sums.length > 4) this.sums.shift();
    this.ready.push(sum);
  }

  /** À appeler une fois quand la partie se termine : empreinte de l'état final. */
  gameEnded(s: GameState): void {
    this.flushOut();
    this.endMsg = { t: 'end', tick: s.tick, hash: syncHash(s), winner: s.winner };
    this.ready.push(this.endMsg);
  }

  /**
   * Reprise après une coupure de connexion (le serveur a gardé la place). L'état du salon est remis à jour, puis tout ce
   * que cet appareil a annoncé ou produit récemment est remis en file d'envoi : le serveur écarte ce qu'il a déjà reçu.
   * Renvoie les équipes passées à l'ordinateur entre-temps.
   */
  resumed(m: Extract<ServerMsg, { t: 'resumed' }>): number[] {
    const changed: number[] = [];
    m.owners.forEach((o, i) => { if (o === 'ai' && this.owners[i] !== 'ai') changed.push(i); });
    this.owners = m.owners.slice();
    this.hostId = m.hostId;
    this.aiFloor = Math.max(this.aiFloor, m.aiFloor);
    this.out = null;
    this.ready = [...this.sums];
    for (const [turn, log] of [...this.mine.entries()].sort((a, b) => a[0] - b[0])) {
      for (let i = 0; i < log.items.length; i += LIMITS.batch) {
        this.ready.push({ t: 'in', turn, from: log.from + i, items: log.items.slice(i, i + LIMITS.batch) });
      }
    }
    if (this.endMsg) this.ready.push(this.endMsg);
    return changed;
  }

  /** Message du serveur. Renvoie un texte à afficher (remplacement par l'IA, hôte changé…) ou null. */
  receive(m: ServerMsg): { kind: 'replace'; team: number; name: string } | { kind: 'host' } | { kind: 'desync'; turn: number } | null {
    switch (m.t) {
      case 'in':
        if (m.by === this.myId || !Array.isArray(m.items)) return null;
        m.items.forEach((w, i) => { if (m.from + i >= this.cursor) this.buffer.set(m.from + i, decodeIntent(w)); });
        return null;
      case 'turn': this.confirmedTurn = Math.max(this.confirmedTurn, m.turn); return null;
      case 'desync': this.desync = { turn: m.turn }; return { kind: 'desync', turn: m.turn };
      case 'replace':
        this.owners[m.team] = 'ai';
        this.hostId = m.hostId;
        this.aiFloor = Math.max(this.aiFloor, m.fromTick);
        return { kind: 'replace', team: m.team, name: m.name };
      case 'host': this.hostId = m.hostId; this.aiFloor = Math.max(this.aiFloor, m.fromTick); return { kind: 'host' };
      default: return null;
    }
  }
}
