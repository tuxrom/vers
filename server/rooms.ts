import { defaultOptions, sanitizeOptions, type GameOptions } from '../src/core/options.ts';
import {
  LIMITS, PROTOCOL_VERSION, type ClientMsg, type Owner, type PlayerInfo, type RoomPhase, type ServerMsg,
} from '../src/net/protocol.ts';

/** Connexion abstraite (WebSocket en production, objet factice dans les tests). */
export interface Conn {
  readonly id: string;
  send(m: ServerMsg): void;
  close(): void;
}

interface Player { id: string; name: string; rtt: number; conn: Conn }

/** Suivi d'un tour : équipe active, intentions déjà relayées (prochain tick attendu) et empreintes des clients. */
interface TurnRecord { turn: number; team: number; tick: number; next: number; hashes: Map<string, string>; confirmed: boolean }

interface Room {
  code: string;
  hostId: string;
  players: Map<string, Player>;
  options: GameOptions;
  phase: RoomPhase;
  owners: Owner[];
  turns: Map<number, TurnRecord>;
  end: Map<string, string>;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans O/0/I/1/L : lisible et dictable
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && Math.abs(v) < 1e9 ? v : null);

export interface RoomManagerOptions {
  /** Aléa du serveur (graines, codes) : injectable pour les tests. */
  random?: () => number;
  maxRooms?: number;
}

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
  private random: () => number;
  private maxRooms: number;

  constructor(opts: RoomManagerOptions = {}) {
    this.random = opts.random ?? Math.random;
    this.maxRooms = opts.maxRooms ?? 200;
  }

  get roomCount(): number { return this.rooms.size; }

  connect(conn: Conn): void {
    this.conns.set(conn.id, conn);
    conn.send({ t: 'welcome', id: conn.id });
  }

  disconnect(id: string): void {
    this.leave(id);
    this.conns.delete(id);
    this.names.delete(id);
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
      case 'leave': this.leave(conn.id); return;
      case 'ping': return this.ping(conn, m.n, m.rtt);
      default: {
        const room = this.roomOf(conn.id);
        if (!room) return;
        switch (m.t) {
          case 'config': return this.config(room, conn, m.options);
          case 'start': return this.start(room, conn, false);
          case 'rematch': return this.start(room, conn, true);
          case 'in': return this.relay(room, conn, m);
          case 'sum': return this.sum(room, conn, m);
          case 'end': return this.end(room, conn, m);
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
    if (this.byConn.has(conn.id)) this.leave(conn.id);
    if (this.rooms.size >= this.maxRooms) { this.err(conn, 'busy', 'Le serveur est complet, réessayez plus tard.'); return; }
    const options = this.cleanOptions(rawOptions);
    const room: Room = {
      code: this.newCode(), hostId: conn.id, players: new Map(), options, phase: 'lobby', owners: [], turns: new Map(), end: new Map(),
    };
    room.players.set(conn.id, { id: conn.id, name: this.names.get(conn.id) ?? 'Joueur', rtt: -1, conn });
    this.rooms.set(room.code, room);
    this.byConn.set(conn.id, room.code);
    this.broadcastRoom(room);
  }

  private join(conn: Conn, code: string): void {
    if (this.byConn.has(conn.id)) this.leave(conn.id);
    const room = this.rooms.get(code);
    if (!room) { this.err(conn, 'not-found', 'Salon introuvable : vérifiez le code.'); return; }
    if (room.phase !== 'lobby') { this.err(conn, 'in-progress', 'La partie a déjà commencé.'); return; }
    if (this.humanSlots(room) <= room.players.size) { this.err(conn, 'full', 'Le salon est complet.'); return; }
    room.players.set(conn.id, { id: conn.id, name: this.names.get(conn.id) ?? 'Joueur', rtt: -1, conn });
    this.byConn.set(conn.id, room.code);
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
      id: p.id, name: p.name, host: p.id === room.hostId, rtt: p.rtt,
      team: slots ? (slots.get(p.id) ?? null) : (room.owners.indexOf(p.id) >= 0 ? room.owners.indexOf(p.id) : null),
    }));
  }

  private broadcastRoom(room: Room): void {
    const msg: ServerMsg = { t: 'room', code: room.code, hostId: room.hostId, phase: room.phase, players: this.infos(room), options: room.options };
    for (const p of room.players.values()) p.conn.send(msg);
  }

  private broadcast(room: Room, m: ServerMsg, except?: string): void {
    for (const p of room.players.values()) if (p.id !== except) p.conn.send(m);
  }

  private config(room: Room, conn: Conn, raw: unknown): void {
    if (conn.id !== room.hostId || room.phase !== 'lobby') return;
    const next = this.cleanOptions(raw);
    const slots = next.teams.filter((t) => t.controller === 'human').length;
    if (slots < room.players.size) { this.err(conn, 'slots', 'Pas assez de places humaines pour les joueurs présents.'); return; }
    room.options = next;
    this.broadcastRoom(room);
  }

  private start(room: Room, conn: Conn, rematch: boolean): void {
    if (conn.id !== room.hostId) { this.err(conn, 'not-host', "Seul l'hôte peut lancer la partie."); return; }
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
    room.end.clear();
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
  private relay(room: Room, conn: Conn, m: Extract<ClientMsg, { t: 'in' }>): void {
    if (room.phase !== 'playing') return;
    const turn = int(m.turn), from = int(m.from);
    if (turn === null || from === null || !Array.isArray(m.items) || m.items.length === 0 || m.items.length > LIMITS.batch) return;
    const rec = room.turns.get(turn);
    if (!rec || !this.ownerAllowed(room, room.owners[rec.team], conn.id)) return; // pas son tour : ignoré
    if (from > rec.next) { this.err(conn, 'gap', "Intentions manquantes : la partie ne peut plus rester synchronisée."); return; }
    const skip = rec.next - from; // chevauchement (renvoi) : on ne garde que le nouveau
    const items = m.items.slice(skip);
    if (items.length === 0) return;
    this.broadcast(room, { t: 'in', turn, from: rec.next, items, by: conn.id }, conn.id);
    rec.next += items.length;
  }

  /**
   * Relève de tour : chaque client annonce l'équipe et l'empreinte de l'état au début du tour. Dès que tous ont répondu,
   * les empreintes sont comparées : identiques → tour confirmé à tous ; différentes → désynchronisation.
   */
  private sum(room: Room, conn: Conn, m: Extract<ClientMsg, { t: 'sum' }>): void {
    if (room.phase !== 'playing') return;
    const turn = int(m.turn), team = int(m.team), tick = int(m.tick);
    if (turn === null || team === null || tick === null || typeof m.hash !== 'string' || m.hash.length > 80) return;
    if (team < 0 || team >= room.owners.length) return;
    let rec = room.turns.get(turn);
    if (!rec) {
      rec = { turn, team, tick, next: tick, hashes: new Map(), confirmed: false };
      room.turns.set(turn, rec);
      for (const k of [...room.turns.keys()]) if (k < turn - 8) room.turns.delete(k); // historique borné
    } else if (rec.team !== team || rec.tick !== tick) {
      this.desync(room, rec, conn.id, m.hash);
      return;
    }
    rec.hashes.set(conn.id, m.hash);
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
    this.broadcast(room, { t: 'desync', turn: rec.turn, hashes });
    this.broadcastRoom(room);
  }

  /** Fin de partie : tous les clients doivent annoncer le même état final ; le salon passe alors en « terminé » (revanche possible). */
  private end(room: Room, conn: Conn, m: Extract<ClientMsg, { t: 'end' }>): void {
    if (room.phase !== 'playing' || typeof m.hash !== 'string' || m.hash.length > 80) return;
    room.end.set(conn.id, m.hash);
    if (new Set(room.end.values()).size > 1) {
      const hashes: Record<string, string> = {};
      for (const [id, h] of room.end) hashes[id] = h;
      room.phase = 'over';
      this.broadcast(room, { t: 'desync', turn: -1, hashes });
      this.broadcastRoom(room);
      return;
    }
    if (room.end.size >= room.players.size) { room.phase = 'over'; this.broadcastRoom(room); }
  }

  private ping(conn: Conn, n: unknown, rtt: unknown): void {
    conn.send({ t: 'pong', n: typeof n === 'number' ? n : 0 });
    const room = this.roomOf(conn.id);
    const p = room?.players.get(conn.id);
    if (room && p && typeof rtt === 'number' && Number.isFinite(rtt)) {
      const changed = Math.abs(p.rtt - rtt) > 8;
      p.rtt = Math.max(-1, Math.min(9999, Math.round(rtt)));
      if (changed) this.broadcastRoom(room); // la latence de chacun est affichée à tous
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
    if (room.players.size === 0) { this.rooms.delete(room.code); return; }

    // Tour en cours (le plus récent) : sert à reprendre sans trou le flux d'intentions d'une IA ou d'un joueur parti.
    const cur = [...room.turns.values()].sort((a, b) => b.turn - a.turn)[0];
    if (room.hostId === id) {
      room.hostId = room.players.keys().next().value as string;
      // Le nouvel hôte pilote les IA : il reprend au premier tick dont l'intention n'a pas été relayée.
      this.broadcast(room, { t: 'host', hostId: room.hostId, fromTick: cur?.next ?? 0 });
    }
    if (room.phase === 'playing' || room.phase === 'over') {
      room.end.delete(id);
      const team = room.owners.indexOf(id);
      if (team >= 0) {
        room.owners[team] = 'ai';
        // Si c'était son tour, l'IA de l'hôte reprend à partir du premier tick sans intention relayée.
        const fromTick = cur && cur.team === team ? cur.next : 0;
        this.broadcast(room, { t: 'replace', team, fromTick, hostId: room.hostId, name: gone?.name ?? '' });
      }
      for (const rec of room.turns.values()) { rec.hashes.delete(id); this.compare(room, rec); }
      if (room.phase === 'playing' && room.end.size >= room.players.size && room.end.size > 0) { room.phase = 'over'; }
    }
    this.broadcastRoom(room);
  }
}
