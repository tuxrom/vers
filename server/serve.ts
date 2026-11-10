import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { LIMITS } from '../src/net/protocol.ts';
import { RoomManager, type Conn } from './rooms.ts';

export interface RunningServer { port: number; rooms: RoomManager; close(): Promise<void> }

export interface ServerOptions {
  port?: number;
  host?: string;
  maxRooms?: number;
  heartbeatMs?: number;
  /** Connexions simultanées autorisées par adresse IP (0 = illimité). */
  maxConnPerIp?: number;
  /**
   * Origines autorisées (`https://exemple.fr`). Vide : seules les pages servies par le même hôte que le WebSocket
   * (en-tête `Origin` = `Host`) sont acceptées ; `*` : toutes. Les clients sans `Origin` (outils, tests) passent.
   */
  allowedOrigins?: string[];
  /** Délai laissé à un joueur déconnecté pour revenir avant d'être remplacé par l'IA (ms). */
  graceMs?: number;
  /** Inactivité (ms) avant fermeture d'un salon. */
  idleMs?: number;
  /** Journal (une ligne JSON par événement) ; muet par défaut. */
  log?: (event: string, data: Record<string, unknown>) => void;
}

const PRIVATE = /^(::ffff:)?(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|^::1$|^f[cd]/;

/** IP du client : celle transmise par le reverse proxy (réseau privé) sinon celle de la connexion. */
export function clientIp(req: IncomingMessage): string {
  const direct = req.socket.remoteAddress ?? '';
  if (PRIVATE.test(direct)) {
    const real = req.headers['x-real-ip'];
    if (typeof real === 'string' && real) return real.trim();
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd) return (fwd.split(',')[0] ?? '').trim();
  }
  return direct;
}

/** La page qui ouvre le WebSocket est-elle autorisée ? (protège des sites tiers qui utiliseraient le serveur) */
export function originAllowed(origin: string | undefined, hostHeader: string | undefined, allowed: string[]): boolean {
  if (!origin) return true;
  if (allowed.includes('*')) return true;
  if (allowed.length > 0) return allowed.includes(origin);
  // Même hôte que la page ; un proxy peut avoir retiré le port de l'en-tête Host.
  try { const u = new URL(origin); return u.host === hostHeader || u.hostname === hostHeader; } catch { return false; }
}

/**
 * Serveur de salons : WebSocket sur `/ws` + `GET /healthz` (+ `GET /stats`, non exposé par nginx). Aucune simulation de
 * jeu : il ordonne les intentions, tire les graines, confirme les tours et détecte les désynchronisations (rooms.ts).
 */
export function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const log = opts.log ?? (() => {});
  const maxPerIp = opts.maxConnPerIp ?? 12;
  const allowed = opts.allowedOrigins ?? [];
  const rooms = new RoomManager({
    maxRooms: opts.maxRooms ?? 200,
    random: () => randomBytes(4).readUInt32BE() / 4294967296,
    secret: () => randomBytes(18).toString('base64url'),
    graceMs: opts.graceMs ?? 20_000,
    idleMs: opts.idleMs,
    log,
  });
  const perIp = new Map<string, number>();
  const http: Server = createServer((req, res) => {
    if (req.url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok\n'); return; }
    if (req.url === '/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...rooms.stats(), connections: wss.clients.size, uptime: Math.round(process.uptime()) }) + '\n');
      return;
    }
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('WebSocket requis (chemin /ws)\n');
  });
  const wss = new WebSocketServer({
    server: http, path: '/ws', maxPayload: LIMITS.payload,
    verifyClient: (info, done) => {
      if (!originAllowed(info.origin || undefined, info.req.headers.host, allowed)) {
        log('reject', { why: 'origin', origin: info.origin });
        done(false, 403, 'Origine refusée');
        return;
      }
      if (maxPerIp > 0 && (perIp.get(clientIp(info.req)) ?? 0) >= maxPerIp) {
        log('reject', { why: 'ip-limit', ip: clientIp(info.req) });
        done(false, 429, 'Trop de connexions');
        return;
      }
      done(true);
    },
  });
  const alive = new WeakMap<WebSocket, boolean>();
  let counter = 0;

  wss.on('connection', (ws, req) => {
    const ip = clientIp(req);
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
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
      if (++count > 250) { log('reject', { why: 'rate', ip }); ws.close(1008, 'trop de messages'); return; }
      rooms.message(id, data.toString());
    });
    ws.on('close', () => {
      const n = (perIp.get(ip) ?? 1) - 1;
      if (n <= 0) perIp.delete(ip); else perIp.set(ip, n);
      rooms.disconnect(id);
    });
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
  // Délais de grâce expirés (joueur remplacé par l'IA) et salons inactifs.
  const sweeper = setInterval(() => rooms.tick(), 1000);

  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(opts.port ?? 8787, opts.host ?? '0.0.0.0', () => {
      const addr = http.address();
      resolve({
        port: typeof addr === 'object' && addr ? addr.port : (opts.port ?? 8787),
        rooms,
        close: () => new Promise<void>((done) => {
          clearInterval(heartbeat);
          clearInterval(sweeper);
          for (const ws of wss.clients) ws.terminate();
          wss.close(() => http.close(() => done()));
        }),
      });
    });
  });
}
