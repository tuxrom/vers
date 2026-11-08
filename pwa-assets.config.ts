import { defineConfig, minimal2023Preset as preset } from '@vite-pwa/assets-generator/config';

/** Couleur de repli sous les icônes « maskable » et Apple. */
const background = '#1b2a41';

/**
 * Génère les icônes PWA (192, 512, maskable 512, apple-touch 180, favicon) à partir de public/icon.svg :
 * `npm run icons`. Les PNG produits sont versionnés dans public/.
 */
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  // L'icône source est pleine page et garde l'essentiel dans la zone sûre : aucune marge ajoutée.
  preset: {
    ...preset,
    transparent: { ...preset.transparent, padding: 0 },
    maskable: { ...preset.maskable, padding: 0, resizeOptions: { background, fit: 'cover' } },
    apple: { ...preset.apple, padding: 0, resizeOptions: { background, fit: 'cover' } },
  },
  images: ['public/icon.svg'],
});
