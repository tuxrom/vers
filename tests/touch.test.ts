import { describe, expect, it } from 'vitest';
import { SIM_DT } from '@/config/engine';
import { GAMEPLAY } from '@/config/gameplay';
import type { GameEvent } from '@/core/events';
import { ActionInput, type Action } from '@/core/input';
import { createState } from '@/core/state';
import { Haptics, hapticPulse } from '@/ui/haptics';
import { TouchCore, type TouchHost } from '@/ui/touch/core';
import {
  DEFAULT_LAYOUT, MIN_RADIUS, TOUCH_IDS, TOUCH_SCALE, circleOf, computeControls, sanitizeTouch, type Circle, type TouchSettings,
} from '@/ui/touch/layout';

const T = GAMEPLAY.touch;
const W = 844, H = 390; // iPhone en paysage (sans marges)
const NOTCH = { top: 0, right: 47, bottom: 21, left: 47 };

function fakeHost(opts: { w?: number; h?: number; ts?: TouchSettings } = {}) {
  const w = opts.w ?? W, h = opts.h ?? H;
  const log: string[] = [];
  const down = new Set<string>();
  const st = { enabled: true, mode: 'hold' as 'hold' | 'confirm', aimOn: true, ui: false, aim: 0.45, weapons: 0, confirms: 0 };
  const circles = computeControls(w, h, NOTCH, opts.ts ?? { scale: 1, layout: {} });
  const host: TouchHost = {
    circles: () => circles,
    enabled: () => st.enabled,
    fireMode: () => st.mode,
    aimZone: () => (st.aimOn ? { x: w * T.aimZoneStart, y: 0, w: w * (1 - T.aimZoneStart), h } : null),
    uiHit: () => st.ui,
    currentAim: () => st.aim,
    press: (a: Action, src: string, on: boolean) => { log.push(`${a}:${on ? 'down' : 'up'}`); if (on) down.add(`${a}|${src}`); else down.delete(`${a}|${src}`); },
    onWeapons: () => { st.weapons++; },
    onConfirm: () => { st.confirms++; },
  };
  return { host, log, down, st, circles, core: new TouchCore(host) };
}

describe('disposition des commandes', () => {
  it('chaque commande reste entièrement dans la zone sûre, à une taille d’au moins un doigt', () => {
    for (const [w, h] of [[844, 390], [740, 360], [932, 430], [667, 375], [1024, 600]] as const) {
      for (const scale of [TOUCH_SCALE.min, 1, TOUCH_SCALE.max]) {
        for (const c of computeControls(w, h, NOTCH, { scale, layout: {} })) {
          expect(c.r, `${c.id} ${w}x${h}`).toBeGreaterThanOrEqual(MIN_RADIUS);
          expect(c.cx - c.r).toBeGreaterThanOrEqual(NOTCH.left);
          expect(c.cx + c.r).toBeLessThanOrEqual(w - NOTCH.right);
          expect(c.cy - c.r).toBeGreaterThanOrEqual(NOTCH.top);
          expect(c.cy + c.r).toBeLessThanOrEqual(h - NOTCH.bottom);
        }
      }
    }
  });

  it('la disposition par défaut n’a aucun chevauchement (taille normale) ni ne masque le centre de l’écran', () => {
    for (const [w, h] of [[844, 390], [740, 360], [932, 430], [667, 375]] as const) {
      const cs = computeControls(w, h, NOTCH, { scale: 1, layout: {} });
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
        const a = cs[i]!, b = cs[j]!;
        expect(Math.hypot(a.cx - b.cx, a.cy - b.cy), `${a.id}/${b.id} ${w}x${h}`).toBeGreaterThanOrEqual(a.r + b.r);
      }
      // Le centre de l'écran (action de jeu) reste libre.
      for (const c of cs) expect(Math.hypot(c.cx - w / 2, c.cy - h / 2)).toBeGreaterThan(c.r + 40);
    }
  });

  it('position et taille personnalisées sont respectées puis ramenées à l’écran si elles en sortent', () => {
    const ts: TouchSettings = { scale: 1.3, layout: { fire: { x: 0.5, y: 0.5 }, jump: { x: 2, y: -3 } } };
    const cs = computeControls(W, H, NOTCH, ts);
    const fire = circleOf(cs, 'fire'), base = circleOf(computeControls(W, H, NOTCH, { scale: 1, layout: {} }), 'fire');
    expect(fire.cx).toBeCloseTo(W / 2, 5);
    expect(fire.r).toBeCloseTo(base.r * 1.3, 5);
    const jump = circleOf(cs, 'jump');
    expect(jump.cx + jump.r).toBeLessThanOrEqual(W - NOTCH.right);
    expect(jump.cy - jump.r).toBeGreaterThanOrEqual(NOTCH.top);
  });

  it('les réglages tactiles venus du stockage sont validés', () => {
    expect(sanitizeTouch(null)).toEqual({ scale: 1, layout: {} });
    expect(sanitizeTouch({ scale: 99 }).scale).toBe(TOUCH_SCALE.max);
    expect(sanitizeTouch({ scale: -1 }).scale).toBe(TOUCH_SCALE.min);
    const s = sanitizeTouch({ scale: 1, layout: { fire: { x: 5, y: -2 }, jump: { x: 'a' }, inconnu: { x: 0.5, y: 0.5 }, joystick: { x: 0.2, y: 0.3 } } });
    expect(s.layout.fire).toEqual({ x: 1, y: 0 });
    expect(s.layout.jump).toBeUndefined();
    expect((s.layout as Record<string, unknown>).inconnu).toBeUndefined();
    expect(s.layout.joystick).toEqual({ x: 0.2, y: 0.3 });
    expect(Object.keys(DEFAULT_LAYOUT).sort()).toEqual([...TOUCH_IDS].sort());
  });
});

describe('logique tactile : un doigt = une commande', () => {
  const pt = (c: Circle, dx = 0, dy = 0): [number, number] => [c.cx + dx * c.r, c.cy + dy * c.r];

  it('le joystick marche à droite / à gauche, vertical = visée fine, relâché = tout est relâché', () => {
    const { core, log, circles } = fakeHost();
    const j = circleOf(circles, 'joystick');
    expect(core.down(1, ...pt(j, 0.1, 0))).toBe(true);
    expect(log).toEqual([]); // zone morte
    core.move(1, ...pt(j, 0.8, 0.1));
    expect(log).toContain('right:down');
    core.move(1, ...pt(j, -0.9, 0));
    expect(log).toContain('right:up');
    expect(log).toContain('left:down');
    core.move(1, ...pt(j, 0.1, -0.9));
    expect(log).toContain('aimUp:down');
    expect(log).toContain('left:up');
    core.move(1, ...pt(j, 0.1, 5)); // très loin : borné au rayon
    expect(log).toContain('aimDown:down');
    expect(core.joy!.ny).toBeLessThanOrEqual(1);
    core.up(1);
    expect(core.joy).toBeNull();
    expect(log.at(-1)).toBe('aimDown:up');
  });

  it('multitouch : marcher, viser et charger le tir en même temps, sans interférence', () => {
    const { core, down, circles, st } = fakeHost();
    const j = circleOf(circles, 'joystick'), f = circleOf(circles, 'fire');
    core.down(1, ...pt(j, 0.9, 0));
    core.down(2, ...pt(f));
    core.down(3, W * 0.56, 90); // zone de visée
    expect(core.owns(1) && core.owns(2) && core.owns(3)).toBe(true);
    expect([...down].sort()).toEqual(['fire|touch:fire', 'right|touch:joy']);
    core.move(3, W * 0.56, 50);
    expect(core.aimTarget).toBeGreaterThan(st.aim); // glisser vers le haut relève la visée
    core.up(2); // relâcher le tir ne touche ni au joystick ni à la visée
    expect([...down]).toEqual(['right|touch:joy']);
    expect(core.joy).not.toBeNull();
    expect(core.aiming).toBe(true);
    core.up(1); core.up(3);
    expect(down.size).toBe(0);
    expect(core.aimTarget).toBeNull();
  });

  it('visée au doigt : angle proportionnel au glissement, borné par les limites du jeu', () => {
    const { core, st } = fakeHost();
    core.down(5, W * 0.56, 90);
    core.move(5, W * 0.56, 90 - 40);
    expect(core.aimTarget).toBeCloseTo(st.aim + 40 * T.aimRadPerPx, 6);
    core.move(5, W * 0.56, -5000);
    expect(core.aimTarget).toBe(GAMEPLAY.weapons.aim.max);
    core.move(5, W * 0.56, 9000);
    expect(core.aimTarget).toBe(GAMEPLAY.weapons.aim.min);
  });

  it('les doigts hors commandes restent libres pour la caméra', () => {
    const { core, st } = fakeHost();
    expect(core.down(7, W * 0.3, 60)).toBe(false); // centre-haut : caméra
    expect(core.owns(7)).toBe(false);
    st.aimOn = false; // arme sans visée : le côté droit sert aussi à la caméra
    expect(core.down(8, W * 0.56, 90)).toBe(false);
  });

  it('priorité : commandes avant la zone de visée ; zones d’interface avant la visée', () => {
    const { core, st, circles, down } = fakeHost();
    const f = circleOf(circles, 'jump');
    core.down(1, ...pt(f)); // dans la zone de visée mais sur un bouton
    expect(core.aiming).toBe(false);
    expect(down.has('jump|touch:jump')).toBe(true);
    st.ui = true; // un élément d'interface (puce de minuterie, minimap…) occupe le point
    expect(core.down(2, W * 0.56, 90)).toBe(false);
    expect(core.aiming).toBe(false);
  });

  it('un 2e doigt sur le joystick est ignoré mais ne déplace pas la caméra', () => {
    const { core, circles } = fakeHost();
    const j = circleOf(circles, 'joystick');
    core.down(1, ...pt(j, 0.9, 0));
    expect(core.down(2, ...pt(j, -0.9, 0))).toBe(true);
    expect(core.joy!.id).toBe(1);
  });

  it('annulation (touchcancel) et perte de focus : aucune commande ne reste coincée', () => {
    const { core, down, circles } = fakeHost();
    core.down(1, ...pt(circleOf(circles, 'joystick'), -0.9, 0));
    core.down(2, ...pt(circleOf(circles, 'fire')));
    core.down(3, ...pt(circleOf(circles, 'backflip')));
    core.down(4, W * 0.56, 90);
    expect(down.size).toBe(3);
    core.up(2); // pointercancel d'un seul doigt
    expect(down.has('fire|touch:fire')).toBe(false);
    core.cancelAll(); // blur / changement de tour / menu
    expect(down.size).toBe(0);
    expect(core.joy).toBeNull();
    expect(core.aimTarget).toBeNull();
    expect(core.owns(1) || core.owns(3) || core.owns(4)).toBe(false);
  });

  it('commandes désactivées (tour de l’IA, menu) : rien n’est attribué', () => {
    const { core, st, circles } = fakeHost();
    st.enabled = false;
    expect(core.down(1, ...pt(circleOf(circles, 'fire')))).toBe(false);
    expect(core.down(2, W * 0.56, 90)).toBe(false);
  });

  it('armes à cible : le bouton de tir valide la cible au lieu de charger', () => {
    const { core, st, down, circles } = fakeHost();
    st.mode = 'confirm';
    core.down(1, ...pt(circleOf(circles, 'fire')));
    expect(st.confirms).toBe(1);
    expect(down.size).toBe(0);
    core.up(1);
    expect(down.size).toBe(0);
  });

  it('bouton d’armes : ouvre le menu une seule fois par appui', () => {
    const { core, st, circles } = fakeHost();
    core.down(1, ...pt(circleOf(circles, 'weapons')));
    core.move(1, 0, 0);
    core.up(1);
    expect(st.weapons).toBe(1);
  });
});

describe('du doigt aux intentions du jeu', () => {
  it('joystick + tir + saut produisent les bonnes intentions ; un appui bref est quand même vu', () => {
    const input = new ActionInput();
    const h = fakeHost();
    const host: TouchHost = { ...h.host, press: (a, s, on) => input.set(a, s, on) };
    const core = new TouchCore(host);
    const j = circleOf(h.circles, 'joystick'), f = circleOf(h.circles, 'fire'), jp = circleOf(h.circles, 'jump');
    core.down(1, j.cx + j.r * 0.9, j.cy);
    core.down(2, f.cx, f.cy);
    let it = input.buildIntent();
    expect(it.moveX).toBe(1);
    expect(it.fireDown).toBe(true);
    core.up(2);
    // Appui plus bref qu'un pas de simulation : appui ET relâchement avant la lecture suivante.
    core.down(3, jp.cx, jp.cy); core.up(3);
    it = input.buildIntent();
    expect(it.jump).toBe(true);
    expect(it.fireDown).toBe(false); // le tir relâché n'est plus tenu
    it = input.buildIntent();
    expect(it.jump).toBe(false);
    expect(it.moveX).toBe(1);
    core.up(1);
    expect(input.buildIntent().moveX).toBe(0);
    // Tap très bref sur le tir (appui + relâchement avant le pas suivant) : au moins un pas « tir maintenu ».
    core.down(4, f.cx, f.cy); core.up(4);
    expect(input.buildIntent().fireDown).toBe(true);
    expect(input.buildIntent().fireDown).toBe(false);
    void SIM_DT;
  });
});

describe('retour haptique', () => {
  const stateWith = () => {
    const s = createState({ seed: 3, withCanvas: false });
    s.teams[0]!.controller = 'human';
    s.teams[1]!.controller = 'ai';
    return s;
  };
  const explosion = (x: number, y: number, r = 45): GameEvent => ({ t: 'explosion', x, y, r });

  it('explosion proche d’un ver humain : vibration d’autant plus longue qu’elle est proche ; loin ou près de l’IA : rien', () => {
    const s = stateWith();
    const mine = s.worms.find((w) => w.team === 0)!, theirs = s.worms.find((w) => w.team === 1)!;
    const near = hapticPulse([explosion(mine.x + 10, mine.y)], s) as number;
    const mid = hapticPulse([explosion(mine.x + 80, mine.y)], s) as number;
    expect(near).toBeGreaterThan(mid);
    expect(near).toBeLessThanOrEqual(T.haptics.maxMs);
    expect(mid).toBeGreaterThanOrEqual(T.haptics.minMs);
    expect(hapticPulse([explosion(mine.x + 3000, mine.y)], s)).toBeNull();
    // Explosion à côté d'un ver IA seulement (les vers humains sont loin) : pas de vibration.
    for (const w of s.worms) if (w.team === 0) { w.x = 100; w.y = 100; }
    expect(hapticPulse([explosion(theirs.x, theirs.y)], s)).toBeNull();
  });

  it('perte de PV d’un ver humain proportionnelle aux dégâts ; mort = motif long ; IA ignorée', () => {
    const s = stateWith();
    const mine = s.worms.find((w) => w.team === 0)!, theirs = s.worms.find((w) => w.team === 1)!;
    const small = hapticPulse([{ t: 'damage', worm: mine.id, amount: 5, x: 0, y: 0 }], s) as number;
    const big = hapticPulse([{ t: 'damage', worm: mine.id, amount: 40, x: 0, y: 0 }], s) as number;
    expect(big).toBeGreaterThan(small);
    expect(big).toBeLessThanOrEqual(T.haptics.damageMaxMs);
    expect(hapticPulse([{ t: 'damage', worm: theirs.id, amount: 40, x: 0, y: 0 }], s)).toBeNull();
    expect(Array.isArray(hapticPulse([{ t: 'death', worm: mine.id, x: 0, y: 0 }], s))).toBe(true);
  });

  it('Haptics : espace les vibrations, respecte le réglage, supporte l’absence ou l’échec de vibrate', () => {
    const s = stateWith();
    const mine = s.worms.find((w) => w.team === 0)!;
    const calls: unknown[] = [];
    let t = 0;
    const h = new Haptics((p) => { calls.push(p); return true; }, () => t);
    const ev: GameEvent[] = [explosion(mine.x, mine.y)];
    h.onEvents(ev, s);
    t += 10; h.onEvents(ev, s); // trop tôt
    expect(calls.length).toBe(1);
    t += T.haptics.minGapMs; h.onEvents(ev, s);
    expect(calls.length).toBe(2);
    h.enabled = false; t += 1000; h.onEvents(ev, s);
    expect(calls.length).toBe(2);
    const broken = new Haptics(() => { throw new Error('refusé'); }, () => 0);
    expect(() => broken.onEvents(ev, s)).not.toThrow();
    const none = new Haptics(() => false, () => 0);
    expect(() => none.onEvents(ev, s)).not.toThrow();
  });
});
