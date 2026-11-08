import { GAMEPLAY } from '@/config/gameplay';
import { QUALITY, type Quality } from '@/config/engine';
import { isLang, type Lang } from '@/ui/i18n';
import { DEFAULT_TOUCH, sanitizeTouch, type TouchSettings } from '@/ui/touch/layout';
import { sanitizeOptions, type GameOptions } from './options';
import type { GameState } from './state';

/** Mode d'interface : détection automatique, ou forcé (HUD PC / HUD tactile). */
export type ControlsMode = 'auto' | 'pc' | 'touch';
export const CONTROLS_MODES: readonly ControlsMode[] = ['auto', 'pc', 'touch'];

/** Réglages de l'application (hors partie). Volumes dans [0,1]. */
export interface Settings {
  sound: number;
  music: number;
  quality: Quality;
  lang: Lang;
  controls: ControlsMode;
  /** Retour haptique (vibrations) sur mobile. */
  haptics: boolean;
  /** Taille et position des commandes tactiles. */
  touch: TouchSettings;
}

/** Statistiques cumulées sur toutes les parties terminées de cet appareil. */
export interface CumulativeStats {
  games: number;
  turns: number;
  damage: number;
  kills: number;
  shots: number;
  misses: number;
  /** Plus longue partie (en tours). */
  longest: number;
}

export const DEFAULT_SETTINGS: Settings = {
  sound: 0.8, music: 0.4, quality: 'high', lang: 'fr', controls: 'auto', haptics: true, touch: DEFAULT_TOUCH,
};
export const EMPTY_STATS: CumulativeStats = { games: 0, turns: 0, damage: 0, kills: 0, shots: 0, misses: 0, longest: 0 };

/** Stockage clé/valeur minimal (localStorage ou mémoire) : permet de tester et de survivre à un stockage indisponible. */
export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function memoryKV(): KV {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) };
}

/** localStorage si disponible (navigation privée, quota, blocage : repli silencieux sur la mémoire). */
export function localKV(): KV {
  const fallback = memoryKV();
  return {
    get(k) { try { return localStorage.getItem(k); } catch { return fallback.get(k); } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { fallback.set(k, v); } },
    remove(k) { try { localStorage.removeItem(k); } catch { fallback.remove(k); } },
  };
}

const PREFIX = 'vers:v1:';
const num = (v: unknown, d: number, lo = 0, hi = Number.MAX_SAFE_INTEGER): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

export function sanitizeSettings(raw: unknown): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    sound: num(r.sound, DEFAULT_SETTINGS.sound, 0, 1),
    music: num(r.music, DEFAULT_SETTINGS.music, 0, 1),
    quality: typeof r.quality === 'string' && r.quality in QUALITY ? (r.quality as Quality) : DEFAULT_SETTINGS.quality,
    lang: isLang(r.lang) ? r.lang : DEFAULT_SETTINGS.lang,
    controls: CONTROLS_MODES.includes(r.controls as ControlsMode) ? (r.controls as ControlsMode) : 'auto',
    haptics: typeof r.haptics === 'boolean' ? r.haptics : true,
    touch: sanitizeTouch(r.touch),
  };
}

export function sanitizeStats(raw: unknown): CumulativeStats {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const n = (k: keyof CumulativeStats): number => Math.round(num(r[k], 0));
  return { games: n('games'), turns: n('turns'), damage: n('damage'), kills: n('kills'), shots: n('shots'), misses: n('misses'), longest: n('longest') };
}

/** Sauvegarde locale : dernières options de partie, réglages, statistiques cumulées, noms d'équipe favoris. */
export class Persistence {
  constructor(private kv: KV) {}

  private read(key: string): unknown {
    try {
      const s = this.kv.get(PREFIX + key);
      return s === null ? null : JSON.parse(s);
    } catch { return null; } // JSON corrompu : on repart des valeurs par défaut
  }
  private write(key: string, v: unknown): void { this.kv.set(PREFIX + key, JSON.stringify(v)); }

  /** Dernières options (null si aucune partie configurée jusqu'ici). */
  hasOptions(): boolean { return this.read('options') !== null; }
  loadOptions(names: readonly string[]): GameOptions { return sanitizeOptions(this.read('options'), names); }
  saveOptions(o: GameOptions): void { this.write('options', o); }

  loadSettings(): Settings { return sanitizeSettings(this.read('settings')); }
  saveSettings(s: Settings): void { this.write('settings', s); }

  loadStats(): CumulativeStats { return sanitizeStats(this.read('stats')); }
  resetStats(): void { this.kv.remove(PREFIX + 'stats'); }

  /** Ajoute une partie terminée aux statistiques cumulées (toutes équipes confondues). */
  recordGame(s: GameState): CumulativeStats {
    const c = this.loadStats();
    c.games++;
    c.turns += s.turnNumber;
    c.longest = Math.max(c.longest, s.turnNumber);
    for (const t of s.teams) {
      c.damage += Math.round(t.stats.damage);
      c.kills += t.stats.kills;
      c.shots += t.stats.shots;
      c.misses += t.stats.misses;
    }
    this.write('stats', c);
    return c;
  }

  /** Date (ms) de la dernière fermeture de l'invite d'installation, ou 0. */
  installDismissedAt(): number {
    const r = this.read('pwa') as { dismissedAt?: unknown } | null;
    return typeof r?.dismissedAt === 'number' && Number.isFinite(r.dismissedAt) ? r.dismissedAt : 0;
  }
  dismissInstall(now: number): void { this.write('pwa', { dismissedAt: now }); }

  /** Pseudo utilisé en ligne. */
  onlineName(): string {
    const r = this.read('online') as { name?: unknown } | null;
    return typeof r?.name === 'string' ? r.name.slice(0, GAMEPLAY.options.nameMaxLength) : '';
  }
  setOnlineName(name: string): void { this.write('online', { name: name.trim().slice(0, GAMEPLAY.options.nameMaxLength) }); }

  favorites(): string[] {
    const r = this.read('favorites');
    return Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string').slice(0, GAMEPLAY.options.favoritesMax) : [];
  }
  setFavorite(name: string, on: boolean): string[] {
    const n = name.trim().slice(0, GAMEPLAY.options.nameMaxLength);
    let f = this.favorites().filter((x) => x !== n);
    if (on && n) f = [n, ...f].slice(0, GAMEPLAY.options.favoritesMax);
    this.write('favorites', f);
    return f;
  }
}
