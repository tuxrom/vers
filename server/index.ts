import { startServer } from './serve.ts';

/** Point d'entrée : PORT (8787), HOST (0.0.0.0), MAX_ROOMS (200). */
const server = await startServer({
  port: Number(process.env.PORT ?? 8787), host: process.env.HOST ?? '0.0.0.0', maxRooms: Number(process.env.MAX_ROOMS ?? 200),
});
console.log(`[vers-server] écoute sur le port ${server.port} (ws : /ws, santé : /healthz)`);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void server.close().then(() => process.exit(0)); });
