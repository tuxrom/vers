import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from '@/net/protocol';
import { clientIp, originAllowed, startServer, type RunningServer } from '../server/serve';

/** Client WebSocket minimal (WebSocket natif de Node 22) avec file de messages typés. */
class Peer {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  id = '';
  constructor(url: string, readonly name: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => { const m = JSON.parse(String(e.data)) as ServerMsg; if (m.t === 'welcome') this.id = m.id; this.msgs.push(m); };
  }
  open(): Promise<void> {
    return new Promise((res, rej) => { this.ws.onopen = () => { this.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.name }); res(); }; this.ws.onerror = () => rej(new Error('ws')); });
  }
  send(m: ClientMsg): void { this.ws.send(JSON.stringify(m)); }
  async next<T extends ServerMsg['t']>(t: T, ms = 3000): Promise<Extract<ServerMsg, { t: T }>> {
    const end = Date.now() + ms;
    for (;;) {
      const i = this.msgs.findIndex((m) => m.t === t);
      if (i >= 0) return this.msgs.splice(i, 1)[0] as Extract<ServerMsg, { t: T }>;
      if (Date.now() > end) throw new Error(`message « ${t} » non reçu`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

let srv: RunningServer;
beforeAll(async () => { srv = await startServer({ port: 0, host: '127.0.0.1', heartbeatMs: 60_000, graceMs: 0 }); });
afterAll(async () => { await srv.close(); });

describe('serveur WebSocket réel', () => {
  it('répond sur /healthz et refuse les requêtes HTTP ordinaires', async () => {
    expect(await (await fetch(`http://127.0.0.1:${srv.port}/healthz`)).text()).toBe('ok\n');
    expect((await fetch(`http://127.0.0.1:${srv.port}/`)).status).toBe(426);
  });

  it('deux clients : salon, jonction par code, graine commune, relais des intentions, relève de tour, latence', async () => {
    const url = `ws://127.0.0.1:${srv.port}/ws`;
    const a = new Peer(url, 'Alice'), b = new Peer(url, 'Bob');
    await Promise.all([a.open(), b.open()]);
    await a.next('welcome'); await b.next('welcome');
    a.send({ t: 'create', options: { teams: [], wormsPerTeam: 3, seed: 'x', turnDuration: 45, startHealth: 100 } as never });
    const room = await a.next('room');
    expect(room.code).toHaveLength(5);
    expect(room.players).toHaveLength(1);
    b.send({ t: 'join', code: room.code });
    const joined = await b.next('room');
    expect(joined.players.map((p) => p.name).sort()).toEqual(['Alice', 'Bob']);
    a.send({ t: 'start' });
    const sa = await a.next('start'), sb = await b.next('start');
    expect(sa.seed).toBe(sb.seed);
    expect(sa.owners).toEqual([a.id, b.id]);
    expect(sa.hostId).toBe(a.id);
    // Alice (équipe 0) joue le tour 1 : elle annonce l'état, puis envoie ses intentions ; Bob les reçoit.
    a.send({ t: 'sum', turn: 1, team: 0, tick: 100, hash: 'H' });
    b.send({ t: 'sum', turn: 1, team: 0, tick: 100, hash: 'H' });
    expect((await a.next('turn')).turn).toBe(1);
    a.send({ t: 'in', turn: 1, from: 100, items: [0, { m: 1 }, { f: 1 }] });
    const relayed = await b.next('in');
    expect(relayed).toMatchObject({ turn: 1, from: 100, by: a.id });
    expect(relayed.items).toEqual([0, { m: 1 }, { f: 1 }]);
    // Bob n'est pas propriétaire de l'équipe 0 : ses intentions pour ce tour sont ignorées.
    b.send({ t: 'in', turn: 1, from: 103, items: [{ f: 1 }] });
    await new Promise((r) => setTimeout(r, 120));
    expect(a.msgs.some((m) => m.t === 'in')).toBe(false);
    // Latence : pong immédiat, puis valeur diffusée à tous.
    b.send({ t: 'ping', n: 1, rtt: 87 });
    expect((await b.next('pong')).n).toBe(1);
    let upd = await a.next('rtt');
    for (let i = 0; i < 10 && upd.rtt !== 87; i++) upd = await a.next('rtt'); // ignore d'éventuelles mesures plus anciennes
    expect(upd).toMatchObject({ id: b.id, rtt: 87 });
    // Une première mesure très faible (réseau local) est diffusée elle aussi.
    a.send({ t: 'ping', n: 2, rtt: 3 });
    let low = await b.next('rtt');
    while (low.id !== a.id) low = await b.next('rtt'); // Bob reçoit aussi sa propre mesure
    expect(low.rtt).toBe(3);
    // Départ de Bob en pleine partie : Alice est prévenue, l'équipe de Bob passe à l'IA.
    b.ws.close();
    const rep = await a.next('replace');
    expect(rep.team).toBe(1);
    expect(srv.rooms.roomCount).toBe(1);
    a.ws.close();
    await new Promise((r) => setTimeout(r, 150));
    expect(srv.rooms.roomCount).toBe(0); // salon supprimé quand le dernier joueur part
  });

  it('désynchronisation : empreintes différentes → alerte', async () => {
    const url = `ws://127.0.0.1:${srv.port}/ws`;
    const a = new Peer(url, 'A'), b = new Peer(url, 'B');
    await Promise.all([a.open(), b.open()]);
    await a.next('welcome'); await b.next('welcome');
    a.send({ t: 'create', options: { teams: [], wormsPerTeam: 3, seed: 'x', turnDuration: 45, startHealth: 100 } as never });
    const room = await a.next('room');
    b.send({ t: 'join', code: room.code });
    await b.next('room');
    a.send({ t: 'start' });
    await a.next('start');
    a.send({ t: 'sum', turn: 1, team: 0, tick: 10, hash: 'AAA' });
    b.send({ t: 'sum', turn: 1, team: 0, tick: 10, hash: 'BBB' });
    const d = await a.next('desync');
    expect(d.turn).toBe(1);
    expect(Object.values(d.hashes).sort()).toEqual(['AAA', 'BBB']);
    a.ws.close(); b.ws.close();
  });
});

describe('garde-fous du serveur', () => {
  it('origine : même hôte par défaut, liste blanche, joker ; client sans en-tête Origin accepté', () => {
    expect(originAllowed(undefined, 'vers.example', [])).toBe(true);
    expect(originAllowed('https://vers.example', 'vers.example', [])).toBe(true);
    expect(originAllowed('http://127.0.0.1:8099', '127.0.0.1:8099', [])).toBe(true);
    expect(originAllowed('http://127.0.0.1:8099', '127.0.0.1', [])).toBe(true); // port retiré par un proxy
    expect(originAllowed('https://evil.example', 'vers.example', [])).toBe(false);
    expect(originAllowed('pas une url', 'vers.example', [])).toBe(false);
    expect(originAllowed('https://autre.example', 'vers.example', ['https://autre.example'])).toBe(true);
    expect(originAllowed('https://vers.example', 'vers.example', ['https://autre.example'])).toBe(false);
    expect(originAllowed('https://evil.example', 'vers.example', ['*'])).toBe(true);
  });

  it('adresse du client : en-têtes du proxy crus seulement depuis un réseau privé', () => {
    const req = (remoteAddress: string, headers: Record<string, string>) => ({ socket: { remoteAddress }, headers }) as never;
    expect(clientIp(req('172.18.0.5', { 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientIp(req('127.0.0.1', { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
    expect(clientIp(req('198.51.100.4', { 'x-real-ip': '203.0.113.9' }))).toBe('198.51.100.4');
  });

  it('limite de connexions par adresse, message trop gros refusé, /stats', async () => {
    const s = await startServer({ port: 0, host: '127.0.0.1', heartbeatMs: 60_000, maxConnPerIp: 2 });
    try {
      const url = `ws://127.0.0.1:${s.port}/ws`;
      const p1 = new Peer(url, 'A'); await p1.open();
      const p2 = new Peer(url, 'B'); await p2.open();
      await p1.next('welcome'); await p2.next('welcome');
      const p3 = new Peer(url, 'C');
      await expect(p3.open()).rejects.toThrow();
      // Un message au-delà de la taille maximale ferme la connexion fautive.
      const closed = new Promise<void>((r) => { p2.ws.onclose = () => r(); });
      p2.ws.send(JSON.stringify({ t: 'create', options: { pad: 'x'.repeat(40_000) } }));
      await closed;
      p1.send({ t: 'create', options: {} as never });
      await p1.next('room');
      const stats = await (await fetch(`http://127.0.0.1:${s.port}/stats`)).json() as { rooms: number; created: number };
      expect(stats).toMatchObject({ rooms: 1, created: 1 });
      p1.ws.close();
    } finally { await s.close(); }
  });

  it('reprise sur un vrai socket : place gardée pendant le délai de grâce', async () => {
    const s = await startServer({ port: 0, host: '127.0.0.1', heartbeatMs: 60_000, graceMs: 5000 });
    try {
      const url = `ws://127.0.0.1:${s.port}/ws`;
      const a = new Peer(url, 'Alice'); const b = new Peer(url, 'Bob');
      await a.open(); await b.open();
      await a.next('welcome'); const wb = await b.next('welcome');
      a.send({ t: 'create', options: { teams: [{ name: 'A', controller: 'human' }, { name: 'B', controller: 'human' }] } as never });
      const room = await a.next('room');
      b.send({ t: 'join', code: room.code });
      await b.next('room');
      a.send({ t: 'start' });
      await a.next('start'); await b.next('start');
      a.send({ t: 'sum', turn: 1, team: 0, tick: 50, hash: 'h' });
      b.send({ t: 'sum', turn: 1, team: 0, tick: 50, hash: 'h' });
      await b.next('turn');
      b.ws.close();
      await new Promise((r) => setTimeout(r, 100));
      a.send({ t: 'in', turn: 1, from: 50, items: [0, { m: 1 }] });
      const b2 = new Peer(url, 'Bob'); await b2.open(); await b2.next('welcome');
      b2.send({ t: 'resume', code: room.code, id: wb.id, key: wb.key, have: 50 });
      expect(await b2.next('resumed')).toMatchObject({ id: wb.id });
      expect(await b2.next('in')).toMatchObject({ turn: 1, from: 50, items: [0, { m: 1 }] });
      expect(a.msgs.some((m) => m.t === 'replace')).toBe(false);
      a.ws.close(); b2.ws.close();
    } finally { await s.close(); }
  });
});
