import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { LIMITS } from '../src/net/protocol.ts';
import { RoomManager, type Conn } from './rooms.ts';

export interface RunningServer { port: number; rooms: RoomManager; close(): Promise<void> }

/**
 * Serveur de salons : WebSocket sur `/ws` + `GET /healthz`. Aucune simulation de jeu : il ordonne les intentions,
 * tire les graines, confirme les tours et détecte les désynchronisations (voir rooms.ts).
 */
export function startServer(opts: { port?: number; host?: string; maxRooms?: number; heartbeatMs?: number } = {}): Promise<RunningServer> {
  const rooms = new RoomManager({ maxRooms: opts.maxRooms ?? 200, random: () => randomBytes(4).readUInt32BE() / 4294967296 });
  const http: Server = createServer((req, res) => {
    if (req.url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok\n'); return; }
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('WebSocket requis (chemin /ws)\n');
  });
  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: LIMITS.payload });
  const alive = new WeakMap<WebSocket, boolean>();
  let counter = 0;

  wss.on('connection', (ws) => {
    const id = `p${(++counter).toString(36)}${randomBytes(3).toString('hex')}`;
    const conn: Conn = {
      id,
      send: (m) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); },
      close: () => ws.close(),
    };
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    // Anti-abus : au plus ~250 messages par seconde et par connexion (60 intentions/s en lots + pings).
    let windowStart = Date.now(), count = 0;
    ws.on('message', (data) => {
      const now = Date.now();
      if (now - windowStart > 1000) { windowStart = now; count = 0; }
      if (++count > 250) { ws.close(1008, 'trop de messages'); return; }
      rooms.message(id, data.toString());
    });
    ws.on('close', () => rooms.disconnect(id));
    ws.on('error', () => ws.terminate());
    rooms.connect(conn);
  });

  // Détection des connexions mortes (coupure réseau sans fermeture propre).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) { ws.terminate(); continue; }
      alive.set(ws, false);
      ws.ping();
    }
  }, opts.heartbeatMs ?? 20_000);

  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(opts.port ?? 8787, opts.host ?? '0.0.0.0', () => {
      const addr = http.address();
      resolve({
        port: typeof addr === 'object' && addr ? addr.port : (opts.port ?? 8787),
        rooms,
        close: () => new Promise<void>((done) => {
          clearInterval(heartbeat);
          for (const ws of wss.clients) ws.terminate();
          wss.close(() => http.close(() => done()));
        }),
      });
    });
  });
}
