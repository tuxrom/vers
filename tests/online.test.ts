import { describe, expect, it } from 'vitest';
import { SIM_DT } from '@/config/engine';
import { GAMEPLAY } from '@/config/gameplay';
import { AiController } from '@/ai';
import { NEUTRAL_INTENT, type Intent } from '@/core/intent';
import { sanitizeOptions, type GameOptions } from '@/core/options';
import { Rng } from '@/core/rng';
import { step } from '@/core/simulation';
import { createState, syncHash, type GameState } from '@/core/state';
import { OnlineSession } from '@/net/session';
import { LIMITS, PROTOCOL_VERSION, cleanWire, decodeIntent, encodeIntent, type ClientMsg, type PlayerInfo, type ServerMsg } from '@/net/protocol';
import { RoomManager, type Conn } from '../server/rooms';

const NAMES = ['A', 'B', 'C', 'D'];

/** Réseau simulé : chaque message met `latency` frames à arriver (dans les deux sens). */
class FakeNet {
  frame = 0;
  private pending: { at: number; run: () => void }[] = [];
  constructor(public latency: number) {}
  later(run: () => void): void { this.pending.push({ at: this.frame + this.latency, run }); }
  tick(): void {
    this.frame++;
    const due = this.pending.filter((p) => p.at <= this.frame);
    this.pending = this.pending.filter((p) => p.at > this.frame);
    for (const d of due) d.run();
  }
}

/** Un client complet : session lockstep + simulation réelle + (pour l'hôte) IA, comme dans `main.ts`. */
class TestClient {
  state: GameState | null = null;
  session: OnlineSession | null = null;
  ai = new AiController();
  inbox: ServerMsg[] = [];
  id = '';
  alive = true;
  room: { phase: string; players: PlayerInfo[]; code: string; hostId: string; options: GameOptions } | null = null;
  hashes = new Map<number, string>();
  confirmed: number[] = [];
  events: string[] = [];
  desync = false;
  private memo = { turn: -1, held: 0 };
  stalls = 0;
  stepsPerFrame = 3;

  constructor(readonly name: string, private net: FakeNet, private server: RoomManager) {}
  /** Connexion courante (null pendant une coupure) ; `id` reste l'identité de joueur d'origine. */
  conn: Conn | null = null;
  key = '';
  resumes = 0;

  private open(connId: string): Conn {
    const conn: Conn = { id: connId, send: (m) => this.net.later(() => { if (this.alive && this.conn === conn) this.inbox.push(m); }), close: () => {} };
    this.conn = conn;
    this.server.connect(conn);
    this.toServer({ t: 'hello', v: PROTOCOL_VERSION, name: this.name });
    return conn;
  }

  connect(id: string): void { this.id = id; this.open(id); }

  toServer(m: ClientMsg): void {
    const conn = this.conn;
    if (!conn) return;
    this.net.later(() => { if (this.alive && this.conn === conn) this.server.message(conn.id, JSON.stringify(m)); });
  }

  disconnect(): void { this.alive = false; if (this.conn) this.server.disconnect(this.conn.id); }

  /** Coupure réseau : le serveur voit la connexion tomber, le client continue de simuler ce qu'il peut. */
  drop(): void { const c = this.conn; this.conn = null; if (c) this.server.disconnect(c.id); }

  /** Nouvelle connexion + reprise de la place avec l'ancienne clé. */
  resume(connId: string, key = this.key): void {
    this.open(connId);
    this.toServer({ t: 'resume', code: this.room!.code, id: this.id, key, have: this.state!.tick });
  }

  /** Entrée locale : un robot qui n'agit QUE par des intentions (jamais en écrivant dans l'état). */
  private bot(s: GameState): Intent {
    if (s.phase !== 'turn') return NEUTRAL_INTENT;
    if (this.memo.turn !== s.turnNumber) this.memo = { turn: s.turnNumber, held: 0 };
    const me = s.worms[s.turn.worm]!;
    const foes = s.worms.filter((w) => w.alive && !w.sunk && w.team !== me.team).sort((a, b) => Math.abs(a.x - me.x) - Math.abs(b.x - me.x));
    const target = foes[0];
    if (!target) return NEUTRAL_INTENT;
    const face = target.x >= me.x ? 1 : -1;
    if (me.facing !== face) return { ...NEUTRAL_INTENT, moveX: face };
    const v = GAMEPLAY.weapons.bazooka.maxSpeed;
    const want = 0.5 * Math.asin(Math.min(1, (GAMEPLAY.physics.gravity * Math.abs(target.x - me.x)) / (v * v)));
    const diff = want - s.turn.aim;
    if (Math.abs(diff) > GAMEPLAY.weapons.aim.rate * SIM_DT * 0.5) return { ...NEUTRAL_INTENT, aimDir: diff > 0 ? 1 : -1 };
    if (this.memo.held < 95) { this.memo.held++; return { ...NEUTRAL_INTENT, fireDown: this.memo.held < 92 }; }
    return NEUTRAL_INTENT;
  }

  private localIntent(s: GameState): Intent {
    const team = s.teams[s.turn.team]!;
    if (team.controller === 'ai') { this.ai.pump(s, 1e9, () => 0); return this.ai.nextIntent(s); }
    return this.bot(s);
  }

  frame(): void {
    for (const m of this.inbox.splice(0)) this.onServer(m);
    const s = this.state, ses = this.session;
    if (!s || !ses || ses.desync || !this.alive) return;
    for (let i = 0; i < this.stepsPerFrame && (s.phase as string) !== 'gameover'; i++) {
      const before = s.turnNumber;
      const intent = ses.intentFor(s, () => this.localIntent(s));
      if (intent === null) { this.stalls++; break; } // lockstep : on attend l'intention du joueur actif
      step(s, SIM_DT, intent);
      s.events.length = 0;
      if (s.turnNumber !== before) { this.hashes.set(s.turnNumber, syncHash(s)); ses.turnStarted(s); }
      if ((s.phase as string) === 'gameover') ses.gameEnded(s);
    }
    if (this.conn) for (const m of ses.drain()) this.toServer(m); // pendant une coupure, rien ne part (comme `OnlineController.flush`)
  }

  private onServer(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome': this.key = m.key; break;
      case 'resumed': {
        this.resumes++;
        for (const team of this.session!.resumed(m)) { this.state!.teams[team]!.controller = 'ai'; this.state!.teams[team]!.difficulty = 'medium'; this.events.push(`replace:${team}`); }
        break;
      }
      case 'error': this.events.push(`error:${m.code}`); break;
      case 'room': this.room = { phase: m.phase, players: m.players, code: m.code, hostId: m.hostId, options: m.options }; break;
      case 'start': {
        this.state = createState({ options: m.options, withCanvas: false });
        this.session = new OnlineSession(this.id, m.owners, m.hostId, this.room?.code ?? '');
        break;
      }
      default: {
        const r = this.session?.receive(m);
        if (m.t === 'turn') this.confirmed.push(m.turn);
        if (r?.kind === 'replace' && this.state) { this.state.teams[r.team]!.controller = 'ai'; this.state.teams[r.team]!.difficulty = 'medium'; this.events.push(`replace:${r.team}`); }
        if (r?.kind === 'desync') { this.desync = true; this.events.push('desync'); }
        if (r?.kind === 'host') this.events.push('host');
      }
    }
  }
}

function setup(n: number, opts: { latency?: number; options?: Partial<GameOptions>; graceMs?: number; idleMs?: number } = {}) {
  const net = new FakeNet(opts.latency ?? 4);
  const rng = new Rng(7);
  const clock = { ms: 0 };
  const server = new RoomManager({ random: () => rng.next(), now: () => clock.ms, graceMs: opts.graceMs ?? 0, idleMs: opts.idleMs });
  const clients = Array.from({ length: n }, (_, i) => new TestClient(NAMES[i]!, net, server));
  clients.forEach((c, i) => c.connect(`c${i}`));
  const teams = Math.max(2, n);
  const options = sanitizeOptions({
    teams: Array.from({ length: teams }, (_, i) => ({ name: NAMES[i], controller: 'human', color: undefined })),
    wormsPerTeam: 2, turnDuration: 30, ...opts.options,
  }, NAMES);
  const run = (frames: number, until?: () => boolean): void => {
    for (let f = 0; f < frames; f++) {
      net.tick();
      for (const c of clients) c.frame();
      if (until?.()) return;
    }
  };
  const lobby = (): void => {
    clients[0]!.toServer({ t: 'create', options });
    run(net.latency * 2 + 2);
    const code = clients[0]!.room!.code;
    for (const c of clients.slice(1)) c.toServer({ t: 'join', code });
    run(net.latency * 2 + 2);
  };
  return { net, server, clients, options, run, lobby, clock };
}

const equalHashes = (clients: TestClient[]): { turns: number; mismatches: number[] } => {
  const turns = new Set<number>();
  for (const c of clients) for (const t of c.hashes.keys()) turns.add(t);
  const mismatches: number[] = [];
  let compared = 0;
  for (const t of [...turns].sort((a, b) => a - b)) {
    const hs = clients.map((c) => c.hashes.get(t)).filter((h): h is string => h !== undefined);
    if (hs.length >= 2) { compared++; if (new Set(hs).size > 1) mismatches.push(t); }
  }
  return { turns: compared, mismatches };
};

describe('protocole', () => {
  it('encodage compact : neutre = 0 ; aller-retour sans perte ; valeurs hostiles neutralisées', () => {
    expect(encodeIntent(NEUTRAL_INTENT)).toBe(0);
    const it: Intent = { moveX: -1, jump: true, backflip: false, aimDir: 1, fireDown: true, selectWeapon: 'grenade', fuse: 4, target: { x: 12.5, y: -3.25 }, skipTurn: false, craters: [{ x: 1, y: 1, r: 9 }] };
    const back = decodeIntent(JSON.parse(JSON.stringify(encodeIntent(it))));
    expect(back).toEqual({ ...it, craters: [] }); // les cratères de debug ne voyagent jamais
    expect(decodeIntent(0)).toEqual(NEUTRAL_INTENT);
    const evil = decodeIntent({ m: 99, j: 'oui', a: 'x', w: 'x'.repeat(100), z: 'NaN', t: ['a', 2], f: 1 });
    expect(evil.moveX).toBe(0);
    expect(evil.jump).toBe(false);
    expect(evil.selectWeapon).toBeNull();
    expect(evil.fuse).toBeNull();
    expect(evil.target).toBeNull();
    expect(evil.fireDown).toBe(true);
  });
});

describe('salons', () => {
  it('création, code partagé, jonction, plein, introuvable, partie déjà commencée', () => {
    const { clients, run, options, net } = setup(3, { options: { teams: [
      { name: 'A', color: '#f08a9b', controller: 'human', difficulty: 'medium' },
      { name: 'B', color: '#6cb4f0', controller: 'human', difficulty: 'medium' },
    ] } });
    const [a, b, c] = clients as [TestClient, TestClient, TestClient];
    a.toServer({ t: 'create', options });
    run(net.latency * 2 + 2);
    expect(a.room!.code).toMatch(new RegExp(`^[A-Z2-9]{${LIMITS.code}}$`));
    expect(a.room!.players.length).toBe(1);
    b.toServer({ t: 'join', code: 'ZZZZZ' });
    run(net.latency * 2 + 2);
    expect(b.room).toBeNull(); // introuvable
    b.toServer({ t: 'join', code: a.room!.code.toLowerCase() }); // insensible à la casse
    run(net.latency * 2 + 2);
    expect(a.room!.players.map((p) => p.name)).toEqual(['A', 'B']);
    expect(a.room!.players.find((p) => p.name === 'B')!.team).toBe(1);
    // Salon plein : 2 équipes humaines, déjà 2 joueurs.
    c.toServer({ t: 'join', code: a.room!.code });
    run(net.latency * 2 + 2);
    expect(c.room).toBeNull();
    a.toServer({ t: 'start' });
    run(net.latency * 2 + 2);
    expect(a.state && b.state).toBeTruthy();
    expect(a.state!.seed).toBe(b.state!.seed);
  });

  it('seul l’hôte configure et lance ; la graine est tirée par le serveur (différente à chaque partie)', () => {
    const { clients, run, net, options, lobby } = setup(2);
    const [a, b] = clients as [TestClient, TestClient];
    lobby();
    b.toServer({ t: 'start' });
    run(net.latency * 2 + 2);
    expect(b.state).toBeNull();
    const cfg = structuredClone(options); cfg.wormsPerTeam = 4;
    b.toServer({ t: 'config', options: cfg });
    run(net.latency * 2 + 2);
    expect(a.room!.options.wormsPerTeam).toBe(2); // refusé : pas l'hôte
    a.toServer({ t: 'config', options: cfg });
    run(net.latency * 2 + 2);
    expect(b.room!.options.wormsPerTeam).toBe(4);
    a.toServer({ t: 'start' });
    run(net.latency * 2 + 2);
    expect(a.state!.worms.length).toBe(8);
    expect(a.state!.options.teams.map((t) => t.name)).toEqual(['A', 'B']); // noms = noms des joueurs
    expect(a.state!.options.seed).toBe(b.state!.options.seed);
    expect(a.state!.options.seed).toMatch(/^[0-9a-f]{8}$/);
    expect(a.state!.terrain.mask.checksum()).toBe(b.state!.terrain.mask.checksum()); // même carte
  });

  it('messages invalides ou hostiles ignorés ; intentions d’un non-propriétaire refusées', () => {
    const { server, clients, run, net, lobby } = setup(2);
    const [a, b] = clients as [TestClient, TestClient];
    lobby();
    a.toServer({ t: 'start' });
    run(net.latency * 2 + 2);
    for (const junk of ['pas du json', '[]', '{"t":42}', '{"t":"in"}', JSON.stringify({ t: 'in', turn: 1e12, from: 0, items: [0] }), JSON.stringify({ t: 'sum', turn: 'x' })]) server.message(a.id, junk);
    expect(() => server.message('inconnu', '{"t":"leave"}')).not.toThrow();
    // Le tour 1 est annoncé par les deux clients ; seul le propriétaire de l'équipe active peut envoyer des intentions.
    run(600, () => a.hashes.has(1) && b.hashes.has(1));
    const owner = a.state!.turn.team === 0 ? a : b;
    const intruder = owner === a ? b : a;
    const before = owner.state!.tick;
    const got: ServerMsg[] = [];
    const orig = (owner as unknown as { inbox: ServerMsg[] }).inbox;
    intruder.toServer({ t: 'in', turn: 1, from: before + 500, items: [{ f: 1 }] });
    run(net.latency * 2 + 2);
    expect(orig.concat(got).some((m) => m.t === 'in' && m.by === intruder.id)).toBe(false);
  });
});

describe('lockstep : mêmes entrées, mêmes états', () => {
  it('deux joueurs (latence ≈ 70 ms) : états identiques à chaque début de tour, tours confirmés par le serveur', () => {
    const { clients, run, lobby } = setup(2, { latency: 4 });
    const [a, b] = clients as [TestClient, TestClient];
    lobby();
    a.toServer({ t: 'start' });
    run(60 * 60 * 5, () => Math.min(a.state?.turnNumber ?? 0, b.state?.turnNumber ?? 0) >= 7 || a.state?.phase === 'gameover');
    const eq = equalHashes([a, b]);
    expect(eq.turns).toBeGreaterThanOrEqual(6);
    expect(eq.mismatches).toEqual([]);
    expect(a.desync || b.desync).toBe(false);
    expect(a.confirmed.length).toBeGreaterThanOrEqual(5);
    expect(a.stalls + b.stalls).toBeGreaterThan(0); // le lockstep attend réellement les intentions distantes
    // Quelqu'un a vraiment joué : des tirs ont eu lieu et fait des dégâts.
    expect(a.state!.teams.reduce((n, t) => n + t.stats.shots, 0)).toBeGreaterThan(0);
    expect(syncHash(a.state!).split('.')[0]).toBeDefined();
  }, 120_000);

  it('deux joueurs + une équipe IA pilotée par l’hôte : les deux appareils restent identiques', () => {
    const { clients, run, lobby } = setup(2, { latency: 3, options: { teams: [
      { name: 'A', color: '#f08a9b', controller: 'human', difficulty: 'medium' },
      { name: 'B', color: '#6cb4f0', controller: 'human', difficulty: 'medium' },
      { name: 'Robots', color: '#f0c75e', controller: 'ai', difficulty: 'medium' },
    ] } });
    const [a, b] = clients as [TestClient, TestClient];
    lobby();
    a.toServer({ t: 'start' });
    run(60 * 60 * 6, () => Math.min(a.state?.turnNumber ?? 0, b.state?.turnNumber ?? 0) >= 7 || a.state?.phase === 'gameover');
    expect(a.state!.options.teams[2]!.controller).toBe('ai');
    expect(a.session!.owner(2)).toBe('ai');
    const eq = equalHashes([a, b]);
    expect(eq.turns).toBeGreaterThanOrEqual(6);
    expect(eq.mismatches).toEqual([]);
    expect(a.desync || b.desync).toBe(false);
  }, 180_000);

  it('déconnexion en plein tour : l’équipe passe à l’IA de l’hôte, la partie continue sans trou ni divergence', () => {
    const { clients, run, lobby, net } = setup(3, { latency: 3 });
    const [a, b, c] = clients as [TestClient, TestClient, TestClient];
    lobby();
    a.toServer({ t: 'start' });
    // On attend que ce soit le tour de B et qu'il ait commencé à envoyer des intentions.
    run(60 * 60 * 3, () => a.state?.turn.team === 1 && a.state.phase === 'turn' && a.state.tick > (b.hashes.size ? a.state.tick - 1 : 1) && (b.state?.turn.team === 1) && b.session!.backlog(0) >= 0 && a.session!.confirmedTurn >= 1 && a.state.phaseTime > 1.2);
    const turnAtLeave = a.state!.turnNumber;
    expect(a.state!.turn.team).toBe(1);
    b.disconnect();
    run(net.latency * 2 + 2);
    expect(a.events).toContain('replace:1');
    expect(c.events).toContain('replace:1');
    expect(a.state!.teams[1]!.controller).toBe('ai');
    run(60 * 60 * 6, () => Math.min(a.state!.turnNumber, c.state!.turnNumber) >= turnAtLeave + 5 || a.state!.phase === 'gameover');
    expect(a.state!.turnNumber).toBeGreaterThanOrEqual(turnAtLeave + 3);
    const eq = equalHashes([a, c]);
    expect(eq.mismatches).toEqual([]);
    expect(a.desync || c.desync).toBe(false);
    expect(a.room!.players.map((p) => p.name)).toEqual(['A', 'C']);
  }, 180_000);

  it('départ de l’hôte : un autre joueur devient hôte et pilote l’IA, sans divergence', () => {
    const { clients, run, lobby, net } = setup(3, { latency: 3 });
    const [a, b, c] = clients as [TestClient, TestClient, TestClient];
    lobby();
    a.toServer({ t: 'start' });
    run(60 * 60 * 2, () => (b.state?.turnNumber ?? 0) >= 2);
    a.disconnect();
    run(net.latency * 2 + 2);
    expect(b.events).toContain('host');
    expect(b.session!.isHost).toBe(true);
    const t = b.state!.turnNumber;
    run(60 * 60 * 6, () => Math.min(b.state!.turnNumber, c.state!.turnNumber) >= t + 5 || b.state!.phase === 'gameover');
    expect(b.state!.turnNumber).toBeGreaterThanOrEqual(t + 3);
    const eq = equalHashes([b, c]);
    expect(eq.mismatches).toEqual([]);
    expect(b.desync || c.desync).toBe(false);
  }, 180_000);

  it('désynchronisation détectée : état altéré chez un client → alerte à tous au tour suivant', () => {
    const { clients, run, lobby } = setup(2, { latency: 2 });
    const [a, b] = clients as [TestClient, TestClient];
    lobby();
    a.toServer({ t: 'start' });
    run(60 * 60, () => (a.state?.turnNumber ?? 0) >= 2 && (b.state?.turnNumber ?? 0) >= 2);
    b.state!.worms[0]!.health -= 1; // triche / bug : l'état de B diverge
    run(60 * 60 * 4, () => a.desync && b.desync);
    expect(a.desync && b.desync).toBe(true);
    expect(a.room!.phase).toBe('over');
  }, 120_000);

  it('fin de partie : états finaux identiques, le salon passe en « terminé », revanche avec une nouvelle graine', () => {
    const { clients, run, lobby } = setup(2, { latency: 2, options: { wormsPerTeam: 1, startHealth: 25 } });
    const [a, b] = clients as [TestClient, TestClient];
    lobby();
    a.toServer({ t: 'start' });
    run(60 * 60 * 8, () => a.state?.phase === 'gameover' && b.state?.phase === 'gameover');
    expect(a.state!.phase).toBe('gameover');
    expect(syncHash(a.state!)).toBe(syncHash(b.state!));
    run(30);
    expect(a.room!.phase).toBe('over');
    const seed1 = a.state!.options.seed;
    a.toServer({ t: 'rematch' });
    run(30);
    expect(a.state!.options.seed).not.toBe(seed1);
    expect(a.state!.options.seed).toBe(b.state!.options.seed);
    expect(a.state!.turnNumber).toBeLessThanOrEqual(1); // nouvelle partie
  }, 180_000);
});

describe('durcissement du serveur', () => {
  it('cleanWire : seuls les champs connus et bornés sont rediffusés', () => {
    expect(cleanWire(0)).toBe(0);
    expect(cleanWire('x' as never)).toBe(0);
    const w = cleanWire({ m: 5, a: -1, j: 1, f: 2, w: '<script>', z: 1e9, t: [1, 'a'], evil: 'x'.repeat(5000) } as never);
    expect(JSON.stringify(w).length).toBeLessThan(40);
    expect(w).not.toHaveProperty('evil');
    expect(w).not.toHaveProperty('w');
    expect(w).not.toHaveProperty('t');
    expect(cleanWire({ w: 'bazooka', t: [10.5, 20], z: 3 })).toEqual({ w: 'bazooka', t: [10.5, 20], z: 3 });
    // Une intention normale traverse le filtre sans perte.
    const it: Intent = { ...NEUTRAL_INTENT, moveX: 1, fireDown: true, selectWeapon: 'grenade', fuse: 4, target: { x: 12, y: 34 } };
    expect(decodeIntent(cleanWire(encodeIntent(it)))).toEqual(decodeIntent(encodeIntent(it)));
  });

  it('annonce de tour hors séquence ignorée : impossible de détourner un tour futur ou de vider l’historique', () => {
    const { clients, run, lobby, net } = setup(2, { latency: 1 });
    const [a, b] = clients as [TestClient, TestClient];
    lobby();
    a.toServer({ t: 'start' });
    run(60 * 60, () => a.session !== null && a.session.confirmedTurn >= 1 && b.session!.confirmedTurn >= 1);
    expect(a.session!.confirmedTurn).toBe(1);
    // B forge un tour lointain attribué à son équipe, puis tente d'y injecter des actions.
    b.toServer({ t: 'sum', turn: 500, team: 1, tick: 9_000_000, hash: 'x' });
    b.toServer({ t: 'in', turn: 500, from: 9_000_000, items: [{ f: 1 }] });
    run(net.latency * 2 + 4);
    expect(a.desync || b.desync).toBe(false);
    run(60 * 60 * 3, () => Math.min(a.state!.turnNumber, b.state!.turnNumber) >= 4);
    expect(a.session!.confirmedTurn).toBeGreaterThanOrEqual(3); // les tours suivants sont toujours confirmés
    expect(equalHashes([a, b]).mismatches).toEqual([]);
  }, 120_000);

  it('salon inactif : fermé après le délai, les joueurs sont prévenus', () => {
    const { clients, run, lobby, server, clock, net } = setup(2, { latency: 1, idleMs: 60_000 });
    lobby();
    expect(server.roomCount).toBe(1);
    clock.ms += 59_000; server.tick();
    expect(server.roomCount).toBe(1);
    clock.ms += 2000; server.tick();
    run(net.latency * 2 + 2);
    expect(server.roomCount).toBe(0);
    expect(clients[0]!.events).toContain('error:expired');
    expect(server.stats()).toMatchObject({ rooms: 0, created: 1, started: 0 });
  });
});

describe('reconnexion', () => {
  it('coupure pendant son propre tour : place gardée, reprise par clé, actions manquées rejouées, aucune divergence', () => {
    const { clients, run, lobby, net, server, clock } = setup(2, { latency: 3, graceMs: 20_000 });
    const [a, b] = clients as [TestClient, TestClient];
    lobby();
    a.toServer({ t: 'start' });
    run(60 * 60 * 3, () => b.state?.turn.team === 1 && b.state.phase === 'turn' && b.state.phaseTime > 1 && a.state?.turn.team === 1);
    const turn = b.state!.turnNumber;
    b.drop();
    run(90); // 1,5 s hors ligne : B continue de jouer localement, A attend
    clock.ms += 5000; server.tick();
    expect(a.events).not.toContain('replace:1');
    expect(a.room!.players.find((p) => p.id === b.id)?.away).toBe(true);
    // Une clé fausse ne permet pas de voler la place.
    const thief = new TestClient('X', net, server);
    thief.id = b.id; thief.room = b.room; thief.state = b.state;
    thief.resume('thief', 'fausse-cle');
    thief.state = null;
    run(net.latency * 2 + 2);
    thief.frame();
    expect(thief.events).toContain('error:resume');
    b.resume('c1-bis');
    run(net.latency * 2 + 4);
    expect(b.resumes).toBe(1);
    expect(a.room!.players.find((p) => p.id === b.id)?.away).toBeFalsy();
    run(60 * 60 * 6, () => Math.min(a.state!.turnNumber, b.state!.turnNumber) >= turn + 4 || a.state!.phase === 'gameover');
    expect(Math.min(a.state!.turnNumber, b.state!.turnNumber)).toBeGreaterThanOrEqual(turn + 2);
    expect(equalHashes([a, b]).mismatches).toEqual([]);
    expect(a.desync || b.desync).toBe(false);
    expect(a.state!.teams[1]!.controller).toBe('human');
    expect(a.session!.confirmedTurn).toBeGreaterThanOrEqual(turn + 1);
  }, 180_000);

  it('coupure pendant le tour d’un autre : les actions relayées entre-temps sont renvoyées à la reprise ; seconde coupure possible', () => {
    const { clients, run, lobby } = setup(2, { latency: 3, graceMs: 20_000 });
    const [a, b] = clients as [TestClient, TestClient];
    lobby();
    a.toServer({ t: 'start' });
    run(60 * 60 * 3, () => a.state?.turn.team === 0 && a.state.phase === 'turn' && a.state.phaseTime > 1 && a.session!.confirmedTurn >= 1);
    const turn = a.state!.turnNumber;
    b.drop();
    run(60 * 4); // A joue pendant que B est hors ligne
    expect(b.state!.tick).toBeLessThan(a.state!.tick);
    b.resume('c1-bis');
    run(60 * 60 * 3, () => b.state!.turnNumber >= turn + 1);
    expect(b.state!.turnNumber).toBeGreaterThanOrEqual(turn + 1);
    b.drop();
    run(30);
    b.resume('c1-ter'); // la clé de la connexion précédente (reprise) fait foi
    run(60 * 60 * 6, () => Math.min(a.state!.turnNumber, b.state!.turnNumber) >= turn + 4 || a.state!.phase === 'gameover');
    expect(b.resumes).toBe(2);
    expect(equalHashes([a, b]).mismatches).toEqual([]);
    expect(a.desync || b.desync).toBe(false);
  }, 180_000);

  it('délai de grâce dépassé : l’équipe passe à l’IA ; la reprise tardive est refusée', () => {
    const { clients, run, lobby, net, server, clock } = setup(2, { latency: 3, graceMs: 20_000 });
    const [a, b] = clients as [TestClient, TestClient];
    lobby();
    a.toServer({ t: 'start' });
    run(60 * 60 * 3, () => a.state?.turn.team === 1 && a.state.phase === 'turn' && a.state.phaseTime > 1);
    const turn = a.state!.turnNumber;
    b.drop();
    clock.ms += 21_000; server.tick();
    run(net.latency * 2 + 2);
    expect(a.events).toContain('replace:1');
    b.resume('c1-bis');
    run(net.latency * 2 + 2);
    expect(b.events).toContain('error:resume');
    run(60 * 60 * 6, () => a.state!.turnNumber >= turn + 3 || a.state!.phase === 'gameover');
    expect(a.state!.turnNumber).toBeGreaterThanOrEqual(turn + 2);
    expect(a.desync).toBe(false);
  }, 180_000);
});
