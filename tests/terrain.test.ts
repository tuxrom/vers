import { describe, expect, it } from 'vitest';
import { Rng } from '@/core/rng';
import { GAMEPLAY } from '@/config/gameplay';
import { generateMask } from '@/terrain/generate';
import { TerrainMask } from '@/terrain/mask';
import { Terrain } from '@/terrain/terrain';

const { width: W, height: H } = GAMEPLAY.world;

describe('masque de collision', () => {
  it('clearCircle vide ≈ πr² pixels, et rien en dehors', () => {
    const m = new TerrainMask(300, 300);
    m.data.fill(1);
    const r = 40;
    const n = m.clearCircle(150, 150, r);
    expect(Math.abs(n - Math.PI * r * r) / (Math.PI * r * r)).toBeLessThan(0.02);
    expect(m.isSolid(150, 150)).toBe(false);
    expect(m.isSolid(150 + r - 2, 150)).toBe(false);
    expect(m.isSolid(150 + r + 2, 150)).toBe(true);
    expect(m.isSolid(150, 150 - r - 2)).toBe(true);
  });

  it('clearCircle sur les bords de carte ne déborde pas', () => {
    const m = new TerrainMask(100, 100);
    m.data.fill(1);
    expect(() => m.clearCircle(-10, 105, 60)).not.toThrow();
    expect(() => m.clearCircle(1e6, 1e6, 60)).not.toThrow();
  });

  it('hors carte : murs latéraux et sol solides, ciel vide', () => {
    const m = new TerrainMask(100, 100);
    expect(m.isSolid(-1, 50)).toBe(true);
    expect(m.isSolid(100, 50)).toBe(true);
    expect(m.isSolid(50, 100)).toBe(true);
    expect(m.isSolid(50, -5)).toBe(false);
  });

  it('Terrain.carveCircle (sans canvas) incrémente la version et met à jour le masque', () => {
    const t = new Terrain(new TerrainMask(100, 100, new Uint8Array(10000).fill(1)), false);
    t.carveCircle(50, 50, 10);
    expect(t.version).toBe(1);
    expect(t.isSolid(50, 50)).toBe(false);
  });
});

describe('génération', () => {
  it('déterministe pour une graine, différente entre graines', () => {
    const a = generateMask(new Rng(123), W, H).checksum();
    const b = generateMask(new Rng(123), W, H).checksum();
    const c = generateMask(new Rng(124), W, H).checksum();
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('contient collines, grottes et îlots flottants', () => {
    for (const seed of [1, 2, 3, 0x5eed1234]) {
      const m = generateMask(new Rng(seed), W, H);
      let caves = 0, islands = 0;
      for (let x = 0; x < W; x += 5) {
        let y = 0;
        while (y < H && !m.isSolid(x, y)) y++;
        const surface = y;
        // îlot : solide, puis de l'air, puis (plus bas) la surface principale
        let inAir = false, found = false;
        // parcours depuis le ciel : première matière = îlot si de l'air la suit avant le vrai sol
        let yy = y;
        while (yy < H && m.isSolid(x, yy)) yy++;
        if (yy < surface + 200 && yy < GAMEPLAY.terrain.baseHeight - 100) { inAir = true; }
        for (let k = yy; k < Math.min(H, yy + 400) && inAir; k++) if (m.isSolid(x, k)) { found = true; break; }
        if (found && surface < 400) islands++;
        for (let y2 = surface + 60; y2 < GAMEPLAY.water.startLevel; y2++) if (!m.isSolid(x, y2)) { caves++; break; }
      }
      expect(caves, `grottes seed ${seed}`).toBeGreaterThan(5);
      expect(islands, `îlots seed ${seed}`).toBeGreaterThan(3);
    }
  });
});
