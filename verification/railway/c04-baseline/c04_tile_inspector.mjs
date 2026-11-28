import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const pkgRoot = process.env.C04_RENDERER_PKG || path.resolve('c04_renderer_pkg');
const { PMTiles } = await import(pathToFileURL(path.join(pkgRoot, 'node_modules/pmtiles/dist/esm/index.js')).href);
const { VectorTile } = await import(pathToFileURL(path.join(pkgRoot, 'node_modules/@mapbox/vector-tile/index.js')).href);
const { PbfReader } = await import(pathToFileURL(path.join(pkgRoot, 'node_modules/pbf/index.js')).href);

export class LocalFilePMTilesSource {
  constructor(buf) {
    this.buf = buf;
  }
  getKey() {
    return 'local-synthetic-pmtiles';
  }
  async getBytes(offset, length) {
    const slice = this.buf.subarray(offset, offset + length);
    return { data: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) };
  }
}

export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return [x, y];
}

export async function inspectPMTilesFile(pmtilesPath) {
  const buf = readFileSync(pmtilesPath);
  const src = new LocalFilePMTilesSource(buf);
  const archive = new PMTiles(src);
  const header = await archive.getHeader();
  const metadata = await archive.getMetadata();

  const vectorLayerIds = (metadata.vector_layers || []).map((l) => l.id).sort();
  if (vectorLayerIds.includes('boundary')) {
    throw new Error('COMPLIANCE_VIOLATION: boundary layer present in PMTiles metadata');
  }

  const sampleCenter = [86.08, 22.06];
  const decodedZooms = {};
  for (const z of [6, 9, 12, 14]) {
    const [tx, ty] = lonLatToTile(sampleCenter[0], sampleCenter[1], z);
    const resp = await archive.getZxy(z, tx, ty);
    if (!resp) {
      decodedZooms[`z${z}`] = { z, x: tx, y: ty, empty: true, layers: {} };
      continue;
    }
    let tileBytes = new Uint8Array(resp.data);
    if (tileBytes.length >= 2 && tileBytes[0] === 0x1f && tileBytes[1] === 0x8b) {
      tileBytes = new Uint8Array(gunzipSync(tileBytes));
    }
    const vt = new VectorTile(new PbfReader(tileBytes));
    const layerCounts = {};
    for (const [lname, layer] of Object.entries(vt.layers)) {
      if (lname.includes('boundary')) {
        throw new Error(`COMPLIANCE_VIOLATION: decoded boundary layer ${lname} at z=${z}`);
      }
      layerCounts[lname] = layer.length;
    }
    decodedZooms[`z${z}`] = {
      z,
      x: tx,
      y: ty,
      rawCompressedBytes: resp.data.byteLength,
      decompressedBytes: tileBytes.length,
      layers: layerCounts,
    };
  }

  const oob = await archive.getZxy(14, 0, 0);

  return {
    ok: true,
    tileCompression: header.tileCompression,
    tileType: header.tileType,
    minZoom: header.minZoom,
    maxZoom: header.maxZoom,
    addressedTilesCount: header.addressedTilesCount,
    tileEntriesCount: header.tileEntriesCount,
    tileContentsCount: header.tileContentsCount,
    vectorLayerIds,
    attribution: metadata.attribution || null,
    outOfBoundsEmpty: oob === undefined,
    decodedZooms,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const target = process.argv[2] || path.resolve('fixtures/c04_synthetic_basemap.pmtiles');
  console.log(JSON.stringify(await inspectPMTilesFile(target), null, 2));
}
