import { startServer } from './serve.ts';

const num = (v: string | undefined, d: number): number => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) ? n : d; };

/**
 * Point d'entrée. Variables : PORT (8787), HOST (0.0.0.0), MAX_ROOMS (200), MAX_CONN_PER_IP (12, 0 = illimité),
 * ALLOWED_ORIGINS (liste séparée par des virgules ; vide = même hôte que la page ; `*` = toutes),
 * GRACE_MS (20000 : délai de reprise après une coupure), IDLE_MS (1800000 : fermeture d'un salon inactif).
 */
const log = (event: string, data: Record<string, unknown>): void => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
};
const server = await startServer({
  port: num(process.env.PORT, 8787),
  host: process.env.HOST ?? '0.0.0.0',
  maxRooms: num(process.env.MAX_ROOMS, 200),
  maxConnPerIp: num(process.env.MAX_CONN_PER_IP, 12),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  graceMs: num(process.env.GRACE_MS, 20_000),
  idleMs: num(process.env.IDLE_MS, 30 * 60_000),
  log,
});
log('listening', { port: server.port });
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void server.close().then(() => process.exit(0)); });
