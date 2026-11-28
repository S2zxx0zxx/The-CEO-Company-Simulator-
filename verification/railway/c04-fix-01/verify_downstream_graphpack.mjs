import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Register minimal TS extension resolver for Node 22+/24 native TS stripping
registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !specifier.endsWith('.ts') && !specifier.endsWith('.js')) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const tsFile = path.resolve(parentDir, specifier + '.ts');
      if (existsSync(tsFile)) {
        return { url: pathToFileURL(tsFile).href, shortCircuit: true };
      }
      const tsIndex = path.resolve(parentDir, specifier, 'index.ts');
      if (existsSync(tsIndex)) {
        return { url: pathToFileURL(tsIndex).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});

function hasRepoSources(dir) {
  return existsSync(path.join(dir, 'src', 'domain', 'models.ts'))
    && existsSync(path.join(dir, 'src', 'rail', 'graph', 'index.ts'))
    && existsSync(path.join(dir, 'src', 'rail', 'compatibility', 'index.ts'));
}

function resolveRepoRoot(explicitArg) {
  const candidates = [];
  if (explicitArg) candidates.push(path.resolve(explicitArg));
  if (process.env.RAILWAY_REPO_ROOT) candidates.push(path.resolve(process.env.RAILWAY_REPO_ROOT));
  let cur = process.cwd();
  for (let i = 0; i < 6; i++) {
    candidates.push(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  candidates.push(path.resolve(__dirname, 'upstream_docs', 'af7ab9fa'));
  candidates.push(__dirname);
  for (const cand of candidates) {
    if (hasRepoSources(cand)) return cand;
  }
  throw new Error('Could not locate repository root containing src/domain/models.ts. Pass [repoRoot] arg or set RAILWAY_REPO_ROOT.');
}

const inputPath = process.argv[2];
if (!inputPath) {
  throw new Error('Usage: node --experimental-strip-types verify_downstream_graphpack.mjs <bundle.json> [repoRoot]');
}
const repoRoot = resolveRepoRoot(process.argv[3]);
const { decodeGraphPack, decodeRegionManifest } = await import(pathToFileURL(path.join(repoRoot, 'src', 'domain', 'models.ts')).href);
const { RailGraph } = await import(pathToFileURL(path.join(repoRoot, 'src', 'rail', 'graph', 'index.ts')).href);
const { RailCompatibility } = await import(pathToFileURL(path.join(repoRoot, 'src', 'rail', 'compatibility', 'index.ts')).href);
const bundle = JSON.parse(readFileSync(inputPath, 'utf8'));

const pack = decodeGraphPack(bundle.graphPack);
const manifest = decodeRegionManifest(bundle.regionManifest);
const graph = new RailGraph(pack);
const components = graph.weakComponents();

// Verify pathLength on first edge and RailCompatibility fail-closed behavior on unknown access/speed
const firstEdge = graph.snapshot().edges[0];
const pathLenM = graph.pathLength([firstEdge.id]);

const compat = new RailCompatibility(
  graph,
  {
    id: 'profile:bg-electric',
    traction: 'electric',
    gaugesMm: [1676],
    voltagesV: [25000],
    frequenciesHz: [50],
    maxSpeedKmh: 130,
    rangeM: 500000,
    massKg: 120000,
  },
  {
    schemaVersion: 1,
    mode: 'Realism',
    allowReversal: true,
    inferences: [],
    modeChanges: [],
  },
);
const compatCheck = compat.evaluateEdge({
  edgeId: firstEdge.id,
  from: firstEdge.from,
  to: firstEdge.to,
  operating: { mode: 'electric', gaugeMm: 1676, voltageV: 25000, frequencyHz: 50 },
});

console.log(JSON.stringify({
  ok: true,
  regionId: graph.regionId,
  graphSha256: graph.graphSha256,
  manifestRegionId: manifest.id,
  nodeCount: graph.nodeCount,
  edgeCount: graph.edgeCount,
  stationCount: graph.stationCount,
  weakComponentCount: components.length,
  firstEdgeId: firstEdge.id,
  firstEdgePathLengthM: pathLenM,
  realismCompatCheck: compatCheck,
}, null, 2));
