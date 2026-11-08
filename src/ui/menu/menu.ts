import { QUALITY, type Quality } from '@/config/engine';
import { GAMEPLAY } from '@/config/gameplay';
import { TEAM_PALETTE } from '@/config/palette';
import { DIFFICULTIES, randomSeed, sanitizeOptions, isHotSeat, type GameOptions } from '@/core/options';
import type { Persistence, Settings } from '@/core/storage';
import type { PlayerInfo } from '@/net/protocol';
import { LANGS, defaultTeamNames, isLang, setLang, t, type Key } from '../i18n';
import { readSafeArea } from '../safeArea';
import { CONTROLS_MODES } from '@/core/storage';
import { TOUCH_IDS, TOUCH_SCALE, computeControls, type TouchControlId } from '../touch/layout';
import { h } from './dom';
import './menu.css';

export type Screen = 'home' | 'config' | 'settings' | 'help' | 'stats' | 'pause' | 'touchLayout' | 'installHelp' | 'online' | 'lobby';

/** Vue du salon en ligne (message `room` du serveur). */
export interface RoomView {
  code: string;
  hostId: string;
  you: string;
  phase: 'lobby' | 'playing' | 'over';
  players: PlayerInfo[];
  options: GameOptions;
}

/** Ce que les écrans « en ligne » attendent de l'application. */
export interface OnlineMenuHost {
  name(): string;
  setName(n: string): void;
  room(): RoomView | null;
  busy(): boolean;
  /** Dernière erreur à afficher (texte traduit), ou null. */
  error(): string | null;
  clearError(): void;
  /** Se connecte et crée un salon avec les options en cours d'édition ; true si le salon est ouvert. */
  create(): Promise<boolean>;
  join(code: string): Promise<boolean>;
  /** Envoie les options modifiées par l'hôte (différé). */
  pushConfig(): void;
  start(): void;
  leave(): void;
  shareLink(code: string): string;
}

/** Ce que le menu attend de l'application. */
export interface MenuHost {
  /** Mode en ligne (absent : écrans en ligne masqués). */
  online?: OnlineMenuHost;
  persistence: Persistence;
  /** Réglages courants (modifiés en place par le menu, puis sauvegardés). */
  settings: Settings;
  /** Options de partie en cours d'édition (idem). */
  options: GameOptions;
  onStart(o: GameOptions): void;
  onResume(): void;
  onQuit(): void;
  onSettingsChanged(): void;
  /** Installation de l'application : 'prompt' (invite du navigateur), 'ios' (aide manuelle), 'installed' ou 'none'. */
  installKind(): 'installed' | 'prompt' | 'ios' | 'none';
  onInstall(): void;
  /** Afficher la carte d'invitation à installer sur l'accueil (installable et pas refusée récemment) ? */
  installInvite(): boolean;
  onInstallDismiss(): void;
  /** Plein écran disponible sur ce navigateur ? */
  fullscreenAvailable(): boolean;
  fullscreenActive(): boolean;
  onToggleFullscreen(): void;
  /** Un tir est-il rejouable (replay au ralenti) ? */
  canReplay(): boolean;
  onReplay(): void;
}

const O = GAMEPLAY.options;

/** Menus responsives en DOM (accueil, configuration, réglages, aide, statistiques, pause, transition hot-seat). */
export class MenuManager {
  private stack: Screen[] = [];
  private el: HTMLElement | null = null;
  private handoffEl: HTMLElement | null = null;
  private loadingEl: HTMLElement | null = null;

  constructor(private root: HTMLElement, private host: MenuHost) {
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || !this.visible || this.handoffEl) return;
      // Différé : l'écouteur de jeu voit d'abord la touche (désactivé), pas de réouverture immédiate.
      setTimeout(() => this.back(), 0);
    });
  }

  get visible(): boolean { return this.stack.length > 0; }
  get handoffVisible(): boolean { return this.handoffEl !== null; }
  get current(): Screen | null { return this.stack[this.stack.length - 1] ?? null; }

  show(screen: Screen, reset = false): void {
    if (reset) this.stack = [];
    this.stack.push(screen);
    this.render();
  }

  hide(): void {
    this.stack = [];
    this.render();
  }

  /** Retour : écran précédent ; depuis la pause, reprise de la partie ; depuis l'accueil, rien. */
  back(): void {
    if (this.current === 'pause') { this.hide(); this.host.onResume(); return; }
    if (this.stack.length > 1) { this.stack.pop(); this.render(); }
  }

  /** Reconstruit l'écran courant (changement de langue). */
  render(): void {
    this.el?.remove();
    this.el = null;
    const screen = this.current;
    if (!screen) return;
    const body = {
      home: () => this.home(), config: () => this.config(), settings: () => this.settings(),
      help: () => this.help(), stats: () => this.stats(), pause: () => this.pause(), touchLayout: () => this.touchLayout(), installHelp: () => this.installHelp(),
      online: () => this.onlineHome(), lobby: () => this.lobby(),
    }[screen]();
    this.el = h('div', { class: screen === 'pause' ? 'scrim clear' : screen === 'touchLayout' ? 'scrim ghost' : 'scrim' }, body);
    this.root.append(this.el);
    (this.el.querySelector('button.primary') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  setLoading(on: boolean): void {
    this.loadingEl?.remove();
    this.loadingEl = null;
    if (!on) return;
    this.loadingEl = h('div', { class: 'scrim' }, h('div', { class: 'toast', text: t('menu.loading') }));
    this.root.append(this.loadingEl);
  }

  /** Écran de transition hot-seat « À toi de jouer » : bloque le jeu jusqu'à « Prêt ». */
  showHandoff(team: string, color: string, worm: string, ready: () => void): void {
    this.handoffEl?.remove();
    const btn = h('button', { class: 'primary', text: t('handoff.ready'), attrs: { type: 'button' } });
    const done = (): void => { this.handoffEl?.remove(); this.handoffEl = null; ready(); };
    btn.addEventListener('click', done);
    const panel = h('div', { class: 'panel narrow handoff', attrs: { role: 'dialog', 'aria-live': 'assertive' } },
      h('h2', { text: t('handoff.title') }),
      h('div', { class: 'who', text: team }),
      h('p', { text: t('handoff.worm', { worm }) }),
      h('p', { class: 'note', text: t('handoff.hint') }),
      h('div', { class: 'row', attrs: { style: 'justify-content:center;margin-top:14px' } }, btn));
    panel.style.borderColor = color;
    (panel.querySelector('.who') as HTMLElement).style.color = color;
    this.handoffEl = h('div', { class: 'scrim' }, panel);
    this.root.append(this.handoffEl);
    btn.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------ écrans

  private btn(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
    return h('button', { class: cls, text: label, attrs: { type: 'button' }, on: { click: onClick } });
  }

  private home(): HTMLElement {
    const k = this.host.installKind();
    const invite = this.host.installInvite()
      ? h('div', { class: 'install-card', attrs: { 'data-install-card': true } },
        h('strong', { text: t('pwa.install.title') }),
        h('span', { text: t('pwa.install.body') }),
        h('div', { class: 'row' },
          this.btn(t('pwa.update.later'), () => { this.host.onInstallDismiss(); this.render(); }),
          this.btn(t('pwa.install.cta'), () => { if (k === 'prompt') this.host.onInstall(); else this.show('installHelp'); }, 'primary')))
      : null;
    return h('div', { class: 'panel narrow' },
      h('h1', { text: t('app.title') }),
      h('p', { class: 'tag', text: t('app.tagline') }),
      invite,
      h('div', { class: 'stack' },
        this.btn(t('menu.play'), () => this.show('config'), 'primary'),
        this.host.online ? this.btn(t('menu.online'), () => { this.host.online?.clearError(); this.show('online'); }) : null,
        this.host.persistence.hasOptions() ? this.btn(t('menu.quick'), () => this.host.onStart(sanitizeOptions(this.host.options, defaultTeamNames()))) : null,
        this.btn(t('menu.settings'), () => this.show('settings')),
        this.btn(t('menu.help'), () => this.show('help')),
        this.btn(t('menu.stats'), () => this.show('stats')),
        this.installButton()));
  }

  private fullscreenButton(): HTMLButtonElement | null {
    if (!this.host.fullscreenAvailable()) return null;
    return this.btn(t(this.host.fullscreenActive() ? 'fullscreen.exit' : 'fullscreen.enter'), () => { this.host.onToggleFullscreen(); setTimeout(() => this.render(), 150); });
  }

  /** Bouton « Installer l'application » : invite du navigateur, ou aide pas à pas sur iOS ; absent si déjà installée. */
  private installButton(): HTMLButtonElement | null {
    const k = this.host.installKind();
    if (k === 'prompt') return this.btn(t('menu.install'), () => this.host.onInstall());
    if (k === 'ios') return this.btn(t('menu.install'), () => this.show('installHelp'));
    return null;
  }

  // ------------------------------------------------------------------ en ligne

  private onlineHome(): HTMLElement {
    const on = this.host.online as OnlineMenuHost;
    const busy = on.busy();
    const err = on.error();
    const name = h('input', {
      attrs: { type: 'text', value: on.name(), maxlength: O.nameMaxLength, 'aria-label': t('online.name'), autocomplete: 'nickname' },
      on: { input: (e) => on.setName((e.target as HTMLInputElement).value) },
    });
    const code = h('input', {
      attrs: { type: 'text', maxlength: 5, 'aria-label': t('online.code'), placeholder: 'ABCDE', autocapitalize: 'characters', autocomplete: 'off', spellcheck: false, style: 'text-transform:uppercase;letter-spacing:4px;text-align:center;font-weight:700' },
    });
    const go = async (fn: () => Promise<boolean>): Promise<void> => {
      const ok = await fn();
      if (ok) this.show('lobby'); else this.render();
    };
    return h('div', { class: 'panel narrow' },
      h('h2', { text: t('online.title') }),
      h('div', { class: 'field' }, h('div', { class: 'lbl', text: t('online.name') }), name),
      h('div', { class: 'install-card' },
        h('span', { text: t('online.createHint') }),
        h('div', { class: 'row' },
          this.btn(t('online.configure'), () => this.show('config')),
          h('button', { class: 'primary', text: t('online.create'), attrs: { type: 'button', disabled: busy }, on: { click: () => { on.setName((name as HTMLInputElement).value); void go(() => on.create()); } } }))),
      h('div', { class: 'install-card', attrs: { style: 'margin-top:12px' } },
        h('span', { text: t('online.joinHint') }),
        h('div', { class: 'row', attrs: { style: 'flex-wrap:nowrap' } },
          h('div', { attrs: { style: 'flex:1 1 auto' } }, code),
          h('button', { class: 'primary', text: t('online.join'), attrs: { type: 'button', disabled: busy }, on: { click: () => { on.setName((name as HTMLInputElement).value); void go(() => on.join((code as HTMLInputElement).value)); } } }))),
      busy ? h('p', { class: 'note', text: t('online.connecting') }) : null,
      err ? h('p', { class: 'note', attrs: { role: 'alert', style: 'color:#ffb3ac;opacity:1' }, text: err }) : null,
      h('div', { class: 'row end' }, this.btn(t('menu.back'), () => { this.back(); })));
  }

  private lobby(): HTMLElement {
    const on = this.host.online as OnlineMenuHost;
    const room = on.room();
    if (!room) return h('div', { class: 'panel narrow' }, h('p', { text: t('online.connecting') }), this.btn(t('menu.back'), () => this.back()));
    const amHost = room.hostId === room.you;
    const copy = (label: string, text: string): HTMLButtonElement => {
      const b = this.btn(label, () => {
        void navigator.clipboard?.writeText(text).then(() => { b.textContent = t('online.copied'); setTimeout(() => { b.textContent = label; }, 1400); }).catch(() => { window.prompt(label, text); });
      });
      return b;
    };
    const slots = room.options.teams.map((team, i) => {
      const p = room.players.find((x) => x.team === i);
      let who: string;
      if (team.controller === 'ai') who = t('online.slot.ai', { level: t(`difficulty.${team.difficulty}` as Key) });
      else if (p) who = `${p.name}${p.host ? ` (${t('online.hostTag')})` : ''}${p.id === room.you ? ` — ${t('online.youTag')}` : ''}`;
      else who = t('online.slot.open');
      const lat = p && p.rtt >= 0 ? `${p.rtt} ms` : '';
      const dot = h('span', { attrs: { 'aria-hidden': 'true', style: `display:inline-block;width:14px;height:14px;border-radius:50%;background:${team.color};margin-right:10px;flex:none` } });
      return h('div', { class: 'row between', attrs: { style: 'padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1);flex-wrap:nowrap' } },
        h('div', { attrs: { style: 'display:flex;align-items:center;min-width:0' } }, dot,
          h('div', { attrs: { style: 'min-width:0' } }, h('strong', { text: team.name }), h('div', { class: 'note', text: who, attrs: { style: 'opacity:.85' } }))),
        h('span', { class: 'note', text: lat, attrs: { 'aria-label': t('online.latency'), style: 'flex:none' } }));
    });
    return h('div', { class: 'panel' },
      h('h2', { text: `${t('online.lobby')} ${room.code}` }),
      h('p', { class: 'note', text: t('online.share'), attrs: { style: 'text-align:center' } }),
      h('div', { attrs: { style: 'text-align:center;font-size:clamp(34px,9vw,56px);font-weight:800;letter-spacing:8px;margin:4px 0 10px', 'data-room-code': room.code }, text: room.code }),
      h('div', { class: 'row', attrs: { style: 'justify-content:center' } }, copy(t('online.copy'), room.code), copy(t('online.copyLink'), on.shareLink(room.code))),
      h('div', { attrs: { style: 'margin-top:14px' } }, ...slots),
      amHost ? h('p', { class: 'note', text: t('online.startHint') }) : h('p', { class: 'note', text: t('online.waitHost') }),
      h('div', { class: 'row end' },
        this.btn(t('online.leave'), () => { on.leave(); this.show('home', true); }, 'danger'),
        amHost ? this.btn(t('online.configure'), () => this.show('config')) : null,
        amHost ? this.btn(t('menu.start'), () => on.start(), 'primary') : null));
  }

  /** Aide d'installation iOS : Partager puis « Sur l'écran d'accueil ». */
  private installHelp(): HTMLElement {
    return h('div', { class: 'panel narrow' },
      h('h2', { text: t('pwa.ios.title') }),
      h('ol', { class: 'steps' }, h('li', { text: t('pwa.ios.step1') }), h('li', { text: t('pwa.ios.step2') }), h('li', { text: t('pwa.ios.step3') })),
      h('p', { class: 'note', text: t('pwa.ios.note') }),
      h('div', { class: 'row end' }, this.btn(t('menu.back'), () => this.back(), 'primary')));
  }

  private pause(): HTMLElement {
    return h('div', { class: 'panel narrow' },
      h('h2', { text: t('menu.paused') }),
      h('div', { class: 'stack' },
        this.btn(t('menu.resume'), () => { this.hide(); this.host.onResume(); }, 'primary'),
        this.btn(t('menu.settings'), () => this.show('settings')),
        this.btn(t('menu.help'), () => this.show('help')),
        this.host.canReplay() ? this.btn(t('killcam.watch'), () => { this.hide(); this.host.onReplay(); }) : null,
        this.fullscreenButton(),
        this.btn(t('menu.quit'), () => { this.hide(); this.host.onQuit(); }, 'danger')));
  }

  private save(): void {
    this.host.persistence.saveOptions(this.host.options);
    if (this.stack.includes('lobby')) this.host.online?.pushConfig(); // l'hôte modifie le salon en direct
  }

  private config(): HTMLElement {
    const o = this.host.options;
    const fav = this.host.persistence.favorites();

    // --- nombre d'équipes
    const teamsSeg = h('div', { class: 'seg', attrs: { role: 'group', 'aria-label': t('config.teams') } });
    for (let n = O.teams.min; n <= O.teams.max; n++) {
      teamsSeg.append(h('button', {
        text: String(n), attrs: { type: 'button', 'aria-pressed': o.teams.length === n },
        on: { click: () => { this.resizeTeams(n); this.save(); this.render(); } },
      }));
    }

    // --- vers par équipe
    const wormsOut = h('output', { text: String(o.wormsPerTeam) });
    const step = (d: number): void => {
      o.wormsPerTeam = Math.min(O.worms.max, Math.max(O.worms.min, o.wormsPerTeam + d));
      wormsOut.textContent = String(o.wormsPerTeam);
      this.save();
    };
    const worms = h('div', { class: 'stepper' },
      h('button', { text: '−', attrs: { type: 'button', 'aria-label': `${t('config.worms')} −` }, on: { click: () => step(-1) } }),
      wormsOut,
      h('button', { text: '+', attrs: { type: 'button', 'aria-label': `${t('config.worms')} +` }, on: { click: () => step(1) } }));

    // --- lignes d'équipes
    const datalist = h('datalist', { attrs: { id: 'fav-names' } }, ...fav.map((f) => h('option', { attrs: { value: f } })));
    const rows = o.teams.map((team, i) => {
      const swatch = h('button', {
        class: 'swatch', attrs: { type: 'button', 'aria-label': t('config.color', { n: i + 1 }) },
        on: { click: () => { this.cycleColor(i); this.save(); this.render(); } },
      });
      swatch.style.background = team.color;
      const star = h('button', {
        class: 'star', text: '★', attrs: { type: 'button', 'aria-pressed': fav.includes(team.name), title: t(fav.includes(team.name) ? 'config.unfavorite' : 'config.favorite'), 'aria-label': t(fav.includes(team.name) ? 'config.unfavorite' : 'config.favorite') },
        on: { click: () => { this.host.persistence.setFavorite(team.name, !fav.includes(team.name)); this.render(); } },
      });
      const input = h('input', {
        attrs: { type: 'text', value: team.name, maxlength: O.nameMaxLength, list: 'fav-names', 'aria-label': t('config.teamName', { n: i + 1 }), autocomplete: 'off' },
        on: {
          input: (e) => { team.name = (e.target as HTMLInputElement).value.slice(0, O.nameMaxLength); this.save(); },
          change: (e) => {
            const el = e.target as HTMLInputElement;
            if (!el.value.trim()) { team.name = defaultTeamNames()[i] ?? `Team ${i + 1}`; el.value = team.name; this.save(); }
            this.render();
          },
        },
      });
      const seg = h('div', { class: 'seg', attrs: { role: 'group', 'aria-label': t('config.controller', { n: i + 1 }) } },
        ...(['human', 'ai'] as const).map((c) => h('button', {
          text: t(c === 'human' ? 'config.human' : 'config.ai'), attrs: { type: 'button', 'aria-pressed': team.controller === c },
          on: { click: () => { team.controller = c; this.save(); this.render(); } },
        })));
      const level = team.controller === 'ai'
        ? h('div', { class: 'seg level', attrs: { role: 'group', 'aria-label': t('config.difficulty', { n: i + 1 }) } },
          ...DIFFICULTIES.map((d) => h('button', {
            text: t(`difficulty.${d}` as Key), attrs: { type: 'button', 'aria-pressed': team.difficulty === d },
            on: { click: () => { team.difficulty = d; this.save(); this.render(); } },
          })))
        : null;
      return h('div', { class: 'teamrow' }, swatch, input, star, seg, level);
    });

    // --- graine
    const seedInput = h('input', {
      attrs: { type: 'text', value: o.seed, maxlength: 24, 'aria-label': t('config.seed'), autocomplete: 'off', spellcheck: false },
      on: { input: (e) => { o.seed = (e.target as HTMLInputElement).value.trim().slice(0, 24) || '5eed1234'; this.save(); } },
    });
    const seedRow = h('div', { class: 'row' },
      h('div', { attrs: { style: 'flex:1 1 160px' } }, seedInput),
      this.btn(t('config.random'), () => { o.seed = randomSeed(); seedInput.value = o.seed; this.save(); }));

    const slider = (min: number, max: number, stepV: number, val: number, label: string, set: (v: number) => void, fmt: (v: number) => string): HTMLElement => {
      const out = h('output', { text: fmt(val) });
      const input = h('input', {
        attrs: { type: 'range', min, max, step: stepV, value: val, 'aria-label': label },
        on: { input: (e) => { const v = Number((e.target as HTMLInputElement).value); set(v); out.textContent = fmt(v); this.save(); } },
      });
      return h('div', { class: 'field' }, h('div', { class: 'lbl' }, h('span', { text: label }), out), input);
    };

    const humans = isHotSeat(o);
    return h('div', { class: 'panel' },
      h('h2', { text: t('config.title') }),
      h('div', { class: 'field' }, h('div', { class: 'lbl', text: t('config.teams') }), teamsSeg),
      h('div', { class: 'field' }, h('div', { class: 'lbl', text: t('config.worms') }), worms),
      datalist, ...rows,
      humans ? h('p', { class: 'note', text: t('config.hotseat') }) : null,
      h('div', { class: 'field' }, h('div', { class: 'lbl', text: t('config.seed') }), seedRow),
      slider(O.turnDuration.min, O.turnDuration.max, O.turnDuration.step, o.turnDuration, t('config.turnDuration'), (v) => { o.turnDuration = v; }, (v) => t('config.seconds', { n: v })),
      slider(O.health.min, O.health.max, O.health.step, o.startHealth, t('config.health'), (v) => { o.startHealth = v; }, (v) => String(v)),
      h('div', { class: 'row end' },
        this.btn(t('menu.back'), () => this.back()),
        this.btn(t('config.reset'), () => {
          Object.assign(o, sanitizeOptions(null, defaultTeamNames()));
          this.save(); this.render();
        }),
        this.stack.includes('lobby') || this.stack.includes('online')
          ? null
          : this.btn(t('menu.start'), () => this.host.onStart(sanitizeOptions(o, defaultTeamNames())), 'primary')));
  }

  /** Ajuste le nombre d'équipes en conservant les existantes ; les nouvelles reçoivent un nom et une couleur libres. */
  private resizeTeams(n: number): void {
    const o = this.host.options;
    const names = defaultTeamNames();
    while (o.teams.length > n) o.teams.pop();
    while (o.teams.length < n) {
      const i = o.teams.length;
      o.teams.push({
        name: names[i] ?? `Team ${i + 1}`,
        color: TEAM_PALETTE.find((c) => !o.teams.some((x) => x.color === c)) ?? TEAM_PALETTE[i % TEAM_PALETTE.length] as string,
        controller: 'human',
        difficulty: 'medium',
      });
    }
  }

  /** Passe à la couleur suivante de la palette non utilisée par une autre équipe. */
  private cycleColor(i: number): void {
    const o = this.host.options;
    const cur = TEAM_PALETTE.indexOf(o.teams[i]?.color as (typeof TEAM_PALETTE)[number]);
    for (let k = 1; k <= TEAM_PALETTE.length; k++) {
      const c = TEAM_PALETTE[(cur + k) % TEAM_PALETTE.length] as string;
      if (!o.teams.some((x, j) => j !== i && x.color === c)) { (o.teams[i] as { color: string }).color = c; return; }
    }
  }

  private settings(): HTMLElement {
    const s = this.host.settings;
    const apply = (): void => { this.host.persistence.saveSettings(s); this.host.onSettingsChanged(); };
    const vol = (label: string, val: number, set: (v: number) => void): HTMLElement => {
      const out = h('output', { text: `${Math.round(val * 100)} %` });
      return h('div', { class: 'field' },
        h('div', { class: 'lbl' }, h('span', { text: label }), out),
        h('input', { attrs: { type: 'range', min: 0, max: 100, step: 5, value: Math.round(val * 100), 'aria-label': label },
          on: { input: (e) => { const v = Number((e.target as HTMLInputElement).value) / 100; set(v); out.textContent = `${Math.round(v * 100)} %`; apply(); } } }));
    };
    const quality = h('div', { class: 'seg', attrs: { role: 'group', 'aria-label': t('settings.quality') } },
      ...(Object.keys(QUALITY) as Quality[]).map((q) => h('button', {
        text: t(`quality.${q}` as Key), attrs: { type: 'button', 'aria-pressed': s.quality === q },
        on: { click: () => { s.quality = q; apply(); this.render(); } },
      })));
    const lang = h('select', {
      attrs: { 'aria-label': t('settings.language') },
      on: { change: (e) => { const v = (e.target as HTMLSelectElement).value; if (isLang(v)) { s.lang = v; setLang(v); apply(); this.render(); } } },
    }, ...LANGS.map((l) => h('option', { text: l.label, attrs: { value: l.id, selected: l.id === s.lang } })));
    const controls = h('div', { class: 'seg', attrs: { role: 'group', 'aria-label': t('settings.controls') } },
      ...CONTROLS_MODES.map((m) => h('button', {
        text: t(`controls.${m}` as Key), attrs: { type: 'button', 'aria-pressed': s.controls === m },
        on: { click: () => { s.controls = m; apply(); this.render(); } },
      })));
    const haptics = h('div', { class: 'seg', attrs: { role: 'group', 'aria-label': t('settings.haptics') } },
      ...([true, false] as const).map((on) => h('button', {
        text: t(on ? 'toggle.on' : 'toggle.off'), attrs: { type: 'button', 'aria-pressed': s.haptics === on },
        on: { click: () => { s.haptics = on; apply(); if (on) navigator.vibrate?.(40); this.render(); } },
      })));
    return h('div', { class: 'panel narrow' },
      h('h2', { text: t('settings.title') }),
      vol(t('settings.sound'), s.sound, (v) => { s.sound = v; }),
      vol(t('settings.music'), s.music, (v) => { s.music = v; }),
      h('div', { class: 'field' }, h('div', { class: 'lbl', text: t('settings.quality') }), quality),
      h('div', { class: 'field' }, h('div', { class: 'lbl', text: t('settings.language') }), lang),
      h('div', { class: 'field' }, h('div', { class: 'lbl', text: t('settings.controls') }), controls),
      h('div', { class: 'field' }, h('div', { class: 'lbl', text: t('settings.haptics') }), haptics),
      this.btn(t('settings.touchLayout'), () => this.show('touchLayout')),
      this.fullscreenButton(),
      this.installButton(),
      h('p', { class: 'note', text: t('settings.version', { v: __APP_VERSION__ }) }),
      h('div', { class: 'row end' }, this.btn(t('menu.back'), () => this.back(), 'primary')));
  }

  private help(): HTMLElement {
    const rows: [string, string][] = [
      ['move', 'move'], ['jump', 'jump'], ['backflip', 'backflip'], ['aim', 'aim'], ['fire', 'fire'], ['fuse', 'fuse'],
      ['weapons', 'weapons'], ['target', 'target'], ['camera', 'camera'], ['skip', 'skip'], ['pause', 'pause'],
      ['mute', 'mute'], ['restart', 'restart'],
    ];
    const grid = h('div', { class: 'keys' });
    for (const [k, d] of rows) {
      grid.append(h('div', {}, h('kbd', { text: t(`help.key.${k}` as Key) })), h('div', { text: t(`help.${d}` as Key) }));
    }
    const touchGrid = h('div', { class: 'keys' });
    for (const k of ['joystick', 'aim', 'fire', 'jump', 'weapons', 'target', 'camera']) {
      touchGrid.append(h('div', {}, h('kbd', { text: t(`help.tkey.${k}` as Key) })), h('div', { text: t(`help.tdesc.${k}` as Key) }));
    }
    return h('div', { class: 'panel' },
      h('h2', { text: t('help.title') }),
      h('p', { text: t('help.goal') }),
      h('h2', { text: t('help.keys'), attrs: { style: 'font-size:17px;text-align:left;margin-top:18px' } }),
      grid,
      h('h2', { text: t('help.touchTitle'), attrs: { style: 'font-size:17px;text-align:left;margin-top:18px' } }),
      touchGrid,
      h('p', { class: 'note', text: t('help.ai') }),
      h('p', { class: 'note', text: t('help.touch') }),
      h('div', { class: 'row end' }, this.btn(t('menu.back'), () => this.back(), 'primary')));
  }

  private stats(): HTMLElement {
    const st = this.host.persistence.loadStats();
    const acc = st.shots > 0 ? `${Math.round(((st.shots - st.misses) / st.shots) * 100)} %` : '–';
    const dl = h('dl', { class: 'stats' });
    const add = (k: Key, v: string | number): void => { dl.append(h('dt', { text: t(k) }), h('dd', { text: String(v) })); };
    add('stats.games', st.games); add('stats.turns', st.turns); add('stats.damage', st.damage);
    add('stats.kills', st.kills); add('stats.shots', st.shots); add('stats.misses', st.misses);
    add('stats.accuracy', acc); add('stats.longest', st.longest);
    return h('div', { class: 'panel narrow' },
      h('h2', { text: t('stats.title') }),
      st.games === 0 ? h('p', { class: 'note', text: t('stats.none') }) : null,
      dl,
      h('div', { class: 'row end' },
        this.btn(t('stats.reset'), () => { this.host.persistence.resetStats(); this.render(); }, 'danger'),
        this.btn(t('menu.back'), () => this.back(), 'primary')));
  }

  /**
   * Éditeur de la disposition tactile : chaque commande est un disque que l'on fait glisser ; la taille globale se
   * règle au curseur. Tout est enregistré immédiatement (réglages) et vu en direct dans le jeu.
   */
  private touchLayout(): HTMLElement {
    const ts = this.host.settings.touch;
    const save = (): void => { this.host.persistence.saveSettings(this.host.settings); this.host.onSettingsChanged(); };
    const wrap = h('div', { class: 'tl-wrap' });
    const els = new Map<TouchControlId, HTMLElement>();
    const place = (): void => {
      const cs = computeControls(window.innerWidth, window.innerHeight, readSafeArea(), ts);
      for (const c of cs) {
        const el = els.get(c.id) as HTMLElement;
        el.style.width = el.style.height = `${c.r * 2}px`;
        el.style.left = `${c.cx - c.r}px`;
        el.style.top = `${c.cy - c.r}px`;
      }
    };
    for (const id of TOUCH_IDS) {
      const el = h('div', { class: 'tl-ctl', text: t(`touch.${id}` as Key), attrs: { 'data-id': id } });
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent): void => {
          ts.layout[id] = {
            x: Math.min(1, Math.max(0, ev.clientX / window.innerWidth)),
            y: Math.min(1, Math.max(0, ev.clientY / window.innerHeight)),
          };
          place();
        };
        const up = (): void => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          save();
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      });
      els.set(id, el);
      wrap.append(el);
    }
    const out = h('output', { text: `${Math.round(ts.scale * 100)} %` });
    const slider = h('input', {
      attrs: { type: 'range', min: TOUCH_SCALE.min, max: TOUCH_SCALE.max, step: TOUCH_SCALE.step, value: ts.scale, 'aria-label': t('touch.scale') },
      on: { input: (e) => { ts.scale = Number((e.target as HTMLInputElement).value); out.textContent = `${Math.round(ts.scale * 100)} %`; place(); save(); } },
    });
    wrap.append(h('div', { class: 'tl-bar panel' },
      h('div', { class: 'lbl', text: t('touch.editTitle') }),
      h('p', { class: 'note', text: t('touch.editHint') }),
      h('div', { class: 'field' }, h('div', { class: 'lbl' }, h('span', { text: t('touch.scale') }), out), slider),
      h('div', { class: 'row end' },
        this.btn(t('touch.reset'), () => { ts.scale = 1; ts.layout = {}; save(); this.render(); }),
        this.btn(t('touch.done'), () => this.back(), 'primary'))));
    queueMicrotask(place);
    return wrap;
  }
}
