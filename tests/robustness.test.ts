import { describe, expect, it } from 'vitest';
import { ADAPTIVE, SIM_DT } from '@/config/engine';
import { GAMEPLAY } from '@/config/gameplay';
import { AiController } from '@/ai';
import { Killcam } from '@/core/killcam';
import { NEUTRAL_INTENT, type Intent } from '@/core/intent';
import { AdaptiveResolution, Perf } from '@/core/perf';
import { Rng } from '@/core/rng';
import { TurnRecorder, restoreState, snapshotState } from '@/core/replay';
import { step } from '@/core/simulation';
import { createState, hashState, type GameState } from '@/core/state';
import { circleOverlaps } from '@/physics/collision';
import { Terrain } from '@/terrain/terrain';
import { TerrainMask } from '@/terrain/mask';
import { paintRegion, paintTerrain } from '@/terrain/paint';
import { aiArena, aiTick, GROUND, R, setAi } from './aiHelpers';
import { flatMask } from './helpers';

const fire = (down = true): Intent => ({ ...NEUTRAL_INTENT, fireDown: down });

describe('anti-coincement des vers', () => {
  it('un ver enfoui profondément dans le terrain est replacé au sol', () => {
    const s = aiArena(31);
    const a = s.worms[0]!;
    a.x = 900; a.y = GROUND + 220; a.px = a.x; a.py = a.y; a.mode = 'ground';
    expect(circleOverlaps(s.terrain, a.x, a.y, R)).toBe(true);
    for (let i = 0; i < 3; i++) step(s, SIM_DT, NEUTRAL_INTENT);
    expect(circleOverlaps(s.terrain, a.x, a.y, R)).toBe(false);
    expect(s.events.some((e) => e.t === 'unstuck')).toBe(true);
    for (let i = 0; i < 300; i++) step(s, SIM_DT, NEUTRAL_INTENT);
    expect(a.mode).toBe('ground');
    expect(a.health).toBe(s.options.startHealth); // aucune blessure due à la remise en place
  });

  it('fuzz : cratères aléatoires et vers placés n’importe où, personne ne reste dans la roche', () => {
    const rng = new Rng(404);
    for (let n = 0; n < 6; n++) {
      const s = createState({ seed: 50 + n, withCanvas: false });
      for (let i = 0; i < 200; i++) step(s, SIM_DT, NEUTRAL_INTENT);
      for (const w of s.worms) { // positions arbitraires, y compris dans la matière
        w.x = rng.range(50, 3950); w.y = rng.range(100, 1000); w.px = w.x; w.py = w.y; w.mode = 'air'; w.vx = 0; w.vy = 0;
      }
      for (let i = 0; i < 400; i++) {
        if (i % 40 === 0) s.terrain.carveCircle(rng.range(0, 4000), rng.range(200, 1000), rng.range(20, 90));
        step(s, SIM_DT, NEUTRAL_INTENT);
      }
      for (const w of s.worms) if (!w.sunk) expect(circleOverlaps(s.terrain, w.x, w.y, R), `carte ${n} ver ${w.id}`).toBe(false);
    }
  });
});

describe('terrain en tuiles', () => {
  it('la peinture par région est cohérente avec la peinture complète (indépendante des tuiles voisines)', () => {
    const mask = new TerrainMask(1200, 800);
    for (let x = 0; x < 1200; x++) for (let y = 300 + Math.round(60 * Math.sin(x / 90)); y < 800; y++) mask.data[y * 1200 + x] = 1;
    mask.clearCircle(600, 500, 70);
    const full = paintTerrain(mask);
    for (const [x0, y0, w, h] of [[0, 0, 512, 512], [512, 256, 400, 400], [900, 500, 300, 300]] as const) {
      const part = paintRegion(mask, x0, y0, w, h);
      for (let y = 0; y < h; y += 7) for (let x = 0; x < w; x += 5) {
        const a = ((y0 + y) * 1200 + (x0 + x)) * 4, b = (y * w + x) * 4;
        expect([part[b], part[b + 1], part[b + 2], part[b + 3]]).toEqual([full[a], full[a + 1], full[a + 2], full[a + 3]]);
      }
    }
  });

  it('un cratère signale la zone modifiée (mise à jour partielle de la minimap) et reste borné', () => {
    const t = new Terrain(flatMask(2000, 1000, 500), false);
    t.carveCircle(300, 500, 40);
    expect(t.dirty.length).toBe(1);
    expect(t.dirty[0]!.w).toBeGreaterThanOrEqual(80);
    for (let i = 0; i < 100; i++) t.carveCircle(i * 10, 500, 10);
    expect(t.dirty.length).toBeLessThanOrEqual(64);
    expect(t.dirtyOverflow).toBe(true);
  });
});

describe('replay au ralenti (killcam)', () => {
  /** Joue des tours d'IA en enregistrant ; renvoie l'état, l'enregistreur et les empreintes de chaque fin de tour. */
  function playRecorded(turns: number, seed = 61): { s: GameState; rec: TurnRecorder } {
    const s = aiArena(seed, 2);
    setAi(s, 0, 'medium'); setAi(s, 1, 'medium');
    s.worms.forEach((w, i) => { w.x = 700 + i * 380; w.px = w.x; });
    const ai = new AiController();
    const rec = new TurnRecorder();
    const t0 = s.turnNumber;
    let guard = 0;
    while (s.turnNumber < t0 + turns && s.phase !== 'gameover' && guard++ < 60 * 60 * 20) {
      const it = aiTick(s, ai);
      rec.afterStep(s, it);
    }
    return { s, rec };
  }

  it('l’instantané est indépendant de l’état vivant', () => {
    const s = aiArena(8, 2);
    const snap = snapshotState(s);
    s.worms[0]!.health = 1;
    s.terrain.carveCircle(800, GROUND, 80);
    s.rng.next();
    const r = restoreState(snap, false);
    expect(r.worms[0]!.health).toBe(s.options.startHealth);
    expect(r.terrain.isSolid(800, GROUND + 10)).toBe(true);
    expect(r.rng.getState()).not.toBe(s.rng.getState());
  });

  it('rejouer un tour enregistré redonne EXACTEMENT l’état final réel (déterminisme)', () => {
    const { rec } = playRecorded(4);
    const r = rec.latest(createState({ seed: 1, withCanvas: false }));
    expect(r).not.toBeNull();
    // Enregistrement terminé : l'empreinte de fin est connue → on la compare après rejeu complet.
    const finished = (rec as unknown as { finished: NonNullable<typeof r> }).finished;
    expect(finished.endHash).not.toBe('');
    const s = restoreState(finished.snap, false);
    for (const it of finished.intents) step(s, SIM_DT, it);
    expect(s.tick).toBe(finished.endTick);
    expect(hashState(s)).toBe(finished.endHash);
  });

  it('Killcam : avance rapide puis ralenti, jusqu’après la dernière explosion, sans modifier la partie réelle', () => {
    const { s: live, rec } = playRecorded(3);
    const r = (rec as unknown as { finished: NonNullable<ReturnType<TurnRecorder['latest']>> }).finished;
    const h = hashState(live);
    const k = new Killcam(r, false);
    expect(k.phase).toBe('ffwd');
    let frames = 0, sawSlow = false, explosions = 0;
    while (k.phase !== 'done' && frames++ < 6000) {
      k.advance(1 / 60);
      if (k.phase === 'slow') sawSlow = true;
      explosions += k.state.events.filter((e) => e.t === 'explosion').length;
      k.state.events.length = 0;
    }
    expect(sawSlow).toBe(true);
    expect(explosions).toBeGreaterThan(0);
    expect(k.progress).toBe(1);
    expect(hashState(live)).toBe(h); // la partie réelle n'a pas bougé
    // Au ralenti : plus de frames de rendu que de pas de simulation montrés.
    const shown = (r.lastExplosionTick! - r.shotTick!) + (GAMEPLAY.killcam.leadSeconds + GAMEPLAY.killcam.tailSeconds) / SIM_DT;
    expect(frames).toBeGreaterThan(shown / 3);
  });

  it('un tir pendant le tour est déjà rejouable (sans attendre la fin du tour)', () => {
    const s = aiArena(77, 1);
    const rec = new TurnRecorder();
    const run = (it: Intent): void => { step(s, SIM_DT, it); rec.afterStep(s, it); };
    expect(rec.hasShot()).toBe(false);
    run(NEUTRAL_INTENT); // initialise l'enregistreur sur le tour courant
    s.turn.aim = 0.9;
    for (let i = 0; i < 80; i++) run(fire());
    for (let i = 0; i < 60 * 4; i++) run(NEUTRAL_INTENT);
    expect(rec.hasShot()).toBe(true);
    const r = rec.latest(s)!;
    expect(r.shotTick).not.toBeNull();
    expect(r.lastExplosionTick).toBeGreaterThan(r.shotTick!);
  });
});

describe('résolution dynamique et mesures', () => {
  it('baisse la résolution si les frames sont lentes, remonte si la machine a de la marge, avec délai entre deux changements', () => {
    const a = new AdaptiveResolution(ADAPTIVE);
    let now = 0;
    const feed = (ms: number, frames: number): number[] => {
      const changes: number[] = [];
      for (let i = 0; i < frames; i++) { now += ms; const r = a.update(ms, now); if (r !== null) changes.push(r); }
      return changes;
    };
    expect(feed(16.7, 600)).toEqual([]); // 60 fps : rien ne change
    const down = feed(40, 400);
    expect(down.length).toBeGreaterThan(0);
    expect(down[0]).toBeCloseTo(1 - ADAPTIVE.step, 5);
    expect(Math.min(...down)).toBeGreaterThanOrEqual(ADAPTIVE.minScale);
    // Délai minimal entre deux changements : jamais deux baisses à moins de cooldown ms.
    expect(down.length * ADAPTIVE.cooldownMs).toBeLessThanOrEqual((400 * 40) + ADAPTIVE.cooldownMs);
    const up = feed(12, 4000);
    expect(up[up.length - 1]).toBe(1);
    // Un à-coup isolé (ramasse-miettes) ou une pause d'onglet ne déclenche rien.
    const b = new AdaptiveResolution(ADAPTIVE);
    for (let i = 0; i < 300; i++) expect(b.update(i % 100 === 0 ? 90 : 16.7, (now += 16.7))).toBeNull();
    expect(b.update(2000, (now += 2000))).toBeNull();
  });

  it('Perf : moyennes et quantiles par frame, sans dérive', () => {
    const p = new Perf();
    for (let i = 0; i < 100; i++) { p.beginRender(0); p.addUpdate(0.2); p.endFrame(1 + (i === 99 ? 9 : 0), 16.7); }
    const st = p.stats();
    expect(st.frames).toBe(100);
    expect(st.updateAvg).toBeCloseTo(0.2, 5);
    expect(st.renderMax).toBeCloseTo(10, 5);
    expect(st.fps).toBeCloseTo(1000 / 16.7, 3);
    p.endFrame(0, 900); // pause : ignorée
    expect(p.stats().frames).toBe(100);
  });
});
