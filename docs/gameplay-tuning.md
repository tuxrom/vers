# Réglage du gameplay

Passe de réglage sur `src/config/gameplay.ts`. Les valeurs retenues sont rappelées dans le README ; ce document explique
**comment elles ont été choisies** et ce qu'elles valent.

## Méthode

Impossible de faire jouer des humains en boucle : on a joué des **parties complètes IA contre IA** (niveau moyen contre
moyen, 2 équipes de 3 vers, vraies cartes générées, 8 parties par jeu de valeurs) avec `tests/tuning.test.ts`
(`TUNING=1 TUNING_OUT=… TUNING_DAMAGE=1.4 TUNING_SUDDEN=10 npx vitest run tests/tuning.test.ts`). L'IA moyenne tire avec
une petite erreur et compense le vent : elle mesure la *létalité* et le *rythme* du jeu, pas le plaisir humain. Les
valeurs liées au vent et à la durée du tour se décident donc surtout par lisibilité (voir plus bas) et restent à valider
en jouant.

Indicateurs : durée médiane en tours, taux de tirs qui blessent un ennemi, dégâts par tir réussi, éliminations et
noyades par partie, part des dégâts subis par l'équipe qui tire (auto-dégâts).

## Mesures

| Jeu de valeurs | Tours (médiane) | Tirs réussis | Dégâts / tir réussi | Éliminations / partie | Noyades / partie | Auto-dégâts |
|---|---|---|---|---|---|---|
| Départ (dégâts ×1, mort subite tour 12) | 32 | 47 % | 29,7 | 1,4 | 2,3 | 3 % |
| Dégâts ×1,3 | 30 | 48 % | 36,0 | 2,4 | 1,5 | 1 % |
| Dégâts ×1,3, recul ×1,2 | 32 | 49 % | 36,2 | 1,6 | 1,3 | 1 % |
| Dégâts ×1,3, mort subite tour 10 | 30 | 49 % | 36,1 | 2,3 | 1,9 | 1 % |
| Dégâts ×1,5 | 30 | 51 % | 40,2 | 2,3 | 1,4 | 2 % |
| Dégâts ×1,5, mort subite tour 10 | 26 | 50 % | 40,9 | 2,3 | 1,3 | 2 % |
| **Retenu** (dégâts ×1,4, mort subite tour 10, vent 100) | **26** | 45 % | **40,0** | **2,1** | 1,1 | 0 % |

Constat de départ : avec ×1 il faut ≈ 3,4 tirs au but pour tuer un ver de 100 PV et les parties se terminent surtout
par la mort subite (l'eau fait les éliminations manquantes). Plus de létalité rend le combat décisif ; le recul
supplémentaire ne fait qu'allonger les parties (les vers retombent plus loin, hors de portée) : abandonné.

## Valeurs retenues

| Réglage | Avant | Retenu | Pourquoi |
|---|---|---|---|
| Dégâts des explosions (tiny / small / medium / large / huge) | 30 / 25 / 45 / 75 / 100 | **42 / 35 / 63 / 105 / 140** | ×1,4 : un tir direct au bazooka fait ≈ 63 (2 tirs pour un ver neuf), la dynamite et la mine tuent au centre, comme dans le genre. |
| Mort subite | tour 12 | **tour 10** | Raccourcit les parties qui s'enlisent (26 tours au lieu de 30) sans décider seule des parties. |
| Vent maximal | 120 px/s² | **100 px/s²** | À 100 la dérive d'une roquette à pleine portée est ≈ 265 px au lieu de 320 : toujours décisive, plus lisible avec la jauge. Sans effet sur l'IA (elle compense) : choix de lisibilité. |
| Gravité | 900 px/s² | 900 (inchangée) | Vol de 1 à 2,5 s, saut de 64 px : arcs lisibles à l'écran sur une carte de 4000 px. |
| Durée du tour | 45 s | 45 (inchangée, réglable 15–120 s) | Assez pour viser et charger au doigt ; l'IA n'est pas limitée par le chrono. |
| Recul | ×1 | ×1 | Voir plus haut. |
| PV de départ | 100 | 100 (réglable 25–300) | Réglable au menu : parties courtes (25–50) ou longues (200+). |

## Limites

- La durée en tours est gonflée par l'IA, qui « perd » quelques tours à s'approcher ; une partie humaine sera différente.
- Les dégâts de chute ne sont pas isolés par le banc (ils sont rares) : à surveiller en jeu.
- À re-mesurer après tout changement de `gameplay.ts` avec la commande ci-dessus ; viser ≈ 2 éliminations au combat par
  partie et des noyades non nulles mais minoritaires.
