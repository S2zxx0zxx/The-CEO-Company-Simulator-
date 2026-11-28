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

function assert(cond, msg) {
  if (!cond) throw new Error('Browser assertion failed: ' + msg);
}

// 1. Build standalone C05 offline browser bundle in c05_web_bundle/
const bundleDir = path.resolve('c05_web_bundle');
if (esbuild) {
  if (existsSync(bundleDir)) rmSync(bundleDir, { recursive: true, force: true });
  mkdirSync(path.join(bundleDir, 'assets', 'fonts'), { recursive: true });
  mkdirSync(path.join(bundleDir, 'assets', 'sprites'), { recursive: true });
  mkdirSync(path.join(bundleDir, 'fixtures', 'c05_regions'), { recursive: true });

  esbuild.buildSync({
    entryPoints: [path.resolve('c05_web_entry.ts')],
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
    throw new Error('esbuild not found (set C04_ESBUILD_PATH) and no prebuilt c05_web_bundle present');
  }
  mkdirSync(path.join(bundleDir, 'assets', 'fonts'), { recursive: true });
  mkdirSync(path.join(bundleDir, 'assets', 'sprites'), { recursive: true });
  mkdirSync(path.join(bundleDir, 'fixtures', 'c05_regions'), { recursive: true });
}

cpSync(path.join(pkgRoot, 'node_modules/maplibre-gl/dist/maplibre-gl.css'), path.join(bundleDir, 'maplibre-gl.css'));
cpSync(path.resolve('assets/fonts'), path.join(bundleDir, 'assets/fonts'), { recursive: true });
cpSync(path.resolve('assets/sprites'), path.join(bundleDir, 'assets/sprites'), { recursive: true });
cpSync(path.resolve('fixtures/c05_regions'), path.join(bundleDir, 'fixtures/c05_regions'), { recursive: true });

writeFileSync(
  path.join(bundleDir, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
  <title>Railway CEO — C05 Region Install, OPFS/IDB & Portals QA</title>
  <link rel="stylesheet" href="./maplibre-gl.css"/>
  <style>
    html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; font-family: sans-serif; }
    #hud {
      position: absolute; top: 8px; left: 8px; z-index: 10;
      background: rgba(15, 23, 42, 0.9); color: #f8fafc;
      padding: 8px 12px; border-radius: 8px; font-size: 12px;
      pointer-events: none; max-width: 90vw;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="hud">
    <div><b>SYNTHETIC C05 QA — OFFLINE STORAGE</b></div>
    <div id="c05-status">BOOTING</div>
    <div id="c05-detail">Pending</div>
  </div>
  <script src="./app.js"></script>
</body>
</html>
`,
  'utf8',
);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.pbf': 'application/x-protobuf',
  '.pmtiles': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.gz': 'application/gzip',
};

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const full = path.resolve(bundleDir, rel);
  if (!full.startsWith(bundleDir) || !existsSync(full)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  const ext = path.extname(full);
  res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
  res.end(readFileSync(full));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
const browserExe = findBrowserExe();

const browser = await chromium.launch({
  executablePath: browserExe,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});

const blockedExternalUrls = [];
const failedLocalUrls = [];
const pageErrors = [];

const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.route('**/*', (route) => {
  const url = route.request().url();
  if (url.startsWith(baseUrl) || url.startsWith('data:') || url.startsWith('blob:')) {
    return route.continue();
  }
  blockedExternalUrls.push(url);
  return route.abort();
});

const page1 = await context.newPage();
page1.on('pageerror', (e) => pageErrors.push(String(e)));
page1.on('requestfailed', (req) => {
  if (req.url().startsWith(baseUrl)) failedLocalUrls.push(req.url());
});

try {
  await page1.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page1.waitForFunction(() => document.getElementById('c05-status')?.textContent === 'C05_HARNESS_READY');

  const initStatus = await page1.evaluate(() => window.__c05Harness.getStatus());
  assert(initStatus.storageNamespace === 'railway-ceo-regions-v1', 'Dedicated region DB namespace required');
  assert(initStatus.hasSaveDbOverlap === false, 'Must never touch railway-ceo-save-v1');
  assert(initStatus.physicalDeviceVerified === false, 'Desktop Chromium is not physical Android device');

  // 1. Install Region A v1 + Region B v1 into live Chromium IndexedDB + OPFS
  const insA1 = await page1.evaluate(() => window.__c05Harness.installPackage('in_east_c05_v1'));
  assert(insA1.result?.ok, 'Chromium install v1 must succeed');
  const insB1 = await page1.evaluate(() => window.__c05Harness.installPackage('in_north_c05_v1'));
  assert(insB1.result?.ok, 'Chromium install Region B must succeed');

  // 2. Live WebGL MapLibre rendering backed by VerifiedInstalledPMTilesSource range reads
  const renderA1 = await page1.evaluate(() => window.__c05Harness.renderActiveRegionMap('in-east-c05'));
  assert(renderA1.mapState === 'READY', 'WebGL map must reach READY from installed storage');
  assert(renderA1.binaryStoreMode === 'opfs', `Expected real Chromium OPFS binary storage, got ${renderA1.binaryStoreMode}`);
  assert(renderA1.telemetry.fullArchiveLoadedInMemory === false, 'Must never buffer full archive in RAM');
  assert(renderA1.telemetry.totalBytesRead < renderA1.telemetry.expectedByteLength, 'Range read bytes must stay strictly below archive size');

  // 3. Cross-region portal planning across two live installed regions
  const portalRes = await page1.evaluate(() => window.__c05Harness.planCrossRegionPortal());
  assert(portalRes.ok && portalRes.pinnedVersions?.length === 2, 'Cross-region portal journey across Chromium IDB/OPFS must succeed');

  // 4. Crash DURING_ACTIVATION in live Chromium -> real page.reload() -> recoverInstallations() -> clean v1!
  const crashMid = await page1.evaluate(() =>
    window.__c05Harness.installPackage('in_east_c05_v2', { injectCrashAt: 'DURING_ACTIVATION' }),
  );
  assert(crashMid.threwCrash, 'Crash injection must abort install');
  await page1.reload({ waitUntil: 'domcontentloaded' });
  await page1.waitForFunction(() => document.getElementById('c05-status')?.textContent === 'C05_HARNESS_READY');

  const recAfterReload = await page1.evaluate(() => window.__c05Harness.recoverInstallations());
  assert(recAfterReload.recovered === true, 'Reload recovery must clean interrupted transaction');
  assert(recAfterReload.resolution === 'ROLLED_BACK_INCOMPLETE_ACTIVATION');
  const recIdempotent = await page1.evaluate(() => window.__c05Harness.recoverInstallations());
  assert(recIdempotent.recovered === false && recIdempotent.resolution === 'NONE');
  assert((await page1.evaluate(() => window.__c05Harness.listStagingKeys())).length === 0, 'Staging cleaned in OPFS');

  const activeAfterCrash = await page1.evaluate(() => window.__c05Harness.inspectActiveVersions());
  assert(activeAfterCrash['in-east-c05'].versionKey === 'in-east-c05--1.0.0--p1', 'Prior v1 active preserved across browser crash & reload');

  // 5. Complete real upgrade to v2 + pin v1 + verify across reload + multi-tab lock & BroadcastChannel!
  await page1.evaluate(() => window.__c05Harness.pinRef('in-east-c05--1.0.0--p1', 'activeMovements', 'browser-trip-1'));
  const insA2 = await page1.evaluate(() => window.__c05Harness.installPackage('in_east_c05_v2'));
  assert(insA2.result?.ok, 'Upgrade to v2 must succeed');
  const gcPinned = await page1.evaluate(() => window.__c05Harness.removeUnusedVersion('in-east-c05--1.0.0--p1'));
  assert(gcPinned.ok === false && gcPinned.code === 'VERSION_PINNED_BY_ACTIVE_REFS');

  // Open second tab in same BrowserContext sharing IDB, OPFS, navigator.locks & BroadcastChannel
  const page2 = await context.newPage();
  page2.on('pageerror', (e) => pageErrors.push('tab2:' + String(e)));
  await page2.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page2.waitForFunction(() => document.getElementById('c05-status')?.textContent === 'C05_HARNESS_READY');

  const [lockTab1, rollbackTab2] = await Promise.all([
    page1.evaluate(() => window.__c05Harness.concurrentLockStress(150)),
    page2.evaluate(() => window.__c05Harness.rollbackRegion('in-east-c05')),
  ]);
  assert(rollbackTab2.ok && rollbackTab2.activeVersionKey === 'in-east-c05--1.0.0--p1', 'Tab 2 rollback succeeds under shared Web Lock');
  const tab1ActiveAfterRollback = await page1.evaluate(() => window.__c05Harness.inspectActiveVersions());
  assert(tab1ActiveAfterRollback['in-east-c05'].versionKey === 'in-east-c05--1.0.0--p1', 'Tab 1 sees Tab 2 committed rollback');
  const tab1Events = await page1.evaluate(() => window.__c05Harness.getReceivedEvents());
  assert(tab1Events.some((e) => e.type === 'ROLLBACK_EXECUTED'), 'Tab 1 received BroadcastChannel rollback event');

  // Reload and verify rendered v1 map works, then re-activate v2 via reload & test live OPFS missing asset detection
  await page2.close();
  await page1.reload({ waitUntil: 'domcontentloaded' });
  await page1.waitForFunction(() => document.getElementById('c05-status')?.textContent === 'C05_HARNESS_READY');
  const renderV1PostReload = await page1.evaluate(() => window.__c05Harness.renderActiveRegionMap('in-east-c05'));
  assert(renderV1PostReload.versionKey === 'in-east-c05--1.0.0--p1' && renderV1PostReload.mapState === 'READY');

  // Corrupt committed OPFS PMTiles and verify fail-closed integrity detection
  await page1.evaluate(() => window.__c05Harness.corruptCommittedPmtiles('in-east-c05--1.0.0--p1'));
  const intPostCorrupt = await page1.evaluate(() => window.__c05Harness.verifyIntegrity('in-east-c05--1.0.0--p1'));
  assert(intPostCorrupt.ok === false, 'Deleted OPFS PMTiles asset must fail integrity verification');

  assert(blockedExternalUrls.length === 0, 'Zero external network URLs permitted');
  assert(failedLocalUrls.length === 0, 'Zero failed local asset requests');
  assert(pageErrors.length === 0, `Page errors: ${pageErrors.join('; ')}`);

  const summary = {
    passed: true,
    browserExecutable: path.basename(browserExe),
    storageNamespace: initStatus.storageNamespace,
    hasSaveDbOverlap: initStatus.hasSaveDbOverlap,
    binaryStoreMode: renderA1.binaryStoreMode,
    quotaStatus: initStatus.quota.quotaStatus,
    physicalDeviceVerified: false,
    installA1Ms: insA1.elapsedMs,
    installA2Ms: insA2.elapsedMs,
    reloadRecoveryMs: recAfterReload.elapsedMs,
    rollbackTab2Ms: rollbackTab2.elapsedMs,
    lockTab1HeldMs: lockTab1.heldMs,
    rangeReadTelemetryA1: renderA1.telemetry,
    crossRegionPortalDistanceM: portalRes.totalDistanceM,
    multiTabBroadcastEventsObserved: tab1Events.length,
    corruptedAssetDetectedCode: intPostCorrupt.reason,
    blockedExternalRequests: blockedExternalUrls.length,
    failedLocalRequests: failedLocalUrls.length,
    pageErrors: pageErrors.length,
  };
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
  server.close();
}
