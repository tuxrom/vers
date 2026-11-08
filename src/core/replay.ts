import { Terrain } from '@/terrain/terrain';
import { TerrainMask } from '@/terrain/mask';
import type { Intent } from './intent';
import { Rng } from './rng';
import { hashState, type GameState } from './state';

/**
 * Copie complète et indépendante de l'état de simulation à un instant donné : suffit, avec la suite des
 * intentions, à rejouer EXACTEMENT ce qui s'est passé (la simulation est déterministe : graine, pas fixe,
 * aucune horloge). C'est la base du replay au ralenti (killcam).
 */
export interface Snapshot {
  state: Omit<GameState, 'rng' | 'terrain' | 'events'>;
  rng: number;
  mask: Uint8Array;
  width: number;
  height: number;
}

export function snapshotState(s: GameState): Snapshot {
  const { rng, terrain, events, ...rest } = s;
  void events;
  return {
    state: structuredClone(rest) as Snapshot['state'],
    rng: rng.getState(),
    mask: terrain.mask.data.slice(),
    width: terrain.width,
    height: terrain.height,
  };
}

/** Recrée un état vivant depuis un instantané (le terrain redevient un `Terrain` complet, rendu paresseux). */
export function restoreState(snap: Snapshot, withCanvas = true): GameState {
  const rng = new Rng(0);
  rng.setState(snap.rng);
  const terrain = new Terrain(new TerrainMask(snap.width, snap.height, snap.mask.slice()), withCanvas);
  return { ...structuredClone(snap.state), rng, terrain, events: [] } as GameState;
}

/** Un tour enregistré : état au début du tour + intentions de chaque pas + repères du tir. */
export interface Recording {
  snap: Snapshot;
  /** Intention appliquée à chaque pas depuis l'instantané (indice 0 = premier pas après le début du tour). */
  intents: Intent[];
  startTick: number;
  /** Tick (état après le pas) du premier tir / de la dernière explosion du tour ; null si aucun. */
  shotTick: number | null;
  lastExplosionTick: number | null;
  /** Empreinte de l'état à la fin de l'enregistrement : permet de vérifier la fidélité d'un replay. */
  endHash: string;
  endTick: number;
}

/**
 * Enregistre en continu le tour en cours (instantané de début de tour + intentions). À appeler après chaque pas de
 * simulation. Conserve le dernier tour terminé où quelque chose a explosé.
 */
export class TurnRecorder {
  private current: Recording | null = null;
  private turn = -1;
  private lastLen = 0;
  /** Dernier tour terminé contenant une explosion. */
  private finished: Recording | null = null;

  /** `intent` = intention utilisée par le pas qui vient d'être exécuté sur `s`. */
  afterStep(s: GameState, intent: Intent): void {
    // Événements du pas : repères du tir et de l'explosion (la file est vidée par le rendu entre les frames).
    if (s.events.length < this.lastLen) this.lastLen = 0;
    for (let i = this.lastLen; i < s.events.length; i++) {
      const e = s.events[i];
      if (!e || !this.current) continue;
      if (e.t === 'shot' && this.current.shotTick === null) this.current.shotTick = s.tick;
      if (e.t === 'explosion') this.current.lastExplosionTick = s.tick;
    }
    this.lastLen = s.events.length;

    if (s.turnNumber !== this.turn) {
      // Nouveau tour : ce pas appartient encore à l'ancien (transition) ; on le clôt puis on repart d'un instantané.
      if (this.current) { this.current.intents.push(intent); this.finish(s); }
      this.current = {
        snap: snapshotState(s), intents: [], startTick: s.tick, shotTick: null, lastExplosionTick: null, endHash: '', endTick: s.tick,
      };
      this.turn = s.turnNumber;
    } else if (this.current) {
      this.current.intents.push(intent);
    }
    if (s.phase === 'gameover' && this.current && !this.current.endHash) this.finish(s, false);
  }

  private finish(s: GameState, restart = true): void {
    const c = this.current;
    if (!c) return;
    c.endHash = hashState(s);
    c.endTick = s.tick;
    if (c.lastExplosionTick !== null) this.finished = c;
    if (restart) this.current = null;
  }

  /** Y a-t-il un tir à rejouer ? (sans allocation : appelé à chaque frame par l'interface) */
  hasShot(): boolean { return this.current?.lastExplosionTick != null || this.finished !== null; }

  /** Dernier tir rejouable : le tour en cours s'il a déjà fait exploser quelque chose, sinon le dernier tour terminé. */
  latest(s: GameState): Recording | null {
    const c = this.current;
    if (c && c.lastExplosionTick !== null) return { ...c, endTick: s.tick, endHash: '' };
    return this.finished;
  }

  reset(): void { this.current = null; this.finished = null; this.turn = -1; this.lastLen = 0; }
}
