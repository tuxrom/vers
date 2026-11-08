# Performance : profilage, optimisations, mesures

Cible : **60 fps sur mobile milieu de gamme** (16,7 ms par frame, dont une grande partie réservée à la rastérisation du
navigateur).

## Méthode

`npm run bench` (`scripts/bench.mjs`) joue une scène chargée dans Chromium : 24 vers, une explosion (cratère + particules)
toutes les 350 ms, caméra qui balaie la carte, qualité maximale. Après 3 s de chauffe il mesure pendant 10 s :
CPU de rendu et de simulation par frame (`core/perf.ts`), intervalle entre frames, et octets alloués par frame (variation du
tas JS). Options : `--throttle 4` (CPU ralenti ×4 ≈ mobile milieu de gamme), `--mobile --dpr 2`, `--profile` (fonctions les
plus coûteuses), `--alloc` (sites d'allocation, avec `npm run dev` pour des noms lisibles), `--adaptive`.

> Chromium sans GPU rastérise en logiciel (SwiftShader) : les **fps absolus sont pessimistes** et dominés par le remplissage
> de pixels. Les colonnes CPU (JS) et allocations sont fiables ; les fps servent à comparer deux versions.

## Résultats

| Mesure | Avant | Après |
|---|---|---|
| PC 1280×720 — CPU de rendu / frame | 1,64 ms (p95 2,6) | **0,77 ms** (p95 1,2) |
| PC 1280×720 — simulation / frame | 0,23 ms | 0,12 ms |
| PC 1280×720 — allocations / frame | 75 Ko | **22 Ko** |
| Mobile émulé 844×390 @2x, CPU ×4 — rendu / frame | 8,7 ms (p95 14,2) | **4,4 ms** (p95 7,7) |
| Mobile émulé — allocations / frame | 114 Ko | **53 Ko** |
| Mobile émulé — fps (rastérisation logicielle) | 9,9 | 10,2 ; **18,3 avec la résolution dynamique** (échelle 0,6) |
| Overlay de debug | empreinte du terrain recalculée à chaque frame (5,6 % du CPU) | 2 fois par seconde |
| Démarrage d'une partie | peinture de toute la carte 4000×1200 : ≈ 160 ms + 19 Mo d'`ImageData` | tuiles de 512 px peintes à la demande : 2–10 ms chacune, le reste en tâche de fond (2 ms/frame) |

## Ce qui a changé

- **Terrain en tuiles** (`terrain/terrain.ts`) : 24 canvas de 512 px peints à la demande depuis le masque
  (`paintRegion`) ; un cratère ne retouche que les tuiles recouvertes, le rendu ne dessine que les tuiles visibles. La
  minimap ne recalcule que les zones modifiées (`Terrain.dirty`).
- **Sprites en cache** : corps des vers (couleur × regard × clignement, à la résolution d'écran par paliers) et étiquettes
  de noms prérendus ; le texte contouré était l'opération la plus chère du canvas.
- **Culling** : vers, caisses, projectiles, cordes, étiquettes et particules hors champ ne sont pas dessinés.
- **Moins d'allocations** : dégradés (ciel, eau) mémorisés, tables de styles de particules (plus de chaînes par particule),
  compaction en place des effets, régions d'interface recyclées, rectangle de caméra réutilisé, fermetures et tableaux
  temporaires retirés des chemins chauds (`groundSlope`, HUD, `unstick`, intentions).
- **Qualité** (`config/engine.ts`) : économique / équilibrée / maximale règlent résolution, particules, ombres, pas des
  vagues. **Résolution dynamique** (`core/perf.ts`, `AdaptiveResolution`) : si la durée moyenne des frames dépasse 24 ms
  pendant ≈ 1,5 s, le canvas descend par paliers de 0,2 (min 0,6) ; il remonte si elle passe sous 15,5 ms ; délai de 6 s
  entre deux changements.
- **Pas de pool pour les projectiles de la simulation** : il y en a au plus quelques-uns en vol (un tir par tour) ; un
  recyclage ajouterait un risque de références périmées (replay, tests) pour un gain nul. Les particules (le vrai flux)
  sont déjà dans des tableaux typés préalloués.

## Pistes restantes

Le coût dominant est désormais la rastérisation (remplissage). Leviers possibles : un canvas séparé pour le décor
(ciel/terrain) qui ne se redessine que quand la caméra bouge, `OffscreenCanvas` dans un worker, regrouper les tracés de
particules par couleur.
