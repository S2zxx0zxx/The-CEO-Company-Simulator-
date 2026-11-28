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
  <title>Railway CEO — C05 FIX-01 Region Install, OPFS/IDB & Portals QA</title>
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
    <div><b>SYNTHETIC C05 FIX-01 QA — OFFLINE STORAGE</b></div>
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

  // 1. Install Region A v1 + Region B v1
  const insA1 = await page1.evaluate(() => window.__c05Harness.installPackage('in_east_c05_v1'));
  assert(insA1.result?.ok, 'Chromium install v1 must succeed');
  const insB1 = await page1.evaluate(() => window.__c05Harness.installPackage('in_north_c05_v1'));
  assert(insB1.result?.ok, 'Chromium install Region B must succeed');

  // 2. Render A1 with version-bound immutable PMTiles identity (C05-FIX-01-C)
  const renderA1 = await page1.evaluate(() => window.__c05Harness.renderActiveRegionMap('in-east-c05'));
  assert(renderA1.mapState === 'READY', 'WebGL map must reach READY from installed storage');
  assert(renderA1.binaryStoreMode === 'opfs', `Expected real Chromium OPFS binary storage, got ${renderA1.binaryStoreMode}`);
  assert(renderA1.pmtilesArchiveId.includes('in-east-c05--v1.0.0-p1-'), 'Archive ID must bind version and tile SHA');
  assert(renderA1.telemetry.fullArchiveLoadedInMemory === false, 'Must never buffer full archive in RAM');
  assert(renderA1.telemetry.totalBytesRead < renderA1.telemetry.expectedByteLength, 'Range read bytes must stay strictly below archive size');

  // 3. Cross-region portal planning
  const portalRes = await page1.evaluate(() => window.__c05Harness.planCrossRegionPortal());
  assert(portalRes.ok && portalRes.pinnedVersions?.length === 2, 'Cross-region portal journey across Chromium IDB/OPFS must succeed');

  // 4. Crash DURING_ACTIVATION -> real page.reload() -> recoverInstallations() -> clean v1
  const crashMid = await page1.evaluate(() =>
    window.__c05Harness.installPackage('in_east_c05_v2', { injectCrashAt: 'DURING_ACTIVATION' }),
  );
  assert(crashMid.threwCrash, 'Crash injection must abort install');
  await page1.reload({ waitUntil: 'domcontentloaded' });
  await page1.waitForFunction(() => document.getElementById('c05-status')?.textContent === 'C05_HARNESS_READY');

  const recAfterReload = await page1.evaluate(() => window.__c05Harness.recoverInstallations());
  assert(recAfterReload.recovered === true && recAfterReload.resolution === 'ROLLED_BACK_INCOMPLETE_ACTIVATION');
  const recIdempotent = await page1.evaluate(() => window.__c05Harness.recoverInstallations());
  assert(recIdempotent.recovered === false && recIdempotent.resolution === 'NONE');

  // 5. C05-FIX-01-B: Durable install-only stage v2 -> page.reload() -> recoverInstallations() preserves staged -> explicit activateRetainedVersion!
  const stageV2 = await page1.evaluate(() =>
    window.__c05Harness.installPackage('in_east_c05_v2', { activateImmediately: false }),
  );
  assert(stageV2.result?.ok && stageV2.result.finalState === 'READY_FOR_ACTIVATION', 'Durable staged install must return READY_FOR_ACTIVATION');
  await page1.reload({ waitUntil: 'domcontentloaded' });
  await page1.waitForFunction(() => document.getElementById('c05-status')?.textContent === 'C05_HARNESS_READY');
  const recPreservesStaged = await page1.evaluate(() => window.__c05Harness.recoverInstallations());
  assert(recPreservesStaged.recovered === false, 'Recovery after clean restart must NOT delete READY_FOR_ACTIVATION staged package');

  const actStaged = await page1.evaluate(() => window.__c05Harness.activateRetainedVersion('in-east-c05--2.0.0--p2'));
  assert(actStaged.ok && actStaged.activeVersionKey === 'in-east-c05--2.0.0--p2', 'Explicit activation of staged v2 after reload must succeed');

  // Verify v2 renders with DISTINCT immutable PMTiles archiveId (FIX-01-C)
  const renderA2 = await page1.evaluate(() => window.__c05Harness.renderActiveRegionMap('in-east-c05'));
  assert(renderA2.mapState === 'READY' && renderA2.pmtilesArchiveId !== renderA1.pmtilesArchiveId, 'V2 PMTiles archiveId must differ from V1');

  // 6. C05-FIX-01-A: Mandatory rollback v1 protection even when unpinned
  const delRollbackBlocked = await page1.evaluate(() => window.__c05Harness.removeUnusedVersion('in-east-c05--1.0.0--p1'));
  assert(delRollbackBlocked.ok === false && delRollbackBlocked.code === 'VERSION_IS_MANDATORY_ROLLBACK', 'Must protect mandatory rollback v1');

  // 7. Multi-tab Web Locks + BroadcastChannel rollback from Tab 2
  const page2 = await context.newPage();
  page2.on('pageerror', (e) => pageErrors.push('tab2:' + String(e)));
  await page2.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page2.waitForFunction(() => document.getElementById('c05-status')?.textContent === 'C05_HARNESS_READY');

  const [lockTab1, rollbackTab2] = await Promise.all([
    page1.evaluate(() => window.__c05Harness.concurrentLockStress(150)),
    page2.evaluate(() => window.__c05Harness.rollbackRegion('in-east-c05')),
  ]);
  assert(rollbackTab2.ok && rollbackTab2.activeVersionKey === 'in-east-c05--1.0.0--p1', 'Tab 2 rollback succeeds under shared Web Lock');
  const tab1Events = await page1.evaluate(() => window.__c05Harness.getReceivedEvents());
  assert(tab1Events.some((e) => e.type === 'ROLLBACK_EXECUTED'), 'Tab 1 received BroadcastChannel rollback event');

  // 8. C05-FIX-01-D: Same-size byte corruption in OPFS -> verifyIntegrity fails AND subsequent getBytes fails closed!
  await page2.close();
  const corruptProbe = await page1.evaluate(() =>
    window.__c05Harness.probeRangeReadFailClosedAfterSameSizeCorruption('in-east-c05--1.0.0--p1'),
  );
  assert(corruptProbe.integrityOk === false, 'Integrity check must fail after same-size OPFS byte flip');
  assert(corruptProbe.getBytesBlocked === true, 'Subsequent getBytes after failed integrity MUST fail closed');

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
    stageA2Ms: stageV2.elapsedMs,
    reloadRecoveryMs: recAfterReload.elapsedMs,
    rollbackTab2Ms: rollbackTab2.elapsedMs,
    lockTab1HeldMs: lockTab1.heldMs,
    v1ArchiveId: renderA1.pmtilesArchiveId,
    v2ArchiveId: renderA2.pmtilesArchiveId,
    rangeReadTelemetryA1: renderA1.telemetry,
    crossRegionPortalDistanceM: portalRes.totalDistanceM,
    multiTabBroadcastEventsObserved: tab1Events.length,
    sameSizeCorruptionFailClosed: corruptProbe,
    blockedExternalRequests: blockedExternalUrls.length,
    failedLocalRequests: failedLocalUrls.length,
    pageErrors: pageErrors.length,
  };
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
  server.close();
}
