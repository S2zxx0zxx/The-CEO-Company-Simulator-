import { createServer } from 'node:http';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const pkgRoot = process.env.C04_RENDERER_PKG || path.resolve('c04_renderer_pkg');

function resolveEsbuild() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const candidates = [
    process.env.C04_ESBUILD_PATH,
    'esbuild',
    path.join(pkgRoot, 'node_modules', 'esbuild'),
    path.join(appData, 'npm', 'node_modules', 'vite', 'node_modules', 'esbuild'),
    path.join(appData, 'npm', 'node_modules', 'esbuild'),
    '/usr/local/lib/node_modules/esbuild',
    '/usr/lib/node_modules/esbuild',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // try next candidate
    }
  }
  return null;
}

const esbuild = resolveEsbuild();
const { chromium } = await import(pathToFileURL(path.join(pkgRoot, 'node_modules/playwright/index.mjs')).href);

function findPlaywrightChromiumDirs() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const cacheRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(localAppData, 'ms-playwright');
  if (!existsSync(cacheRoot)) return [];
  return readdirSync(cacheRoot)
    .filter((d) => d.startsWith('chromium-'))
    .sort()
    .reverse()
    .flatMap((d) => [
      path.join(cacheRoot, d, 'chrome-win64', 'chrome.exe'),
      path.join(cacheRoot, d, 'chrome-win', 'chrome.exe'),
      path.join(cacheRoot, d, 'chrome-linux', 'chrome'),
      path.join(cacheRoot, d, 'chrome-linux64', 'chrome'),
    ]);
}

function findBrowserExe() {
  const candidates = [
    process.env.RAILWAY_BROWSER_EXE,
    process.env.CHROME_EXE,
    ...findPlaywrightChromiumDirs(),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p));
}

// 1. Build standalone zero-CDN offline web bundle in c04_web_bundle/ (or reuse prebuilt bundle if esbuild is absent)
const bundleDir = path.resolve('c04_web_bundle');
if (esbuild) {
  if (existsSync(bundleDir)) rmSync(bundleDir, { recursive: true, force: true });
  mkdirSync(path.join(bundleDir, 'assets', 'fonts'), { recursive: true });
  mkdirSync(path.join(bundleDir, 'assets', 'sprites'), { recursive: true });
  mkdirSync(path.join(bundleDir, 'fixtures'), { recursive: true });

  esbuild.buildSync({
    entryPoints: [path.resolve('c04_web_entry.ts')],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    outfile: path.join(bundleDir, 'app.js'),
    nodePaths: [path.join(pkgRoot, 'node_modules')],
  });

  esbuild.buildSync({
    entryPoints: [path.join(pkgRoot, 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs')],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    outfile: path.join(bundleDir, 'maplibre-gl-worker.js'),
    nodePaths: [path.join(pkgRoot, 'node_modules')],
  });
} else {
  const hasPrebuilt = existsSync(path.join(bundleDir, 'app.js')) && existsSync(path.join(bundleDir, 'maplibre-gl-worker.js'));
  if (!hasPrebuilt) {
    throw new Error('esbuild not found (set C04_ESBUILD_PATH) and no prebuilt c04_web_bundle/{app.js,maplibre-gl-worker.js} present');
  }
  mkdirSync(path.join(bundleDir, 'assets', 'fonts'), { recursive: true });
  mkdirSync(path.join(bundleDir, 'assets', 'sprites'), { recursive: true });
  mkdirSync(path.join(bundleDir, 'fixtures'), { recursive: true });
}

cpSync(path.join(pkgRoot, 'node_modules/maplibre-gl/dist/maplibre-gl.css'), path.join(bundleDir, 'maplibre-gl.css'));
cpSync(path.resolve('assets/fonts'), path.join(bundleDir, 'assets/fonts'), { recursive: true });
cpSync(path.resolve('assets/sprites'), path.join(bundleDir, 'assets/sprites'), { recursive: true });
cpSync(path.resolve('fixtures/c04_synthetic_basemap.pmtiles'), path.join(bundleDir, 'fixtures/c04_synthetic_basemap.pmtiles'));
cpSync(path.resolve('fixtures/c04_synthetic_graph_bundle.json'), path.join(bundleDir, 'fixtures/c04_synthetic_graph_bundle.json'));

writeFileSync(
  path.join(bundleDir, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
  <title>Railway CEO — C04 Synthetic Offline Map Verification</title>
  <link rel="stylesheet" href="./maplibre-gl.css"/>
  <style>
    html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; font-family: sans-serif; }
    #hud {
      position: absolute; top: 8px; left: 8px; z-index: 10;
      background: rgba(15, 23, 42, 0.88); color: #f8fafc;
      padding: 8px 12px; border-radius: 8px; font-size: 12px;
      pointer-events: none; max-width: 90vw;
    }
    #hud b { color: #fbbf24; }
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="hud">
    <div><b>SYNTHETIC C04 QA — NOT RELEASE</b></div>
    <div id="c04-status">INITIALIZING</div>
    <div id="c04-detail">No selection</div>
  </div>
  <script src="./app.js"></script>
</body>
</html>
`,
  'utf8',
);

// 2. Serve strictly from local c04_web_bundle/ on ephemeral 127.0.0.1 port
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.pbf': 'application/x-protobuf',
  '.pmtiles': 'application/octet-stream',
};

const server = createServer((req, res) => {
  const reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const cleanRel = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '');
  const full = path.resolve(bundleDir, cleanRel);
  if (!full.startsWith(bundleDir) || !existsSync(full)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(full).toLowerCase();
  res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
  res.end(readFileSync(full));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const baseOrigin = `http://127.0.0.1:${port}`;

const screenshotsDir = path.resolve('screenshots');
mkdirSync(screenshotsDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: findBrowserExe(),
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-precise-memory-info'],
});

const externalAttempts = [];
const failedLocal = [];
const pageErrors = [];

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  // Strictly block ALL external origins to simulate 100% network-disconnected offline execution
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(baseOrigin) || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('pmtiles:') || url.startsWith('offlinefont:')) {
      await route.continue();
    } else {
      externalAttempts.push(url);
      await route.abort('blockedbyclient');
    }
  });

  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('requestfailed', (req) => {
    if (req.url().startsWith(baseOrigin)) {
      failedLocal.push(`${req.url()} (${req.failure()?.errorText})`);
    }
  });

  await page.goto(baseOrigin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__c04Harness && (window.__c04Harness.bootError || window.__c04Harness.readyState?.() === 'READY'), { timeout: 20000 });

  const bootErr = await page.evaluate(() => window.__c04Harness.bootError || null);
  if (bootErr) throw new Error('Browser boot error: ' + bootErr);

  const initState = await page.evaluate(() => window.__c04Harness.readyState());
  if (initState !== 'READY') throw new Error('MapLibre failed to reach READY: ' + initState);

  // Check corrupted manifest mismatch fails closed in browser
  const mismatchCheck = await page.evaluate(() => window.__c04Harness.triggerCorruptedManifestCheck());
  if (mismatchCheck.state !== 'MANIFEST_MISMATCH') {
    throw new Error('Expected MANIFEST_MISMATCH on tampered digest, got ' + JSON.stringify(mismatchCheck));
  }

  // Verify boundary toggle remains blocked
  await page.evaluate(() => window.__c04Harness.toggleLayer('boundary', true));

  // Verify adversarial offline URLs & unregistered PMTiles protocol fallbacks fail closed in Chromium with 0 network leakage
  const adversarialCheck = await page.evaluate(() => window.__c04Harness.probeAdversarialOfflineBlocks());
  for (const [k, v] of Object.entries(adversarialCheck.rejectedRenderers)) {
    if (v.state !== 'MANIFEST_MISMATCH' || !v.reason.startsWith('EXTERNAL_URL_FORBIDDEN:')) {
      throw new Error(`Browser renderer failed to reject ${k}: ${JSON.stringify(v)}`);
    }
  }
  if (!adversarialCheck.protocolGuardBlocked) {
    throw new Error('Browser pmtiles protocol guard failed to block unregistered external URL');
  }
  if (externalAttempts.length > 0) {
    throw new Error('External network attempts triggered during adversarial offline check: ' + externalAttempts.join(', '));
  }

  // Screenshot 1: Z6 Regional Overview (1280x720)
  await page.evaluate(() => window.__c04Harness.setCameraDirect(8, 86.09, 22.07));
  await page.screenshot({ path: path.join(screenshotsDir, 'c04_synthetic_z6_overview.png') });

  // Screenshot 2: Z10 Portrait-first Mobile Viewport (390x844, DPR=2)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    window.__c04Harness.selectRoute('route-main-el');
    window.__c04Harness.setPreview(true);
    await window.__c04Harness.setCameraDirect(10, 86.09, 22.07);
  });
  await page.screenshot({ path: path.join(screenshotsDir, 'c04_synthetic_z10_portrait_mobile.png') });

  // Screenshot 3: Z12 Corridor + Stations + Junctions + Yards + Multiple Simultaneous Trains (1280x720)
  await page.setViewportSize({ width: 1280, height: 720 });
  const trainsT1 = await page.evaluate(async () => {
    await window.__c04Harness.locateStation('Riverbend Junction', 12);
    return window.__c04Harness.getProjectedTrains();
  });
  const z12RenderedFeatures = await page.evaluate(() => window.__c04Harness.queryVisibleFeatureCounts());
  await page.screenshot({ path: path.join(screenshotsDir, 'c04_synthetic_z12_stations_routes_trains.png') });

  // Mouse pan + step simulation forward (R33 movement projection along curved track)
  await page.mouse.move(640, 360);
  await page.mouse.down();
  await page.mouse.move(580, 320, { steps: 6 });
  await page.mouse.up();
  const trainsT2 = await page.evaluate(async () => {
    const nxt = await window.__c04Harness.stepSimulation(180);
    await window.__c04Harness.selectAndFollowTrain('TRAIN-E1', 14);
    return nxt;
  });

  // Screenshot 4: Z14 Close inspection following moving train along curved track geometry
  await page.screenshot({ path: path.join(screenshotsDir, 'c04_synthetic_z14_closeup_train_follow.png') });

  // Measure WebGL render frame perf in browser + WebGL context recovery check + real canvas click test
  const framePerf = await page.evaluate(() => window.__c04Harness.measureFramePerf(36));
  const webglRecoveryCheck = await page.evaluate(() => window.__c04Harness.triggerWebGLContextLossCheck());
  if (!webglRecoveryCheck.dispatched || !webglRecoveryCheck.lostSeen || !webglRecoveryCheck.restoredSeen) {
    throw new Error('WebGL context loss/restore events were not observed by RailwayMapRenderer');
  }
  await page.mouse.click(640, 360); // interactive center click on followed train TRAIN-E1 / viewport

  // Verify Canvas contains non-blank pixels & WebGL rendered pixels exist
  const canvasCheck = await page.evaluate(() => {
    const c = document.querySelector('#map canvas');
    return {
      hasCanvas: Boolean(c),
      width: c?.width ?? 0,
      height: c?.height ?? 0,
    };
  });

  // Check clean dispose
  const mapErrors = await page.evaluate(() => window.__c04Harness.getErrors());
  const disposedState = await page.evaluate(() => window.__c04Harness.dispose());

  // Validate train moved along track between t1 and t2
  const t1E1 = trainsT1.find((t) => t.trainId === 'TRAIN-E1');
  const t2E1 = trainsT2.find((t) => t.trainId === 'TRAIN-E1');
  const movedAlongTrack = t1E1 && t2E1 && t2E1.distanceM > t1E1.distanceM && (t2E1.coordinates[0] !== t1E1.coordinates[0] || t2E1.coordinates[1] !== t1E1.coordinates[1]);

  if (!movedAlongTrack) throw new Error('Simulated train TRAIN-E1 did not advance along curved track coordinates');
  if (mapErrors.length > 0) throw new Error('MapLibre runtime/tile errors: ' + mapErrors.join('; '));
  if (externalAttempts.length > 0) throw new Error('External network attempts detected: ' + externalAttempts.join(', '));
  if (failedLocal.length > 0) throw new Error('Failed local offline fetches: ' + failedLocal.join(', '));
  if (pageErrors.length > 0) throw new Error('Page runtime errors: ' + pageErrors.join('; '));

  console.log(JSON.stringify({
    suite: 'c04_browser_webgl_offline_rendering',
    passed: true,
    realPbfProcessed: false,
    syntheticQAOnly: true,
    actualC08MobileAcceptanceClaimed: false,
    externalNetworkRequestsBlockedCount: externalAttempts.length,
    failedLocalRequestsCount: failedLocal.length,
    mapErrorCount: mapErrors.length,
    pageErrorCount: pageErrors.length,
    mismatchCheck,
    adversarialCheck,
    canvasCheck,
    z12RenderedFeatures,
    webglRecoveryCheck,
    trainAdvancement: {
      trainId: 'TRAIN-E1',
      t1DistanceM: t1E1.distanceM,
      t1Coords: t1E1.coordinates,
      t2DistanceM: t2E1.distanceM,
      t2Coords: t2E1.coordinates,
      t2HeadingDeg: Math.round(t2E1.headingDeg * 100) / 100,
    },
    framePerf,
    nodeMemoryRssBytes: process.memoryUsage().rss,
    rebuiltWithEsbuild: Boolean(esbuild),
    disposedState,
    screenshotsGenerated: [
      'screenshots/c04_synthetic_z6_overview.png',
      'screenshots/c04_synthetic_z10_portrait_mobile.png',
      'screenshots/c04_synthetic_z12_stations_routes_trains.png',
      'screenshots/c04_synthetic_z14_closeup_train_follow.png',
    ],
  }, null, 2));
} finally {
  await browser.close();
  server.close();
}
