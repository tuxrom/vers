import { describe, expect, it } from 'vitest';
import { SIM_DT } from '@/config/engine';
import { GAMEPLAY } from '@/config/gameplay';
import { TEAM_PALETTE } from '@/config/palette';
import { NEUTRAL_INTENT } from '@/core/intent';
import {
  defaultOptions, isHotSeat, randomSeed, sanitizeOptions, seedToNumber, type GameOptions,
} from '@/core/options';
import { step } from '@/core/simulation';
import { createState } from '@/core/state';
import {
  DEFAULT_SETTINGS, Persistence, memoryKV, sanitizeSettings, sanitizeStats, type KV,
} from '@/core/storage';
import { DICTIONARIES, LANGS, defaultTeamNames, setLang, t } from '@/ui/i18n';
import { WEAPON_LIST } from '@/weapons';

const O = GAMEPLAY.options;
const NAMES = ['A', 'B', 'C', 'D'];
const DEFAULT_SETTINGS_WITH = (o: Partial<typeof DEFAULT_SETTINGS>): typeof DEFAULT_SETTINGS => ({ ...DEFAULT_SETTINGS, ...o });

describe('options de partie', () => {
  it('valeurs par défaut cohérentes avec GAMEPLAY', () => {
    const o = defaultOptions();
    expect(o.teams.length).toBe(GAMEPLAY.match.teams);
    expect(o.wormsPerTeam).toBe(GAMEPLAY.match.wormsPerTeam);
    expect(o.turnDuration).toBe(GAMEPLAY.turn.duration);
    expect(o.startHealth).toBe(GAMEPLAY.worm.startHealth);
    expect(new Set(o.teams.map((t) => t.color)).size).toBe(o.teams.length);
  });

  it('bornes : 2 à 4 équipes, 1 à 6 vers, durée et PV bornés et alignés sur le pas', () => {
    const wild = { teams: Array.from({ length: 9 }, () => ({})), wormsPerTeam: 99, turnDuration: 7, startHealth: 9999 };
    const o = sanitizeOptions(wild, NAMES);
    expect(o.teams.length).toBe(O.teams.max);
    expect(o.wormsPerTeam).toBe(O.worms.max);
    expect(o.turnDuration).toBe(O.turnDuration.min);
    expect(o.startHealth).toBe(O.health.max);
    expect(sanitizeOptions({ teams: [{}], wormsPerTeam: 0 }, NAMES).teams.length).toBe(O.teams.min);
    expect(sanitizeOptions({ wormsPerTeam: 0 }, NAMES).wormsPerTeam).toBe(O.worms.min);
    expect(sanitizeOptions({ turnDuration: 47 }, NAMES).turnDuration % O.turnDuration.step).toBe(0);
  });

  it('données corrompues ou hostiles : repli sûr, noms tronqués, couleurs valides et uniques', () => {
    for (const bad of [null, undefined, 42, 'x', [], { teams: 'oui' }, { teams: [null, 3, 'a'] }]) {
      const o = sanitizeOptions(bad, NAMES);
      expect(o.teams.length).toBeGreaterThanOrEqual(2);
      for (const tm of o.teams) { expect(tm.name.length).toBeGreaterThan(0); expect(['human', 'ai']).toContain(tm.controller); }
    }
    const o = sanitizeOptions({
      teams: [
        { name: '  ' + 'x'.repeat(80) + '  ', color: '#ff00ff', controller: 'robot' },
        { name: '', color: TEAM_PALETTE[0], controller: 'ai', difficulty: 'hard' },
        { name: 'Dup', color: TEAM_PALETTE[0], controller: 'human', difficulty: 'medium' },
      ],
    }, NAMES);
    expect(o.teams[0]!.name.length).toBe(O.nameMaxLength);
    expect(o.teams[0]!.controller).toBe('human');
    expect(o.teams[1]!.name).toBe('B'); // nom vide → nom par défaut
    expect(new Set(o.teams.map((x) => x.color)).size).toBe(3);
    for (const tm of o.teams) expect(TEAM_PALETTE as readonly string[]).toContain(tm.color);
  });

  it('graine : hexadécimal tel quel, texte haché de façon stable, aléatoire valide', () => {
    expect(seedToNumber('5eed1234')).toBe(0x5eed1234);
    expect(seedToNumber('FF')).toBe(255);
    expect(seedToNumber('bonjour')).toBe(seedToNumber('bonjour'));
    expect(seedToNumber('bonjour')).not.toBe(seedToNumber('bonjour!'));
    const r = randomSeed(() => 0.5);
    expect(r).toMatch(/^[0-9a-f]{8}$/);
    expect(randomSeed()).toMatch(/^[0-9a-f]{8}$/);
  });

  it('hot-seat : au moins deux équipes humaines', () => {
    const o = defaultOptions();
    expect(isHotSeat(o)).toBe(true);
    o.teams[1]!.controller = 'ai';
    expect(isHotSeat(o)).toBe(false);
    o.teams.push({ name: 'C', color: TEAM_PALETTE[2], controller: 'human', difficulty: 'medium' });
    expect(isHotSeat(o)).toBe(true);
  });
});

describe('création de partie depuis les options', () => {
  it('3 équipes × 4 vers, noms/couleurs/PV/durée appliqués', () => {
    const o: GameOptions = {
      teams: [
        { name: 'Alpha', color: TEAM_PALETTE[4], controller: 'human', difficulty: 'medium' },
        { name: 'Beta', color: TEAM_PALETTE[5], controller: 'ai', difficulty: 'hard' },
        { name: 'Gamma', color: TEAM_PALETTE[6], controller: 'human', difficulty: 'medium' },
      ],
      wormsPerTeam: 4, seed: 'abc', turnDuration: 30, startHealth: 150,
    };
    const s = createState({ options: o, withCanvas: false });
    expect(s.teams.map((x) => x.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(s.teams.map((x) => x.controller)).toEqual(['human', 'ai', 'human']);
    expect(s.teams.every((x) => x.wormIds.length === 4)).toBe(true);
    expect(s.worms.length).toBe(12);
    expect(s.worms.every((w) => w.health === 150)).toBe(true);
    expect(s.worms.every((w) => w.color === s.teams[w.team]!.color)).toBe(true);
    expect(s.seed).toBe(seedToNumber('abc'));
    let g = 0;
    while (s.phase !== 'turn' && g++ < 60 * 20) step(s, SIM_DT, NEUTRAL_INTENT);
    expect(s.turn.timeLeft).toBe(30);
  });

  it('extrêmes : 4 équipes × 6 vers et 2 équipes × 1 ver jouent jusqu’au premier tour', () => {
    for (const [teams, per] of [[4, 6], [2, 1]] as const) {
      const o = sanitizeOptions({ teams: Array.from({ length: teams }, () => ({})), wormsPerTeam: per }, NAMES);
      const s = createState({ options: o, withCanvas: false });
      expect(s.worms.length).toBe(teams * per);
      let g = 0;
      while (s.phase !== 'turn' && g++ < 60 * 30) step(s, SIM_DT, NEUTRAL_INTENT);
      expect(s.phase).toBe('turn');
      // Tous les vers sont au sol, sans chevauchement avec le terrain.
      expect(s.worms.every((w) => w.mode === 'ground')).toBe(true);
    }
  });

  it('la graine de la carte détermine le terrain', () => {
    const a = createState({ options: sanitizeOptions({ seed: 'carte-1' }, NAMES), withCanvas: false });
    const b = createState({ options: sanitizeOptions({ seed: 'carte-1' }, NAMES), withCanvas: false });
    const c = createState({ options: sanitizeOptions({ seed: 'carte-2' }, NAMES), withCanvas: false });
    expect(a.terrain.mask.checksum()).toBe(b.terrain.mask.checksum());
    expect(a.terrain.mask.checksum()).not.toBe(c.terrain.mask.checksum());
  });
});

describe('sauvegarde locale', () => {
  const edited = (): GameOptions => sanitizeOptions({
    teams: [
      { name: 'Les Tigres', color: TEAM_PALETTE[5], controller: 'human', difficulty: 'medium' },
      { name: 'Robots', color: TEAM_PALETTE[6], controller: 'ai', difficulty: 'hard' },
      { name: 'Trois', color: TEAM_PALETTE[0], controller: 'human', difficulty: 'medium' },
    ],
    wormsPerTeam: 5, seed: 'ma-graine', turnDuration: 60, startHealth: 200,
  }, NAMES);

  it('les options persistent après « rechargement » (nouvelle instance sur le même stockage)', () => {
    const kv = memoryKV();
    const p1 = new Persistence(kv);
    expect(p1.hasOptions()).toBe(false);
    p1.saveOptions(edited());
    const p2 = new Persistence(kv);
    expect(p2.hasOptions()).toBe(true);
    expect(p2.loadOptions(NAMES)).toEqual(edited());
  });

  it('réglages persistants, valeurs hors bornes corrigées', () => {
    const kv = memoryKV();
    const p = new Persistence(kv);
    expect(p.loadSettings()).toEqual(DEFAULT_SETTINGS);
    const custom = { sound: 0.3, music: 0, quality: 'low' as const, lang: 'en' as const, controls: 'touch' as const, haptics: false, touch: { scale: 1.2, layout: { fire: { x: 0.8, y: 0.6 } } } };
    p.saveSettings(custom);
    expect(new Persistence(kv).loadSettings()).toEqual(custom);
    expect(sanitizeSettings({ sound: 9, music: -3, quality: 'ultra', lang: 'xx', controls: 'vr', haptics: 'oui', touch: 5 })).toEqual(DEFAULT_SETTINGS_WITH({ sound: 1, music: 0 }));
  });

  it('statistiques cumulées entre les parties, effaçables', () => {
    const kv = memoryKV();
    const p = new Persistence(kv);
    const s = createState({ seed: 1, withCanvas: false });
    s.turnNumber = 14;
    s.teams[0]!.stats = { damage: 120.4, kills: 2, shots: 7, misses: 3 };
    s.teams[1]!.stats = { damage: 30, kills: 1, shots: 4, misses: 1 };
    p.recordGame(s);
    s.turnNumber = 9;
    const c = new Persistence(kv).recordGame(s);
    expect(c).toEqual({ games: 2, turns: 23, damage: 300, kills: 6, shots: 22, misses: 8, longest: 14 });
    expect(new Persistence(kv).loadStats()).toEqual(c);
    p.resetStats();
    expect(p.loadStats().games).toBe(0);
    expect(sanitizeStats({ games: 'x', turns: -5 }).turns).toBe(0);
  });

  it('noms d’équipe favoris : ajout, dédoublonnage, plafond, retrait', () => {
    const p = new Persistence(memoryKV());
    p.setFavorite('Tigres', true);
    p.setFavorite('Lions', true);
    p.setFavorite('Tigres', true);
    expect(p.favorites()).toEqual(['Tigres', 'Lions']);
    for (let i = 0; i < 30; i++) p.setFavorite(`N${i}`, true);
    expect(p.favorites().length).toBe(O.favoritesMax);
    p.setFavorite('N29', false);
    expect(p.favorites()).not.toContain('N29');
    p.setFavorite('   ', true);
    expect(p.favorites().includes('')).toBe(false);
  });

  it('JSON corrompu ou stockage qui lève : valeurs par défaut, pas d’exception', () => {
    const kv = memoryKV();
    kv.set('vers:v1:options', '{pas du json');
    kv.set('vers:v1:settings', '[1,2');
    const p = new Persistence(kv);
    expect(() => p.loadOptions(NAMES)).not.toThrow();
    expect(p.loadOptions(NAMES).teams.length).toBe(2);
    expect(p.loadSettings()).toEqual(DEFAULT_SETTINGS);

    const broken: KV = { get() { throw new Error('quota'); }, set() { throw new Error('quota'); }, remove() { throw new Error('quota'); } };
    const q = new Persistence(broken);
    expect(q.loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(() => q.saveOptions(defaultOptions())).toThrow(); // l'enveloppe localKV() absorbe ce cas ; ici KV brut
  });
});

describe('textes (i18n)', () => {
  it('chaque langue a exactement les mêmes clés que le français, sans valeur vide', () => {
    const ref = Object.keys(DICTIONARIES.fr).sort();
    for (const l of LANGS) {
      const d = DICTIONARIES[l.id];
      expect(Object.keys(d).sort(), l.id).toEqual(ref);
      for (const v of Object.values(d)) expect(v.trim().length).toBeGreaterThan(0);
    }
  });

  it('chaque arme a un nom et une description dans chaque langue', () => {
    for (const l of LANGS) {
      for (const w of WEAPON_LIST) {
        expect(DICTIONARIES[l.id][`weapon.${w.id}.name` as keyof typeof DICTIONARIES.fr], `${l.id}:${w.id}`).toBeTruthy();
        expect(DICTIONARIES[l.id][`weapon.${w.id}.desc` as keyof typeof DICTIONARIES.fr], `${l.id}:${w.id}`).toBeTruthy();
      }
    }
  });

  it('variables remplacées, langue commutable, mêmes variables dans toutes les langues', () => {
    setLang('fr');
    expect(t('hud.sudden.many', { n: 3 })).toBe('Mort subite dans 3 tours');
    setLang('en');
    expect(t('hud.sudden.many', { n: 3 })).toBe('Sudden death in 3 turns');
    expect(defaultTeamNames()[0]).toBe('The Pinks');
    for (const k of Object.keys(DICTIONARIES.fr) as (keyof typeof DICTIONARIES.fr)[]) {
      const vars = (s: string): string => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
      expect(vars(DICTIONARIES.en[k]), k).toBe(vars(DICTIONARIES.fr[k]));
    }
    setLang('fr');
  });
});
