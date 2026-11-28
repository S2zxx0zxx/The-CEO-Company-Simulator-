import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !specifier.endsWith('.ts') && !specifier.endsWith('.js')) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const tsFile = path.resolve(parentDir, specifier + '.ts');
      if (existsSync(tsFile)) return { url: pathToFileURL(tsFile).href, shortCircuit: true };
      const tsIndex = path.resolve(parentDir, specifier, 'index.ts');
      if (existsSync(tsIndex)) return { url: pathToFileURL(tsIndex).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const {
  canonicalJsonBytes,
  decodeRegionPackageManifest,
  decodeSignedRegionPackageEnvelope,
  decodeTrustedRegionAuthority,
  encodeBytesToBase64,
  sha256Hex,
  verifySignedRegionPackageEnvelope,
} = await import(pathToFileURL(path.resolve('src/rail/regions/contracts.ts')).href);

function sha256File(filePath) {
  const bytes = readFileSync(filePath);
  return {
    bytes,
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

const outRoot = path.resolve('fixtures/c05_regions');
const summary = JSON.parse(readFileSync(path.join(outRoot, 'c05_raw_build_summary.json'), 'utf8'));

// Generate an ephemeral in-memory ECDSA P-256 test signing keypair (private key NEVER persisted!)
const keyId = 'synthetic-c05-authority-p256-v1';
const keyPair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);
const spkiBuf = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
const spkiBase64 = encodeBytesToBase64(spkiBuf);

const pinnedManifestSha256s = [];
const packageEntriesIndex = [];

for (const pkgMeta of summary.packages) {
  const pkgDir = path.join(outRoot, pkgMeta.pkgSlug);
  const regionManifestInfo = sha256File(path.join(pkgDir, 'region_manifest.json'));
  const tileManifestInfo = sha256File(path.join(pkgDir, 'tile_build_manifest.json'));
  const pmtilesInfo = sha256File(path.join(pkgDir, 'basemap.pmtiles'));
  const graphGzInfo = sha256File(path.join(pkgDir, 'graph_pack.json.gz'));
  const portalsInfo = sha256File(path.join(pkgDir, 'portals.json'));
  const attrInfo = sha256File(path.join(pkgDir, 'ATTRIBUTION.txt'));

  // Note: graph_pack.json.gz decompresses to canonical JSON bytes of length pkgMeta.graphRawBytes with sha256 pkgMeta.graphFileSha256
  const manifestInput = {
    schemaVersion: 1,
    packageId: pkgMeta.packageId,
    regionId: pkgMeta.regionId,
    version: pkgMeta.version,
    packageVersion: pkgMeta.packageVersion,
    syntheticOnly: true,
    sourceUrl: pkgMeta.sourceUrl,
    snapshotUtc: pkgMeta.snapshotUtc,
    createdAtUtc: '2026-11-28T02:00:00Z',
    license: 'ODbL-1.0',
    attribution: 'Map data (c) OpenStreetMap contributors, ODbL 1.0 (Synthetic C05 Fixture)',
    styleVersion: 'c04-rail-style-v1',
    bounds: JSON.parse(tileManifestInfo.bytes.toString('utf8')).bounds,
    graphSha256: pkgMeta.graphSha256,
    graphFileSha256: pkgMeta.graphFileSha256,
    tilesSha256: pkgMeta.pmtilesSha256,
    regionManifestSha256: regionManifestInfo.sha256,
    tileManifestSha256: tileManifestInfo.sha256,
    portalSetSha256: portalsInfo.sha256,
    totalUncompressedBytes:
      regionManifestInfo.size +
      pkgMeta.graphRawBytes +
      tileManifestInfo.size +
      pmtilesInfo.size +
      portalsInfo.size +
      attrInfo.size,
    totalCompressedBytes:
      regionManifestInfo.size +
      graphGzInfo.size +
      tileManifestInfo.size +
      pmtilesInfo.size +
      portalsInfo.size +
      attrInfo.size,
    maxSingleEntryBytes: 64 * 1024 * 1024,
    estimatedDecodePeakBytes: Math.max(pkgMeta.graphRawBytes * 2, pmtilesInfo.size + 16384),
    boundaryContract: {
      schemaVersion: 1,
      sourceStandard: 'Survey of India',
      assetAcquired: false,
      approvedForPoliticalView: false,
      layerUrl: null,
      assetSha256: null,
      license: null,
      attribution: null,
    },
    styleUrls: {
      pmtilesSourceUrl: `pmtiles://${pkgMeta.regionId}`,
      spriteUrl: './assets/sprites/railway-sprites',
      glyphsUrl: 'offlinefont://{fontstack}/{range}.pbf',
    },
    assets: [
      {
        role: 'region-manifest',
        relativePath: 'region_manifest.json',
        encoding: 'raw',
        sha256: regionManifestInfo.sha256,
        compressedSha256: regionManifestInfo.sha256,
        sizeBytes: regionManifestInfo.size,
        compressedSizeBytes: regionManifestInfo.size,
      },
      {
        role: 'graph-pack',
        relativePath: 'graph_pack.json.gz',
        encoding: 'gzip',
        sha256: pkgMeta.graphFileSha256,
        compressedSha256: graphGzInfo.sha256,
        sizeBytes: pkgMeta.graphRawBytes,
        compressedSizeBytes: graphGzInfo.size,
      },
      {
        role: 'tile-manifest',
        relativePath: 'tile_build_manifest.json',
        encoding: 'raw',
        sha256: tileManifestInfo.sha256,
        compressedSha256: tileManifestInfo.sha256,
        sizeBytes: tileManifestInfo.size,
        compressedSizeBytes: tileManifestInfo.size,
      },
      {
        role: 'pmtiles',
        relativePath: 'basemap.pmtiles',
        encoding: 'raw',
        sha256: pmtilesInfo.sha256,
        compressedSha256: pmtilesInfo.sha256,
        sizeBytes: pmtilesInfo.size,
        compressedSizeBytes: pmtilesInfo.size,
      },
      {
        role: 'portals',
        relativePath: 'portals.json',
        encoding: 'raw',
        sha256: portalsInfo.sha256,
        compressedSha256: portalsInfo.sha256,
        sizeBytes: portalsInfo.size,
        compressedSizeBytes: portalsInfo.size,
      },
      {
        role: 'attribution',
        relativePath: 'ATTRIBUTION.txt',
        encoding: 'raw',
        sha256: attrInfo.sha256,
        compressedSha256: attrInfo.sha256,
        sizeBytes: attrInfo.size,
        compressedSizeBytes: attrInfo.size,
      },
    ],
  };

  const manifest = decodeRegionPackageManifest(manifestInput);
  const payloadBytes = canonicalJsonBytes(manifest);
  const manifestSha256 = await sha256Hex(payloadBytes);
  const sigBuf = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      keyPair.privateKey,
      payloadBytes,
    ),
  );
  const envelope = decodeSignedRegionPackageEnvelope({
    schemaVersion: 1,
    manifest,
    manifestSha256,
    signatureAlgorithm: 'ECDSA-P256-SHA256',
    keyId,
    signatureBase64: encodeBytesToBase64(sigBuf),
  });

  writeFileSync(path.join(pkgDir, 'package_envelope.json'), JSON.stringify(envelope, null, 2) + '\n', 'utf8');
  pinnedManifestSha256s.push(manifestSha256);
  packageEntriesIndex.push({
    pkgSlug: pkgMeta.pkgSlug,
    packageId: pkgMeta.packageId,
    regionId: pkgMeta.regionId,
    version: pkgMeta.version,
    packageVersion: pkgMeta.packageVersion,
    manifestSha256,
    graphSha256: pkgMeta.graphSha256,
    tilesSha256: pkgMeta.pmtilesSha256,
  });
}

const trustedAuthority = decodeTrustedRegionAuthority({
  schemaVersion: 1,
  trustedKeys: [
    {
      keyId,
      algorithm: 'ECDSA-P256-SHA256',
      spkiBase64,
      active: true,
    },
  ],
  pinnedManifestSha256s,
  requireSignature: true,
  requirePinnedIndex: true,
  allowSyntheticOnly: true,
  allowRealData: false,
});

writeFileSync(
  path.join(outRoot, 'trusted_region_index.json'),
  JSON.stringify({ authority: trustedAuthority, packages: packageEntriesIndex }, null, 2) + '\n',
  'utf8',
);

// Self-verify all signed envelopes immediately
for (const item of packageEntriesIndex) {
  const env = JSON.parse(readFileSync(path.join(outRoot, item.pkgSlug, 'package_envelope.json'), 'utf8'));
  const check = await verifySignedRegionPackageEnvelope(env, trustedAuthority);
  if (!check.ok) {
    throw new Error(`Signature self-verify failed for ${item.pkgSlug}: ${check.reason}`);
  }
}

console.log(JSON.stringify({ signedPackages: packageEntriesIndex.length, authorityKeyId: keyId, allowRealData: trustedAuthority.allowRealData }, null, 2));
