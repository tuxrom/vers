#!/usr/bin/env node
/**
 * Banc d'essai de performance : joue une scène chargée (24 vers, explosions en rafale, caméra qui balaie la carte)
 * dans Chromium et mesure le CPU de rendu/simulation par frame, les intervalles entre frames et les allocations.
 *
 *   npm run build && npm run preview -- --host 127.0.0.1 --port 4173 &
 *   CHROME_PATH=/chemin/vers/chrome node scripts/bench.mjs [--url http://127.0.0.1:4173] [--seconds 12]
 *       [--throttle 4] [--dpr 2] [--mobile] [--profile] [--label avant]
 *
 * `--adaptive` laisse la résolution dynamique agir (sinon elle est figée pour comparer) ; `--alloc` liste les sites
 * d'allocation (utiliser avec `npm run dev`, noms lisibles) ; `--profile` liste les fonctions les plus coûteuses.
 * `--throttle N` ralentit le CPU N fois (≈ mobile milieu de gamme avec N = 4). En Chromium sans GPU
 * (rastérisation logicielle) les valeurs absolues sont pessimistes : comparer les mesures entre elles.
 */
import { chromium } from 'playwright-core';

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i < 0 ? def : (process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? true : process.argv[i + 1]); };
const URL_ = arg('url', 'http://127.0.0.1:4173');
const SECONDS = Number(arg('seconds', 12));
const THROTTLE = Number(arg('throttle', 1));
const DPR = Number(arg('dpr', 2));
const MOBILE = !!arg('mobile', false);
const PROFILE = !!arg('profile', false);
const ALLOC = !!arg('alloc', false);
const ADAPTIVE = !!arg('adaptive', false);
const LABEL = arg('label', '');

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-precise-memory-info', '--disable-frame-rate-limit'],
});
const ctx = await browser.newContext({
  viewport: MOBILE ? { width: 844, height: 390 } : { width: 1280, height: 720 },
  deviceScaleFactor: DPR, hasTouch: MOBILE, isMobile: MOBILE,
});
await ctx.addInitScript(({ mobile }) => {
  // Partie chargée : 4 équipes × 6 vers, graine fixe, qualité maximale.
  localStorage.setItem('vers:v1:options', JSON.stringify({
    teams: [0, 1, 2, 3].map((i) => ({ name: 'E' + i, color: ['#f08a9b', '#6cb4f0', '#f0c75e', '#8bd67a'][i], controller: 'human', difficulty: 'medium' })),
    wormsPerTeam: 6, seed: 'bench', turnDuration: 45, startHealth: 100,
  }));
  localStorage.setItem('vers:v1:settings', JSON.stringify({ sound: 0, music: 0, quality: 'high', lang: 'fr', controls: mobile ? 'touch' : 'pc', haptics: false, touch: { scale: 1, layout: {} } }));
}, { mobile: MOBILE });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL_ + '/?debug&play' + (ADAPTIVE ? '' : '&noadapt'));
await page.waitForFunction(() => window.__game?.state?.phase === 'turn', null, { timeout: 60000 });
await page.waitForSelector('#ui .handoff', { timeout: 5000 }).then(() => page.click('#ui .handoff button')).catch(() => {});

// L'overlay de debug (?debug) est coupé pour ne pas fausser la mesure ; --overlay le garde.
if (!arg('overlay', false)) { await page.keyboard.press('F3'); await page.waitForTimeout(200); }
const cdp = await ctx.newCDPSession(page);
if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
if (ALLOC) { await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.startSampling', { samplingInterval: 1024, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }); }
if (PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }

const result = await page.evaluate(async ({ seconds, profile }) => {
  const g = window.__game;
  const { state, camera, canvas, perf } = g;
  camera.zoomBy(1.3, canvas.width / 2, canvas.height / 2, canvas.width, canvas.height, true);
  // Scène : explosions en rafale (cratère + effets) et caméra qui balaie la carte.
  let x = 600, dir = 1, lastBoom = 0;
  const W = 4000;
  let allocated = 0, lastHeap = performance.memory?.usedJSHeapSize ?? 0, frames = 0;
  const t0 = performance.now();
  await new Promise((resolve) => {
    const tick = (now) => {
      x += dir * 6; if (x > W - 700 || x < 700) dir = -dir;
      camera.manual = true; camera.x = x; camera.y = 560;
      if (now - lastBoom > 350) {
        lastBoom = now;
        const bx = x + (Math.random() - 0.5) * 600, by = 520 + Math.random() * 200;
        state.terrain.carveCircle(bx, by, 60);
        state.events.push({ t: 'explosion', x: bx, y: by, r: 60 }, { t: 'damage', worm: 0, amount: 12, x: bx, y: by });
      }
      const heap = performance.memory?.usedJSHeapSize ?? 0;
      if (heap > lastHeap) allocated += heap - lastHeap;
      lastHeap = heap; frames++;
      if (now - t0 < 3000) perf.reset(); // 3 s de chauffe (JIT, caches) non comptées
      if (now - t0 > seconds * 1000 + 3000) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const s = perf.stats();
  return { ...s, allocKBperFrame: allocated / 1024 / Math.max(1, frames), worms: state.worms.length, canvas: [canvas.el.width, canvas.el.height], resolutionScale: canvas.resolutionScale };
}, { seconds: SECONDS, profile: PROFILE });

let top = null;
if (PROFILE) {
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map();
  const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anonyme)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0)); });
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${(100 * v / total).toFixed(1).padStart(5)} %  ${k}`);
}
let allocTop = null;
if (ALLOC) {
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  const bySite = new Map();
  const walk = (n) => { const k = `${n.callFrame.functionName || '(anonyme)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`; bySite.set(k, (bySite.get(k) ?? 0) + n.selfSize); n.children.forEach(walk); };
  walk(profile.head);
  const total = [...bySite.values()].reduce((a, b) => a + b, 0);
  allocTop = [...bySite.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${(100 * v / total).toFixed(1).padStart(5)} %  ${(v / 1024).toFixed(0).padStart(6)} Ko  ${k}`);
}
console.log(JSON.stringify({ label: LABEL, throttle: THROTTLE, dpr: DPR, mobile: MOBILE, ...Object.fromEntries(Object.entries(result).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 100) / 100 : v])), errors }, null, 2));
if (allocTop) console.log('\nSites d\'allocation (échantillonnage du tas) :\n' + allocTop.join('\n'));
if (top) console.log('\nTop fonctions (temps propre) :\n' + top.join('\n'));
await browser.close();
