/**
 * Maths DÉTERMINISTES pour la simulation. Le standard JavaScript ne garantit pas le dernier bit de `Math.hypot`, `sin`,
 * `cos`, `pow`, `exp`… : deux navigateurs (ou deux appareils) peuvent différer d'un ulp, et en lockstep en ligne cet
 * écart s'amplifie jusqu'à la désynchronisation. Ici : seulement + − × ÷ et `Math.sqrt` (correctement arrondie par la norme IEEE 754),
 * donc des résultats identiques partout.
 */

/** Distance euclidienne √(dx² + dy²), identique sur tous les moteurs (contrairement à `Math.hypot`). */
export function dist(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

const TAU = 6.283185307179586;
const PI = 3.141592653589793;

/** Ramène x dans [-π, π] sans fonction transcendante. */
function reduce(x: number): number {
  if (x > PI || x < -PI) x -= TAU * Math.round(x / TAU);
  return x;
}

/** Sinus par série de Taylor (précision double sur [-π, π]), déterministe. */
export function dsin(x: number): number {
  x = reduce(x);
  const x2 = x * x;
  let term = x, sum = x;
  for (let n = 1; n <= 14; n++) {
    term *= -x2 / ((2 * n) * (2 * n + 1));
    sum += term;
  }
  return sum;
}

/** Cosinus par série de Taylor, déterministe. */
export function dcos(x: number): number {
  x = reduce(x);
  const x2 = x * x;
  let term = 1, sum = 1;
  for (let n = 1; n <= 14; n++) {
    term *= -x2 / ((2 * n - 1) * (2 * n));
    sum += term;
  }
  return sum;
}
