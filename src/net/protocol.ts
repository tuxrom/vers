import { NEUTRAL_INTENT, type Intent } from '@/core/intent';
import type { GameOptions } from '@/core/options';

/** Version du protocole : le serveur refuse les clients incompatibles. */
export const PROTOCOL_VERSION = 1;

/** Identifiant de propriétaire d'une équipe : id d'un joueur, ou `ai` (pilotée par l'IA de l'hôte). */
export type Owner = string;

export interface PlayerInfo {
  id: string;
  name: string;
  /** Équipe occupée (null : spectateur / pas encore placé). */
  team: number | null;
  host: boolean;
  /** Latence aller-retour mesurée par le joueur (ms), −1 si inconnue. */
  rtt: number;
}

/** Intention compacte sur le réseau : 0 = neutre, sinon seuls les champs non nuls. */
export type WireIntent = 0 | {
  m?: -1 | 1; j?: 1; b?: 1; a?: -1 | 1; f?: 1; w?: string; z?: number; t?: [number, number]; s?: 1;
};

export type ClientMsg =
  | { t: 'hello'; v: number; name: string }
  | { t: 'create'; options: GameOptions }
  | { t: 'join'; code: string }
  | { t: 'config'; options: GameOptions }
  | { t: 'start' }
  | { t: 'rematch' }
  | { t: 'in'; turn: number; from: number; items: WireIntent[] }
  | { t: 'sum'; turn: number; team: number; tick: number; hash: string }
  | { t: 'end'; tick: number; hash: string; winner: number | null }
  | { t: 'ping'; n: number; rtt: number }
  | { t: 'leave' };

export type RoomPhase = 'lobby' | 'playing' | 'over';

export type ServerMsg =
  | { t: 'welcome'; id: string }
  | { t: 'room'; code: string; hostId: string; phase: RoomPhase; players: PlayerInfo[]; options: GameOptions }
  | { t: 'start'; seed: string; options: GameOptions; owners: Owner[]; hostId: string }
  | { t: 'in'; turn: number; from: number; items: WireIntent[]; by: string }
  | { t: 'turn'; turn: number; team: number; owner: Owner }
  | { t: 'desync'; turn: number; hashes: Record<string, string> }
  | { t: 'replace'; team: number; fromTick: number; hostId: string; name: string }
  | { t: 'host'; hostId: string; fromTick: number }
  | { t: 'pong'; n: number }
  | { t: 'error'; code: string; message: string };

/** Limites partagées client/serveur. */
export const LIMITS = { batch: 240, nameMax: 16, players: 4, code: 5, payload: 64 * 1024 } as const;

const NO_CRATERS: Intent['craters'] = [];

/** Encode une intention pour le réseau (les cratères de debug ne sont jamais transmis). */
export function encodeIntent(i: Intent): WireIntent {
  const w: Exclude<WireIntent, 0> = {};
  if (i.moveX) w.m = i.moveX;
  if (i.jump) w.j = 1;
  if (i.backflip) w.b = 1;
  if (i.aimDir) w.a = i.aimDir;
  if (i.fireDown) w.f = 1;
  if (i.selectWeapon) w.w = i.selectWeapon;
  if (i.fuse !== null) w.z = i.fuse;
  if (i.target) w.t = [i.target.x, i.target.y];
  if (i.skipTurn) w.s = 1;
  return Object.keys(w).length === 0 ? 0 : w;
}

/** Décode une intention reçue d'un pair : toute valeur invalide est neutralisée (on ne fait jamais confiance au réseau). */
export function decodeIntent(w: unknown): Intent {
  if (typeof w !== 'object' || w === null) return NEUTRAL_INTENT;
  const o = w as Record<string, unknown>;
  const dir = (v: unknown): -1 | 0 | 1 => (v === 1 ? 1 : v === -1 ? -1 : 0);
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const tx = Array.isArray(o.t) ? num(o.t[0]) : null, ty = Array.isArray(o.t) ? num(o.t[1]) : null;
  return {
    moveX: dir(o.m),
    jump: o.j === 1,
    backflip: o.b === 1,
    aimDir: dir(o.a),
    fireDown: o.f === 1,
    selectWeapon: typeof o.w === 'string' && o.w.length <= 24 ? o.w : null,
    fuse: num(o.z),
    target: tx !== null && ty !== null ? { x: tx, y: ty } : null,
    skipTurn: o.s === 1,
    craters: NO_CRATERS,
  };
}
