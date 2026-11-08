/**
 * Réglages de ressenti du gameplay — SEUL endroit où vivent les nombres magiques de la simulation.
 * Unités : pixels de monde, secondes, pixels/s, pixels/s². Tout est lu par la simulation (déterministe).
 * Les réglages purement techniques (pas de temps, pixel ratio) sont dans engine.ts.
 */
export const GAMEPLAY = {
  world: {
    width: 4000, // ≈ 3,5 écrans de large
    height: 1200,
    /** Marge hors-carte avant qu'une entité soit considérée comme perdue (px). */
    killMargin: 200,
  },

  physics: {
    gravity: 900, // px/s²
    terminalVelocity: 1400, // px/s
    /** Rebond (0 = aucun, 1 = parfait) appliqué aux projectiles rebondissants. */
    bounceRestitution: 0.5,
    airDrag: 0.0, // fraction de vitesse perdue par seconde
  },

  wind: {
    /** Vitesse de vent maximale (px/s² appliqués aux projectiles légers). */
    max: 100,
    /** Le vent est retiré au hasard (graine) à chaque tour, entre -max et +max. */
    changePerTurn: true,
  },

  turn: {
    duration: 45, // s, durée d'un tour
    /** Temps restant une fois l'arme utilisée : on s'éloigne pendant ce délai (s). */
    retreatTime: 4,
    /** Phase de placement : durée de calme exigée avant le premier tour (s) et délai maximal (s). */
    placeStableTime: 0.8,
    placeTimeout: 8,
    /** Résolution : tout doit rester immobile pendant ce délai (s) ; garde-fou si ça n'arrive jamais (s). */
    resolveStableTime: 0.8,
    resolveTimeout: 25,
    /** Bandeau de changement d'équipe (s). */
    transitionTime: 1.6,
    /** Vitesse en dessous de laquelle un ver est considéré immobile (px/s). */
    restSpeed: 8,
  },

  /** Valeurs par défaut d'une partie ; les menus peuvent les modifier dans les bornes de `options`. */
  match: {
    teams: 2,
    wormsPerTeam: 3,
    teamNames: ['Les Roses', 'Les Bleus', 'Les Jaunes', 'Les Verts'],
  },

  /** Bornes des réglages de partie proposés dans les menus. */
  options: {
    teams: { min: 2, max: 4 },
    worms: { min: 1, max: 6 },
    turnDuration: { min: 15, max: 120, step: 5 },
    health: { min: 25, max: 300, step: 25 },
    nameMaxLength: 16,
    favoritesMax: 12,
  },

  worm: {
    startHealth: 100,
    radius: 9, // rayon du cercle de collision (px)
    walkSpeed: 70, // px/s
    maxStepUp: 2, // marche franchissable par pixel horizontal (px) ≈ pente max grimpable
    maxStepDown: 4, // le ver "colle" au sol en descente jusqu'à cette hauteur (px)
    /** Pente (tan) au-delà de laquelle le ver ne peut plus grimper et glisse. */
    maxWalkSlope: 1.2,
    slideSpeed: 90, // px/s, glissade sur pente trop raide
    jumpSpeed: 340, // px/s vertical
    jumpForward: 130, // px/s horizontal
    backflipSpeed: 420,
    backflipBackward: 60,
    /** Rotation du salto : un tour complet par durée de vol (déduite de la vitesse et de la gravité). */
    backflipTurns: 1,
    landFriction: 0, // fraction de vx conservée à l'atterrissage
    ceilingBounce: 0, // fraction de vy conservée en tapant un plafond
    fallDamageThreshold: 120, // px de chute sans dégât
    fallDamagePerPixel: 0.25, // PV par px au-delà du seuil
    fallDamageMax: 50,
    knockbackMultiplier: 1.0,
    /** Ver projeté : rebond contre les murs, adhérence à l'atterrissage, freinage au sol (1/s). */
    knockedWallBounce: 0.4,
    knockedLandFriction: 0.5,
    knockedGroundFriction: 5,
  },

  explosion: {
    /**
     * Tailles d'explosion réutilisées par les armes (rayon du cratère en px, dégâts max au centre,
     * multiplicateur de recul). `huge` = dynamite.
     */
    presets: {
      tiny: { radius: 14, damage: 42, knockback: 0.45 },
      small: { radius: 28, damage: 35, knockback: 0.8 },
      medium: { radius: 45, damage: 63, knockback: 1 },
      large: { radius: 70, damage: 105, knockback: 1.2 },
      huge: { radius: 110, damage: 140, knockback: 1.6 },
    },
    /** Distance d'influence = rayon × ce facteur (dégâts et recul décroissent linéairement jusqu'à 0). */
    falloffRange: 1.4,
    /** Force de recul max (px/s) au centre, avant multiplicateur. */
    knockbackForce: 480,
    /** Projection verticale additionnelle (px/s). */
    knockbackLift: 120,
  },

  water: {
    startLevel: 1020, // y de la surface (px) au début de la partie
    riseAmount: 40, // px de montée à chaque palier
    riseEveryTurns: 2, // montée tous les N tours une fois la mort subite déclenchée
    suddenDeathTurn: 10, // numéro du tour à partir duquel l'eau monte (mort subite)
    /** Un ver dont le bas du corps passe sous la surface est éliminé. */
    drownMargin: 2,
    /** Vitesse d'animation de la montée à l'écran (px/s). */
    riseAnimSpeed: 40,
  },

  terrain: {
    /** Amplitude des collines (px, ± autour de baseHeight). */
    amplitude: 260,
    /** Les valeurs du bruit fractal restent proches de 0,5 : ce facteur étire le relief. */
    amplitudeScale: 3.2,
    baseHeight: 640, // y moyen de la surface
    minSurface: 200, // y minimal de la surface
    /** Nombre d'octaves du bruit de surface. */
    octaves: 4,
    /** Longueur d'onde de la première octave (px). */
    wavelength: 900,
    persistence: 0.5,
    /** Épaisseur de la couche d'herbe (px). */
    grassDepth: 10,
    /** Grottes : tunnels le long de la ligne de niveau 0,5 d'un bruit 2D. */
    caveWavelength: 240,
    caveOctaves: 3,
    caveWidth: 0.036, // demi-épaisseur de la bande de bruit creusée (plus grand = tunnels plus larges)
    caveMinDepth: 30, // profondeur sous la surface avant la première grotte (px)
    caveWaterMargin: 40, // les grottes s'arrêtent à ce delta sous le niveau de l'eau (px)
    caveTaper: 120, // distance sur laquelle les tunnels s'amincissent avant le fond (px)
    caveCellSize: 4, // résolution du champ de bruit des grottes (px)
    /** Îlots flottants. */
    islandCount: 6,
    islandMinWidth: 160,
    islandMaxWidth: 340,
    islandMinThickness: 45,
    islandMaxThickness: 90,
    islandMinY: 140,
    islandClearance: 140, // écart vertical minimal au-dessus de la surface (px)
    /** Marge à gauche/droite sans îlot (px). */
    islandEdgeMargin: 150,
    /** Le ver apparaît à au moins cette hauteur au-dessus de l'eau (px). */
    spawnWaterMargin: 40,
    spawnMinHeadroom: 40,
  },

  crate: {
    spawnChancePerTurn: 0.5, // tirage (graine) au début de chaque tour
    maxAlive: 3,
    halfSize: 8, // demi-côté de la caisse (px)
    fallSpeed: 80, // px/s (parachute)
    healthRestore: 25,
    /** Répartition des contenus (poids relatifs). */
    weights: { health: 3, weapon: 4, tool: 3 },
    /** Munitions ajoutées par une caisse d'arme ou d'outil. */
    ammoBonus: 2,
    weaponPool: ['grenade', 'shotgun', 'dynamite', 'airstrike', 'bat'],
    toolPool: ['rope', 'teleport', 'mine'],
    /** Marge au-dessus de l'eau pour choisir la colonne de largage (px). */
    dropWaterMargin: 60,
  },

  camera: {
    followLerp: 6, // vitesse de suivi (1/s)
    zoomLerp: 8, // vitesse de rattrapage du zoom (1/s)
    /** Anticipation : la caméra vise la position du projectile dans ce délai (s). */
    lookAhead: 0.12,
    /** Durée pendant laquelle la caméra reste sur une explosion (s). */
    explosionFocusTime: 1.4,
    /** Facteur de zoom par cran de molette. */
    wheelZoomStep: 1.12,
    /** Distance (px écran) avant qu'un appui devienne un glissement de caméra. */
    dragThreshold: 6,
    /** Hauteur de monde visible à l'écran (px) : le zoom s'adapte à la taille de la fenêtre. */
    viewHeight: 480,
    minZoom: 0.4,
    maxZoom: 2.5,
  },


  /** Visée, charge et réglages propres à chaque arme (les définitions vivent dans src/weapons). */
  weapons: {
    aim: {
      rate: 1.4, // rad/s
      min: -1.35, // visée vers le bas (rad, négatif = sous l'horizontale)
      max: 1.5, // visée vers le haut
      start: 0.45, // angle au début du tour
      reticleDistance: 46, // px du centre du ver
    },
    /** Temps pour charger la jauge de puissance de 0 à 100 % en maintenant le tir (s). */
    chargeTime: 1.5,
    /** Distance entre le centre du ver et le point d'apparition d'un projectile (px). */
    muzzleOffset: 15,
    /** Vitesse sous laquelle un projectile qui touche le sol s'immobilise (px/s). */
    projectileRestSpeed: 28,
    /** Vitesse minimale d'un rebond audible/visible (px/s). */
    bounceEventSpeed: 90,
    /** Durée de vie maximale d'un projectile (s) : garde-fou contre tout blocage. */
    projectileMaxAge: 40,

    bazooka: {
      ammo: -1, // illimité
      minSpeed: 140, // px/s à 0 % de puissance
      maxSpeed: 1250, // px/s à 100 %
      radius: 3,
      windInfluence: 1,
      gravityScale: 1,
      blast: 'medium',
    },
    grenade: {
      ammo: 6,
      minSpeed: 120,
      maxSpeed: 980,
      radius: 4,
      windInfluence: 0.12,
      gravityScale: 1,
      bounce: 0.55, // restitution au rebond
      friction: 0.25, // fraction de vitesse tangentielle perdue à chaque rebond
      spin: 9, // rad/s
      fuseMin: 1,
      fuseMax: 5,
      fuseDefault: 3,
      blast: 'medium',
    },
    dynamite: {
      ammo: 2,
      fuse: 5, // s
      radius: 5,
      blast: 'huge',
    },
    airstrike: {
      ammo: 1,
      missiles: 5,
      spacing: 46, // px entre deux missiles (en ligne)
      stagger: 0.17, // s entre deux largages
      startY: -80, // y de départ des missiles (au-dessus de la carte)
      fallSpeed: 520, // vitesse initiale vers le bas (px/s)
      gravityScale: 0.25,
      windInfluence: 0.25,
      radius: 3,
      blast: 'small',
    },
    bat: {
      ammo: 3,
      reach: 30, // portée au-delà du corps du ver (px)
      force: 780, // impulsion d'éjection (px/s)
      damage: 20,
      blast: 'tiny',
    },
    rope: {
      ammo: 5,
      maxLength: 380, // portée du tir de la corde (px)
      minLength: 28,
      swing: 520, // accélération latérale du balancement (px/s²)
      climbSpeed: 140, // px/s (↑ raccourcit, ↓ allonge)
      maxSpeed: 950, // vitesse maximale en balancement (px/s)
      releaseBoost: 1.1, // facteur de vitesse au décrochage : le ver se projette
      blast: 'tiny',
    },
    teleport: {
      ammo: 2,
      headroom: 4, // marge libre exigée autour de la destination (px)
      appearTime: 0.6, // durée de l'animation d'apparition (s)
      blast: 'tiny',
    },
    mine: {
      ammo: 3,
      radius: 5,
      armDelay: 2.2, // s avant armement
      triggerRadius: 38, // px : un ver à cette distance déclenche la mine
      triggerFuse: 0.45, // s entre déclenchement et explosion
      bounce: 0.15,
      friction: 0.5,
      blast: 'large',
    },
    shotgun: {
      ammo: 8,
      shots: 2,
      reload: 0.75, // s entre deux tirs
      range: 560, // px
      blast: 'tiny',
    },
  },

  /** Effets visuels (cosmétique) : particules et secousse de caméra. */
  fx: {
    shake: {
      perRadius: 0.2, // px de secousse par px de rayon d'explosion
      max: 22,
      decay: 5, // 1/s
    },
    maxParticles: 900,
    /** Éclaboussure : nombre de gouttes par px de rayon d'impact. */
    splashDrops: 22,
    /** Hauteur et longueur d'onde des deux couches de vagues (px) ; vitesse en rad/s. */
    waves: { amp1: 5, len1: 110, speed1: 1.6, amp2: 3.5, len2: 70, speed2: -2.3 },
    /** Délai avant l'écran de victoire après la fin de partie (s) et durée de la chute de la tombe (s). */
    gameoverDelay: 1.6,
    graveDrop: 0.7,
  },

  /** Intelligence artificielle : délais, erreurs de visée et réglages de recherche par niveau. */
  ai: {
    /** Temps de calcul alloué à l'IA par frame de rendu (ms) : le reste du calcul est repris à la frame suivante. */
    budgetMs: 4,
    /** Nombre d'essais de tir entre deux points de reprise du calcul (découpage en tranches). */
    sliceTrials: 6,
    easy: {
      think: [1.6, 2.8], // délai de réflexion avant d'agir (s)
      aimPause: [0.5, 1.0], // pause avant de tirer, réticule en place (s)
      aimError: 0.2, // écart-type de l'erreur d'angle (rad)
      powerError: 0.28, // écart-type de l'erreur de puissance (fraction)
      approachRange: 750, // distance au-delà de laquelle elle s'approche de la cible (px)
    },
    medium: {
      think: [1.0, 2.0],
      aimPause: [0.35, 0.8],
      aimError: 0.03,
      powerError: 0.04,
      approachRange: 1100,
    },
    hard: {
      think: [0.7, 1.4],
      aimPause: [0.25, 0.6],
      aimError: 0.012,
      powerError: 0.015,
      approachRange: 1400,
      /** Positions de tir atteignables évaluées (en plus de la position actuelle). */
      positions: 6,
      /** Meilleurs tirs re-évalués avec la simulation de projection des vers (eau, falaises). */
      knockTopK: 6,
      /** Distance max (px) d'un ennemi pour tenter la batte ou la dynamite. */
      closeRange: 70,
    },
    /** Déplacement : durée maximale simulée, pas d'échantillonnage des positions, détection de blocage. */
    walk: { maxSeconds: 4.5, stride: 60, stuckTicks: 12, unsafeFall: 90, idealRange: 520 },
    /** Recherche de tir : pas (en crans d'angle / de charge) de la grille grossière, puis fenêtre d'affinage. */
    search: { aimStride: 3, powerStride: 9, refineAim: 3, refinePower: 6, refineTop: 3 },
    /** Valeur d'un tir : kills, risque pour soi et ses équipiers, noyades provoquées. */
    score: {
      killBonus: 40,
      selfFactor: 1.5,
      allyFactor: 1.2,
      selfKillPenalty: 120,
      allyKillPenalty: 60,
      drownBonus: 120,
      /** Score sous lequel une position/arme est jugée sans intérêt. */
      minScore: 8,
    },
  },

  /** Commandes tactiles. */
  touch: {
    /** Radians de visée par pixel de glissement vertical sur la zone de visée. */
    aimRadPerPx: 0.0075,
    /** Zone morte du joystick (fraction du rayon) et seuil vertical pour régler la visée / la corde. */
    joyDeadzone: 0.3,
    joyVertical: 0.62,
    /** La prise du joystick déborde de sa base de cette fraction du rayon (doigt imprécis). */
    joyGrab: 0.5,
    /** La zone de visée au doigt commence à cette fraction de la largeur de l'écran. */
    aimZoneStart: 0.5,
    /** Retour haptique : durées (ms) et distance d'effet d'une explosion (en rayons d'explosion). */
    haptics: { minMs: 20, maxMs: 90, damageBaseMs: 15, damagePerHp: 2.5, damageMaxMs: 160, reach: 1.6, minGapMs: 60 },
  },

  /** Replay au ralenti du dernier tir (killcam) : rejoué depuis le début du tour grâce au déterminisme. */
  killcam: {
    slowMotion: 0.25, // vitesse de lecture (1 = temps réel)
    leadSeconds: 1.2, // durée montrée avant le tir (s de jeu)
    tailSeconds: 1.8, // durée montrée après la dernière explosion (s de jeu)
    fastForwardStepsPerFrame: 400, // pas rejoués par frame avant la partie visible (sans bloquer l'interface)
    autoAtGameOver: true, // lancé automatiquement quand la partie se termine
  },
} as const;
