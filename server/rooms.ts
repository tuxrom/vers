import { defaultOptions, sanitizeOptions, type GameOptions } from '../src/core/options.ts';
import {
  LIMITS, PROTOCOL_VERSION, cleanWire, type ClientMsg, type Owner, type PlayerInfo, type RoomPhase, type ServerMsg, type WireIntent,
} from '../src/net/protocol.ts';

/** Connexion abstraite (WebSocket en production, objet factice dans les tests). */
export interface Conn {
  readonly id: string;
  send(m: ServerMsg): void;
  close(): void;
}

/** `conn` nul = connexion perdue : la place est gardée jusqu'à `awayUntil` (reprise par `resume` avec `key`). */
interface Player { id: string; key: string; name: string; rtt: number; conn: Conn | null; awayUntil: number }

/**
 * Suivi d'un tour : équipe active, intentions déjà relayées (`items`, à partir du pas `tick` ; prochain pas attendu =
 * `next`) et empreintes des clients. Le journal `items` sert à resservir les intentions manquées à un joueur qui revient.
 */
interface TurnRecord { turn: number; team: number; tick: number; next: number; items: WireIntent[]; hashes: Map<string, string>; confirmed: boolean }

interface Room {
  code: string;
  hostId: string;
  players: Map<string, Player>;
  options: GameOptions;
  phase: RoomPhase;
  owners: Owner[];
  turns: Map<number, TurnRecord>;
  /** Numéro du dernier tour annoncé (les tours s'enchaînent un par un). */
  lastTurn: number;
  end: Map<string, string>;
  /** Dernier `fromTick` diffusé (remplacement / changement d'hôte) : rappelé à un joueur qui reprend sa place. */
  aiFloor: number;
  /** Dernière activité (ms) : un salon inactif est fermé. */
  lastActive: number;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans O/0/I/1/L : lisible et dictable
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && Math.abs(v) < 1e9 ? v : null);

export interface RoomManagerOptions {
  /** Aléa du serveur (graines, codes) : injectable pour les tests. */
  random?: () => number;
  maxRooms?: number;
  /** Horloge (ms), injectable pour les tests. */
  now?: () => number;
  /** Secret d'une connexion (clé de reprise). */
  secret?: () => string;
  /** Délai de grâce (ms) laissé à un joueur déconnecté en pleine partie pour revenir ; 0 = remplacement immédiat. */
  graceMs?: number;
  /** Durée d'inactivité (ms) au bout de laquelle un salon est fermé. */
  idleMs?: number;
  /** Journal structuré (création de salon, lancement, désynchronisation, départs…). */
  log?: (event: string, data: Record<string, unknown>) => void;
}

export interface ServerStats { rooms: number; playing: number; players: number; created: number; started: number; desyncs: number }

/**
 * Logique des salons, sans réseau : création/jonction par code, configuration par l'hôte, tirage de la graine, relais
 * des intentions du joueur actif, relève de tour (confirmée quand tous les clients annoncent la même empreinte d'état),
 * détection de désynchronisation, remplacement d'un joueur déconnecté par l'IA et promotion d'un nouvel hôte.
 * Le serveur ne simule pas le jeu : il ordonne, autorise et compare.
 */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private byConn = new Map<string, string>(); // id de connexion → code de salon
  private conns = new Map<string, Conn>();
  private names = new Map<string, string>();
  private keys = new Map<string, string>();
  /** Connexion → identité de joueur reprise (`resume`) ; sans entrée, l'identité est l'id de la connexion. */
  private alias = new Map<string, string>();
  private random: () => number;
  private maxRooms: number;
  private now: () => number;
  private secret: () => string;
  private graceMs: number;
  private idleMs: number;
  private log: (event: string, data: Record<string, unknown>) => void;
  private counters = { created: 0, started: 0, desyncs: 0 };

  constructor(opts: RoomManagerOptions = {}) {
    this.random = opts.random ?? Math.random;
    this.maxRooms = opts.maxRooms ?? 200;
    this.now = opts.now ?? Date.now;
    this.secret = opts.secret ?? (() => Math.floor(this.random() * 2 ** 48).toString(36) + Math.floor(this.random() * 2 ** 48).toString(36));
    this.graceMs = opts.graceMs ?? 0;
    this.idleMs = opts.idleMs ?? 30 * 60_000;
    this.log = opts.log ?? (() => {});
  }

  get roomCount(): number { return this.rooms.size; }

  stats(): ServerStats {
    let playing = 0, players = 0;
    for (const r of this.rooms.values()) { if (r.phase === 'playing') playing++; players += r.players.size; }
    return { rooms: this.rooms.size, playing, players, ...this.counters };
  }

  /** Identité de joueur d'une connexion. */
  private pid(connId: string): string { return this.alias.get(connId) ?? connId; }

  connect(conn: Conn): void {
    this.conns.set(conn.id, conn);
    const key = this.secret();
    this.keys.set(conn.id, key);
    conn.send({ t: 'welcome', id: conn.id, key });
  }

  /** Connexion fermée. En pleine partie, la place est gardée pendant le délai de grâce (reprise possible) ; sinon départ. */
  disconnect(connId: string): void {
    const id = this.pid(connId);
    const room = this.roomOf(id);
    const p = room?.players.get(id);
    this.conns.delete(connId);
    this.names.delete(connId);
    this.keys.delete(connId);
    this.alias.delete(connId);
    if (p && p.conn && p.conn.id !== connId) return; // ancienne connexion d'un joueur déjà revenu
    if (room && p && room.phase === 'playing' && this.graceMs > 0) {
      p.conn = null;
      p.awayUntil = this.now() + this.graceMs;
      this.log('away', { room: room.code, player: id });
      this.broadcastRoom(room);
      return;
    }
    this.leave(id);
  }

  /** À appeler régulièrement : remplace les joueurs qui ne sont pas revenus à temps, ferme les salons inactifs. */
  tick(): void {
    const now = this.now();
    for (const room of [...this.rooms.values()]) {
      for (const p of [...room.players.values()]) if (!p.conn && now >= p.awayUntil) this.leave(p.id);
      if (!this.rooms.has(room.code)) continue;
      if (now - room.lastActive > this.idleMs) {
        this.log('expired', { room: room.code });
        for (const p of room.players.values()) {
          this.byConn.delete(p.id);
          if (p.conn) this.err(p.conn, 'expired', 'Salon fermé pour inactivité.');
        }
        this.rooms.delete(room.code);
      }
    }
  }

  /** Traite un message brut d'un client ; un message invalide est ignoré (jamais d'exception vers l'appelant). */
  message(id: string, raw: unknown): void {
    const conn = this.conns.get(id);
    if (!conn) return;
    let m: ClientMsg;
    try { m = (typeof raw === 'string' ? JSON.parse(raw) : raw) as ClientMsg; } catch { return; }
    if (typeof m !== 'object' || m === null || typeof (m as { t?: unknown }).t !== 'string') return;
    try {
      this.handle(conn, m);
    } catch {
      conn.send({ t: 'error', code: 'internal', message: 'Erreur interne' });
    }
  }

  // ------------------------------------------------------------------ messages

  private err(conn: Conn, code: string, message: string): void { conn.send({ t: 'error', code, message }); }

  private handle(conn: Conn, m: ClientMsg): void {
    switch (m.t) {
      case 'hello':
        if (m.v !== PROTOCOL_VERSION) { this.err(conn, 'version', 'Version du jeu incompatible : rechargez la page.'); return; }
        this.names.set(conn.id, str(m.name, LIMITS.nameMax) || 'Joueur');
        return;
      case 'create': return this.create(conn, m.options);
      case 'join': return this.join(conn, str(m.code, LIMITS.code).toUpperCase());
      case 'resume': return this.resume(conn, m);
      case 'leave': this.leave(this.pid(conn.id)); this.alias.delete(conn.id); return;
      case 'ping': return this.ping(conn, m.n, m.rtt);
      default: {
        const id = this.pid(conn.id);
        const room = this.roomOf(id);
        if (!room) return;
        room.lastActive = this.now();
        switch (m.t) {
          case 'config': return this.config(room, conn, id, m.options);
          case 'start': return this.start(room, conn, id, false);
          case 'rematch': return this.start(room, conn, id, true);
          case 'in': return this.relay(room, conn, id, m);
          case 'sum': return this.sum(room, id, m);
          case 'end': return this.end(room, id, m);
          default:
        }
      }
    }
  }

  private roomOf(id: string): Room | undefined {
    const code = this.byConn.get(id);
    return code ? this.rooms.get(code) : undefined;
  }

  private newCode(): string {
    for (let tries = 0; tries < 50; tries++) {
      let c = '';
      for (let i = 0; i < LIMITS.code; i++) c += CODE_ALPHABET[Math.floor(this.random() * CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
    throw new Error('plus de code de salon libre');
  }

  private create(conn: Conn, rawOptions: unknown): void {
    if (this.byConn.has(this.pid(conn.id))) this.leave(this.pid(conn.id));
    this.alias.delete(conn.id);
    if (this.rooms.size >= this.maxRooms) { this.err(conn, 'busy', 'Le serveur est complet, réessayez plus tard.'); return; }
    const options = this.cleanOptions(rawOptions);
    const room: Room = {
      code: this.newCode(), hostId: conn.id, players: new Map(), options, phase: 'lobby', owners: [], turns: new Map(), lastTurn: 0,
      end: new Map(), aiFloor: 0, lastActive: this.now(),
    };
    room.players.set(conn.id, this.player(conn));
    this.rooms.set(room.code, room);
    this.byConn.set(conn.id, room.code);
    this.counters.created++;
    this.log('create', { room: room.code, rooms: this.rooms.size });
    this.broadcastRoom(room);
  }

  private player(conn: Conn): Player {
    return { id: conn.id, key: this.keys.get(conn.id) ?? '', name: this.names.get(conn.id) ?? 'Joueur', rtt: -1, conn, awayUntil: 0 };
  }

  private join(conn: Conn, code: string): void {
    if (this.byConn.has(this.pid(conn.id))) this.leave(this.pid(conn.id));
    this.alias.delete(conn.id);
    const room = this.rooms.get(code);
    if (!room) { this.err(conn, 'not-found', 'Salon introuvable : vérifiez le code.'); return; }
    if (room.phase !== 'lobby') { this.err(conn, 'in-progress', 'La partie a déjà commencé.'); return; }
    if (this.humanSlots(room) <= room.players.size) { this.err(conn, 'full', 'Le salon est complet.'); return; }
    room.players.set(conn.id, this.player(conn));
    this.byConn.set(conn.id, room.code);
    room.lastActive = this.now();
    this.broadcastRoom(room);
  }

  /** Options validées ; l'équipe 0 est toujours celle de l'hôte (humaine) ; au moins une place humaine. */
  private cleanOptions(raw: unknown): GameOptions {
    const o = sanitizeOptions(raw ?? defaultOptions());
    const first = o.teams[0];
    if (first) first.controller = 'human';
    return o;
  }

  /** Nombre de places occupables par un humain (équipes `human`). */
  private humanSlots(room: Room): number {
    return room.options.teams.filter((t) => t.controller === 'human').length;
  }

  /** Place de chaque joueur : l'hôte prend l'équipe 0, les autres les équipes humaines libres, dans l'ordre d'arrivée. */
  private assign(room: Room): Map<string, number> {
    const out = new Map<string, number>();
    const free: number[] = [];
    room.options.teams.forEach((t, i) => { if (i > 0 && t.controller === 'human') free.push(i); });
    out.set(room.hostId, 0);
    for (const id of room.players.keys()) {
      if (id === room.hostId) continue;
      const slot = free.shift();
      if (slot !== undefined) out.set(id, slot);
    }
    return out;
  }

  private infos(room: Room): PlayerInfo[] {
    const slots = room.phase === 'lobby' ? this.assign(room) : null;
    return [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, host: p.id === room.hostId, rtt: p.rtt, ...(p.conn ? {} : { away: true }),
      team: slots ? (slots.get(p.id) ?? null) : (room.owners.indexOf(p.id) >= 0 ? room.owners.indexOf(p.id) : null),
    }));
  }

  private broadcastRoom(room: Room): void {
    const msg: ServerMsg = { t: 'room', code: room.code, hostId: room.hostId, phase: room.phase, players: this.infos(room), options: room.options };
    for (const p of room.players.values()) p.conn?.send(msg);
  }

  private broadcast(room: Room, m: ServerMsg, except?: string): void {
    for (const p of room.players.values()) if (p.id !== except) p.conn?.send(m);
  }

  private config(room: Room, conn: Conn, id: string, raw: unknown): void {
    if (id !== room.hostId || room.phase !== 'lobby') return;
    const next = this.cleanOptions(raw);
    const slots = next.teams.filter((t) => t.controller === 'human').length;
    if (slots < room.players.size) { this.err(conn, 'slots', 'Pas assez de places humaines pour les joueurs présents.'); return; }
    room.options = next;
    this.broadcastRoom(room);
  }

  private start(room: Room, conn: Conn, id: string, rematch: boolean): void {
    if (id !== room.hostId) { this.err(conn, 'not-host', "Seul l'hôte peut lancer la partie."); return; }
    if (rematch ? room.phase !== 'over' : room.phase !== 'lobby') return;
    if (!rematch) {
      // Équipes : l'hôte et les joueurs présents ; les places humaines restées vides passent à l'IA.
      const slots = this.assign(room);
      const byTeam = new Map<number, string>();
      for (const [pid, team] of slots) byTeam.set(team, pid);
      room.owners = room.options.teams.map((t, i) => (t.controller === 'human' ? (byTeam.get(i) ?? 'ai') : 'ai'));
    }
    room.phase = 'playing';
    room.turns.clear();
    room.lastTurn = 0;
    room.aiFloor = 0;
    room.end.clear();
    this.counters.started++;
    this.log('start', { room: room.code, players: room.players.size, teams: room.options.teams.length, rematch });
    // Graine tirée par le SERVEUR : tous les clients génèrent exactement la même carte.
    let seed = '';
    for (let i = 0; i < 8; i++) seed += Math.floor(this.random() * 16).toString(16);
    const options: GameOptions = structuredClone(room.options);
    options.seed = seed;
    options.teams.forEach((t, i) => {
      const owner = room.owners[i];
      const p = owner && owner !== 'ai' ? room.players.get(owner) : undefined;
      if (p) { t.controller = 'human'; t.name = p.name || t.name; } else { t.controller = 'ai'; }
    });
    this.broadcast(room, { t: 'start', seed, options, owners: room.owners.slice(), hostId: room.hostId });
    this.broadcastRoom(room);
  }

  private ownerAllowed(room: Room, owner: Owner | undefined, sender: string): boolean {
    return owner === sender || (owner === 'ai' && sender === room.hostId);
  }

  /** Relais des intentions du joueur actif (ou de l'hôte pour une équipe IA) : ordre garanti, sans trou. */
  private relay(room: Room, conn: Conn, id: string, m: Extract<ClientMsg, { t: 'in' }>): void {
    if (room.phase !== 'playing') return;
    const turn = int(m.turn), from = int(m.from);
    if (turn === null || from === null || !Array.isArray(m.items) || m.items.length === 0 || m.items.length > LIMITS.batch) return;
    const rec = room.turns.get(turn);
    if (!rec || !this.ownerAllowed(room, room.owners[rec.team], id)) return; // pas son tour : ignoré
    if (from > rec.next) { this.err(conn, 'gap', "Intentions manquantes : la partie ne peut plus rester synchronisée."); return; }
    const skip = rec.next - from; // chevauchement (renvoi) : on ne garde que le nouveau
    // Chaque intention est réduite aux champs connus : rien d'arbitraire n'est rediffusé aux autres joueurs.
    const items = m.items.slice(Math.max(0, skip)).map(cleanWire);
    if (items.length === 0) return;
    this.broadcast(room, { t: 'in', turn, from: rec.next, items, by: id }, id);
    for (const it of items) rec.items.push(it);
    rec.next += items.length;
  }

  /**
   * Relève de tour : chaque client annonce l'équipe et l'empreinte de l'état au début du tour. Dès que tous ont répondu,
   * les empreintes sont comparées : identiques → tour confirmé à tous ; différentes → désynchronisation.
   */
  private sum(room: Room, id: string, m: Extract<ClientMsg, { t: 'sum' }>): void {
    if (room.phase !== 'playing') return;
    const turn = int(m.turn), team = int(m.team), tick = int(m.tick);
    if (turn === null || team === null || tick === null || typeof m.hash !== 'string' || m.hash.length > 80) return;
    if (team < 0 || team >= room.owners.length) return;
    let rec = room.turns.get(turn);
    if (!rec) {
      // Les tours s'enchaînent un par un et le temps avance : une annonce hors séquence (vieille, ou forgée pour vider
      // l'historique) est ignorée.
      const prev = room.turns.get(room.lastTurn);
      if (turn !== room.lastTurn + 1 || tick < 0 || (prev && tick < prev.next)) return;
      rec = { turn, team, tick, next: tick, items: [], hashes: new Map(), confirmed: false };
      room.turns.set(turn, rec);
      room.lastTurn = turn;
      for (const k of [...room.turns.keys()]) if (k < turn - 8) room.turns.delete(k); // historique borné
    } else if (rec.team !== team || rec.tick !== tick) {
      this.desync(room, rec, id, m.hash);
      return;
    }
    rec.hashes.set(id, m.hash);
    this.compare(room, rec);
  }

  private compare(room: Room, rec: TurnRecord): void {
    if (rec.confirmed) return;
    const distinct = new Set(rec.hashes.values());
    if (distinct.size > 1) { this.desync(room, rec); return; }
    if (rec.hashes.size >= room.players.size) {
      rec.confirmed = true;
      this.broadcast(room, { t: 'turn', turn: rec.turn, team: rec.team, owner: room.owners[rec.team] ?? 'ai' });
    }
  }

  private desync(room: Room, rec: TurnRecord, extraId?: string, extraHash?: string): void {
    const hashes: Record<string, string> = {};
    for (const [id, h] of rec.hashes) hashes[id] = h;
    if (extraId && extraHash) hashes[extraId] = extraHash;
    room.phase = 'over';
    this.counters.desyncs++;
    this.log('desync', { room: room.code, turn: rec.turn, hashes });
    this.broadcast(room, { t: 'desync', turn: rec.turn, hashes });
    this.broadcastRoom(room);
  }

  /** Fin de partie : tous les clients doivent annoncer le même état final ; le salon passe alors en « terminé » (revanche possible). */
  private end(room: Room, id: string, m: Extract<ClientMsg, { t: 'end' }>): void {
    if (room.phase !== 'playing' || typeof m.hash !== 'string' || m.hash.length > 80) return;
    room.end.set(id, m.hash);
    if (new Set(room.end.values()).size > 1) {
      const hashes: Record<string, string> = {};
      for (const [id, h] of room.end) hashes[id] = h;
      room.phase = 'over';
      this.counters.desyncs++;
      this.log('desync', { room: room.code, turn: -1, hashes });
      this.broadcast(room, { t: 'desync', turn: -1, hashes });
      this.broadcastRoom(room);
      return;
    }
    if (room.end.size >= room.players.size) { room.phase = 'over'; this.log('end', { room: room.code }); this.broadcastRoom(room); }
  }

  /**
   * Reprise après une coupure : la nouvelle connexion présente l'ancien identifiant et sa clé. Elle retrouve sa place,
   * reçoit l'état du salon puis toutes les intentions relayées depuis son pas courant (`have`). Le client renvoie
   * ensuite ses propres annonces et intentions non parvenues (les doublons sont écartés par `relay`).
   */
  private resume(conn: Conn, m: Extract<ClientMsg, { t: 'resume' }>): void {
    const room = this.rooms.get(str(m.code, LIMITS.code).toUpperCase());
    const p = typeof m.id === 'string' ? room?.players.get(m.id) : undefined;
    const have = int(m.have);
    // Une connexion encore rattachée (coupure pas encore vue par le serveur) est simplement remplacée : la clé fait foi.
    if (!room || !p || room.phase === 'lobby' || have === null || typeof m.key !== 'string' || !p.key || m.key !== p.key) {
      this.err(conn, 'resume', 'Reprise impossible : la partie continue sans vous.');
      return;
    }
    if (this.byConn.has(this.pid(conn.id))) this.leave(this.pid(conn.id));
    this.alias.set(conn.id, p.id);
    p.conn = conn;
    p.awayUntil = 0;
    p.key = this.keys.get(conn.id) ?? p.key; // la clé de la nouvelle connexion servira à la prochaine reprise
    room.lastActive = this.now();
    this.log('resume', { room: room.code, player: p.id });
    conn.send({ t: 'resumed', id: p.id, hostId: room.hostId, owners: room.owners.slice(), aiFloor: room.aiFloor });
    for (const rec of [...room.turns.values()].sort((a, b) => a.turn - b.turn)) {
      for (let from = Math.max(have, rec.tick); from < rec.next; from += LIMITS.batch) {
        const items = rec.items.slice(from - rec.tick, from - rec.tick + LIMITS.batch);
        conn.send({ t: 'in', turn: rec.turn, from, items, by: '' });
      }
      if (rec.confirmed) conn.send({ t: 'turn', turn: rec.turn, team: rec.team, owner: room.owners[rec.team] ?? 'ai' });
    }
    this.broadcastRoom(room);
  }

  private ping(conn: Conn, n: unknown, rtt: unknown): void {
    conn.send({ t: 'pong', n: typeof n === 'number' ? n : 0 });
    const id = this.pid(conn.id);
    const room = this.roomOf(id);
    const p = room?.players.get(id);
    if (room && p && typeof rtt === 'number' && Number.isFinite(rtt)) {
      const next = Math.max(-1, Math.min(9999, Math.round(rtt)));
      // Première mesure toujours diffusée (sinon une latence < 8 ms ne s'afficherait jamais), puis seulement les écarts nets.
      if ((p.rtt < 0 && next >= 0) || Math.abs(p.rtt - next) > 8) {
        p.rtt = next;
        this.broadcast(room, { t: 'rtt', id, rtt: next }); // la latence de chacun est affichée à tous (message léger)
      }
    }
  }

  // ------------------------------------------------------------------ départs

  /** Un joueur quitte (ou perd sa connexion). Partie en cours : son équipe passe à l'IA ; l'hôte est remplacé si besoin. */
  private leave(id: string): void {
    const room = this.roomOf(id);
    this.byConn.delete(id);
    if (!room) return;
    const gone = room.players.get(id);
    room.players.delete(id);
    this.log('leave', { room: room.code, player: id, phase: room.phase, left: room.players.size });
    if (room.players.size === 0) { this.rooms.delete(room.code); return; }

    // Tour en cours (le plus récent) : sert à reprendre sans trou le flux d'intentions d'une IA ou d'un joueur parti.
    const cur = [...room.turns.values()].sort((a, b) => b.turn - a.turn)[0];
    if (room.hostId === id) {
      // Nouvel hôte : de préférence un joueur connecté (pas en cours de reprise).
      const present = [...room.players.values()].find((q) => q.conn) ?? room.players.values().next().value as Player;
      room.hostId = present.id;
      // Le nouvel hôte pilote les IA : il reprend au premier tick dont l'intention n'a pas été relayée.
      room.aiFloor = Math.max(room.aiFloor, cur?.next ?? 0);
      this.broadcast(room, { t: 'host', hostId: room.hostId, fromTick: cur?.next ?? 0 });
    }
    if (room.phase === 'playing' || room.phase === 'over') {
      room.end.delete(id);
      const team = room.owners.indexOf(id);
      if (team >= 0) {
        room.owners[team] = 'ai';
        // Si c'était son tour, l'IA de l'hôte reprend à partir du premier tick sans intention relayée.
        const fromTick = cur && cur.team === team ? cur.next : 0;
        room.aiFloor = Math.max(room.aiFloor, fromTick);
        this.broadcast(room, { t: 'replace', team, fromTick, hostId: room.hostId, name: gone?.name ?? '' });
      }
      for (const rec of room.turns.values()) { rec.hashes.delete(id); this.compare(room, rec); }
      if (room.phase === 'playing' && room.end.size >= room.players.size && room.end.size > 0) { room.phase = 'over'; }
    }
    this.broadcastRoom(room);
  }
}
