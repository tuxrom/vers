// Test de bout en bout du mode en ligne dans un vrai navigateur (Chromium) : deux appareils (ordinateur + smartphone
// tactile), salon, partie synchronisée, coupure réseau puis reprise, départ d'un joueur. Vérifie aussi la politique de
// sécurité de contenu (aucune violation) et le service worker.
//
//   npm run test:e2e [-- http://127.0.0.1:8080]     (ou E2E_URL=… ; la pile doit tourner : docker compose up --build -d)
//   Navigateur : CHROME_PATH, sinon le Chromium installé par `npx playwright-core install chromium`.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.argv[2] || process.env.E2E_URL || 'http://127.0.0.1:8080';
const TURNS = Number(process.env.E2E_TURNS || 4);

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(root)) {
    for (const d of readdirSync(root).filter((n) => n.startsWith('chromium-')).sort().reverse()) {
      for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) if (existsSync(join(root, d, rel))) return join(root, d, rel);
    }
  }
  return undefined; // laisse playwright-core choisir
}

const failures = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ['--no-sandbox', '--use-gl=swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const problems = [];
// Appareil A : ordinateur ; appareil B : smartphone tactile (contextes distincts = pas de stockage partagé).
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const ctxB = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const A = await ctxA.newPage(), B = await ctxB.newPage();
for (const [n, p] of [['A', A], ['B', B]]) {
  p.on('pageerror', (e) => problems.push(`${n} exception : ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|CSP/i.test(m.text())) problems.push(`${n} CSP : ${m.text()}`); });
}
const cdpB = await ctxB.newCDPSession(B);
const wait = (ms) => A.waitForTimeout(ms);
const game = (p, fn, arg) => p.evaluate(fn, arg);

try {
  await A.goto(`${BASE}/?debug`); await B.goto(`${BASE}/?debug`);
  await A.waitForSelector('#ui h1'); await B.waitForSelector('#ui h1');

  console.log('Salon');
  await A.click('text=Jouer en ligne');
  await A.fill('input[aria-label="Votre pseudo"]', 'Alice');
  await A.click('button:has-text("Créer un salon")');
  await A.waitForSelector('[data-room-code]', { timeout: 10000 });
  const code = await A.getAttribute('[data-room-code]', 'data-room-code');
  check(/^[A-Z0-9]{4,8}$/.test(code ?? ''), 'salon créé', `code ${code}`);
  await B.tap('text=Jouer en ligne');
  await B.fill('input[aria-label="Votre pseudo"]', 'Bob');
  await B.fill('input[aria-label="Code du salon"]', code.toLowerCase());
  await B.tap('button:has-text("Rejoindre")');
  await B.waitForSelector('[data-room-code]', { timeout: 10000 });
  await A.waitForFunction(() => document.body.textContent.includes('Bob'), null, { timeout: 5000 });
  check(true, 'jonction par code (interface tactile)');
  const latency = await B.waitForFunction(() => /\d+ ms/.test(document.querySelector('#ui .panel')?.textContent ?? ''), null, { timeout: 8000 }).then(() => true, () => false);
  check(latency, 'latence des joueurs affichée dans le salon');

  console.log('Partie');
  await A.click('button:has-text("Lancer la partie")');
  await Promise.all([A, B].map((p) => p.waitForFunction(() => window.__game?.mode === 'game' && window.__game.online && window.__game.state.turnNumber >= 1, null, { timeout: 40000 })));
  const maps = await Promise.all([A, B].map((p) => game(p, () => JSON.stringify({ seed: window.__game.state.options.seed, mask: window.__game.state.terrain.mask.checksum() }))));
  check(maps[0] === maps[1], 'graine et carte identiques sur les deux appareils', maps[0]);

  const who = (p) => game(p, () => { const g = window.__game, s = g.state; return { mine: g.online.isLocalTeam(s.turn.team), turn: s.turnNumber, phase: s.phase }; });
  async function playMyTurn(p, isTouch) {
    const info = await game(p, () => {
      const s = window.__game.state; const me = s.worms[s.turn.worm];
      const foe = s.worms.filter((w) => w.alive && w.team !== me.team).sort((a, c) => Math.abs(a.x - me.x) - Math.abs(c.x - me.x))[0];
      return { dx: foe.x - me.x, aim: s.turn.aim, facing: me.facing };
    });
    const dir = info.dx >= 0 ? 'ArrowRight' : 'ArrowLeft';
    if ((info.dx >= 0 ? 1 : -1) !== info.facing) { await p.keyboard.down(dir); await p.waitForTimeout(90); await p.keyboard.up(dir); }
    const want = 0.5 * Math.asin(Math.min(1, (900 * Math.abs(info.dx)) / (1250 * 1250)));
    const diff = want - info.aim;
    if (Math.abs(diff) > 0.03) { const key = diff > 0 ? 'ArrowUp' : 'ArrowDown'; await p.keyboard.down(key); await p.waitForTimeout((Math.abs(diff) / 1.4) * 1000); await p.keyboard.up(key); }
    if (isTouch) { // tir au doigt : maintenir le bouton de tir
      const c = await game(p, () => window.__game.touchCircles().find((k) => k.id === 'fire'));
      await cdpB.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.cx, y: c.cy, id: 1 }] });
      await p.waitForTimeout(1700);
      await cdpB.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else { await p.keyboard.down('Space'); await p.waitForTimeout(1700); await p.keyboard.up('Space'); }
  }
  /** Joue `n` tours (chacun le sien) ; `during(turnIndex)` est appelé juste après chaque tir. */
  async function playTurns(n, during = async () => {}) {
    let played = 0, last = 0;
    const t0 = Date.now();
    while (played < n && Date.now() - t0 < 60000 * n) {
      for (const [p, isTouch] of [[A, false], [B, true]]) {
        const w = await who(p);
        if (w.mine && w.phase === 'turn' && w.turn !== last) { last = w.turn; await playMyTurn(p, isTouch); played++; await during(played, p); }
      }
      await wait(250);
    }
    await A.waitForFunction((t) => window.__game.state.turnNumber > t, last, { timeout: 40000 }).catch(() => {});
    await wait(1200);
    return played;
  }
  const compare = async () => {
    const H = await Promise.all([A, B].map((p) => game(p, () => ({ hashes: [...window.__game.turnHashes.entries()], confirmed: window.__game.online.confirmedTurn, desync: !!window.__game.online.desync }))));
    const ha = new Map(H[0].hashes), hb = new Map(H[1].hashes);
    const common = [...ha.keys()].filter((k) => hb.has(k));
    return { common: common.length, bad: common.filter((k) => ha.get(k) !== hb.get(k)), confirmed: Math.min(H[0].confirmed, H[1].confirmed), desync: H[0].desync || H[1].desync };
  };

  const played = await playTurns(TURNS);
  let c = await compare();
  check(played === TURNS, `${TURNS} tours joués (clavier sur A, tactile sur B)`);
  check(c.common >= TURNS && c.bad.length === 0 && !c.desync, 'états identiques à chaque début de tour', `${c.common} tours comparés`);
  check(c.confirmed >= TURNS - 1, 'tours confirmés par le serveur', `jusqu'au tour ${c.confirmed}`);

  console.log('Coupure et reprise');
  const before = await game(B, () => ({ id: window.__game.net.id, turn: window.__game.state.turnNumber }));
  // La connexion de B tombe (comme une perte de réseau) pendant que la partie continue.
  let dropped = false;
  const more = await playTurns(2, async (i) => { if (i === 1 && !dropped) { dropped = true; await game(B, () => window.__game.net.drop()); } });
  const after = await game(B, () => ({ id: window.__game.net?.id, open: window.__game.net?.status === 'open', reconnecting: window.__game.onlineCtl.reconnecting, mode: window.__game.mode, turn: window.__game.state.turnNumber }));
  check(dropped && after.open && !after.reconnecting && after.id === before.id, 'B a repris sa place avec la même identité', JSON.stringify(after));
  check(more === 2 && after.turn > before.turn, 'la partie a continué après la reprise', `tour ${before.turn} → ${after.turn}`);
  c = await compare();
  check(c.bad.length === 0 && !c.desync, 'aucune divergence après la reprise', `${c.common} tours comparés`);
  check(await game(A, () => window.__game.state.teams.every((t) => t.controller === 'human')), 'aucune équipe n’a été confiée à l’ordinateur');

  console.log('Sécurité et PWA');
  const headers = (await (await ctxA.request.get(`${BASE}/`)).headers());
  if (headers['content-security-policy']) {
    check(/frame-ancestors 'none'/.test(headers['content-security-policy']), 'CSP présente (frame-ancestors none)');
    const sw = await A.evaluate(() => navigator.serviceWorker?.getRegistration().then((r) => !!r)).catch(() => false);
    check(sw, 'service worker enregistré malgré la CSP');
  } else console.log('  · pas de CSP (serveur de développement) : contrôle ignoré');
  check(problems.length === 0, 'aucune exception ni violation de CSP dans les pages', problems.join(' | '));

  console.log('Départ d’un joueur');
  await ctxB.close();
  const replaced = await A.waitForFunction(() => window.__game.state.teams.some((t) => t.controller === 'ai'), null, { timeout: 45000 }).then(() => true, () => false);
  check(replaced, 'B parti : après le délai de grâce, son équipe est reprise par l’ordinateur');
  const tA = await game(A, () => window.__game.state.turnNumber);
  const goesOn = await A.waitForFunction((n) => window.__game.state.turnNumber >= n + 2 || window.__game.state.phase === 'gameover', tA, { timeout: 120000 }).then(() => true, () => false);
  check(goesOn, 'la partie continue sans B');
} catch (e) {
  failures.push(`exception : ${e?.message ?? e}`);
  console.error(e);
} finally {
  await browser.close();
}
if (problems.length) console.log('Problèmes relevés :', problems);
console.log(failures.length ? `\nÉCHEC (${failures.length}) : ${failures.join(' ; ')}` : '\nOK');
process.exit(failures.length ? 1 : 0);
