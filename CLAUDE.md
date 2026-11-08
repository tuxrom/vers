# CLAUDE.md

Guide pour Claude Code sur ce projet : **Vers**, jeu d'artillerie 2D au tour par tour (type Worms),
vers en équipes, terrain destructible, jouable dans un navigateur (PC + mobile), installable en PWA,
hébergé dans Docker (nginx). Hébergé sur le serveur `openspec.fr`, HTTPS fourni par un reverse proxy externe.

## Stack

- TypeScript (strict), Vite, **Canvas 2D natif** — aucun moteur de jeu.
- `vite-plugin-pwa` (service worker Workbox, manifest).
- Graphismes générés par code (terrain procédural, vers en primitives, particules).
- Sons synthétisés avec la Web Audio API. Aucun asset externe obligatoire ; l'architecture doit
  permettre de remplacer ces éléments par des sprites/samples (interfaces de rendu/son, pas d'appels
  de dessin éparpillés dans la logique).
- Docker : build `node:lts-alpine`, service `nginx:alpine`.

## Arborescence

```
src/
  main.ts          point d'entrée (câblage uniquement)
  core/            boucle à pas fixe, canvas, input, caméra, état global, RNG, rendu monde
  terrain/         bitmap destructible (canvas hors écran + masque), génération
  physics/         collisions pixel, balistique
  entities/        vers, projectiles, caisses
  weapons/         définitions et comportements des armes
  ai/              IA adverse
  ui/              HUD (canvas), menus (DOM, ui/menu/), i18n, overlay debug
  audio/           synthèse Web Audio
  config/          gameplay.ts (ressenti) et engine.ts (technique)
public/            icon.svg et assets statiques
Dockerfile  nginx.conf  nginx-security.inc  docker-compose.yml  .dockerignore  .env.example
```

## Conventions de code

- **Simulation déterministe** : pas fixe 60 Hz (`SIM_DT`), rendu interpolé (`alpha`). Aucun
  `Math.random`, `Date.now`, `performance.now` ni lecture du DOM dans la simulation : utiliser
  `Rng` (`core/rng.ts`, graine) stocké dans `GameState`. L'état de simulation est sérialisable.
  Les effets purement cosmétiques utilisent leur propre `Rng` (fork) — jamais celui du gameplay.
- **Nombres magiques** du gameplay (gravité, vent, durée du tour, PV, dégâts, rayons, forces de
  recul, vitesses, eau…) → uniquement dans `src/config/gameplay.ts`. Réglages techniques (Hz,
  pixel ratio) → `src/config/engine.ts`.
- Séparer simulation (`update`, pur, sans dessin) et rendu (`render`, lit l'état, n'y écrit pas).
  Les entités gardent leur position précédente (`px`, `py`) pour l'interpolation.
- Entrées : le jeu lit des **actions logiques** (`ActionInput`, `core/input.ts`), jamais des touches
  brutes ; clavier/tactile appellent `input.set(action, source, down)`. La simulation ne reçoit
  qu'un `Intent` par pas (`core/intent.ts`) : c'est la seule entrée de `step()` (replay/réseau).
- Terrain : le masque (`TerrainMask`) est la vérité physique, le canvas hors écran n'est que sa
  représentation ; toute destruction passe par `Terrain.carveCircle` (met les deux à jour).
- Les tests Node n'ont pas de DOM : `createState({ withCanvas: false })`, physique sur `SolidQuery`.
- Machine à états (`core/game.ts`) : `placing → turn → firing → resolving → transition → turn…`
  puis `gameover`. `resolving` attend que tout soit immobile (`isSettled`) avec un garde-fou
  (`turn.resolveTimeout`) : aucune situation ne doit bloquer la partie. Rotation des vers par équipe
  via `Team.cursor` ; les vers morts (`alive=false`) sont sautés.
- La simulation émet des `GameEvent` (`core/events.ts`, sortie seule) que le rendu vide chaque frame
  (caméra, sons, particules). La simulation ne les relit jamais.
- Caméra : `Camera` (suivi lissé, zoom, bornes carte) pilotée par `CameraDirector` (projectile > explosion
  > ver actif). Glisser/molette/pincement via `PointerController` ; les zones d'UI (`ui/ui.ts`) sont testées
  avant la caméra.
- Armes data-driven : une `WeaponDef` par fichier dans `src/weapons/` (nom, munitions, mode de tir,
  `endsTurn`, `usableAfterMove`, explosion…) ; réglages chiffrés dans `GAMEPLAY.weapons`, tailles d'explosion
  dans `GAMEPLAY.explosion.presets`. Logique générique dans `weapons/system.ts` (visée, charge, tir),
  `weapons/explosion.ts` (cratère + dégâts + recul), `entities/projectile.ts` (balistique, vent, rebonds).
  Munitions décomptées par équipe (`Team.ammo`, -1 = illimité).
- Chaque arme déclare `endsTurn` (retraite puis résolution) et `usableAfterMove` (sinon verrouillée une fois le
  ver déplacé). Un tir sans effet (téléportation invalide, corde dans le vide) ne consomme rien et ne termine
  pas le tour. Armes à cible (frappe aérienne, téléportation) : clic sur la carte → `Intent.target`. Corde :
  `Worm.rope` (pendule contraint), toujours relâchée à la fin du tour. Objets posés (dynamite, mine) :
  `Projectile` ; une mine armée au repos ne bloque pas la résolution. Largages différés : `GameState.pending`.
- Dégâts : tout passe par `damageWorm(s, id, amount, source)` (PV, mort, statistiques : dégâts/kills crédités
  seulement contre une autre équipe). Chute : `Worm.fallDamagePending` appliqué par `step()`. Mort =
  `alive=false` (tombe dessinée par `deathAge`) ; noyade = `sunk=true` (retiré de la physique, sans kill).
- Eau : `GameState.waterLevel` monte de `water.riseAmount` aux tours `suddenDeathTurn + k·riseEveryTurns` ;
  rendu animé `ui/water.ts` (2 couches), niveau affiché lissé par `Fx`. Caisses : `entities/crate.ts`
  (largage tiré à chaque début de tour, soins/arme/outil, ramassées au contact).
- Fin de partie : statistiques par équipe dans `Team.stats` (tir raté = tour où un tir offensif n'a blessé
  aucun ennemi) ; écran `ui/gameover.ts`, bouton Rejouer / touche R (`restart()` dans `main.ts`).
- Effets : `ui/fx.ts` (particules, secousse, bulles de dégâts), sons synthétisés `audio/` (AudioContext
  créé au premier geste ; `audio/eventSounds.ts` traduit les événements en sons).
- Options de partie : `GameOptions` (`core/options.ts` : 2-4 équipes, 1-6 vers, noms/couleurs, humain/IA, graine
  texte, durée de tour, PV de départ ; bornes dans `GAMEPLAY.options`) stockées dans `GameState.options`.
  Toute donnée externe passe par `sanitizeOptions`. Couleurs d'équipe : `Team.color` / `Worm.color`
  (plus de couleur par index). Le jeu ne lit plus `GAMEPLAY.match/turn.duration/worm.startHealth` que comme défauts.
- Sauvegarde : `core/storage.ts` (`Persistence` sur `localKV()` = localStorage avec repli mémoire ; clés
  `vers:v1:*` : options, settings, stats cumulées, favoris). Les options sont enregistrées à chaque modification.
  Changer le format ⇒ nouvelle version de clé + `sanitize*` tolérant.
- Menus : DOM + CSS (`ui/menu/`), pas de framework ; accueil, configuration, réglages (son, musique, qualité,
  langue), aide, statistiques, pause, transition hot-seat. Pendant un menu ou la transition : `input.enabled=false`
  et simulation gelée. Hot-seat = ≥ 2 équipes humaines (`isHotSeat`) : écran « À toi de jouer » avant chaque tour.
- IA (`src/ai/`) : `AiController` produit des `Intent` comme un humain (marche, réticule qui tourne pas à pas,
  charge visible, tir) — jamais d'écriture directe dans l'état. Le plan vient de `planTurn`, un **générateur**
  repris par tranches (`ai.pump(state, budgetMs)` à chaque frame, `GAMEPLAY.ai.budgetMs`/`sliceTrials`) : pas de
  gel de l'interface. Les essais de tir réutilisent la physique exacte du jeu (`physics/ballistics.ts#advanceBody`,
  `weapons/explosion.ts#blastEffect`, `updateWorm` pour marche et projection) : une prédiction = ce qui arrivera.
  Visée/puissance sont quantifiées sur les pas réels du jeu (angle ±n·`aim.rate·dt`, charge en pas). Niveaux dans
  `GAMEPLAY.ai` : facile (cible proche, vent ignoré, grosse erreur), moyen (grille + affinage, vent, petite erreur),
  difficile (positions atteignables, armes multiples, risque pour soi, projection vers l'eau/falaises).
  Toute tâche longue de l'IA doit être un générateur qui `yield` (≤ ~5 ms par tranche).
- Tactile (`ui/touch/`, `ui/haptics.ts`, `ui/gestures.ts`, `ui/safeArea.ts`) : mode détecté automatiquement
  (`(pointer: coarse)` puis dernier type de pointeur ; forçable dans Réglages). `TouchCore` (logique pure, testée
  sous Node) attribue **chaque doigt à une seule commande** (joystick, tir, saut, salto, armes, visée au doigt) via
  l'identifiant de pointeur ; `TouchControls` (DOM) l'écoute AVANT `PointerController` et lui retire les doigts pris
  (`stopImmediatePropagation` + `owns`). Les doigts libres = caméra (1 doigt) et zoom (pincement). Les commandes
  passent par `ActionInput.set` avec la source `touch:*` (même `Intent` que le clavier). Visée : le glissement fixe
  un angle cible et `main.ts` règle `aimDir` pour que le réticule le rejoigne au rythme du jeu. Armes à cible :
  un appui pose `touchTarget`, le bouton ✓ (le tir) valide. `pointercancel`/`lostpointercapture`/blur/changement de
  tour relâchent tout (`cancelAll`). Taille/position des commandes : `Settings.touch` (position par défaut en fraction
  de la zone sûre, personnalisée en fraction de l'écran), éditeur DOM `MenuManager.touchLayout`.
  `GameCanvas.touch/safe` pilotent le HUD (minimap en haut à gauche, bouton pause, menu d'armes plein écran,
  jauge de puissance agrandie, marges d'encoche). Aucun scroll/zoom/sélection : CSS (`touch-action:none`,
  `user-select:none`, `position:fixed`) + `installGestureGuards`. Paysage requis : invite `#rotate` en portrait.
- PWA (`vite.config.ts`, `src/platform/`) : `registerType: 'prompt'` (aucun rechargement surprise) ; manifeste
  complet (192, 512, **maskable 512**, SVG, `display: standalone`, `orientation: landscape`, `id/start_url/scope`
  = `/`) ; icônes générées depuis `public/icon.svg` par `npm run icons` (`pwa-assets.config.ts`, PNG versionnés ;
  l'icône est pleine page et garde le ver dans la zone sûre maskable). Service worker : précache de tout le build
  (hors ligne dès la 1re visite), repli SPA sur `index.html` (hors `/healthz`), `StaleWhileRevalidate` pour le
  reste de la même origine. `platform/pwa.ts` : détection de version à l'ouverture, toutes les heures, au retour au
  premier plan et en ligne ; toast « Nouvelle version » avec bouton Mettre à jour (prévient si une partie est en
  cours). `platform/install.ts` : `beforeinstallprompt` capturé → carte d'invitation sur l'accueil + bouton
  « Installer l'application » ; iOS Safari → écran d'aide Partager → Sur l'écran d'accueil ; refus mémorisé 14 jours.
  `platform/fullscreen.ts` : plein écran + `orientation.lock('landscape')` au lancement d'une partie tactile (repli :
  écran de rotation `#rotate`). La version (`__APP_VERSION__`, = package.json) s'affiche dans Réglages ; **un
  changement de code sans nouvelle empreinte de bundle n'est pas détecté** (le bundle change dès qu'un fichier change).
- En ligne (`docs/online.md`) : lockstep — seules les intentions circulent, rejouées au même numéro de pas chez tous.
  `net/session.ts` (`OnlineSession.intentFor`) : phase avant le pas ∉ {turn, firing} ⇒ intention NEUTRE chez tous ; sinon
  propriétaire de l'équipe active (local / IA de l'hôte / réseau, le pas attend). Le serveur (`server/rooms.ts`) tire la
  graine, autorise l'émetteur, confirme chaque tour quand toutes les `syncHash` sont égales, détecte la désynchronisation,
  remplace un joueur parti par l'IA de l'hôte (`fromTick`) et promeut un nouvel hôte. **La simulation ne doit utiliser que
  des opérations exactes** (`core/math.ts` : `dist/dsin/dcos`, `Math.sqrt`…) : pas de `Math.hypot/sin/cos/pow/exp`, pas
  d'horloge ni de `Math.random` (garde-fou : `tests/determinism.test.ts`). Toute nouvelle donnée de simulation doit être
  dans `syncHash`. Le serveur ne simule rien. `npm run server` + `tests/online.test.ts` / `server.test.ts`.
- Performance (`docs/performance.md`, `npm run bench`) : ne pas allouer dans les chemins chauds (pas de
  `filter`/fermetures/chaînes par frame ; réutiliser les objets) ; le texte et les corps de vers passent par des
  sprites en cache (`ui/labels.ts`, `entities/wormSprites.ts`) ; tout dessin hors champ est évité (`visible()` dans
  `core/render.ts`) ; le terrain est en tuiles peintes à la demande (`terrain/terrain.ts`, `paintRegion` ne dépend que du
  masque) ; qualité dans `QUALITY` + résolution dynamique (`ADAPTIVE`). Mesurer avant/après avec `npm run bench`.
- Replay (`core/replay.ts`, `core/killcam.ts`) : `TurnRecorder.afterStep(state, intent)` après CHAQUE pas de simulation
  (instantané de début de tour + intentions). Rejouer = `restoreState` + mêmes intentions = état identique (test
  d'égalité d'empreinte). Toute nouvelle donnée de simulation DOIT être dans `snapshotState`/`GameState` plain-object
  (structuredClone) et dans `hashState` si elle influe sur le jeu ; ne jamais lire d'horloge ni de `Math.random` dans
  la simulation, sous peine de replays faux.
- Robustesse : pause automatique (blur/onglet masqué) ; `relocateIfStuck` (anti-coincement) ; erreurs → `platform/errors.ts`
  (écran bloquant seulement si fatal, sinon notification) ; `GameLoop` absorbe les exceptions de frame (fatal après 30
  de suite) ; perte de contexte → `Terrain.invalidateCanvas()` et caches vidés.
- Réglage du gameplay : `tests/tuning.test.ts` (parties IA contre IA) ; consigner toute modification de valeurs et ses
  mesures dans `docs/gameplay-tuning.md`.
- Textes : tout texte visible passe par `t('clé')` (`ui/i18n.ts`). `fr` est la référence ; `en` est un
  `Record<Key,string>` donc la compilation échoue si une clé manque. Ajouter une langue = un dictionnaire + `LANGS`.
  Noms/descriptions d'armes : `weapon.<id>.name|desc`.
- Contrôles tactiles : joystick à gauche (marche ; ▲▼ visée fine/corde), glisser à droite = angle, bouton de tir à
  maintenir (anneau de puissance), ⤒ saut, ↺ salto, bouton d'arme = menu plein écran, toucher la carte + ✓ = cible.
- Contrôles actuels (étape 3) : Espace maintenu = charge, relâché = tir ; ↑/↓ visée ; 1-5 minuterie ;
  clic droit ou W/Tab = menu d'armes ; M = muet ; R = rejouer (écran de fin).
- Contrôles de base : ←/→ marche, Entrée saut, ⌫ salto arrière, N passe le tour, Échap pause,
  glisser = caméra, molette/pincement = zoom, clic minimap = recentrer, Maj+clic = cratère (debug).
- Pixel ratio plafonné à 2 ; viser 60 fps sur mobile milieu de gamme : pas d'allocation dans la
  boucle chaude, pas de `getImageData` par frame.
- Imports via l'alias `@/` (= `src/`). TypeScript strict, pas de `any`. Code et commentaires en
  français, identifiants en anglais.
- Commits : messages courts à l'impératif ; un commit par étape terminée.

## Commandes

npm :
- `npm run dev` — serveur de dev Vite (hôte exposé, overlay FPS actif)
- `npm run build` — `tsc --noEmit` puis `vite build` (sortie `dist/`)
- `npm run preview` — sert `dist/` en local (ajouter `-- --host 127.0.0.1` pour ne pas l'exposer sur le réseau)
- `npm run icons` — régénère les icônes PWA depuis `public/icon.svg`
- `npm run typecheck` — vérification de types seule
- `npm test` — Vitest (terrain, collisions, physique, armes, menus, IA ; ≈ 1,5 min dont les duels d'IA) ; à lancer avec le build à chaque étape

Docker :
- `docker compose up --build -d` — build et lancement ; port hôte via `VERS_PORT` (défaut 8080,
  ex. `VERS_PORT=8099 docker compose up --build -d`, ou fichier `.env`, cf. `.env.example`)
- `docker compose logs -f` / `docker compose down`
- Healthcheck : `GET /healthz` → `ok`

Lancement direct sans menu : `?seed=<texte>` ou `?play` (dernières options). Debug : `?debug` dans l'URL (ou touche `F3` / `` ` ``) affiche FPS, pas de sim/s, hash d'état ;
`?seed=<hex>` force la graine.

## Reverse proxy externe (HTTPS)

Le conteneur sert en HTTP sur le port 80 interne. Le proxy (nginx-proxy-manager) doit :
- terminer TLS (certificat) et rediriger HTTP → HTTPS ; HTTPS est **obligatoire** pour le service
  worker et l'installation PWA ;
- transmettre `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` (= `https`) ;
- activer le support WebSocket (`Upgrade` / `Connection: upgrade`) — requis pour l'étape 11 ;
- ne **pas** mettre en cache `index.html`, `sw.js`, `manifest.webmanifest` (sinon les mises à jour ne sont jamais vues) (nginx envoie déjà
  `Cache-Control: no-cache`) ; ne pas réécrire les `Cache-Control` des `/assets/*` (immutables) ;
- ne pas imposer de CSP bloquant les scripts/workers inline de Workbox sans test.
Vérifié derrière un reverse proxy nginx HTTPS (en-têtes ci-dessus) : service worker, hors ligne, installabilité
et en-têtes de cache inchangés. Contrôle d'une mise à jour : changer `version` dans package.json, `docker compose up
--build -d`, puis la page ouverte affiche le toast (`registration.update()` ou retour au premier plan).
nginx interne : gzip, MIME (webmanifest, js, svg), immutable sur `/assets/*` et `workbox-*.js`,
fallback SPA vers `index.html`, IP cliente lue dans `X-Forwarded-For` depuis les réseaux privés.

## Étapes

Règle : **après chaque étape, lancer `npm run build`, corriger les erreurs, tester le comportement
(dev/navigateur, et Docker quand c'est pertinent), puis cocher l'étape dans cette liste.** Ne pas
commencer l'étape suivante avant.

- [x] 0. Socle : Vite + TS, boucle à pas fixe, rendu interpolé, RNG, config, overlay FPS, Docker, nginx
- [x] 1. Terrain destructible et vers
- [x] 2. Tour par tour et caméra
- [x] 3. Armes à projectile et explosions
- [x] 4. Armes secondaires et utilitaires
- [x] 5. Dégâts, mort, eau et caisses
- [x] 6. Équipes, menus et sauvegarde
- [x] 7. IA adverse
- [x] 8. Contrôles tactiles
- [x] 9. PWA
- [x] 10. Optimisation et README
- [x] 11. Multijoueur en ligne (optionnel) : salons, lockstep déterministe, sommes de contrôle
