import type { RegionManifest } from '../../domain/models';
import { RailGraph } from '../graph';
import { verifyGraphTileCompatibility } from '../spatial';
import { decodeC04TileManifest, type C04TileManifest } from './contracts';

export interface PMTilesSourceLike {
  getKey(): string;
  getBytes(offset: number, length: number): Promise<{ readonly data: ArrayBuffer }>;
}

/** In-memory offline PMTiles byte source supporting zero-network ArrayBuffer/Uint8Array tiles. */
export class MemoryPMTilesSource implements PMTilesSourceLike {
  readonly #key: string;
  readonly #bytes: Uint8Array;

  constructor(key: string, data: Uint8Array | ArrayBuffer) {
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
  dispose(): void;
}

export interface OfflineFontMap {
  /** Key `${fontstack}/${start}-${end}.pbf` -> gzipped/raw protobuf Uint8Array */
  readonly ranges: ReadonlyMap<string, Uint8Array>;
  readonly fallbackEmptyRange: Uint8Array;
}

/**
 * Register offline pmtiles:// (pinned pmtiles@4.5.0 Protocol) and offlinefont:// custom protocols
 * with MapLibre GL JS without modifying any global network state.
 */
export function registerOfflineProtocols(
  maplibregl: {
    addProtocol(name: string, loadFn: (params: { url: string }, abortController: AbortController) => Promise<{ data: unknown }>): void;
    removeProtocol(name: string): void;
  },
  ProtocolCtor: new (options?: { metadata?: boolean }) => { add(a: unknown): void; tile: (p: { url: string }, c: AbortController) => Promise<{ data: unknown }> },
  PMTilesCtor: new (src: PMTilesSourceLike) => unknown,
  archives: ReadonlyMap<string, Uint8Array | ArrayBuffer>,
  offlineFonts?: OfflineFontMap,
): OfflineProtocolRegistrar {
  const protocol = new ProtocolCtor({ metadata: true });
  for (const [key, buf] of archives.entries()) {
    const archive = new PMTilesCtor(new MemoryPMTilesSource(key, buf));
    protocol.add(archive);
  }
  maplibregl.addProtocol('pmtiles', (params, abortController) => protocol.tile(params, abortController));

  if (offlineFonts) {
    maplibregl.addProtocol('offlinefont', async (params) => {
      // offlinefont://Inter%20Regular/0-255.pbf
      const stripped = decodeURIComponent(params.url.replace(/^offlinefont:\/\//, ''));
      const exact = offlineFonts.ranges.get(stripped) ?? offlineFonts.fallbackEmptyRange;
      const copy = exact.buffer.slice(exact.byteOffset, exact.byteOffset + exact.byteLength);
      return { data: copy };
    });
  }

  return {
    pmtilesProtocol: protocol,
    dispose() {
      maplibregl.removeProtocol('pmtiles');
      if (offlineFonts) maplibregl.removeProtocol('offlinefont');
    },
  };
}

export type RegionManifestTyped = RegionManifest;
