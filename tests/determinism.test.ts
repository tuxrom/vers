import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { datan2, dcos, dist, dsin } from '@/core/math';

/**
 * Garde-fou du mode en ligne : la simulation ne doit utiliser que des opérations dont le résultat est identique sur tous
 * les moteurs JavaScript (+ − × ÷, sqrt, floor/round/min/max/abs…). `Math.hypot/sin/cos/pow/exp/log…` peuvent différer au
 * dernier bit d'un navigateur à l'autre, ce qui ferait diverger deux joueurs en lockstep.
 */
const SIM_FILES = [
  ...['simulation', 'game', 'state', 'rng', 'intent', 'events', 'math'].map((f) => `src/core/${f}.ts`),
  ...['worm', 'projectile', 'crate', 'spawn'].map((f) => `src/entities/${f}.ts`),
  ...readdirSync('src/physics').map((f) => `src/physics/${f}`),
  ...readdirSync('src/weapons').filter((f) => f.endsWith('.ts')).map((f) => `src/weapons/${f}`),
  ...['generate', 'mask', 'noise'].map((f) => `src/terrain/${f}.ts`),
];
const BANNED = /Math\.(hypot|sin|cos|tan|asin|acos|atan|atan2|atanh|asinh|acosh|exp|expm1|log|log2|log10|log1p|pow|cbrt|sinh|cosh|tanh|random)\b|Date\.now|performance\.now/;

describe('déterminisme inter-appareils', () => {
  it('aucune fonction non déterministe ni horloge dans le code de simulation', () => {
    const offenders: string[] = [];
    for (const f of SIM_FILES) {
      const code = readFileSync(join(process.cwd(), f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      code.split('\n').forEach((line, i) => { if (BANNED.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`); });
    }
    expect(offenders).toEqual([]);
    expect(SIM_FILES.length).toBeGreaterThan(20);
  });

  it('dsin / dcos / datan2 : précision double sur toute l’étendue utile, valeurs exactes en 0', () => {
    for (let x = -12; x <= 12; x += 0.0137) {
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-12);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-12);
    }
    for (let a = -3.14; a <= 3.14; a += 0.0113) {
      for (const r of [0.001, 1, 750]) expect(Math.abs(datan2(Math.sin(a) * r, Math.cos(a) * r) - a)).toBeLessThan(1e-12);
    }
    expect(datan2(0, 0)).toBe(0);
    expect(datan2(0, 5)).toBe(0);
    expect(datan2(1, 0)).toBeCloseTo(Math.PI / 2, 14);
    expect(datan2(0, -1)).toBeCloseTo(Math.PI, 14);
    expect(dsin(0)).toBe(0);
    expect(dcos(0)).toBe(1);
    expect(dist(3, 4)).toBe(5);
    expect(dist(-3, 4)).toBe(5);
  });
});
