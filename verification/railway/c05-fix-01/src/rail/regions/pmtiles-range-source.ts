import { isValidArchiveKey, type PMTilesSourceLike } from '../map/pmtiles-adapter';
import { PMTILES_INTEGRITY_BLOCK_BYTES, sha256Hex } from './contracts';
import type { RegionStorageBackend } from './storage';

export class CorruptedArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorruptedArchiveError';
  }
}

export interface RangeSourceTelemetry {
  readonly versionKey: string;
  readonly archiveId: string;
  readonly committedKey: string;
  readonly expectedByteLength: number;
  readonly expectedSha256: string;
  readonly blockSizeBytes: number;
  readonly blockCount: number;
  readonly verifiedBlocksRead: number;
  readonly rangeReadCount: number;
  readonly totalBytesRead: number;
  readonly maxSingleReadBytes: number;
  readonly fullArchiveLoadedInMemory: boolean;
  readonly corrupted: boolean;
  readonly corruptionReason: string | null;
}

/**
 * Bounded PMTiles v3 Source backed by durable local RegionStorageBackend range reads.
 *
 * Integrity Guarantees (C05-FIX-01-D):
 * 1. Never loads the full PMTiles archive into heap RAM on getBytes().
 * 2. Verifies touched 16 KiB aligned storage blocks against immutable install-time SHA-256 block
 *    digests before returning a single slice byte (detecting same-size byte corruption immediately).
 * 3. Permanently invalidates itself (and triggers persistent registry corruption callback) once
 *    either verifyIntegrity() or getBytes() fails, so ALL subsequent reads fail closed.
 * 4. Optional external invalidation predicate allows cross-instance/persisted corruption checks.
 */
export class VerifiedInstalledPMTilesSource implements PMTilesSourceLike {
  readonly #versionKey: string;
  readonly #archiveId: string;
  readonly #backend: RegionStorageBackend;
  readonly #committedKey: string;
  readonly #expectedByteLength: number;
  readonly #expectedSha256: string;
  readonly #blockSizeBytes: number;
  readonly #blockSha256s: readonly string[];
  readonly #maxSingleRangeBytes: number;
  readonly #onCorruptionDetected?: (reason: string) => Promise<void> | void;
  readonly #isExternallyInvalidated?: () => Promise<string | null> | string | null;
  #rangeReadCount = 0;
  #totalBytesRead = 0;
  #maxSingleReadBytes = 0;
  #verifiedBlocksRead = 0;
  #corrupted = false;
  #corruptionReason: string | null = null;

  constructor(options: {
    versionKey: string;
    archiveId: string;
    backend: RegionStorageBackend;
    committedKey: string;
    expectedByteLength: number;
    expectedSha256: string;
    blockSizeBytes?: number;
    blockSha256s: readonly string[];
    maxSingleRangeBytes?: number;
    initialCorrupted?: boolean;
    initialCorruptionReason?: string | null;
    onCorruptionDetected?: (reason: string) => Promise<void> | void;
    isExternallyInvalidated?: () => Promise<string | null> | string | null;
  }) {
    if (!isValidArchiveKey(options.archiveId)) {
      throw new TypeError(`Invalid offline PMTiles archiveId: ${options.archiveId}`);
    }
    if (!Number.isSafeInteger(options.expectedByteLength) || options.expectedByteLength <= 0) {
      throw new TypeError(`Invalid expectedByteLength for ${options.archiveId}`);
    }
    if (!/^[a-f0-9]{64}$/.test(options.expectedSha256)) {
      throw new TypeError(`Invalid expectedSha256 for ${options.archiveId}`);
    }
    const blockSize = options.blockSizeBytes ?? PMTILES_INTEGRITY_BLOCK_BYTES;
    const expectedBlocks = Math.ceil(options.expectedByteLength / blockSize);
    if (!Array.isArray(options.blockSha256s) || options.blockSha256s.length !== expectedBlocks) {
      throw new TypeError(`Invalid blockSha256s length: expected=${expectedBlocks}, got=${options.blockSha256s?.length}`);
    }
    this.#versionKey = options.versionKey;
    this.#archiveId = options.archiveId;
    this.#backend = options.backend;
    this.#committedKey = options.committedKey;
    this.#expectedByteLength = options.expectedByteLength;
    this.#expectedSha256 = options.expectedSha256;
    this.#blockSizeBytes = blockSize;
    this.#blockSha256s = [...options.blockSha256s];
    this.#maxSingleRangeBytes = options.maxSingleRangeBytes ?? 16 * 1024 * 1024;
    this.#corrupted = Boolean(options.initialCorrupted);
    this.#corruptionReason = options.initialCorruptionReason ?? null;
    this.#onCorruptionDetected = options.onCorruptionDetected;
    this.#isExternallyInvalidated = options.isExternallyInvalidated;
  }

  getKey(): string {
    return this.#archiveId;
  }

  getTelemetry(): RangeSourceTelemetry {
    return {
      versionKey: this.#versionKey,
      archiveId: this.#archiveId,
      committedKey: this.#committedKey,
      expectedByteLength: this.#expectedByteLength,
      expectedSha256: this.#expectedSha256,
      blockSizeBytes: this.#blockSizeBytes,
      blockCount: this.#blockSha256s.length,
      verifiedBlocksRead: this.#verifiedBlocksRead,
      rangeReadCount: this.#rangeReadCount,
      totalBytesRead: this.#totalBytesRead,
      maxSingleReadBytes: this.#maxSingleReadBytes,
      fullArchiveLoadedInMemory: false,
      corrupted: this.#corrupted,
      corruptionReason: this.#corruptionReason,
    };
  }

  async #markCorrupted(reason: string): Promise<void> {
    this.#corrupted = true;
    this.#corruptionReason = this.#corruptionReason ?? reason;
    await this.#onCorruptionDetected?.(reason);
  }

  async #assertNotInvalidated(): Promise<void> {
    if (this.#corrupted) {
      throw new CorruptedArchiveError(`INSTALLED_PMTILES_CORRUPTED_INVALIDATED: ${this.#corruptionReason}`);
    }
    if (this.#isExternallyInvalidated) {
      const extReason = await this.#isExternallyInvalidated();
      if (extReason) {
        this.#corrupted = true;
        this.#corruptionReason = extReason;
        throw new CorruptedArchiveError(`INSTALLED_PMTILES_CORRUPTED_INVALIDATED: ${extReason}`);
      }
    }
  }

  /**
   * Full backing-asset integrity audit verifying size, every 16 KiB block, and full-file SHA-256.
   * Puts this source (and durable registry record via callback) into fail-closed invalidated state on failure.
   */
  async verifyIntegrity(): Promise<Readonly<{ ok: true } | { ok: false; reason: string }>> {
    if (this.#corrupted) {
      return { ok: false, reason: this.#corruptionReason ?? 'INSTALLED_PMTILES_CORRUPTED_INVALIDATED' };
    }
    const ext = await this.#isExternallyInvalidated?.();
    if (ext) {
      this.#corrupted = true;
      this.#corruptionReason = ext;
      return { ok: false, reason: ext };
    }

    const stat = await this.#backend.committedStat(this.#committedKey);
    if (!stat.exists) {
      const reason = `INSTALLED_PMTILES_MISSING: ${this.#committedKey}`;
      await this.#markCorrupted(reason);
      return { ok: false, reason };
    }
    if (stat.byteLength !== this.#expectedByteLength) {
      const reason = `INSTALLED_PMTILES_SIZE_MISMATCH: expected=${this.#expectedByteLength} actual=${stat.byteLength}`;
      await this.#markCorrupted(reason);
      return { ok: false, reason };
    }
    const allBytes = await this.#backend.readCommittedAll(this.#committedKey);
    const actualSha = await sha256Hex(allBytes);
    if (actualSha !== this.#expectedSha256) {
      const reason = `INSTALLED_PMTILES_SHA256_MISMATCH: expected=${this.#expectedSha256} actual=${actualSha}`;
      await this.#markCorrupted(reason);
      return { ok: false, reason };
    }
    return { ok: true };
  }

  async getBytes(offset: number, length: number, signal?: AbortSignal): Promise<{ readonly data: ArrayBuffer }> {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    await this.#assertNotInvalidated();

    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new RangeError(`Invalid PMTiles range offset: ${offset}`);
    }
    if (!Number.isSafeInteger(length) || length < 0 || length > this.#maxSingleRangeBytes) {
      throw new RangeError(`Invalid or oversized PMTiles range length: ${length} (cap=${this.#maxSingleRangeBytes})`);
    }
    if (!Number.isSafeInteger(offset + length)) {
      throw new RangeError(`Range offset+length overflow: ${offset} + ${length}`);
    }
    const stat = await this.#backend.committedStat(this.#committedKey);
    if (!stat.exists) {
      const reason = `INSTALLED_PMTILES_MISSING: ${this.#committedKey}`;
      await this.#markCorrupted(reason);
      throw new CorruptedArchiveError(reason);
    }
    if (stat.byteLength !== this.#expectedByteLength) {
      const reason = `INSTALLED_PMTILES_SIZE_MISMATCH: expected=${this.#expectedByteLength} actual=${stat.byteLength}`;
      await this.#markCorrupted(reason);
      throw new CorruptedArchiveError(reason);
    }
    if (offset >= stat.byteLength) {
      throw new RangeError(`Range offset ${offset} out of bounds for size ${stat.byteLength}`);
    }

    const requestedEnd = Math.min(stat.byteLength, offset + length);
    const outLength = requestedEnd - offset;
    if (outLength === 0) {
      return { data: new ArrayBuffer(0) };
    }

    // Bounded block-aligned read & cryptographic verification: reads ONLY touched 16 KiB block(s)
    const firstBlock = Math.floor(offset / this.#blockSizeBytes);
    const lastBlock = Math.floor((requestedEnd - 1) / this.#blockSizeBytes);
    const alignedStart = firstBlock * this.#blockSizeBytes;
    const alignedEnd = Math.min(stat.byteLength, (lastBlock + 1) * this.#blockSizeBytes);
    const alignedLen = alignedEnd - alignedStart;

    const alignedBuf = await this.#backend.readCommittedRange(this.#committedKey, alignedStart, alignedLen, signal);
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (alignedBuf.byteLength !== alignedLen) {
      const reason = `SHORT_RANGE_READ: expected=${alignedLen} actual=${alignedBuf.byteLength}`;
      await this.#markCorrupted(reason);
      throw new CorruptedArchiveError(reason);
    }

    const alignedBytes = new Uint8Array(alignedBuf);
    for (let blk = firstBlock; blk <= lastBlock; blk++) {
      const blkOffsetInBuf = (blk - firstBlock) * this.#blockSizeBytes;
      const blkExpectedEnd = Math.min(stat.byteLength, (blk + 1) * this.#blockSizeBytes);
      const blkLen = blkExpectedEnd - blk * this.#blockSizeBytes;
      const blkSlice = alignedBytes.subarray(blkOffsetInBuf, blkOffsetInBuf + blkLen);
      const actualBlkSha = await sha256Hex(blkSlice);
      if (actualBlkSha !== this.#blockSha256s[blk]) {
        const reason = `CORRUPTED_PMTILES_BLOCK_SHA256_MISMATCH: key=${this.#committedKey} block=${blk}`;
        await this.#markCorrupted(reason);
        throw new CorruptedArchiveError(reason);
      }
      this.#verifiedBlocksRead += 1;
    }

    const relStart = offset - alignedStart;
    const relEnd = relStart + outLength;
    const slice = alignedBytes.subarray(relStart, relEnd);

    if (offset === 0 && slice.byteLength >= 7) {
      const magic = new TextDecoder().decode(slice.subarray(0, 7));
      if (magic !== 'PMTiles') {
        const reason = `CORRUPTED_PMTILES_MAGIC_HEADER: ${this.#committedKey}`;
        await this.#markCorrupted(reason);
        throw new CorruptedArchiveError(reason);
      }
    }

    this.#rangeReadCount += 1;
    this.#totalBytesRead += slice.byteLength;
    if (slice.byteLength > this.#maxSingleReadBytes) {
      this.#maxSingleReadBytes = slice.byteLength;
    }

    return {
      data: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) as ArrayBuffer,
    };
  }
}
