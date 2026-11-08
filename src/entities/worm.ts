import { dist } from '@/core/math';
import { GAMEPLAY } from '@/config/gameplay';
import { wormName } from '@/config/names';
import { SIM_DT } from '@/config/engine';
import type { Intent } from '@/core/intent';
import { circleOverlaps, unstick } from '@/physics/collision';
import type { SolidQuery } from '@/terrain/mask';

const W = GAMEPLAY.worm;
const PHYS = GAMEPLAY.physics;
const scratch = { x: 0, y: 0 };
const ROPE = GAMEPLAY.weapons.rope;

export type WormMode = 'ground' | 'air';

/** Corde ninja accrochée au terrain (point d'ancrage + longueur courante). */
export interface Rope { ax: number; ay: number; length: number }

/** État d'un ver (position = centre du cercle de collision). Entièrement sérialisable. */
export interface Worm {
  id: number;
  name: string;
  /** Couleur d'équipe (rendu). */
  color: string;
  team: number;
  x: number; y: number;
  px: number; py: number; // pas précédent (interpolation du rendu)
  vx: number; vy: number;
  facing: -1 | 1;
  mode: WormMode;
  health: number;
  alive: boolean;
  /** Noyé : retiré du jeu (ni dessin ni physique). */
  sunk: boolean;
  /** Temps écoulé depuis la mort (s) : anime la chute de la tombe. */
  deathAge: number;
  /** Dégâts de chute calculés à l'atterrissage, à appliquer par la simulation. */
  fallDamagePending: number;
  /** Projeté par une explosion : rebondit sur les murs et glisse à l'atterrissage. */
  knocked: boolean;
  rope: Rope | null;
  /** Animation d'apparition (téléportation) : reste de durée (s), 0 = terminée. */
  appear: number;
  /** Rotation visuelle (salto), radians. */
  angle: number;
  spin: number; // rad/s, non nul pendant un salto
  /** Phase d'animation de marche. */
  walkPhase: number;
  walking: boolean;
  sliding: boolean;
  /** y le plus haut atteint depuis le dernier contact au sol (mesure de chute). */
  peakY: number;
  /** Dernière chute : distance (px) et dégâts correspondants (appliqués à l'étape 5). */
  lastFallDistance: number;
  lastFallDamage: number;
}

export function createWorm(
  id: number, team: number, x: number, y: number, name = wormName(id), health: number = W.startHealth, color = '#f08a9b',
): Worm {
  return {
    id, name, color, team, x, y, px: x, py: y, vx: 0, vy: 0,
    facing: 1, mode: 'air', health, alive: true, sunk: false, deathAge: 0, fallDamagePending: 0, knocked: false, rope: null, appear: 0,
    angle: 0, spin: 0, walkPhase: 0, walking: false, sliding: false,
    peakY: y, lastFallDistance: 0, lastFallDamage: 0,
  };
}

/** Dégâts d'une chute de `distance` px (pur, config uniquement). */
export function fallDamage(distance: number): number {
  const excess = distance - W.fallDamageThreshold;
  return excess > 0 ? Math.min(W.fallDamageMax, Math.round(excess * W.fallDamagePerPixel)) : 0;
}

const onGround = (t: SolidQuery, w: Worm): boolean => circleOverlaps(t, w.x, w.y + 1, W.radius);

/** y du premier pixel solide sous (x, y0) en descendant jusqu'à `reach`. */
function firstSolidY(t: SolidQuery, x: number, y0: number, reach: number): number {
  for (let y = y0; y <= reach; y++) if (t.isSolid(x, y)) return y;
  return reach;
}

/** Pente locale (tan, > 0 : le sol descend vers la gauche) mesurée sous le ver. */
function groundSlope(t: SolidQuery, w: Worm): number {
  const d = W.radius;
  const top = Math.round(w.y) - W.radius;
  const reach = top + W.radius * 2 + 24;
  const left = firstSolidY(t, Math.round(w.x) - d, top, reach);
  const right = firstSolidY(t, Math.round(w.x) + d, top, reach);
  return (left - right) / (2 * d);
}

/** Déplacement horizontal au sol par pas ≤ 1 px : marche, montée de marches, collage au sol en descente. */
function walkStep(t: SolidQuery, w: Worm, dx: number): boolean {
  let moved = false;
  const n = Math.max(1, Math.ceil(Math.abs(dx)));
  const sx = dx / n;
  for (let i = 0; i < n; i++) {
    const nx = w.x + sx;
    if (!circleOverlaps(t, nx, w.y, W.radius)) {
      w.x = nx; moved = true;
    } else {
      let climbed = false;
      for (let k = 1; k <= W.maxStepUp; k++) {
        if (!circleOverlaps(t, nx, w.y - k, W.radius)) { w.x = nx; w.y -= k; climbed = moved = true; break; }
      }
      if (!climbed) break;
    }
    // Colle au sol dans les descentes douces.
    for (let k = 0; k < W.maxStepDown && !onGround(t, w); k++) w.y += 1;
  }
  return moved;
}

function launch(w: Worm, vx: number, vy: number, spin = 0): void {
  w.knocked = false;
  w.mode = 'air';
  w.vx = vx; w.vy = vy;
  w.spin = spin;
  w.peakY = w.y;
  w.sliding = false;
  w.walking = false;
}

/** Projette un ver (explosion, coup de batte) : ajoute une vitesse et le met en vol. */
export function knockWorm(w: Worm, vx: number, vy: number): void {
  if (w.mode === 'ground') { w.vx = 0; w.vy = 0; }
  w.mode = 'air';
  w.vx += vx;
  w.vy += vy;
  w.knocked = true;
  w.rope = null;
  w.spin = 0;
  w.angle = 0;
  w.peakY = Math.min(w.peakY, w.y);
  w.sliding = false;
  w.walking = false;
}

/** Décroche la corde : le ver garde sa vitesse (amplifiée) et part en vol libre. */
export function releaseRope(w: Worm): void {
  if (!w.rope) return;
  w.rope = null;
  w.mode = 'air';
  w.vx *= ROPE.releaseBoost;
  w.vy *= ROPE.releaseBoost;
  w.peakY = w.y;
  w.angle = 0;
  w.knocked = false;
}

/** Balancement pendulaire : gravité, poussée latérale, longueur réglable, contrainte de distance. */
function updateRope(t: SolidQuery, w: Worm, intent: Intent, dt: number): void {
  const rope = w.rope as Rope;
  if (intent.moveX !== 0) w.facing = intent.moveX;
  w.vy = Math.min(w.vy + PHYS.gravity * dt, PHYS.terminalVelocity);
  w.vx += intent.moveX * ROPE.swing * dt;
  rope.length = Math.min(ROPE.maxLength, Math.max(ROPE.minLength, rope.length - intent.aimDir * ROPE.climbSpeed * dt));
  const sp = dist(w.vx, w.vy);
  if (sp > ROPE.maxSpeed) { w.vx *= ROPE.maxSpeed / sp; w.vy *= ROPE.maxSpeed / sp; }

  // Déplacement par pas ≤ 1 px, axe par axe ; un obstacle annule la composante de vitesse.
  const nx = Math.max(1, Math.ceil(Math.abs(w.vx * dt)));
  for (let i = 0; i < nx; i++) {
    const x2 = w.x + (w.vx * dt) / nx;
    if (circleOverlaps(t, x2, w.y, W.radius)) { w.vx = 0; break; }
    w.x = x2;
  }
  const ny = Math.max(1, Math.ceil(Math.abs(w.vy * dt)));
  for (let i = 0; i < ny; i++) {
    const y2 = w.y + (w.vy * dt) / ny;
    if (circleOverlaps(t, w.x, y2, W.radius)) { if (w.vy > 0) w.vx *= 0.92; w.vy = 0; break; }
    w.y = y2;
  }

  // Contrainte : le ver ne s'éloigne pas de l'ancrage au-delà de la longueur (retire la vitesse radiale sortante).
  const dx = w.x - rope.ax, dy = w.y - rope.ay;
  const d = dist(dx, dy);
  if (d > rope.length && d > 1e-6) {
    const ux = dx / d, uy = dy / d;
    const nxp = rope.ax + ux * rope.length, nyp = rope.ay + uy * rope.length;
    if (!circleOverlaps(t, nxp, nyp, W.radius)) { w.x = nxp; w.y = nyp; }
    const vr = w.vx * ux + w.vy * uy;
    if (vr > 0) { w.vx -= vr * ux; w.vy -= vr * uy; }
  }
  w.angle = Math.max(-1.1, Math.min(1.1, Math.atan2(-(w.x - rope.ax), Math.max(1, w.y - rope.ay))));
  w.peakY = w.y; // pas de dégâts de chute pendant le balancement
}

/** Met à jour un ver pour un pas de simulation fixe. */
export function updateWorm(t: SolidQuery, w: Worm, intent: Intent, dt: number = SIM_DT): void {
  w.px = w.x; w.py = w.y;

  // Terrain modifié sous nos pieds (ou apparition) : sortir de la matière. Test peu coûteux d'abord (pas d'objet
  // créé tant que le ver n'est pas enfoncé : c'est le cas de 99,99 % des pas).
  if (circleOverlaps(t, w.x, w.y, W.radius)) {
    scratch.x = w.x; scratch.y = w.y;
    if (unstick(t, scratch, W.radius)) { w.x = scratch.x; w.y = scratch.y; }
  }

  if (w.appear > 0) w.appear = Math.max(0, w.appear - dt);

  if (w.rope) {
    if (intent.jump || intent.backflip) releaseRope(w);
    else { updateRope(t, w, intent, dt); return; }
  }

  if (w.mode === 'ground' && !onGround(t, w)) {
    // Sol creusé / bord franchi : on tombe en conservant l'élan d'une éventuelle glissade.
    const { vx, knocked } = w;
    launch(w, knocked ? vx : 0, 0);
    w.knocked = knocked;
  }

  if (w.mode === 'ground' && w.knocked) {
    // Glissade après projection : freinage au sol, puis retour au contrôle normal.
    if (Math.abs(w.vx) > GAMEPLAY.turn.restSpeed) {
      walkStep(t, w, w.vx * dt);
      w.vx *= Math.max(0, 1 - W.knockedGroundFriction * dt);
      if (!onGround(t, w)) { const vx = w.vx; launch(w, vx, 0); w.knocked = true; }
    } else {
      w.vx = 0;
      w.knocked = false;
    }
  } else if (w.mode === 'ground') {
    if (intent.moveX !== 0) w.facing = intent.moveX;

    if (intent.backflip) {
      const airtime = (2 * W.backflipSpeed) / PHYS.gravity;
      launch(w, -w.facing * W.backflipBackward, -W.backflipSpeed, -w.facing * (W.backflipTurns * Math.PI * 2) / airtime);
    } else if (intent.jump) {
      launch(w, w.facing * W.jumpForward, -W.jumpSpeed);
    } else {
      const slope = groundSlope(t, w);
      const steep = Math.abs(slope) > W.maxWalkSlope;
      const downhill: -1 | 1 = slope > 0 ? -1 : 1;
      w.sliding = steep;
      w.walking = false;

      if (steep) {
        // Trop raide : on ne grimpe pas, on glisse vers le bas.
        walkStep(t, w, downhill * W.slideSpeed * dt);
      } else if (intent.moveX !== 0) {
        w.walking = walkStep(t, w, intent.moveX * W.walkSpeed * dt);
        if (w.walking) w.walkPhase += (W.walkSpeed * dt) / (W.radius * 1.6);
      }
      if (!onGround(t, w)) launch(w, 0, 0);
    }
  }

  if (w.mode === 'air') {
    w.vy = Math.min(w.vy + PHYS.gravity * dt, PHYS.terminalVelocity);
    w.vx *= 1 - PHYS.airDrag * dt;
    w.angle += w.spin * dt;

    // Horizontal (pas ≤ 1 px).
    const nx = Math.max(1, Math.ceil(Math.abs(w.vx * dt)));
    for (let i = 0; i < nx; i++) {
      const x2 = w.x + (w.vx * dt) / nx;
      if (circleOverlaps(t, x2, w.y, W.radius)) {
        // Petite marche en l'air (bord de plateforme) sinon on stoppe contre le mur.
        if (!circleOverlaps(t, x2, w.y - 1, W.radius)) { w.x = x2; w.y -= 1; }
        else { w.vx = w.knocked ? -w.vx * W.knockedWallBounce : 0; break; }
      } else w.x = x2;
    }

    // Vertical (pas ≤ 1 px).
    const ny = Math.max(1, Math.ceil(Math.abs(w.vy * dt)));
    for (let i = 0; i < ny; i++) {
      const y2 = w.y + (w.vy * dt) / ny;
      if (circleOverlaps(t, w.x, y2, W.radius)) {
        if (w.vy < 0) { w.vy *= -W.ceilingBounce; break; }
        // Atterrissage.
        w.lastFallDistance = Math.max(0, w.y - w.peakY);
        w.lastFallDamage = fallDamage(w.lastFallDistance);
        w.fallDamagePending = w.lastFallDamage;
        w.mode = 'ground';
        w.vx *= w.knocked ? W.knockedLandFriction : W.landFriction;
        w.vy = 0;
        w.spin = 0;
        w.angle = 0;
        break;
      }
      w.y = y2;
      if (w.y < w.peakY) w.peakY = w.y;
    }
  }

  // Limites du monde : plafond de carte (le ciel est ouvert, mais pas infini).
  if (w.y < -GAMEPLAY.world.killMargin) { w.y = -GAMEPLAY.world.killMargin; w.vy = Math.max(0, w.vy); }
}
