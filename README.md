# Vers — artillerie 2D au tour par tour

Jeu d'artillerie façon *Worms* : des équipes de vers, un terrain destructible, du vent, de l'eau qui monte.
Il se joue dans un navigateur (PC et mobile), s'installe comme une application (PWA), fonctionne hors ligne et se
déploie dans un conteneur nginx. **Canvas 2D natif, aucun moteur de jeu, aucun asset externe** : terrain, vers,
particules et sons sont générés par le code.

- **Parties** : 2 à 4 équipes, 1 à 6 vers par équipe, humains (hot-seat sur un écran) ou IA (3 niveaux).
- **9 armes** : bazooka, grenade, fusil à pompe, dynamite, mine, frappe aérienne, batte, corde ninja, téléportation.
- **Terrain** procédural (collines, grottes, îlots flottants), entièrement destructible, graine réglable.
- **Mort subite** : l'eau monte ; caisses de soins / armes / outils larguées en parachute.
- **Mode en ligne** par salons (code à partager) : lockstep déterministe, états vérifiés à chaque tour, remplacement par l'IA en cas de déconnexion — [docs/online.md](docs/online.md).
- **Replay au ralenti** du dernier tir (killcam), rendu possible par une simulation 100 % déterministe.
- **Mobile** : commandes tactiles repositionnables, retour haptique, plein écran paysage, zones sûres (encoches).

## Démarrage rapide

```bash
npm ci
npm run dev          # http://localhost:5173, overlay FPS actif (F3 pour le masquer)
```

## Commandes

### npm

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement Vite (hôte exposé) |
| `npm run build` | `tsc --noEmit` puis build de production dans `dist/` (+ service worker) |
| `npm run preview` | Sert `dist/` (ajouter `-- --host 127.0.0.1` pour ne pas l'exposer au réseau) |
| `npm run typecheck` | Vérification des types seule |
| `npm test` | Tests Vitest (physique, armes, menus, IA, tactile, PWA, replay…) — environ 1 min 30 |
| `npm run icons` | Régénère les icônes PWA depuis `public/icon.svg` |
| `npm run bench` | Banc d'essai de performance (voir [docs/performance.md](docs/performance.md)) |
| `npm run server` | Serveur de salons du mode en ligne en local (port 8787 ; `npm run dev` proxifie `/ws` vers lui) |

Autres outils : `TUNING=1 npx vitest run tests/tuning.test.ts` joue des parties IA contre IA pour mesurer le ressenti
([docs/gameplay-tuning.md](docs/gameplay-tuning.md)). Paramètres d'URL : `?debug` (overlay, accès à `window.__game`),
`?seed=<texte>` ou `?play` (lancement direct sans menu), `?noadapt` (résolution dynamique coupée).

### Docker

```bash
docker compose up --build -d                       # port 8080 par défaut
VERS_PORT=8099 docker compose up --build -d        # ou variable d'environnement / fichier .env (voir .env.example)
docker compose logs -f
docker compose down
```

`docker-compose.yml` lance **deux services** : `vers` (nginx + jeu, port `VERS_PORT`) et `vers-server` (serveur de salons WebSocket du mode en ligne, interne, `server/Dockerfile`), joint par nginx sous `/ws`. Le `Dockerfile` du jeu est multi-étapes (`node:lts-alpine` pour `npm ci` + build, `nginx:alpine` pour servir `dist/`).
`GET /healthz` répond `ok` (utilisé par le *healthcheck* Compose). Le conteneur redémarre automatiquement
(`restart: unless-stopped`).

## Déploiement derrière un reverse proxy HTTPS

Le conteneur sert du **HTTP sur le port 80 interne**. **HTTPS est obligatoire en production** : le service worker,
l'installation PWA et le plein écran n'existent qu'en contexte sécurisé. Le proxy externe (nginx-proxy-manager,
Caddy, Traefik, nginx…) doit :

1. terminer TLS et rediriger HTTP → HTTPS ;
2. transmettre `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` (= `https`) ;
3. **autoriser les WebSockets** (`Upgrade` / `Connection: upgrade`, délais de lecture longs) — indispensable au mode en ligne (`wss://<domaine>/ws`) ;
4. **ne pas mettre en cache** `index.html`, `sw.js` et `manifest.webmanifest`, et ne pas réécrire les `Cache-Control`
   de `/assets/*` (sinon les mises à jour ne sont jamais vues ou les fichiers sont rechargés pour rien) ;
5. ne pas imposer de CSP qui bloque les scripts inline de Workbox sans l'avoir testée.

```nginx
server {
    listen 443 ssl;
    server_name vers.example.org;
    # ssl_certificate / ssl_certificate_key …
    location / {
        proxy_pass http://127.0.0.1:8080;          # VERS_PORT
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
    }
}
```

Politique de cache appliquée par le nginx interne (`nginx.conf`) :

| Fichier | `Cache-Control` |
|---|---|
| `index.html`, `sw.js`, `manifest.webmanifest`, repli SPA | `no-cache, no-store, must-revalidate` |
| `/assets/*` et `workbox-*.js` (noms hachés) | `public, max-age=31536000, immutable` |
| Icônes et autres statiques | `public, max-age=3600, must-revalidate` |

Le build est précaché en entier par le service worker (jeu utilisable hors ligne dès la première visite). **Mettre à jour** :
reconstruire (`docker compose up --build -d`) ; les pages ouvertes détectent la nouvelle version à l'ouverture, toutes
les heures et au retour au premier plan, puis proposent un bouton *Mettre à jour* (la version affichée dans Réglages suit
`version` de `package.json`).

## Contrôles

| Action | Clavier / souris | Tactile |
|---|---|---|
| Marcher | `←` `→` | joystick (gauche) |
| Sauter / salto arrière | `Entrée` / `Retour arrière` | boutons ⤒ / ↺ |
| Régler la visée | `↑` `↓` | glisser verticalement sur le côté droit (ou ▲▼ du joystick pour affiner) |
| Charger puis tirer | maintenir `Espace`, relâcher | maintenir le bouton de tir (anneau de puissance), relâcher |
| Minuterie de la grenade | `1` à `5` | puces 1 à 5 près du bouton d'arme |
| Menu des armes | clic droit, `W` ou `Tab` | bouton d'arme (menu plein écran) |
| Désigner une cible (frappe, téléportation) | clic sur la carte | toucher la carte puis ✓ |
| Corde ninja | `Espace` accroche/décroche, `←→` balance, `↑↓` longueur | bouton de tir / joystick |
| Caméra | glisser, molette, clic sur la minimap | un doigt hors commandes, pincement |
| Passer le tour | `N` | — |
| Pause / fermer un menu | `Échap` | bouton pause |
| Son coupé / rétabli | `M` | Réglages |
| Rejouer (écran de fin) | `R` | bouton Rejouer |
| Debug | `F3` ou `` ` `` (overlay), `Maj`+clic (cratère) | — |

La taille et la position des commandes tactiles se règlent dans **Réglages → Régler les commandes tactiles**.

## Structure du code

```
src/
  main.ts            câblage : boucle, menus, entrées, replay, plateforme
  config/            gameplay.ts (TOUS les réglages de ressenti), engine.ts (technique, qualité), palette, noms
  core/              boucle à pas fixe, état + machine à états (game.ts), simulation, RNG, caméra, entrées, options,
                     stockage local, replay + killcam, mesures de performance
  terrain/           masque de collision, génération (bruit), peinture, rendu en tuiles
  physics/           collisions pixel, balistique (partagée avec l'IA)
  entities/          vers, projectiles, caisses, dessin (sprites en cache)
  weapons/           une définition par arme, logique de tir générique, explosions
  ai/                IA : plan (générateur découpé), marche, essais de tir, évaluation, contrôleur
  ui/                HUD canvas, menus DOM (ui/menu), commandes tactiles (ui/touch), effets, i18n, haptique
  audio/             sons et musique synthétisés (Web Audio)
  platform/          PWA (service worker, installation), plein écran, erreurs
  net/               mode en ligne : protocole, client WebSocket, session lockstep
server/              serveur de salons (Node + ws) : rooms.ts (logique), serve.ts, Dockerfile
tests/               Vitest (≈ 140 tests) ; scripts/ : banc d'essai ; docs/ : performance et réglage
```

Principes (détaillés dans `CLAUDE.md`) : **simulation déterministe** (pas fixe 60 Hz, graine, aucun `Math.random`
dans le gameplay) séparée du rendu ; la simulation n'a qu'une entrée, un `Intent` par pas (clavier, tactile, IA, replay
et futur réseau passent par là) ; tout nombre de gameplay vit dans `src/config/gameplay.ts`.

## Réglages de gameplay

Tout est dans [`src/config/gameplay.ts`](src/config/gameplay.ts) ; les valeurs retenues et leur justification sont dans
[docs/gameplay-tuning.md](docs/gameplay-tuning.md). Principales valeurs :

| Réglage | Valeur | Clé |
|---|---|---|
| Gravité | 900 px/s² | `physics.gravity` |
| Vent maximal | 100 px/s² (tiré à chaque tour) | `wind.max` |
| Durée du tour / retraite après tir | 45 s / 4 s | `turn.duration`, `turn.retreatTime` (durée du tour réglable dans le menu) |
| PV de départ | 100 (réglable : 25–300) | `worm.startHealth` |
| Dégâts au centre (tiny/small/medium/large/huge) | 42 / 35 / 63 / 105 / 140 | `explosion.presets` |
| Recul | 480 px/s × force de l'arme | `explosion.knockbackForce` |
| Dégâts de chute | 0,25 PV/px au-delà de 120 px (max 50) | `worm.fallDamage*` |
| Mort subite | eau +40 px tous les 2 tours à partir du tour 10 | `water.*` |
| Marche / saut | 70 px/s / 340 px/s | `worm.walkSpeed`, `worm.jumpSpeed` |

## Qualité et performances

Qualité graphique réglable (économique / équilibrée / maximale : résolution, particules, ombres, vagues) et résolution
dynamique automatique si la machine peine. Terrain en tuiles peintes à la demande, sprites de vers et étiquettes
prérendus, culling hors écran, très peu d'allocations par frame. Mesures avant/après et méthode :
[docs/performance.md](docs/performance.md).

## Robustesse

Pause automatique si la fenêtre perd le focus ; anti-coincement des vers (sortie locale puis replacement au sol) ;
erreurs de canvas, de génération de carte et de contexte graphique signalées clairement (jamais d'écran blanc) ;
boucle de jeu résiliente aux exceptions ; sauvegarde locale tolérante aux données corrompues.

## Pistes d'évolution

- **Mode en ligne — suites** : reconnexion (le `TurnRecorder`/`restoreState` permettent déjà de rejouer un tour pour
  rattraper un joueur), spectateurs, salons publics / classement, vérification des intentions côté serveur (anti-triche),
  chat et émoticônes.
- **Éditeur de cartes** : le terrain n'est qu'un masque 1 octet/pixel ; importer/exporter une image ou dessiner à la
  souris, graine + liste de cratères pour partager une carte.
- **Sprites** : `drawWorm`, `drawProjectile`, `drawCrate`, `drawWeaponIcon` sont des points de remplacement isolés ;
  le cache de sprites (`entities/wormSprites.ts`) accepte déjà des canvas prérendus.
- **Thèmes de terrain** : palette, herbe et textures sont dans `terrain/paint.ts`, ciel et eau dans `core/render.ts` /
  `ui/water.ts` ; ajouter un thème = un jeu de couleurs + paramètres de génération (`config/gameplay.ts` → `terrain`).
- **Autres idées** : nouvelles armes (une `WeaponDef` + un comportement), modes de jeu (équipes asymétriques), IA qui
  apprend les cartes, classements locaux/en ligne, accessibilité (daltonisme, taille des textes).
