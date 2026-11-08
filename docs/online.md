# Mode en ligne (salons, lockstep déterministe)

Deux navigateurs sur deux appareils jouent **la même partie** : seules les *entrées* des joueurs circulent, chaque client
rejoue exactement la même simulation, et une empreinte de l'état est comparée à chaque début de tour.

## Architecture

```
navigateur ──wss──▶ reverse proxy HTTPS ──▶ nginx (service « vers », /ws) ──▶ service « vers-server » (Node + ws, :8787)
```

- **Client** (`src/net/`) : `client.ts` (WebSocket, latence), `protocol.ts` (messages, encodage compact des intentions),
  `session.ts` (moteur lockstep). Menus : `ui/menu/menu.ts` (écrans *Jouer en ligne* et *Salon*), câblage : `main.ts`.
- **Serveur** (`server/`) : `rooms.ts` (toute la logique des salons, sans réseau, testable), `serve.ts` (HTTP `/healthz` +
  WebSocket `/ws`, anti-abus, battement de cœur), `index.ts` (point d'entrée). Il **ne simule pas le jeu** : il ordonne, autorise
  et compare. Bundle esbuild (`npm run server:build`), image `server/Dockerfile`.
- **nginx** : `location = /ws` proxifie vers `vers-server:8787` (DNS Docker résolu à la volée : le site démarre même si le
  serveur de jeu est absent, `/ws` répond alors 502).

## Déroulement

1. **Salon.** L'hôte *Crée un salon* (options de partie de son menu) ; le serveur renvoie un **code de 5 caractères**
   (alphabet sans ambiguïté `O/0/I/1`) et un lien `?room=CODE`. Les autres joueurs entrent le code (ou ouvrent le lien) et
   prennent la première équipe humaine libre. Les places humaines restées vides au lancement passent à l'ordinateur.
2. **Lancement.** L'hôte lance ; **le serveur tire la graine** de la carte (aléa cryptographique) et envoie à tous
   `{seed, options, owners}` : cartes et états initiaux identiques. Le nom de chaque équipe humaine est le pseudo du joueur.
3. **Lockstep.** Le numéro de pas (`state.tick`) indexe les intentions. Pour chaque pas :
   - phase *avant* le pas ∉ {`turn`, `firing`} → intention **neutre** chez tout le monde (même pour le joueur qui va jouer :
     sinon l'état divergerait au changement de tour) ;
   - sinon l'intention vient du **propriétaire de l'équipe active** : lue localement (et envoyée par lots) si c'est cet
     appareil ; produite par l'**IA de l'hôte** (et envoyée) si l'équipe est un ordinateur ; sinon **attendue du réseau**
     (le pas attend : `update()` renvoie `false`, le temps accumulé est conservé).
   Le joueur actif joue sans attendre ; les autres le suivent avec le retard réseau et rattrapent plus vite que le temps
   réel (`boost`) après un à-coup. Les IA tournent sur l'hôte seulement : leur temps de calcul dépend de la machine, donc
   leurs *intentions* sont transmises comme celles d'un humain au lieu d'être recalculées partout.
4. **Relève de tour et somme de contrôle.** Au début de chaque tour, chaque client envoie `sum {turn, team, tick, hash}`
   (`syncHash` : positions, vitesses, PV, terrain, aléa, munitions, projectiles, phase…). Le serveur confirme le tour
   (`turn`) quand **tous** les clients ont annoncé la même empreinte, sinon diffuse `desync` : la partie en ligne est
   interrompue avec un message explicite. Il sait aussi qui est autorisé à envoyer des intentions pour chaque tour et
   refuse les autres (ou les trous dans le flux). À la fin, les états finaux sont comparés (`end`) ; l'hôte peut proposer
   une **revanche** (nouvelle graine, mêmes joueurs).
5. **Déconnexion.** L'équipe du joueur parti passe à l'**IA de l'hôte**, qui reprend le flux d'intentions exactement au
   premier pas non relayé (`fromTick`). Si c'est l'hôte qui part, le plus ancien joueur restant devient hôte et reprend de
   la même façon. Salon vide = supprimé. Pas de reconnexion (une coupure sort le joueur ; il est remplacé).
6. **Latence.** `ping` toutes les 2 s, moyenne lissée, annoncée au serveur et affichée à tous (salon) ; pastille en jeu :
   code, latence colorée, dernier tour synchronisé, « En attente de … » quand le lockstep attend un joueur.

## Déterminisme (prérequis)

La simulation est identique d'un appareil à l'autre à condition de n'employer que des opérations au résultat exact :
`+ − × ÷`, `sqrt`, `floor/round/min/max/abs`, entiers 32 bits (`Rng`). `Math.hypot/sin/cos/pow/exp…` ne sont **pas** garantis
au dernier bit entre moteurs (V8, JavaScriptCore, SpiderMonkey) : la simulation utilise `core/math.ts` (`dist`, `dsin`, `dcos`,
racines carrées) et un test (`tests/determinism.test.ts`) interdit ces fonctions et les horloges dans les fichiers de
simulation. Toute évolution de la simulation doit respecter cette règle ; en cas de doute, `syncHash` + `tests/online.test.ts`
détectent la divergence.

## Limites connues

- **Triche** : confiance entre joueurs (chaque client simule tout). Le serveur n'autorise que le propriétaire de l'équipe
  active, mais ne peut pas vérifier le contenu des intentions.
- **Pas de reconnexion** ni de joueurs tardifs / spectateurs.
- **Latence** : le joueur actif n'est jamais ralenti, les autres voient son action avec le retard réseau ; une latence très
  élevée ou instable se traduit par des attentes visibles (« En attente de … »).
- **Mise en veille** d'un appareil : le serveur le détecte (battement de cœur de 20 s) et le remplace par l'IA.

## Développement et tests

```bash
npm run server                 # serveur local (port 8787) ; `npm run dev` proxifie /ws vers lui
npx vitest run tests/online.test.ts tests/server.test.ts tests/determinism.test.ts
```

`tests/online.test.ts` rejoue de vrais lockstep (simulation complète, latence simulée) : 2 joueurs, +IA hôte, déconnexion en
plein tour, départ de l'hôte, désynchronisation volontaire, fin de partie et revanche — états identiques à chaque tour.
`tests/server.test.ts` utilise de vrais WebSockets. Variables du serveur : `PORT` (8787), `HOST`, `MAX_ROOMS` (200).
