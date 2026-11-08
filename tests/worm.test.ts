import { describe, expect, it } from 'vitest';
import { GAMEPLAY } from '@/config/gameplay';
import { Rng } from '@/core/rng';
import { circleOverlaps } from '@/physics/collision';
import { generateMask } from '@/terrain/generate';
import { findSpawn } from '@/entities/spawn';
import { fallDamage } from '@/entities/worm';
import { flatMask, idle, move, rampMask, run, spawnWorm } from './helpers';

const R = GAMEPLAY.worm.radius;

describe('ver : sol plat', () => {
  it('tombe, atterrit, ne s’enfonce pas et reste immobile', () => {
    const m = flatMask();
    const w = spawnWorm(400, 100);
    run(m, w, idle, 120);
    expect(w.mode).toBe('ground');
    const y0 = w.y;
    expect(circleOverlaps(m, w.x, w.y, R)).toBe(false);
    expect(circleOverlaps(m, w.x, w.y + 1, R)).toBe(true); // posé
    run(m, w, idle, 1200); // 20 s
    expect(Math.abs(w.y - y0)).toBeLessThan(0.01);
    expect(w.x).toBe(400);
  });

  it('marche à vitesse de config, dans les deux sens', () => {
    const m = flatMask();
    const w = spawnWorm(400, 100);
    run(m, w, idle, 120);
    const x0 = w.x;
    run(m, w, move(1), 60);
    expect(w.x - x0).toBeCloseTo(GAMEPLAY.worm.walkSpeed, 0);
    expect(w.facing).toBe(1);
    run(m, w, move(-1), 120);
    expect(w.x).toBeCloseTo(x0 - GAMEPLAY.worm.walkSpeed, 0);
    expect(w.facing).toBe(-1);
  });

  it('est bloqué par les murs de carte sans se coincer', () => {
    const m = flatMask(300, 400, 300);
    const w = spawnWorm(150, 100);
    run(m, w, idle, 120);
    run(m, w, move(1), 600);
    expect(w.x).toBeLessThanOrEqual(300 - R);
    expect(circleOverlaps(m, w.x, w.y, R)).toBe(false);
    run(m, w, move(-1), 1200);
    expect(w.x).toBeGreaterThanOrEqual(R - 1); // centre arrondi au pixel
    expect(w.mode).toBe('ground');
  });
});

describe('ver : sauts', () => {
  it('saut avant : retombe plus loin dans le sens du regard, au même niveau', () => {
    const m = flatMask();
    const w = spawnWorm(400, 100);
    run(m, w, idle, 120);
    const { x: x0, y: y0 } = w;
    run(m, w, { ...idle, jump: true }, 1);
    expect(w.mode).toBe('air');
    let minY = w.y;
    for (let i = 0; i < 200 && w.mode === 'air'; i++) { run(m, w, idle, 1); minY = Math.min(minY, w.y); }
    expect(w.mode).toBe('ground');
    expect(w.x).toBeGreaterThan(x0 + 60);
    expect(Math.abs(w.y - y0)).toBeLessThan(1.5);
    const apex = GAMEPLAY.worm.jumpSpeed ** 2 / (2 * GAMEPLAY.physics.gravity);
    expect(y0 - minY).toBeGreaterThan(apex * 0.9);
  });

  it('salto : recule, tourne d’un tour complet, angle remis à 0 à l’atterrissage', () => {
    const m = flatMask();
    const w = spawnWorm(400, 100);
    run(m, w, idle, 120);
    const x0 = w.x;
    run(m, w, { ...idle, backflip: true }, 1);
    let maxAngle = 0;
    for (let i = 0; i < 300 && w.mode === 'air'; i++) { run(m, w, idle, 1); maxAngle = Math.max(maxAngle, Math.abs(w.angle)); }
    expect(w.mode).toBe('ground');
    expect(w.x).toBeLessThan(x0 - 30); // regarde à droite, recule à gauche
    expect(maxAngle).toBeGreaterThan(Math.PI * 1.8);
    expect(w.angle).toBe(0);
  });

  it('un saut sous un plafond bas tape la tête sans se coincer', () => {
    const m = flatMask(800, 400, 300);
    m.data.fill(1, 0, 800 * 250); // plafond à y<250 (ver haut de 18 px, sol à 300)
    const w = spawnWorm(400, 280);
    run(m, w, idle, 60);
    run(m, w, { ...idle, jump: true }, 1);
    run(m, w, idle, 120);
    expect(w.mode).toBe('ground');
    expect(circleOverlaps(m, w.x, w.y, R)).toBe(false);
  });
});

describe('ver : pentes', () => {
  it('monte une pente douce (30°) et suit le sol', () => {
    const m = rampMask(1200, 500, 300, 400, 300 + 400, 400 - 231, 460); // tan 30° ≈ 0.577
    const w = spawnWorm(150, 300);
    run(m, w, idle, 120);
    const y0 = w.y;
    run(m, w, move(1), 60 * 5);
    expect(w.mode).toBe('ground');
    expect(w.y).toBeLessThan(y0 - 100);
    expect(circleOverlaps(m, w.x, w.y, R)).toBe(false);
    expect(w.sliding).toBe(false);
  });

  it('redescend une pente douce sans décoller', () => {
    const m = rampMask(1200, 500, 300, 400, 700, 169, 460);
    const w = spawnWorm(150, 300);
    run(m, w, move(1), 60 * 8); // monte
    run(m, w, move(-1), 60 * 3);
    let airFrames = 0;
    for (let i = 0; i < 60 * 4; i++) { run(m, w, move(-1), 1); if (w.mode === 'air') airFrames++; }
    expect(airFrames).toBeLessThan(3);
  });

  it('glisse sur une pente trop raide (70°) et n’y grimpe pas', () => {
    // paroi à 70° (tan ≈ 2.75), sommet plateau.
    const m = rampMask(1200, 600, 400, 500, 600, 500 - 550, 560);
    const w = spawnWorm(480, 100);
    run(m, w, idle, 240);
    expect(circleOverlaps(m, w.x, w.y, R)).toBe(false);
    // Le ver a glissé jusqu'au pied de la pente (à gauche) et y reste posé.
    expect(w.x).toBeLessThan(420);
    const x = w.x;
    run(m, w, move(1), 120); // il pousse vers la paroi : il ne grimpe pas
    expect(w.x).toBeLessThan(x + 30);
    expect(circleOverlaps(m, w.x, w.y, R)).toBe(false);
  });
});

describe('ver : cratères et collision', () => {
  it('un cratère sous le ver modifie la collision immédiatement et le fait tomber', () => {
    const m = flatMask(800, 600, 300);
    const w = spawnWorm(400, 100);
    run(m, w, idle, 120);
    const y0 = w.y;
    m.clearCircle(400, 305, 45);
    expect(m.isSolid(400, 320)).toBe(false); // effet immédiat sur la requête physique
    run(m, w, idle, 120);
    expect(w.y).toBeGreaterThan(y0 + 20);
    expect(w.mode).toBe('ground');
    expect(circleOverlaps(m, w.x, w.y, R)).toBe(false);
  });

  it('un cratère qui englobe le ver ne le coince pas (il est dégagé)', () => {
    const m = flatMask(800, 600, 300);
    const w = spawnWorm(400, 100);
    run(m, w, idle, 120);
    m.clearCircle(w.x, w.y + 5, 30);
    run(m, w, idle, 240);
    expect(circleOverlaps(m, w.x, w.y, R)).toBe(false);
    expect(w.mode).toBe('ground');
  });

  it('dégâts de chute selon la config', () => {
    expect(fallDamage(GAMEPLAY.worm.fallDamageThreshold)).toBe(0);
    expect(fallDamage(GAMEPLAY.worm.fallDamageThreshold + 40)).toBe(Math.round(40 * GAMEPLAY.worm.fallDamagePerPixel));
    expect(fallDamage(1e6)).toBe(GAMEPLAY.worm.fallDamageMax);
  });
});

describe('ver : terrain généré', () => {
  it('traverse les cartes générées sans jamais s’enfoncer ni se figer', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const m = generateMask(new Rng(seed), GAMEPLAY.world.width, GAMEPLAY.world.height);
      const rng = new Rng(seed ^ 0xabc);
      const p = findSpawn(m, rng, 300, 800);
      const w = spawnWorm(p.x, p.y);
      // Marche + sauts périodiques dans une direction, puis l'autre : ne doit jamais pénétrer.
      let maxX = w.x, minX = w.x;
      for (let dir of [1, -1] as const) {
        for (let i = 0; i < 60 * 40; i++) {
          const jump = i % 150 === 149;
          run(m, w, { ...move(dir), jump }, 1);
          expect(circleOverlaps(m, w.x, w.y, R), `seed ${seed} tick ${i}`).toBe(false);
          maxX = Math.max(maxX, w.x); minX = Math.min(minX, w.x);
        }
      }
      expect(maxX - minX, `seed ${seed} mobilité`).toBeGreaterThan(150);
    }
  });

  it('apparition : findSpawn donne une position libre au-dessus de l’eau', () => {
    const m = generateMask(new Rng(9), GAMEPLAY.world.width, GAMEPLAY.world.height);
    const rng = new Rng(9);
    for (let i = 0; i < 20; i++) {
      const p = findSpawn(m, rng, 100, GAMEPLAY.world.width - 100);
      expect(circleOverlaps(m, p.x, p.y, R)).toBe(false);
      expect(p.y).toBeLessThan(GAMEPLAY.water.startLevel);
    }
  });
});
