import { ADAPTIVE, QUALITY, SIM_DT } from '@/config/engine';
import { GAMEPLAY } from '@/config/gameplay';
import { AudioEngine } from '@/audio/audio';
import { playEvents } from '@/audio/eventSounds';
import { AiController } from '@/ai';
import { Camera } from '@/core/camera';
import { Killcam } from '@/core/killcam';
import { TurnRecorder } from '@/core/replay';
import { clearLabels } from '@/ui/labels';
import { wormSprites } from '@/entities/wormSprites';
import { drawKillcam } from '@/ui/killcamOverlay';
import { errorMessage, installGlobalErrorHandlers, showFatal } from '@/platform/errors';
import { AdaptiveResolution, Perf } from '@/core/perf';
import { CanvasUnavailableError, GameCanvas } from '@/core/canvas';
import { Debug } from '@/core/debug';
import { CameraDirector } from '@/core/director';
import { NEUTRAL_INTENT, type Intent } from '@/core/intent';
import { ActionInput, bindKeyboard } from '@/core/input';
import { GameLoop } from '@/core/loop';
import { isHotSeat, randomSeed, sanitizeOptions, seedToNumber, type GameOptions } from '@/core/options';
import { OnlineController } from '@/net/controller';
import { drawOnlineBadge } from '@/ui/onlineBadge';
import { PointerController } from '@/core/pointer';
import { renderWorld } from '@/core/render';
import { step } from '@/core/simulation';
import { createState, syncHash, type GameState } from '@/core/state';
import { Persistence, localKV } from '@/core/storage';
import { drawDebugOverlay } from '@/ui/debugOverlay';
import { Fx } from '@/ui/fx';
import { drawGameOver } from '@/ui/gameover';
import { drawHud } from '@/ui/hud';
import { defaultTeamNames, setLang } from '@/ui/i18n';
import { MenuManager, type MenuHost } from '@/ui/menu/menu';
import { Minimap } from '@/ui/minimap';
import { UI } from '@/ui/ui';
import { drawWeaponHud, drawWeaponMenu } from '@/ui/weaponMenu';
import { InstallManager } from '@/platform/install';
import { canFullscreen, enterFullscreen, isFullscreen, toggleFullscreen } from '@/platform/fullscreen';
import { setupServiceWorker, type ServiceWorkerHandle } from '@/platform/pwa';
import { Toasts } from '@/ui/menu/toasts';
import { installGestureGuards } from '@/ui/gestures';
import { Haptics } from '@/ui/haptics';
import { t } from '@/ui/i18n';
import { TouchControls } from '@/ui/touch/controls';
import type { TouchHost } from '@/ui/touch/core';
import { computeControls } from '@/ui/touch/layout';
import { WEAPONS } from '@/weapons';

/** Canvas du jeu ; si le navigateur n'en fournit pas, un message clair remplace l'écran blanc. */
function bootCanvas(): GameCanvas {
  try {
    return new GameCanvas(document.getElementById('game') as HTMLCanvasElement);
  } catch (e) {
    showFatal(e instanceof CanvasUnavailableError ? t('error.canvas') : t('error.generic', { msg: errorMessage(e) }));
    throw e;
  }
}
const canvas = bootCanvas();
const camera = new Camera();
const director = new CameraDirector();
const input = new ActionInput();
bindKeyboard(input);
const debug = new Debug();
const ui = new UI();
const minimap = new Minimap();
const ai = new AiController();
let fx = new Fx();
const audio = new AudioEngine();
const params = new URLSearchParams(location.search);
const haptics = new Haptics();
const perf = new Perf();
const adaptive = new AdaptiveResolution(ADAPTIVE);
/** `?noadapt` : résolution fixe (mesures, comparaisons). */
const adaptiveOn = !new URLSearchParams(location.search).has('noadapt');
installGestureGuards();

// --- Sauvegarde locale et réglages ------------------------------------------------------------
const persistence = new Persistence(localKV());
const settings = persistence.loadSettings();
setLang(settings.lang);

function applySettings(): void {
  audio.setVolumes(settings.sound, settings.music);
  haptics.enabled = settings.haptics;
  const rot = document.getElementById('rotate');
  if (rot) rot.textContent = `📱↻  ${t('touch.rotate')}`;
  const q = QUALITY[settings.quality];
  canvas.quality = q;
  canvas.maxDpr = q.maxPixelRatio;
  adaptive.reset(); // nouveau réglage de qualité : on repart de la pleine résolution
  canvas.resolutionScale = 1;
  canvas.resize();
  fx.density = q.particles;
}
applySettings();

// --- Intégration plateforme : installation, notifications de version
const INSTALL_SNOOZE_MS = 14 * 24 * 3600 * 1000;
const install = new InstallManager();
const toasts = new Toasts(document.getElementById('pwa') as HTMLElement);
let sw: ServiceWorkerHandle | null = null;

// --- État applicatif ---------------------------------------------------------------------------
/** `menu` : décor animé derrière les menus ; `game` : partie en cours (éventuellement en pause). */
let mode: 'menu' | 'game' = 'menu';
/** État de décor des menus : simulé quelques instants puis figé. */
const demo = createState({ options: persistence.loadOptions(defaultTeamNames()), seed: seedToNumber(randomSeed()) });
let state: GameState = demo;
let recorded = false;
/** Enregistre chaque tour (instantané + intentions) pour rejouer le dernier tir au ralenti. */
const recorder = new TurnRecorder();
let killcam: Killcam | null = null;
/** Fin de lecture (ms) : on laisse l'image finale quelques instants. */
let killcamHoldUntil = 0;
let killcamAutoDone = false;
let handoffPending = false;
let hover: { sx: number; sy: number } | null = null;

// --- Interface tactile : détection automatique (dernier type de pointeur utilisé) ou forcée dans les réglages
let touchSeen = matchMedia('(pointer: coarse)').matches;
window.addEventListener('pointerdown', (e) => { touchSeen = e.pointerType === 'touch' || e.pointerType === 'pen'; }, true);
const touchMode = (): boolean => settings.controls === 'touch' || (settings.controls === 'auto' && touchSeen);
/** Cible provisoire posée au doigt (frappe aérienne, téléportation) en attendant la validation par ✓. */
let touchTarget: { x: number; y: number } | null = null;
/** Commandes tactiles de la frame courante (calculées une fois par frame, pas à chaque lecture). */
let frameCircles: ReturnType<typeof computeControls> | null = null;

// --- En ligne : salons, lockstep et reconnexion sont dans `net/controller.ts` ; ici, seulement le câblage ---------
function onlineName(): string {
  let n = persistence.onlineName();
  if (!n) { n = `Joueur${Math.floor(Math.random() * 900 + 100)}`; persistence.setOnlineName(n); }
  return n;
}

const online = new OnlineController({
  state: () => state,
  inGame: () => mode === 'game',
  options: () => sanitizeOptions(host.options, defaultTeamNames()),
  name: onlineName,
  setName: (n) => persistence.setOnlineName(n),
  menu: () => menu,
  begin: (options) => beginGame(options, () => online.leave()),
  backToDemo: () => { mode = 'menu'; state = demo; killcam = null; recorder.reset(); },
  toast: (id, text, timeoutMs) => toasts.show(id, { text, timeoutMs }),
  fatal: (message, then) => showFatal(message, then),
  shareLink: (code) => `${location.origin}/?room=${code}`,
  now: () => performance.now(),
});
online.keepHashes = debug.enabled;

/** L'équipe `team` est-elle jouée par un humain de CET appareil ? */
const localTeam = (team: number): boolean => (online.session ? online.session.isLocalTeam(team) : state.teams[team]?.controller === 'human');
/** Phase contrôlée (tour ou retraite) et équipe active jouée ici : les commandes du joueur s'appliquent. */
const localCanAct = (): boolean => (state.phase === 'turn' || state.phase === 'firing') && localTeam(state.turn.team);
/** L'IA de CET appareil pilote-t-elle le tour en cours ? (en ligne : seul l'hôte fait tourner les IA, les autres reçoivent ses actions) */
const aiDrives = (): boolean => AiController.isAiTurn(state) && (!online.active || online.isHost);

const host: MenuHost = {
  online: online.menuHost,
  persistence,
  settings,
  options: persistence.loadOptions(defaultTeamNames()),
  onStart: startGame,
  onResume() { input.clearPressed(); },
  onQuit: () => (online.active ? online.leave() : quitToMenu()),
  onSettingsChanged: applySettings,
  installKind: () => install.kind,
  onInstall: () => { void install.prompt(); },
  installInvite: () => (install.kind === 'prompt' || install.kind === 'ios') && Date.now() - persistence.installDismissedAt() > INSTALL_SNOOZE_MS,
  onInstallDismiss: () => persistence.dismissInstall(Date.now()),
  fullscreenAvailable: () => canFullscreen(),
  fullscreenActive: () => isFullscreen(),
  onToggleFullscreen: () => { void toggleFullscreen(); },
  canReplay: () => mode === 'game' && recorder.hasShot() && (!online.active || state.phase === 'gameover'),
  onReplay: startKillcam,
};
const menu = new MenuManager(document.getElementById('ui') as HTMLElement, host);

/** Les commandes de jeu répondent-elles ? (tour d'un humain, aucun menu ni transition) */
const controlsActive = (): boolean =>
  mode === 'game' && !menu.visible && !handoffPending && !killcam && !ui.menuOpen &&
  localCanAct();
const aimActive = (): boolean => controlsActive() && state.phase === 'turn' && WEAPONS[state.turn.weapon].aim;

const touchHost: TouchHost = {
  circles: () => frameCircles ?? computeControls(canvas.width, canvas.height, canvas.safe, settings.touch),
  enabled: () => touchMode() && controlsActive(),
  fireMode: () => (WEAPONS[state.turn.weapon].input === 'target' ? 'confirm' : 'hold'),
  aimZone: () => (aimActive()
    ? { x: canvas.width * GAMEPLAY.touch.aimZoneStart, y: 0, w: canvas.width * (1 - GAMEPLAY.touch.aimZoneStart), h: canvas.height }
    : null),
  uiHit: (x, y) => ui.hit(x, y) !== null,
  currentAim: () => state.turn.aim,
  press: (a, src, down) => input.set(a, src, down),
  onWeapons: () => { ui.menuOpen = true; },
  onConfirm: () => { if (touchTarget) { input.pushTarget(touchTarget.x, touchTarget.y); touchTarget = null; } },
};
// Créé AVANT le contrôleur de pointeur : il retire de la caméra les doigts attribués aux commandes.
const touchCtl = new TouchControls(canvas.el, touchHost);

/** Crée la partie (carte, état, remise à zéro de l'affichage) ; `onFail` après le message si la création échoue. */
function beginGame(options: GameOptions, onFail: () => void): void {
  menu.hide();
  menu.setLoading(true);
  // Sur mobile : plein écran + verrouillage paysage (depuis ce geste ; sans effet si non supporté → écran de rotation).
  if (touchMode()) void enterFullscreen();
  // Laisse le navigateur afficher « Génération… » avant le calcul (≈ 0,3 s, bloquant).
  setTimeout(() => {
    try {
      state = createState({ options });
      fx = new Fx();
      fx.density = QUALITY[settings.quality].particles;
      adaptive.reset();
      canvas.resolutionScale = 1;
      canvas.resize();
      mode = 'game';
      recorded = false;
      handoffPending = false;
      camera.resume();
      ui.menuOpen = false;
      input.clearPressed();
      recorder.reset();
      killcam = null;
      killcamAutoDone = false;
      menu.setLoading(false);
    } catch (e) {
      // Mémoire insuffisante, canvas indisponible… : message clair et retour au menu plutôt qu'un écran figé.
      console.error(e);
      menu.setLoading(false);
      showFatal(t(e instanceof CanvasUnavailableError ? 'error.canvas' : 'error.memory'), onFail);
    }
  }, 40);
}

/** Nouvelle partie locale avec ces options (sauvegardées comme « dernières options »). */
function startGame(options: GameOptions): void {
  host.options = structuredClone(options);
  persistence.saveOptions(host.options);
  beginGame(options, quitToMenu);
}

/** Rejouer : mêmes options, carte suivante (graine dérivée, déterministe). */
function restart(): void {
  const o = structuredClone(state.options);
  o.seed = (Math.imul(seedToNumber(o.seed), 1664525) + 1013904223 >>> 0).toString(16).padStart(8, '0');
  startGame(o);
}

function quitToMenu(): void {
  mode = 'menu';
  state = demo;
  killcam = null;
  recorder.reset();
  handoffPending = false;
  ui.menuOpen = false;
  input.clearPressed();
  menu.show('home', true);
}

/** Lance le replay au ralenti du dernier tir (depuis le début du tour enregistré). */
function startKillcam(): void {
  if (mode !== 'game' || killcam) return;
  const rec = recorder.latest(state);
  if (!rec) return;
  try {
    killcam = new Killcam(rec);
    killcamHoldUntil = 0;
    ui.menuOpen = false;
    camera.resume();
    toasts.dismiss('autopause');
  } catch (e) {
    console.error(e);
    killcam = null;
    reportError(errorMessage(e));
  }
}

function endKillcam(): void {
  killcam = null;
  camera.resume();
  input.clearPressed();
}

/** Erreur inattendue : notification (au plus une toutes les 10 s), la partie continue. */
let lastErrorAt = -1e9;
function reportError(msg: string): void {
  const now = performance.now();
  if (now - lastErrorAt < 10_000) return;
  lastErrorAt = now;
  toasts.show('error', {
    text: t('error.generic', { msg }),
    actions: [{ label: t('error.reload'), primary: true, onClick: () => location.reload() }],
    timeoutMs: 9000,
  });
}
installGlobalErrorHandlers(reportError);

// Perte du contexte graphique (veille, mémoire) : pause, puis restauration des tuiles et des caches depuis l'état.
canvas.onContextLost = () => {
  toasts.show('ctx', { text: t('error.contextLost') });
  if (mode === 'game' && !menu.visible) menu.show('pause', true);
};
canvas.onContextRestored = () => {
  state.terrain.invalidateCanvas();
  demo.terrain.invalidateCanvas();
  wormSprites.clear();
  clearLabels();
  canvas.resize();
  toasts.dismiss('ctx');
};

/** Pause automatique : onglet masqué ou fenêtre qui perd le focus (jamais de partie qui se joue sans le joueur). */
function autoPause(): void {
  if (online.active || mode !== 'game' || menu.visible || handoffPending || killcam || state.phase === 'gameover') return;
  menu.show('pause', true);
  toasts.show('autopause', { text: t('pause.auto'), timeoutMs: 3500 });
}
document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
window.addEventListener('blur', () => { setTimeout(() => { if (!document.hasFocus()) autoPause(); }, 0); });

// L'audio ne démarre qu'après un geste utilisateur.
for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, () => audio.unlock());

canvas.el.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const r = canvas.el.getBoundingClientRect();
  hover = { sx: e.clientX - r.left, sy: e.clientY - r.top };
});
canvas.el.addEventListener('pointerleave', () => { hover = null; });

new PointerController(canvas.el, camera, {
  view: () => ({ w: canvas.width, h: canvas.height }),
  hit: (sx, sy) => ui.hit(sx, sy),
  onRegion(r, sx, sy, phase) {
    if (r.id === 'minimap') {
      const p = minimap.toWorld(sx, sy);
      camera.centerOn(p.x, p.y, canvas.width, canvas.height);
    } else if (phase === 'down') {
      if (r.id === 'menu-bg' || r.id === 'menu-close') ui.menuOpen = false;
      else if (r.id === 'pause-btn') menu.show('pause', true);
      else if (r.id === 'weapon-btn') ui.menuOpen = true;
      else if (r.id === 'replay') { if (online.active) online.rematch(); else restart(); }
      else if (r.id === 'replay-shot') startKillcam();
      else if (r.id === 'killcam-skip') endKillcam();
      else if (r.id === 'gameover-menu') { if (online.active) online.leave(); else quitToMenu(); }
      else if (r.id.startsWith('weapon:')) { input.pushSelect(r.id.slice(7)); ui.menuOpen = false; }
      else if (r.id.startsWith('fuse:')) input.pushFuse(Number(r.id.slice(5)));
    }
  },
  onTap(sx, sy, e) {
    if (mode !== 'game') return;
    const p = camera.screenToWorld(sx, sy, canvas.width, canvas.height);
    // Debug : Maj+clic creuse un cratère (commande rejouable passée par la simulation).
    if (e.shift && !online.active) input.pushCrater({ x: p.x, y: p.y, r: GAMEPLAY.explosion.presets.medium.radius });
    else if (touchMode()) {
      // Au doigt : un appui pose une cible provisoire, validée ensuite par le bouton ✓ (pas de tir sur un appui raté).
      if (controlsActive() && WEAPONS[state.turn.weapon].input === 'target') touchTarget = p;
    } else input.pushTarget(p.x, p.y);
  },
  owns: (id) => touchCtl.core.owns(id),
  // L'appui long tactile déclenche aussi `contextmenu` : on l'ignore (menu d'armes = bouton dédié).
  onContextMenu() { if (!touchMode() && mode === 'game' && localCanAct()) ui.menuOpen = !ui.menuOpen; },
});

// Expose l'état pour les tests navigateur (dev / ?debug uniquement).
if (debug.enabled) {
  (window as unknown as { __game: unknown }).__game = {
    get state() { return state; }, get mode() { return mode; }, syncHash: () => syncHash(state), get online() { return online.session; }, turnHashes: online.turnHashes, get net() { return online.net; }, get room() { return online.room; }, onlineCtl: online, perf, recorder, get killcam() { return killcam; }, startKillcam, endKillcam, version: __APP_VERSION__, install, toasts, get sw() { return sw; }, ai, camera, touchCtl, touchCircles: () => touchHost.circles(), get touchTarget() { return touchTarget; }, input, canvas, minimap, ui, audio, menu, persistence,
    get fx() { return fx; },
  };
}

/** Intention du joueur de cet appareil pour le pas courant (clavier / tactile). */
function humanIntent(): Intent {
  const intent = input.buildIntent();
  if (ui.menuOpen) { intent.fireDown = false; intent.aimDir = 0; }
  // Visée au doigt : le réticule rejoint l'angle visé, à la vitesse de rotation permise par le jeu.
  if (touchMode() && state.phase === 'turn' && touchCtl.core.aimTarget !== null) {
    const d = touchCtl.core.aimTarget - state.turn.aim;
    intent.aimDir = Math.abs(d) > GAMEPLAY.weapons.aim.rate * SIM_DT * 0.5 ? (d > 0 ? 1 : -1) : 0;
  }
  // Toute action du joueur sur son ver rend la caméra au suivi automatique.
  if (intent.moveX !== 0 || intent.jump || intent.backflip || intent.fireDown) camera.resume();
  return intent;
}

/** Exécute un pas de simulation avec cette intention (mesure, enregistrement du tour pour le replay). */
function runStep(intent: Intent): void {
  const t0 = performance.now();
  step(state, SIM_DT, intent);
  perf.addUpdate(performance.now() - t0);
  recorder.afterStep(state, intent);
  debug.onStep();
}

/** Intention produite par CET appareil pour un pas en ligne : IA (hôte), neutre si un menu est ouvert, sinon le joueur. */
function onlineLocalIntent(): Intent {
  if (aiDrives()) { input.clearPressed(); return ai.nextIntent(state); }
  if (menu.visible) { input.clearPressed(); return NEUTRAL_INTENT; }
  const it = humanIntent();
  return it.craters.length ? { ...it, craters: [] } : it; // pas de cratères de debug en ligne
}

const loop = new GameLoop({
  onError(e, fatal) {
    console.error(e);
    if (fatal) showFatal(t('error.generic', { msg: errorMessage(e) }), quitToMenu);
    else reportError(errorMessage(e));
  },
  update(dt) {
    if (mode === 'menu') {
      if (state.tick < 90) step(state, dt, NEUTRAL_INTENT); // le décor se pose puis se fige
      return;
    }
    // Hors ligne : pause / transition hot-seat / replay gèlent la simulation. En ligne, les menus ne la gèlent pas (les autres joueurs continuent).
    if ((menu.visible && !online.active) || handoffPending || killcam) return;
    if (online.active) return online.step(state, onlineLocalIntent, runStep);
    // Tour d'une équipe IA : ses intentions remplacent celles du clavier (qui sont écartées).
    const aiTurn = AiController.isAiTurn(state);
    if (aiTurn) input.clearPressed();
    const intent = aiTurn ? ai.nextIntent(state) : humanIntent();
    runStep(intent);
  },
  /** En ligne : rattrape le retard (intentions déjà reçues mais pas encore jouées) plus vite que le temps réel. */
  boost() {
    return mode === 'game' && online.backlog(state.tick) > 4 ? SIM_DT * 2 : 0;
  },
  render(alpha, frameMs) {
    perf.beginRender(performance.now());
    const dtSec = Math.min(frameMs / 1000, 0.1);
    input.enabled = mode === 'game' && !menu.visible && !handoffPending;
    const touch = touchMode();
    canvas.touch = touch;
    frameCircles = touch ? computeControls(canvas.width, canvas.height, canvas.safe, settings.touch) : null;
    document.body.classList.toggle('touch', touch);
    if (!(touch && controlsActive())) touchCtl.core.cancelAll(); // jamais de bouton coincé (menu, changement de tour…)
    if (!controlsActive() || WEAPONS[state.turn.weapon].input !== 'target') touchTarget = null;

    if (input.consume('debug')) debug.toggle();
    if (input.consume('mute')) audio.toggleMute();
    if (input.consume('restart') && mode === 'game' && state.phase === 'gameover') { if (online.active) online.rematch(); else restart(); }
    // Tour d'une IA ou d'un autre joueur (en ligne) : ni menu d'armes ni commandes pour ce joueur.
    const notMyTurn = mode === 'game' && (state.phase === 'turn' || state.phase === 'firing') && !localCanAct();
    if (input.consume('weapons') && !notMyTurn) ui.menuOpen = !ui.menuOpen;
    if (notMyTurn) ui.menuOpen = false;
    if (input.consume('pause') && mode === 'game') {
      if (killcam) endKillcam();
      else if (ui.menuOpen) ui.menuOpen = false;
      else menu.show('pause', true);
    }

    // Replay au ralenti : il remplace entièrement l'affichage du jeu en direct (figé) jusqu'à sa fin ou son passage.
    if (killcam) {
      const k = killcam;
      k.advance(dtSec);
      k.director.onEvents(k.state.events);
      k.fx.onEvents(k.state.events, k.state);
      k.state.events.length = 0;
      if (k.director.resumeRequested) { camera.resume(); k.director.resumeRequested = false; }
      const kt = k.director.target(k.state, k.alpha, dtSec);
      camera.update(dtSec, kt.x, kt.y, canvas.width, canvas.height);
      k.fx.update(dtSec, k.state);
      ui.reset();
      const ksh = k.fx.shakeOffset();
      renderWorld(canvas, camera, k.state, k.alpha, k.fx, ksh.x, ksh.y, null);
      drawKillcam(canvas, ui, k);
      if (k.phase === 'done') {
        const nowMs = performance.now();
        if (!killcamHoldUntil) killcamHoldUntil = nowMs + 900;
        else if (nowMs > killcamHoldUntil) endKillcam();
      }
      debug.onFrame(frameMs);
      perf.endFrame(performance.now(), frameMs);
      return;
    }

    // Événements de la simulation → caméra, effets, sons, transition hot-seat.
    let handoff: { team: number; worm: number } | null = null;
    for (const e of state.events) {
      if (e.t === 'turn' && mode === 'game' && !online.active && isHotSeat(state.options) && state.teams[e.team]?.controller === 'human') handoff = e;
    }
    haptics.enabled = settings.haptics && touch && mode === 'game';
    haptics.onEvents(state.events, state);
    director.onEvents(state.events);
    fx.onEvents(state.events, state);
    playEvents(state.events, audio, camera.x, camera.y, canvas.width / (2 * camera.zoom));
    state.events.length = 0;
    if (director.resumeRequested) { camera.resume(); director.resumeRequested = false; }
    if (handoff && !handoffPending) {
      const team = state.teams[handoff.team];
      const worm = state.worms[handoff.worm];
      if (team && worm) {
        handoffPending = true;
        menu.showHandoff(team.name, team.color, worm.name, () => { handoffPending = false; input.clearPressed(); });
      }
    }

    // Statistiques cumulées : une fois par partie terminée.
    if (mode === 'game' && state.phase === 'gameover' && !recorded) { recorded = true; persistence.recordGame(state); }
    // Fin de partie : replay au ralenti du tir décisif (passable), puis écran de victoire.
    if (mode === 'game' && state.phase === 'gameover' && !killcamAutoDone && !killcam && !menu.visible && state.phaseTime > 0.8) {
      killcamAutoDone = true;
      if (GAMEPLAY.killcam.autoAtGameOver) startKillcam();
    }

    // Caméra : décor lent derrière les menus, sinon réalisateur.
    if (mode === 'menu') {
      const W = GAMEPLAY.world;
      camera.centerOn(W.width / 2 + Math.sin(performance.now() / 14000) * W.width * 0.32, W.height * 0.52, canvas.width, canvas.height);
      camera.update(dtSec, camera.x, camera.y, canvas.width, canvas.height);
    } else {
      const t = director.target(state, alpha, dtSec);
      camera.update(dtSec, t.x, t.y, canvas.width, canvas.height);
    }
    // Réflexion de l'IA : calcul découpé en tranches de quelques ms par frame (pas de gel de l'interface).
    // Réflexion de l'IA : en ligne, seul l'hôte la fait tourner (les autres reçoivent ses actions).
    if (mode === 'game' && (!menu.visible || online.active) && !handoffPending && (!online.active || online.isHost)) ai.pump(state);
    // En ligne : envoi des intentions locales et annonces de tour accumulées pendant la frame.
    online.flush();
    if (!(mode === 'game' && (menu.visible || handoffPending))) {
      fx.update(dtSec, state);
      for (const p of state.projectiles) if (p.kind === 'rocket') fx.trail(p.x, p.y, dtSec / Math.max(1, state.projectiles.length));
    }

    // Les tuiles de terrain non encore peintes le sont pendant les frames calmes (2 ms max par frame).
    if (mode === 'game') state.terrain.prewarm(2);

    ui.reset();
    const sh = fx.shakeOffset();
    const hw = mode === 'game' && aiDrives() ? ai.cursor
      : mode === 'game' && touch ? touchTarget
      : mode === 'game' && hover && !ui.menuOpen && !menu.visible && !ui.hit(hover.sx, hover.sy)
        ? camera.screenToWorld(hover.sx, hover.sy, canvas.width, canvas.height) : null;
    renderWorld(canvas, camera, state, alpha, fx, sh.x, sh.y, hw);
    if (mode === 'game') {
      drawHud(canvas, state, ai.thinking, ui);
      drawWeaponHud(canvas, ui, state, localCanAct());
      if (online.session) {
        drawOnlineBadge(canvas, { rtt: online.net?.rtt ?? -1, code: online.session.code, syncedTurn: online.session.confirmedTurn, status: online.status(state) });
      }
      minimap.draw(canvas, ui, state, camera, performance.now());
      if (touch && !menu.visible) {
        const mode2 = WEAPONS[state.turn.weapon].input === 'target' ? 'confirm' : 'hold';
        touchCtl.draw(canvas, ui, state, touchHost.circles(), controlsActive(), mode2, touchTarget !== null, aimActive());
      }
      drawWeaponMenu(canvas, ui, state);
      fx.drawBanner(canvas.ctx, canvas.width, canvas.height);
      if (!menu.visible) drawGameOver(canvas, ui, state, recorder.hasShot(), online.active ? (online.isHost ? 'host' : 'guest') : null);
      if (debug.enabled) drawDebugOverlay(canvas, debug, state, perf);
    }
    debug.onFrame(frameMs);
    perf.endFrame(performance.now(), frameMs);
    if (adaptiveOn && mode === 'game' && !menu.visible) {
      const ns = adaptive.update(frameMs, performance.now());
      if (ns !== null) { canvas.resolutionScale = ns; canvas.resize(); }
    }
  },
});
loop.start();

// --- Démarrage : menu d'accueil, sauf lancement direct (?seed=… ou ?play) ----------------------
if (params.has('room')) {
  // Lien d'invitation : on rejoint directement le salon (le pseudo est celui déjà enregistré).
  menu.show('online', true);
  void online.menuHost.join(params.get('room') ?? '').then((ok) => { if (ok) menu.show('lobby', true); else menu.render(); });
} else if (params.has('seed') || params.has('play')) {
  const o = structuredClone(host.options);
  if (params.has('seed')) o.seed = params.get('seed') ?? o.seed;
  startGame(o);
} else {
  menu.show('home', true);
}

// --- Service worker : précache complet (hors ligne), mises à jour proposées par un bouton -------------------
if (import.meta.env.PROD) {
  sw = setupServiceWorker({
    onNeedRefresh: () => toasts.show('update', {
      title: t('pwa.update.title'),
      // Mettre à jour recharge la page : on prévient si une partie est en cours.
      text: mode === 'game' && state.phase !== 'gameover' ? t('pwa.update.warn') : '',
      actions: [
        { label: t('pwa.update.later'), onClick: () => { /* rappel à la prochaine vérification */ } },
        { label: t('pwa.update.now'), primary: true, onClick: () => { void sw?.applyUpdate(); } },
      ],
    }),
    onOfflineReady: () => toasts.show('offline', { text: t('pwa.offlineReady'), timeoutMs: 4500 }),
  });
}

// --- Invite d'installation personnalisée (beforeinstallprompt) ou aide iOS, intégrée à l'accueil ; refus repoussé 14 jours
install.onChange(() => menu.render()); // la carte et le bouton « Installer » apparaissent / disparaissent
