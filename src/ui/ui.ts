/** Zone cliquable de l'interface (coordonnées écran CSS), recalculée à chaque frame par le HUD. */
export interface Region { id: string; x: number; y: number; w: number; h: number; data?: number | string }

/** Registre des zones d'interface : sert au test de clic avant la caméra/le jeu. */
export class UI {
  /** Zones réutilisées d'une frame à l'autre (pas d'allocation) ; `n` = nombre de zones valides. */
  private pool: Region[] = [];
  private n = 0;
  menuOpen = false;

  /** Zones déclarées pendant la frame courante (copie : réservée aux tests / au debug). */
  get regions(): Region[] { return this.pool.slice(0, this.n); }

  reset(): void {
    this.n = 0;
  }

  add(id: string, x: number, y: number, w: number, h: number, data?: number | string): void {
    const r = this.pool[this.n];
    if (r) { r.id = id; r.x = x; r.y = y; r.w = w; r.h = h; r.data = data; }
    else this.pool[this.n] = { id, x, y, w, h, data };
    this.n++;
  }

  /** Dernière zone ajoutée sous le point (= la plus au-dessus). */
  hit(sx: number, sy: number): Region | null {
    for (let i = this.n - 1; i >= 0; i--) {
      const r = this.pool[i] as Region;
      if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return r;
    }
    return null;
  }
}
