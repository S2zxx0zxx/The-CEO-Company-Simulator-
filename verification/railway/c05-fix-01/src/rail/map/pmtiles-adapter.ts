import type { RegionManifest } from '../../domain/models';
import { RailGraph } from '../graph';
import { verifyGraphTileCompatibility } from '../spatial';
import { decodeC04TileManifest, type C04TileManifest } from './contracts';

export interface PMTilesSourceLike {
  getKey(): string;
  getBytes(offset: number, length: number, signal?: AbortSignal): Promise<{ readonly data: ArrayBuffer }>;
}

function isPMTilesSourceLike(value: unknown): value is PMTilesSourceLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PMTilesSourceLike).getKey === 'function' &&
    typeof (value as PMTilesSourceLike).getBytes === 'function'
  );
}

const SAFE_ARCHIVE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isValidArchiveKey(key: string): boolean {
  return typeof key === 'string' && key !== '.' && key !== '..' && SAFE_ARCHIVE_KEY_RE.test(key);
}

/** Extract safe archive identity from `pmtiles://<archiveKey>` or `pmtiles://<archiveKey>/{z}/{x}/{y}`, failing closed on external/malformed URLs. */
export function resolveOfflinePMTilesArchiveId(rawUrl: string): string | null {
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('pmtiles://') || rawUrl !== rawUrl.trim()) {
    return null;
  }
  if (/[\u0000-\u001f\u007f\\]/.test(rawUrl) || /%2f|%5c|%3a/i.test(rawUrl)) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawUrl);
    if (decodeURIComponent(decoded) !== decoded) return null;
  } catch {
    return null;
  }
  if (decoded !== rawUrl) {
    return null;
  }
  const rem = rawUrl.slice('pmtiles://'.length);
  if (!rem || rem.startsWith('/') || rem.includes('://') || rem.includes(':') || rem.includes('@') || rem.includes('?') || rem.includes('#') || rem.includes('..')) {
    return null;
  }
  const parts = rem.split('/');
  const archiveId = parts[0];
  if (!isValidArchiveKey(archiveId)) {
    return null;
  }
  if (parts.length === 1) {
    return archiveId;
  }
  if (parts.length !== 4 || !parts.slice(1).every((seg) => /^[0-9]+(\.(pbf|mvt))?$/.test(seg))) {
    return null;
  }
  return archiveId;
}

/** Validate and resolve `offlinefont://<fontstack>/<start>-<end>.pbf` without traversal or nested protocols. */
export function parseSafeOfflineFontPath(rawUrl: string): string | null {
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('offlinefont://') || rawUrl !== rawUrl.trim()) {
    return null;
  }
  if (/[\u0000-\u001f\u007f\\]/.test(rawUrl) || /%2f|%5c|%3a/i.test(rawUrl)) {
    return null;
  }
  const rem = rawUrl.slice('offlinefont://'.length);
  if (!rem || rem.startsWith('/') || rem.includes('://') || rem.includes(':') || rem.includes('@') || rem.includes('?') || rem.includes('#')) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(rem);
    if (decodeURIComponent(decoded) !== decoded) return null;
  } catch {
    return null;
  }
  if (/[\u0000-\u001f\u007f\\]/.test(decoded) || decoded.includes('://') || decoded.includes(':') || decoded.includes('@') || decoded.includes('..') || decoded.includes('//')) {
    return null;
  }
  if (!/^[A-Za-z0-9 ._,-]+\/[0-9]+-[0-9]+\.pbf$/.test(decoded)) {
    return null;
  }
  return decoded;
}

/** In-memory offline PMTiles byte source supporting zero-network ArrayBuffer/Uint8Array tiles. */
export class MemoryPMTilesSource implements PMTilesSourceLike {
  readonly #key: string;
  readonly #bytes: Uint8Array;

  constructor(key: string, data: Uint8Array | ArrayBuffer) {
    if (!isValidArchiveKey(key)) {
      throw new TypeError(`Invalid offline PMTiles archive key: ${key}`);
    }
    this.#key = key;
    this.#bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  }

  getKey(): string {
    return this.#key;
  }

  async getBytes(offset: number, length: number): Promise<{ readonly data: ArrayBuffer }> {
    const end = Math.min(this.#bytes.byteLength, Math.max(0, offset + length));
    const start = Math.min(end, Math.max(0, offset));
    const slice = this.#bytes.subarray(start, end);
    return {
      data: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) as ArrayBuffer,
    };
  }
}

export type BundleConsistencyResult =
  | Readonly<{
      ok: true;
      regionId: string;
      graphSha256: string;
      pmtilesSha256: string;
      styleVersion: string;
    }>
  | Readonly<{
      ok: false;
      reason: string;
    }>;

/**
 * Strictly enforce graph, RegionManifest, TileBuildManifest, style version, and expected SHA-256 identity parity.
 * Rejects mismatched versions or placeholder zero-SHA tile digests fail closed.
 */
export function verifyGraphTilesBundleMatch(
  graph: RailGraph,
  regionManifestInput: unknown,
  tileManifestInput: unknown,
  expectedStyleVersion: string,
  options: {
    readonly expectedGraphSha256?: string;
    readonly expectedPmtilesSha256?: string;
  } = {},
): BundleConsistencyResult {
  if (!(graph instanceof RailGraph)) {
    return Object.freeze({ ok: false as const, reason: 'INVALID_GRAPH' });
  }
  let tileManifest: C04TileManifest;
  try {
    tileManifest = decodeC04TileManifest(tileManifestInput);
  } catch {
    return Object.freeze({ ok: false as const, reason: 'INVALID_TILE_MANIFEST' });
  }

  const baseCheck = verifyGraphTileCompatibility(graph, regionManifestInput, {
    requireBuiltTiles: true,
    expectedTilesSha256: tileManifest.pmtilesSha256,
  });
  if (!baseCheck.ok) {
    return baseCheck;
  }

  if (tileManifest.regionId !== graph.regionId) {
    return Object.freeze({ ok: false as const, reason: 'TILE_MANIFEST_REGION_MISMATCH' });
  }
  if (tileManifest.graphSha256 !== graph.graphSha256) {
    return Object.freeze({ ok: false as const, reason: 'TILE_MANIFEST_GRAPH_HASH_MISMATCH' });
  }
  if (tileManifest.styleVersion !== expectedStyleVersion) {
    return Object.freeze({ ok: false as const, reason: 'STYLE_VERSION_MISMATCH' });
  }
  if (options.expectedGraphSha256 && graph.graphSha256 !== options.expectedGraphSha256) {
    return Object.freeze({ ok: false as const, reason: 'EXPECTED_GRAPH_HASH_MISMATCH' });
  }
  if (options.expectedPmtilesSha256 && tileManifest.pmtilesSha256 !== options.expectedPmtilesSha256) {
    return Object.freeze({ ok: false as const, reason: 'EXPECTED_PMTILES_HASH_MISMATCH' });
  }

  return Object.freeze({
    ok: true as const,
    regionId: graph.regionId,
    graphSha256: graph.graphSha256,
    pmtilesSha256: tileManifest.pmtilesSha256,
    styleVersion: tileManifest.styleVersion,
  });
}

export interface OfflineProtocolRegistrar {
  readonly pmtilesProtocol: { add(archive: unknown): void; tile(params: unknown): Promise<unknown> };
  readonly registeredArchiveIds: ReadonlySet<string>;
  loadPMTilesTile(params: { url: string }, abortController: AbortController): Promise<{ data: unknown }>;
  loadOfflineFont(params: { url: string }): Promise<{ data: ArrayBuffer }>;
  dispose(): void;
}

export interface OfflineFontMap {
  /** Key `${fontstack}/${start}-${end}.pbf` -> gzipped/raw protobuf Uint8Array */
  readonly ranges: ReadonlyMap<string, Uint8Array>;
  readonly fallbackEmptyRange: Uint8Array;
}

/**
 * Register offline pmtiles:// (pinned pmtiles@4.5.0 Protocol) and offlinefont:// custom protocols
 * with MapLibre GL JS, enforcing strict archive identity lookup so unregistered or external
 * PMTiles URLs fail closed before pmtiles Protocol can fall back to network FetchSource.
 */
export function registerOfflineProtocols(
  maplibregl: {
    addProtocol(name: string, loadFn: (params: { url: string }, abortController: AbortController) => Promise<{ data: unknown }>): void;
    removeProtocol(name: string): void;
  },
  ProtocolCtor: new (options?: { metadata?: boolean }) => { add(a: unknown): void; tile: (p: { url: string }, c: AbortController) => Promise<{ data: unknown }> },
  PMTilesCtor: new (src: PMTilesSourceLike) => unknown,
  archives: ReadonlyMap<string, Uint8Array | ArrayBuffer | PMTilesSourceLike>,
  offlineFonts?: OfflineFontMap,
): OfflineProtocolRegistrar {
  const protocol = new ProtocolCtor({ metadata: true });
  const registeredKeys = new Set<string>();
  for (const [key, bufOrSource] of archives.entries()) {
    const src = isPMTilesSourceLike(bufOrSource) ? bufOrSource : new MemoryPMTilesSource(key, bufOrSource);
    if (!isValidArchiveKey(src.getKey()) || src.getKey() !== key) {
      throw new TypeError(`Offline PMTiles archive key mismatch: map=${key} source=${src.getKey()}`);
    }
    const archive = new PMTilesCtor(src);
    protocol.add(archive);
    registeredKeys.add(src.getKey());
  }
  const readonlyKeys: ReadonlySet<string> = registeredKeys;

  const loadPMTilesTile = async (params: { url: string }, abortController: AbortController): Promise<{ data: unknown }> => {
    const archiveId = resolveOfflinePMTilesArchiveId(params?.url ?? '');
    if (!archiveId) {
      throw new Error(`FORBIDDEN_PMTILES_URL: ${String(params?.url)}`);
    }
    if (!readonlyKeys.has(archiveId)) {
      throw new Error(`UNREGISTERED_PMTILES_ARCHIVE: ${archiveId}`);
    }
    return protocol.tile(params, abortController);
  };

  const loadOfflineFont = async (params: { url: string }): Promise<{ data: ArrayBuffer }> => {
    if (!offlineFonts) {
      throw new Error('OFFLINE_FONTS_NOT_CONFIGURED');
    }
    const stripped = parseSafeOfflineFontPath(params?.url ?? '');
    if (!stripped) {
      throw new Error(`FORBIDDEN_OFFLINE_FONT_URL: ${String(params?.url)}`);
    }
    const exact = offlineFonts.ranges.get(stripped) ?? offlineFonts.fallbackEmptyRange;
    const copy = exact.buffer.slice(exact.byteOffset, exact.byteOffset + exact.byteLength) as ArrayBuffer;
    return { data: copy };
  };

  maplibregl.addProtocol('pmtiles', loadPMTilesTile);

  if (offlineFonts) {
    maplibregl.addProtocol('offlinefont', async (params) => loadOfflineFont(params));
  }

  return {
    pmtilesProtocol: protocol,
    registeredArchiveIds: readonlyKeys,
    loadPMTilesTile,
    loadOfflineFont,
    dispose() {
      maplibregl.removeProtocol('pmtiles');
      if (offlineFonts) maplibregl.removeProtocol('offlinefont');
    },
  };
}

export type RegionManifestTyped = RegionManifest;
