import type { Intent, CraterCommand } from './intent';

/** Actions logiques du jeu. Clavier, tactile, manette alimentent les mêmes actions. */
export type Action =
  | 'left' | 'right' | 'aimUp' | 'aimDown' | 'jump' | 'backflip' | 'fire'
  | 'weapons' | 'pause' | 'debug' | 'skip' | 'mute' | 'restart';

const KEYBOARD_BINDINGS: Record<string, Action> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'aimUp',
  ArrowDown: 'aimDown',
  Space: 'fire',
  Tab: 'weapons',
  KeyW: 'weapons',
  KeyM: 'mute',
  KeyR: 'restart',
  Enter: 'jump',
  Backspace: 'backflip',
  Escape: 'pause',
  KeyN: 'skip',
  F3: 'debug',
  Backquote: 'debug',
};

/** Liste vide partagée (jamais modifiée) : évite de créer un tableau à chaque pas de simulation. */
const NO_CRATERS: CraterCommand[] = [];

/** Touches 1 à 5 : minuterie des armes à retardement. */
const FUSE_KEYS: Record<string, number> = {
  Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5,
  Numpad1: 1, Numpad2: 2, Numpad3: 3, Numpad4: 4, Numpad5: 5,
};

/**
 * Registre d'actions : état « maintenu » + appuis mémorisés jusqu'à consommation.
 * Les sources (clavier ici, tactile à l'étape 8) appellent `set(action, source, down)`.
 */
export class ActionInput {
  /** false : les entrées de jeu sont ignorées (menus ouverts, écran de transition). */
  enabled = true;
  private held = new Map<Action, Set<string>>();
  private pressed = new Set<Action>();
  private craters: CraterCommand[] = [];
  private select: string | null = null;
  private fuse: number | null = null;
  private target: { x: number; y: number } | null = null;

  /** Une action reste maintenue tant qu'au moins une source la maintient. */
  set(action: Action, source: string, down: boolean): void {
    let s = this.held.get(action);
    if (!s) this.held.set(action, (s = new Set()));
    if (down) {
      if (!s.has(source)) this.pressed.add(action);
      s.add(source);
    } else {
      s.delete(source);
    }
  }

  isDown(action: Action): boolean {
    return (this.held.get(action)?.size ?? 0) > 0;
  }

  /** Vrai une fois par appui ; l'appui reste en attente tant qu'il n'est pas consommé. */
  consume(action: Action): boolean {
    return this.pressed.delete(action);
  }

  clearPressed(): void {
    this.pressed.clear();
    this.craters.length = 0;
    this.select = null; this.fuse = null; this.target = null;
  }

  releaseAll(): void {
    this.held.clear();
  }

  pushCrater(c: CraterCommand): void {
    this.craters.push(c);
  }

  pushSelect(id: string): void { this.select = id; }
  pushFuse(n: number): void { this.fuse = n; }
  pushTarget(x: number, y: number): void { this.target = { x, y }; }

  /** Construit l'intention d'un pas de simulation (consomme les appuis ponctuels). */
  buildIntent(): Intent {
    const l = this.isDown('left'), r = this.isDown('right');
    const intent: Intent = {
      moveX: l === r ? 0 : l ? -1 : 1,
      jump: this.consume('jump'),
      backflip: this.consume('backflip'),
      aimDir: this.isDown('aimUp') === this.isDown('aimDown') ? 0 : this.isDown('aimUp') ? 1 : -1,
      // `consume` garantit au moins un pas « tir maintenu » même pour un appui plus bref qu'un pas.
      fireDown: this.consume('fire') || this.isDown('fire'),
      selectWeapon: this.select,
      fuse: this.fuse,
      target: this.target,
      skipTurn: this.consume('skip'),
      craters: this.craters.length ? this.craters.splice(0) : NO_CRATERS,
    };
    this.select = null; this.fuse = null; this.target = null;
    return intent;
  }
}

/** Branche le clavier sur les actions. */
export function bindKeyboard(input: ActionInput, target: Window = window): void {
  // Les champs de saisie du menu gardent leurs touches (noms d'équipe, graine…).
  const typing = (e: KeyboardEvent): boolean => {
    const el = e.target as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  };
  target.addEventListener('keydown', (e) => {
    if (!input.enabled || typing(e)) return;
    const f = FUSE_KEYS[e.code];
    if (f !== undefined) { e.preventDefault(); input.pushFuse(f); return; }
    const a = KEYBOARD_BINDINGS[e.code];
    if (!a) return;
    e.preventDefault();
    if (!e.repeat) input.set(a, 'kbd:' + e.code, true);
  });
  target.addEventListener('keyup', (e) => {
    const a = KEYBOARD_BINDINGS[e.code];
    if (a) input.set(a, 'kbd:' + e.code, false); // relâchement toujours pris en compte (pas de touche coincée)
  });
  target.addEventListener('blur', () => input.releaseAll());
}
