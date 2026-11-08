import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const THEME = '#1b2a41';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Version affichée dans les réglages ; elle change avec package.json, donc avec le bundle (détection de mise à jour).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: 'es2022', sourcemap: false },
  // Mode en ligne en développement : `npm run server` (port 8787) ; le client joint le même chemin /ws qu'en production.
  server: { proxy: { '/ws': { target: 'ws://127.0.0.1:8787', ws: true } } },
  preview: { proxy: { '/ws': { target: 'ws://127.0.0.1:8787', ws: true } } },
  plugins: [
    VitePWA({
      // `prompt` : un nouveau service worker attend ; l'application propose la mise à jour (bouton), jamais de
      // rechargement surprise au milieu d'une partie.
      registerType: 'prompt',
      injectRegister: false, // l'enregistrement est fait dans src/platform/pwa.ts
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'icon.svg'],
      manifest: {
        id: '/',
        name: 'Vers — artillerie au tour par tour',
        short_name: 'Vers',
        description: 'Jeu d’artillerie 2D au tour par tour : des vers, des explosions, un terrain destructible.',
        lang: 'fr',
        dir: 'ltr',
        categories: ['games', 'entertainment'],
        theme_color: THEME,
        background_color: THEME,
        display: 'standalone',
        orientation: 'landscape',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // Précache de TOUS les fichiers du build : le jeu démarre hors ligne dès la première visite réussie.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/healthz/, /^\/ws/],
        // Tout le reste (même origine, hors précache) : réponse immédiate depuis le cache, mise à jour en arrière-plan.
        runtimeCaching: [
          {
            urlPattern: ({ url, request }: { url: URL; request: Request }) =>
              request.method === 'GET' && url.origin === self.location.origin && !/^\/(healthz|sw\.js)/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'vers-runtime', expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
