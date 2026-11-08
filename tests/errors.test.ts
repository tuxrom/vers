import { afterEach, describe, expect, it, vi } from 'vitest';
import { isForeignError } from '@/platform/errors';

describe('isForeignError', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ignore « Script error. » masqué (script injecté par le navigateur, extension)', () => {
    vi.stubGlobal('location', { href: 'https://vers.example/', origin: 'https://vers.example' });
    expect(isForeignError({ message: 'Script error.', filename: '' })).toBe(true);
    expect(isForeignError({ message: 'x', filename: 'https://autre.example/a.js' })).toBe(true);
  });

  it('garde les erreurs du jeu', () => {
    vi.stubGlobal('location', { href: 'https://vers.example/', origin: 'https://vers.example' });
    expect(isForeignError({ error: new Error('boum'), message: 'boum', filename: '' })).toBe(false);
    expect(isForeignError({ message: 'boum', filename: 'https://vers.example/assets/index.js' })).toBe(false);
  });
});
