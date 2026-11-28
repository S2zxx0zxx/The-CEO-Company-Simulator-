import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgRoot = process.env.C04_RENDERER_PKG || path.join(__dirname, 'c04_renderer_pkg');

const { chromium } = await import(pathToFileURL(path.join(pkgRoot, 'node_modules/playwright/index.mjs')).href);
const { PbfWriter } = await import(pathToFileURL(path.join(pkgRoot, 'node_modules/pbf/index.js')).href);
const { default: TinySDF } = await import(pathToFileURL(path.join(pkgRoot, 'node_modules/@mapbox/tiny-sdf/index.js')).href);

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
    process.env.CHROME_EXE,
    process.env.RAILWAY_BROWSER_EXE,
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

function sha256Buf(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function encodeGlyphsPbf(fontName, rangeStr, glyphs) {
  const writer = new PbfWriter();
  writer.writeMessage(
    1,
    (fsObj, pbf) => {
      pbf.writeStringField(1, fsObj.name);
      pbf.writeStringField(2, fsObj.range);
      for (const g of fsObj.glyphs) {
        pbf.writeMessage(
          3,
          (gl, gpbf) => {
            gpbf.writeVarintField(1, gl.id);
            if (gl.width > 0 && gl.height > 0 && gl.bitmap.length > 0) {
              gpbf.writeBytesField(2, gl.bitmap);
            }
            gpbf.writeVarintField(3, gl.width);
            gpbf.writeVarintField(4, gl.height);
            gpbf.writeSVarintField(5, gl.left);
            gpbf.writeSVarintField(6, gl.top);
            gpbf.writeVarintField(7, gl.advance);
          },
          g,
        );
      }
    },
    { name: fontName, range: rangeStr, glyphs },
  );
  return Buffer.from(writer.finish());
}

const outRoot = path.join(__dirname, 'assets');
const spritesDir = path.join(outRoot, 'sprites');
const fontsDir = path.join(outRoot, 'fonts');
mkdirSync(spritesDir, { recursive: true });
mkdirSync(path.join(fontsDir, 'Inter Regular'), { recursive: true });
mkdirSync(path.join(fontsDir, 'Inter SemiBold'), { recursive: true });
mkdirSync(path.join(fontsDir, '_empty'), { recursive: true });

const interDir = path.join(pkgRoot, 'node_modules/@fontsource/inter');
const woffRegular = readFileSync(path.join(interDir, 'files/inter-latin-400-normal.woff2'));
const woffSemiBold = readFileSync(path.join(interDir, 'files/inter-latin-600-normal.woff2'));

const exe = findBrowserExe();
if (!exe) throw new Error('No Chromium/Edge binary available for offline asset generation.');

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});

const tinySdfSource = readFileSync(path.join(pkgRoot, 'node_modules/@mapbox/tiny-sdf/index.js'), 'utf8');

let regularGlyphs = [];
let semiBoldGlyphs = [];
let sprites1x = null;
let sprites2x = null;

try {
  const page = await browser.newPage();
  const dataUrlReg = 'data:font/woff2;base64,' + woffRegular.toString('base64');
  const dataUrlSemi = 'data:font/woff2;base64,' + woffSemiBold.toString('base64');

  // Inject @font-face (100% self-contained in memory, zero HTTP)
  await page.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: 'InterReg'; src: url('${dataUrlReg}') format('woff2'); font-weight: 400; }
    @font-face { font-family: 'InterSemi'; src: url('${dataUrlSemi}') format('woff2'); font-weight: 600; }
  </style></head><body></body></html>`);
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Trigger rasterization warmup
    await document.fonts.load('24px InterReg');
    await document.fonts.load('600 24px InterSemi');
  });

  // Load TinySDF as inline script module in page
  await page.addScriptTag({
    type: 'module',
    content: tinySdfSource.replace('export default class TinySDF', 'window.TinySDF = class TinySDF'),
  });

  const codePoints = [];
  for (let cp = 32; cp <= 126; cp++) codePoints.push(cp);
  for (let cp = 160; cp <= 255; cp++) codePoints.push(cp);

  const fontData = await page.evaluate((cps) => {
    function buildSet(fontFamily, fontWeight) {
      const sdf = new window.TinySDF({ fontSize: 24, buffer: 3, radius: 8, cutoff: 0.25, fontFamily, fontWeight });
      return cps.map((cp) => {
        const g = sdf.draw(String.fromCodePoint(cp));
        return {
          id: cp,
          width: g.glyphWidth,
          height: g.glyphHeight,
          left: g.glyphLeft,
          top: g.glyphTop,
          advance: Math.max(0, Math.round(g.glyphAdvance)),
          bitmap: Array.from(g.data),
        };
      });
    }
    return {
      reg: buildSet("'InterReg', sans-serif", '400'),
      semi: buildSet("'InterSemi', sans-serif", '600'),
    };
  }, codePoints);

  regularGlyphs = fontData.reg.map((g) => ({ ...g, bitmap: Uint8Array.from(g.bitmap) }));
  semiBoldGlyphs = fontData.semi.map((g) => ({ ...g, bitmap: Uint8Array.from(g.bitmap) }));

  // Render original procedural geometric vector sprites at 1x and 2x pixel ratios
  const renderSprites = async (pixelRatio) => {
    return page.evaluate((pr) => {
      const icons = ['station-major', 'station-halt', 'station-selected', 'yard-depot', 'train-loco', 'train-selected', 'direction-arrow', 'junction-node'];
      const cell = 32 * pr;
      const canvas = document.createElement('canvas');
      canvas.width = icons.length * cell;
      canvas.height = cell;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const layout = {};
      icons.forEach((name, idx) => {
        const x0 = idx * cell;
        const cx = x0 + cell / 2;
        const cy = cell / 2;
        ctx.save();
        if (name === 'station-major') {
          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          ctx.arc(cx, cy, 10 * pr, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.5 * pr;
          ctx.stroke();
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.arc(cx, cy, 4 * pr, 0, Math.PI * 2);
          ctx.fill();
        } else if (name === 'station-halt') {
          ctx.fillStyle = '#334155';
          ctx.beginPath();
          ctx.arc(cx, cy, 6.5 * pr, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#f8fafc';
          ctx.lineWidth = 2 * pr;
          ctx.stroke();
        } else if (name === 'station-selected') {
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.arc(cx, cy, 13 * pr, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 2.5 * pr;
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(cx, cy, 5 * pr, 0, Math.PI * 2);
          ctx.fill();
        } else if (name === 'yard-depot') {
          ctx.fillStyle = '#1e293b';
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 2.2 * pr;
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const ang = (i * Math.PI) / 3 - Math.PI / 6;
            const px = cx + Math.cos(ang) * 11 * pr;
            const py = cy + Math.sin(ang) * 11 * pr;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (name === 'train-loco') {
          // Pointing North (0 deg heading)
          ctx.fillStyle = '#0284c7';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2 * pr;
          ctx.beginPath();
          ctx.moveTo(cx, cy - 12 * pr);
          ctx.lineTo(cx + 8 * pr, cy + 9 * pr);
          ctx.lineTo(cx, cy + 4 * pr);
          ctx.lineTo(cx - 8 * pr, cy + 9 * pr);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (name === 'train-selected') {
          ctx.fillStyle = '#10b981';
          ctx.strokeStyle = '#fef08a';
          ctx.lineWidth = 2.8 * pr;
          ctx.beginPath();
          ctx.moveTo(cx, cy - 13 * pr);
          ctx.lineTo(cx + 9.5 * pr, cy + 10 * pr);
          ctx.lineTo(cx, cy + 5 * pr);
          ctx.lineTo(cx - 9.5 * pr, cy + 10 * pr);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (name === 'direction-arrow') {
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2.5 * pr;
          ctx.beginPath();
          ctx.moveTo(cx - 5 * pr, cy + 5 * pr);
          ctx.lineTo(cx, cy - 6 * pr);
          ctx.lineTo(cx + 5 * pr, cy + 5 * pr);
          ctx.stroke();
        } else if (name === 'junction-node') {
          ctx.fillStyle = '#a855f7';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.8 * pr;
          ctx.beginPath();
          ctx.moveTo(cx, cy - 7 * pr);
          ctx.lineTo(cx + 7 * pr, cy);
          ctx.lineTo(cx, cy + 7 * pr);
          ctx.lineTo(cx - 7 * pr, cy);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
        layout[name] = { x: x0, y: 0, width: cell, height: cell, pixelRatio: pr };
      });

      return {
        pngBase64: canvas.toDataURL('image/png').split(',')[1],
        layout,
      };
    }, pixelRatio);
  };

  sprites1x = await renderSprites(1);
  sprites2x = await renderSprites(2);
} finally {
  await browser.close();
}

const regPbf = encodeGlyphsPbf('Inter Regular', '0-255', regularGlyphs);
const semiPbf = encodeGlyphsPbf('Inter SemiBold', '0-255', semiBoldGlyphs);
const emptyPbf = encodeGlyphsPbf('Fallback Empty', '0-255', []);

const pReg = path.join(fontsDir, 'Inter Regular/0-255.pbf');
const pSemi = path.join(fontsDir, 'Inter SemiBold/0-255.pbf');
const pEmpty = path.join(fontsDir, '_empty/0-255.pbf');
writeFileSync(pReg, regPbf);
writeFileSync(pSemi, semiPbf);
writeFileSync(pEmpty, emptyPbf);

const pSp1Png = path.join(spritesDir, 'railway-sprites.png');
const pSp1Json = path.join(spritesDir, 'railway-sprites.json');
const pSp2Png = path.join(spritesDir, 'railway-sprites@2x.png');
const pSp2Json = path.join(spritesDir, 'railway-sprites@2x.json');

const sp1Buf = Buffer.from(sprites1x.pngBase64, 'base64');
const sp1JsonBuf = Buffer.from(JSON.stringify(sprites1x.layout, null, 2) + '\n', 'utf8');
const sp2Buf = Buffer.from(sprites2x.pngBase64, 'base64');
const sp2JsonBuf = Buffer.from(JSON.stringify(sprites2x.layout, null, 2) + '\n', 'utf8');

writeFileSync(pSp1Png, sp1Buf);
writeFileSync(pSp1Json, sp1JsonBuf);
writeFileSync(pSp2Png, sp2Buf);
writeFileSync(pSp2Json, sp2JsonBuf);

const assetManifest = {
  schemaVersion: 1,
  stage: 'C04_OFFLINE_RENDERER_ASSETS',
  generatedAtUtc: new Date().toISOString(),
  externalCdnRequired: false,
  fonts: [
    {
      fontstack: 'Inter Regular',
      sourcePackage: '@fontsource/inter@5.1.1',
      license: 'OFL-1.1',
      redistributable: true,
      file: 'assets/fonts/Inter Regular/0-255.pbf',
      bytes: regPbf.length,
      sha256: sha256Buf(regPbf),
      glyphCount: regularGlyphs.length,
    },
    {
      fontstack: 'Inter SemiBold',
      sourcePackage: '@fontsource/inter@5.1.1',
      license: 'OFL-1.1',
      redistributable: true,
      file: 'assets/fonts/Inter SemiBold/0-255.pbf',
      bytes: semiPbf.length,
      sha256: sha256Buf(semiPbf),
      glyphCount: semiBoldGlyphs.length,
    },
    {
      fontstack: '_empty',
      sourcePackage: 'original-empty-protobuf-fallback',
      license: 'Apache-2.0',
      redistributable: true,
      file: 'assets/fonts/_empty/0-255.pbf',
      bytes: emptyPbf.length,
      sha256: sha256Buf(emptyPbf),
      glyphCount: 0,
    },
  ],
  sprites: [
    {
      file: 'assets/sprites/railway-sprites.png',
      origin: 'Original Railway CEO Canvas 2D vector synthesis',
      license: 'Original Project Asset',
      redistributable: true,
      bytes: sp1Buf.length,
      sha256: sha256Buf(sp1Buf),
    },
    {
      file: 'assets/sprites/railway-sprites.json',
      origin: 'Original Railway CEO sprite atlas index',
      license: 'Original Project Asset',
      redistributable: true,
      bytes: sp1JsonBuf.length,
      sha256: sha256Buf(sp1JsonBuf),
    },
    {
      file: 'assets/sprites/railway-sprites@2x.png',
      origin: 'Original Railway CEO Canvas 2D vector synthesis (2x)',
      license: 'Original Project Asset',
      redistributable: true,
      bytes: sp2Buf.length,
      sha256: sha256Buf(sp2Buf),
    },
    {
      file: 'assets/sprites/railway-sprites@2x.json',
      origin: 'Original Railway CEO sprite atlas index (2x)',
      license: 'Original Project Asset',
      redistributable: true,
      bytes: sp2JsonBuf.length,
      sha256: sha256Buf(sp2JsonBuf),
    },
  ],
};

writeFileSync(path.join(__dirname, 'C04_ASSET_LICENSE_MANIFEST.json'), JSON.stringify(assetManifest, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(assetManifest, null, 2));
